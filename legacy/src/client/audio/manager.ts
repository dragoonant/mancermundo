// Web Audio manager (ported from Mallet 42k and extended): AudioContext unlock on any gesture (retried all session, iOS-safe),
// master / sfx / voice / music buses, per-id concurrency cap and retrigger gap, per-play detune jitter,
// measured per-id trims from public/audio/trims.json, and two streamed music slots with crossfades and a
// playback-rate control (the "tense" battle variant). Nothing here knows about game events; see eventSounds.ts.
// Safe in node: with no window every call is a no-op.
import { audioUrl, channelFor, SHORT_IDS, TRIMS_URL, type MusicId, type SoundChannel, type SoundId } from './ids'
import { loadAudioSettings, saveAudioSettings, type AudioSettings } from './settings'

export interface PlayOptions {
  /** 0..1, multiplies the channel volume and the measured trim */
  volume?: number
  /** max random pitch jitter in cents (+/-); defaults per channel, 0 disables */
  detuneJitter?: number
  /** delay before the sound starts, in ms */
  delayMs?: number
}

const MAX_CONCURRENT_PER_ID = 4
const MIN_RETRIGGER_MS: Record<SoundChannel, number> = { sfx: 30, voice: 120, music: 0 }
const DEFAULT_JITTER_CENTS: Record<SoundChannel, number> = { sfx: 25, voice: 0, music: 0 }

interface Throttle {
  active: number
  lastStart: number
}

interface MusicSlot {
  el: HTMLAudioElement
  src: MediaElementAudioSourceNode
  gain: GainNode
  id: MusicId | null
}

export interface MusicRequest {
  id: MusicId | null
  rate?: number
  loop?: boolean
  fadeMs?: number
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Events that count as a user activation somewhere (iOS: touchend / pointerup / click; desktop: pointerdown / keydown). */
const GESTURES = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown'] as const

export class AudioManager {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private buses: Partial<Record<SoundChannel, GainNode>> = {}
  private settings: AudioSettings = loadAudioSettings()
  private listeners = new Set<(s: AudioSettings) => void>()
  private buffers = new Map<SoundId, AudioBuffer>()
  private loading = new Map<SoundId, Promise<AudioBuffer | null>>()
  private throttle = new Map<SoundId, Throttle>()
  private trims: Record<string, number> = {}
  private trimsLoaded = false
  private unlocked = false
  private attached = false
  private slots: MusicSlot[] = []
  private current = 0
  private wanted: MusicRequest = { id: null }
  private voiceBusyUntil = 0
  /** ids requested (for tests and debugging), bounded */
  readonly history: SoundId[] = []

  private get hasWindow(): boolean {
    return typeof window !== 'undefined'
  }

  /** Gestures unlock audio. iOS Safari only lets a touchend / pointerup / click resume an AudioContext (not the
   *  touchstart / pointerdown that comes first), and suspends it again after a call or a trip to another app, so the
   *  listeners stay attached for the whole session and every gesture retries whatever is still locked. Idempotent. */
  attachAutoUnlock(): void {
    if (this.attached || !this.hasWindow) return
    this.attached = true
    const handler = () => this.onGesture()
    for (const type of GESTURES) window.addEventListener(type, handler, { capture: true, passive: true })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {})
    })
    void this.loadTrims()
  }

  /** Runs synchronously inside the gesture: resume() and a silent buffer must start within the user activation. */
  private onGesture(): void {
    this.ensureContext()
    const ctx = this.ctx
    if (!ctx) return
    if (ctx.state !== 'running') {
      try {
        const blip = ctx.createBufferSource()
        blip.buffer = ctx.createBuffer(1, 1, 22050)
        blip.connect(ctx.destination)
        blip.start(0)
      } catch {
        /* the resume below is what matters */
      }
      void ctx.resume().then(() => this.syncUnlocked(), () => {})
      return
    }
    this.syncUnlocked()
    // music refused by an earlier autoplay block: a gesture is the moment to retry it
    const cur = this.slots[this.current]
    if (cur?.id && cur.el.paused) void cur.el.play().catch(() => {})
  }

  async unlock(): Promise<void> {
    if (!this.hasWindow) return
    this.ensureContext()
    if (this.ctx && this.ctx.state !== 'running') {
      try {
        await this.ctx.resume()
      } catch {
        /* the next real gesture retries */
      }
    }
    this.syncUnlocked()
  }

  /** Follows the context's state: on the way to running it loads trims, preloads the short sounds and starts music. */
  private syncUnlocked(): void {
    const was = this.unlocked
    this.unlocked = this.ctx?.state === 'running'
    if (this.unlocked && !was) {
      void this.loadTrims()
      this.preload(SHORT_IDS)
      this.applyMusic()
    }
  }

  isUnlocked(): boolean {
    return this.unlocked
  }

  private async loadTrims(): Promise<void> {
    if (this.trimsLoaded || !this.hasWindow || typeof fetch === 'undefined') return
    this.trimsLoaded = true
    try {
      const res = await fetch(TRIMS_URL)
      if (res.ok) this.trims = (await res.json()) as Record<string, number>
    } catch {
      /* untrimmed playback is fine */
    }
  }

  /** Measured playback gain for an id (1 when unknown). */
  trimOf(id: string): number {
    const t = this.trims[id]
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : 1
  }

  private ensureContext(): void {
    if (this.ctx || !this.hasWindow) return
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    // iOS: the 'playback' session plays through the ring / silent switch (the default session is muted by it)
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
      if (session) session.type = 'playback'
    } catch {
      /* not supported: older Safari keeps the default session */
    }
    try {
      this.ctx = new Ctor()
    } catch {
      return
    }
    this.ctx.onstatechange = () => this.syncUnlocked()
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
    for (const ch of ['sfx', 'voice', 'music'] as const) {
      const g = this.ctx.createGain()
      g.connect(this.master)
      this.buses[ch] = g
    }
    this.applyGains()
  }

  private applyGains(): void {
    if (!this.master) return
    this.master.gain.value = this.settings.muted ? 0 : clamp01(this.settings.master)
    for (const ch of ['sfx', 'voice', 'music'] as const) {
      const g = this.buses[ch]
      if (g) g.gain.value = clamp01(this.settings[ch])
    }
  }

  // ---------------------------------------------------------------- one shots

  preload(ids: readonly SoundId[]): void {
    for (const id of ids) void this.ensureBuffer(id)
  }

  private async ensureBuffer(id: SoundId): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(id)
    if (cached) return cached
    const inFlight = this.loading.get(id)
    if (inFlight) return inFlight
    const p = (async () => {
      try {
        this.ensureContext()
        if (!this.ctx) return null
        const res = await fetch(audioUrl(id))
        if (!res.ok) throw new Error(String(res.status))
        const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
        this.buffers.set(id, buf)
        return buf
      } catch (err) {
        console.warn(`[audio] could not load "${id}"`, err)
        return null
      } finally {
        this.loading.delete(id)
      }
    })()
    this.loading.set(id, p)
    return p
  }

  /** Plays a sound. Silent before unlock, while still decoding, or when the id's throttle is hit. */
  play(id: SoundId, opts: PlayOptions = {}): void {
    if (!this.hasWindow) return
    if (opts.delayMs && opts.delayMs > 0) {
      const { delayMs, ...rest } = opts
      setTimeout(() => this.play(id, rest), delayMs)
      return
    }
    this.history.push(id)
    if (this.history.length > 200) this.history.splice(0, 100)
    const channel = channelFor(id)
    if (channel === 'music') return
    const now = performance.now()
    const st = this.throttle.get(id) ?? { active: 0, lastStart: 0 }
    if (st.active >= MAX_CONCURRENT_PER_ID || now - st.lastStart < MIN_RETRIGGER_MS[channel]) return
    // a new narrator line never starts over one that is still speaking
    if (channel === 'voice' && now < this.voiceBusyUntil) return
    const buf = this.buffers.get(id)
    if (buf) {
      this.start(id, channel, buf, opts, st, now)
      return
    }
    void this.ensureBuffer(id).then((b) => {
      if (b && this.unlocked) this.play(id, opts)
    })
  }

  private start(id: SoundId, channel: SoundChannel, buf: AudioBuffer, opts: PlayOptions, st: Throttle, now: number): void {
    if (!this.unlocked || !this.ctx) return
    const bus = this.buses[channel]
    if (!bus) return
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const jitter = opts.detuneJitter ?? DEFAULT_JITTER_CENTS[channel]
    if (jitter) src.detune.value = (Math.random() * 2 - 1) * jitter
    const gain = this.ctx.createGain()
    gain.gain.value = Math.min(8, Math.max(0, (opts.volume ?? 1) * this.trimOf(id)))
    src.connect(gain).connect(bus)
    st.active++
    st.lastStart = now
    this.throttle.set(id, st)
    if (channel === 'voice') this.voiceBusyUntil = now + buf.duration * 1000 * 0.9
    src.onended = () => {
      st.active = Math.max(0, st.active - 1)
      src.disconnect()
      gain.disconnect()
    }
    src.start()
  }

  // ---------------------------------------------------------------- music

  private ensureSlots(): boolean {
    this.ensureContext()
    const bus = this.buses.music
    if (!this.ctx || !bus) return false
    while (this.slots.length < 2) {
      const el = new Audio()
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      const src = this.ctx.createMediaElementSource(el)
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      src.connect(gain).connect(bus)
      this.slots.push({ el, src, gain, id: null })
    }
    return true
  }

  /** What the music director wants playing. Remembered until the context unlocks. */
  setMusic(req: MusicRequest): void {
    this.wanted = req
    if (this.unlocked) this.applyMusic()
  }

  getMusic(): MusicRequest {
    return this.wanted
  }

  private applyMusic(): void {
    if (!this.unlocked || !this.ctx || !this.ensureSlots()) return
    const req = this.wanted
    const fade = Math.max(0.05, (req.fadeMs ?? 1500) / 1000)
    const now = this.ctx.currentTime
    const cur = this.slots[this.current]!
    const other = this.slots[1 - this.current]!
    if (req.id === null) {
      this.fadeOut(cur, fade, now)
      this.fadeOut(other, fade, now)
      return
    }
    if (cur.id === req.id) {
      cur.el.playbackRate = req.rate ?? 1
      cur.el.loop = req.loop !== false
      return
    }
    // crossfade: the idle slot takes the new track while the current one fades out
    this.fadeOut(cur, fade, now)
    other.el.src = audioUrl(req.id)
    other.id = req.id
    other.el.loop = req.loop !== false
    other.el.playbackRate = req.rate ?? 1
    other.el.currentTime = 0
    other.gain.gain.cancelScheduledValues(now)
    other.gain.gain.setValueAtTime(0, now)
    other.gain.gain.linearRampToValueAtTime(this.trimOf(req.id), now + fade)
    void other.el.play().catch(() => {
      /* autoplay refusal: the next gesture re-applies */
    })
    this.current = 1 - this.current
  }

  private fadeOut(slot: MusicSlot, fade: number, now: number): void {
    if (!slot.id) return
    const g = slot.gain.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(0, now + fade)
    const el = slot.el
    const id = slot.id
    window.setTimeout(() => {
      if (slot.id === id && g.value < 0.001) {
        el.pause()
        slot.id = null
      }
    }, fade * 1000 + 80)
  }

  // ---------------------------------------------------------------- settings

  getSettings(): AudioSettings {
    return this.settings
  }

  setMuted(muted: boolean): void {
    this.update({ ...this.settings, muted })
  }

  setVolume(channel: 'master' | SoundChannel, value: number): void {
    this.update({ ...this.settings, [channel]: clamp01(value) })
  }

  private update(next: AudioSettings): void {
    this.settings = next
    saveAudioSettings(next)
    this.applyGains()
    for (const l of this.listeners) l(next)
  }

  onSettingsChange(l: (s: AudioSettings) => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
}

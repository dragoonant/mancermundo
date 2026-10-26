// iOS audio unlock: Safari refuses AudioContext.resume() from touchstart / pointerdown and only honours it from
// touchend / pointerup / click, so the manager must keep listening after a failed first touch.
import { afterEach, describe, expect, it, vi } from 'vitest'

let activation = false

class FakeCtx {
  state: 'suspended' | 'running' | 'interrupted' = 'suspended'
  onstatechange: (() => void) | null = null
  destination = {}
  currentTime = 0
  createGain() {
    return { gain: { value: 1 }, connect: () => ({}) }
  }
  createBuffer() {
    return {}
  }
  createMediaElementSource() {
    return { connect: () => ({ connect: () => ({}) }) }
  }
  createBufferSource() {
    return { buffer: null, connect: () => ({}), start: () => {} }
  }
  resume(): Promise<void> {
    // only a "real" activation (touchend in this fake) may resume, like iOS Safari
    if (!activation) return Promise.reject(new Error('not allowed'))
    this.state = 'running'
    this.onstatechange?.()
    return Promise.resolve()
  }
}

function fakeWindow() {
  const target = new EventTarget()
  const doc = new EventTarget() as EventTarget & { visibilityState: string }
  doc.visibilityState = 'visible'
  const win = Object.assign(target, { AudioContext: FakeCtx })
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  vi.stubGlobal('Audio', class {
    paused = true
    play() {
      return Promise.resolve()
    }
    pause() {}
  })
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  return win
}

async function fire(win: EventTarget, type: string, allowed: boolean) {
  activation = allowed
  win.dispatchEvent(new Event(type))
  activation = false
  await new Promise((r) => setTimeout(r, 0))
}

describe('audio unlock on touch devices', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('AUDIO-UNLOCK-001 a refused touchstart does not end the unlock: the touchend that follows unlocks', async () => {
    const win = fakeWindow()
    const { AudioManager } = await import('../../src/client/audio/manager')
    const m = new AudioManager()
    m.attachAutoUnlock()
    await fire(win, 'touchstart', false)
    expect(m.isUnlocked()).toBe(false)
    await fire(win, 'touchend', true)
    expect(m.isUnlocked()).toBe(true)
  })

  it('AUDIO-UNLOCK-002 an interruption (call, app switch) locks again and the next gesture resumes', async () => {
    const win = fakeWindow()
    const { AudioManager } = await import('../../src/client/audio/manager')
    const m = new AudioManager()
    m.attachAutoUnlock()
    await fire(win, 'click', true)
    expect(m.isUnlocked()).toBe(true)
    const ctx = (m as unknown as { ctx: FakeCtx }).ctx
    ctx.state = 'interrupted'
    ctx.onstatechange?.()
    expect(m.isUnlocked()).toBe(false)
    await fire(win, 'pointerup', true)
    expect(m.isUnlocked()).toBe(true)
  })
})

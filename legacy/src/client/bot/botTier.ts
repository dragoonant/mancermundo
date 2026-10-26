// Bot tier preference (Start screen selector). Kept apart from the worker client so the menus never import the AI.
import { TIER_IDS, type Tier } from '@/ai/tiers'

export type BotTier = Tier
export const BOT_TIERS: readonly BotTier[] = TIER_IDS
export const DEFAULT_BOT_TIER: BotTier = 'normal'
const STORAGE_KEY = 'ms.botTier'

export function isTier(v: unknown): v is BotTier {
  return typeof v === 'string' && (TIER_IDS as readonly string[]).includes(v)
}

/** The tier chosen on the Start screen (`setBotTier`), else `?bot=` in the URL (which wins), else normal. */
export function getBotTier(): BotTier {
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('bot') : null
    if (isTier(q)) return q
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (isTier(s)) return s
  } catch {
    // storage may be blocked
  }
  return DEFAULT_BOT_TIER
}

export function setBotTier(tier: BotTier): void {
  try {
    localStorage.setItem(STORAGE_KEY, tier)
  } catch {
    // ignore
  }
}

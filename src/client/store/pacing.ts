// Pacing rules of a watched (AI vs AI) game. Pure, so the store and the tests share them: how long the bot waits before it answers,
// how long the "what the AI is deciding" card stays up, and which decisions start an attack.
import type { Seat } from '@/engine'
import { speedFactor, type AnimSpeed } from '../presentation/settings'
import type { SeatMode } from '../params'

/** Pause (ms at normal speed) between the end of the last beat and the bot's answer. */
export const BOT_DELAY_MS = 250
/** How long the decision card stays up before a running game applies the answer (ms at normal speed). */
export const CARD_HOLD_MS = 1100

export const botDelayMs = (speed: AnimSpeed): number => Math.round(BOT_DELAY_MS * speedFactor(speed))
/** Zero at Instant: the card still updates, but nothing waits for it. */
export const cardHoldMs = (speed: AnimSpeed): number => Math.round(CARD_HOLD_MS * speedFactor(speed))

/** The decision kinds that make up a shooting or fighting sequence. */
const ATTACK_KINDS = new Set(['shoot.weapon', 'shoot.target', 'shoot.aim', 'shoot.allocate', 'fight.weapons', 'fight.split', 'fight.after'])
export const isAttackKind = (kind: string | null): boolean => kind !== null && ATTACK_KINDS.has(kind)

/** True for the first decision of a shooting or fighting sequence (the decision before it was not part of one). */
export const startsAttackSequence = (previousKind: string | null, kind: string): boolean => isAttackKind(kind) && !isAttackKind(previousKind)

/** Nobody at a human seat: the watch controls apply. */
export const isWatching = (seats: Record<Seat, SeatMode>): boolean => seats.A === 'bot' && seats.B === 'bot'

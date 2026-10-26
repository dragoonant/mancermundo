// Public surface of the AI package (docs/spec/40-ai).
export { createAiDecider, answerOk, POLICIES } from './decider'
export type { AiDecider, AiOpts } from './decider'
export { handleRequest } from './worker'
export type { WorkerRequest, WorkerResponse } from './worker'
export { randomPolicy } from './random'
export { TIERS, TIER_IDS, aiBudgetMs, tunedWeights, DEFAULT_WEIGHTS } from './tiers'
export type { Tier, TierParams, Weights, AiMemory, AiStats } from './tiers'

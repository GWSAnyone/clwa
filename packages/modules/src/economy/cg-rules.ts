import type { ConsequenceRule } from '@clwa/engine';

/**
 * Economy → crime cross-module consequence rules (M7 P5). Consumed by the server (merged with CRIME_CG_RULES
 * into the engine's CG bus); NOT self-registered. The engine processes them generically — no module-to-module
 * import. This is the connective tissue: economic hardship spills into crime motives.
 */
export const ECONOMY_CG_RULES: ConsequenceRule[] = [
  // A defaulted debt breeds a grudge. demand_payment emits DEBT_DEFAULT with payload.affectedTargets =
  // [creditorId]; this rule gives that creditor a DEBT_GRUDGE consequence → the economy's belief creator turns
  // it into a PERSONAL_GRUDGE motive toward the debtor (event.subject). Crime's threaten/argue/kill affordances
  // already react to PERSONAL_GRUDGE — so an unpaid debt can escalate into violence. Economy → crime, zero shared code.
  {
    id: 'debt-default-grudge',
    trigger: 'DEBT_DEFAULT',
    targetMode: 'affected',
    conditions: [],
    consequence: { type: 'DEBT_GRUDGE', importance: 5, delayDays: 0, probability: 1.0 },
    maxChainDepth: 1,
  },
  // Scarcity → economic desperation. The pricing tick emits SHORTAGE with payload.affectedTargets = broke + hungry
  // agents; this rule gives each of them a DEBT_PRESSURE consequence → the economy's belief creator sharpens their
  // hunger need (→ economy scoring boosts buy/sell/smuggle) + records a pressure belief. Environment → economy, zero shared code.
  {
    id: 'shortage-debt-pressure',
    trigger: 'SHORTAGE',
    targetMode: 'affected',
    conditions: [],
    consequence: { type: 'DEBT_PRESSURE', importance: 4, delayDays: 0, probability: 1.0 },
    maxChainDepth: 1,
  },
];

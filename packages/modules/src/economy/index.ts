/**
 * Economy / Trade Module — the second genre on the CLWA engine (M7).
 *
 * Registers economic CONTENT (intents, affordances, events, pricing, debt, CG rules) through engine
 * registries. The engine NEVER imports this module (INV-14). Built on the M5 substrate (scalar attributes /
 * inventory / factions / capabilities) + the M7 universal primitives:
 *   - E1 ScalarAttribute.drift  → price evolution + need growth
 *   - E2 overdraft transfer     → loans / debt
 *   - E3 INTENT_KIND registry   → the 'trade' player intent (below)
 *
 * This is CONTENT (what trading IS), not ENGINE (how decisions/transfers are computed).
 */

import { registerIntentKind } from '@clwa/engine';
import type { ConsequenceRule } from '@clwa/engine';

/** Economy consequence-graph rules — consumed by the server (merged with CRIME_CG_RULES into the engine),
 *  NOT self-registered (mirrors crime-justice's CRIME_CG_RULES). Filled in P5 (shortage→pressure,
 *  stock-theft→guild alarm, debt-default→grudge). Empty skeleton until then. */
export const ECONOMY_CG_RULES: ConsequenceRule[] = [];

let registered = false;

/** Idempotent registration hub (mirrors registerCrimeJusticeModule). Fills engine registries at boot. */
export function registerEconomyModule(): void {
  if (registered) return;
  registered = true;

  // 'trade' player intent (E3 INTENT_KIND registry) — the economy module owns the trade vocabulary as DATA,
  // so the engine names no economic concept (INV-14/15). The 'trade' speech act itself is part of the world's
  // IL vocabulary (registered at server boot); this kind binds the structured sub-intent to it.
  registerIntentKind({
    key: 'trade',
    speechActs: ['trade'],
    verbs: ['buy', 'sell', 'browse', 'trade'],
    schemaProperties: { category: { type: 'string' }, itemName: { type: 'string' } },
    promptLines: ['player wants to buy, sell, or browse goods / ask about prices. category: weapon, armor, potion, food, general; itemName: specific item if named.'],
  });

  console.log(`[Economy] Registered trade intent + ${ECONOMY_CG_RULES.length} CG rules`);
}

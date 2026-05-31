import { TARGET_FINDERS, isStatusAbsent, hasCapability, getAttributeValue } from '@clwa/engine';
import type { Agent, AffordanceContext, AffordanceTarget } from '@clwa/engine';

/** Co-located NPC (not the player, alive, present) matching `pred`. Trade happens face-to-face at a venue. */
function coLocated(npcId: string, agent: Agent, ctx: AffordanceContext, pred: (o: Agent) => boolean): AffordanceTarget | null {
  for (const [otherId, other] of ctx.agents) {
    if (otherId === npcId || !other.state.alive || other.profile.isPlayer) continue;
    if (isStatusAbsent(other.state.status)) continue;
    if (other.state.location === agent.state.location && pred(other)) {
      return { targetId: otherId, targetName: other.profile.name, targetLocation: other.state.location };
    }
  }
  return null;
}

const hasStock = (o: Agent): boolean => (o.state.inventory ?? []).some((it) => it.quantity > 0);
const hasCoin = (o: Agent): boolean => (getAttributeValue(o.state.attributes, 'gold') ?? 0) > 0;

export function registerEconomyTargetFinders(): void {
  // Seller: a co-located merchant with stock to sell.
  TARGET_FINDERS.set('trade_seller', (npcId, agent, ctx) =>
    coLocated(npcId, agent, ctx, (o) => hasCapability(o.profile, 'isMerchant') && hasStock(o)));
  // Buyer: a co-located NPC with coin to spend.
  TARGET_FINDERS.set('trade_buyer', (npcId, agent, ctx) =>
    coLocated(npcId, agent, ctx, (o) => hasCoin(o)));
  // Self: for self-directed economic actions (produce/hoard/smuggle) that act on the agent's own stock at
  // home — they have no external counterparty, so findTarget needs a non-null (self) target to mark them
  // actionable (findTarget falls back to TARGET_FINDERS.get(aff.id), so each is wired to this via targetFinder).
  TARGET_FINDERS.set('eco_self', (npcId, agent) => ({ targetId: npcId, targetName: agent.profile.name, targetLocation: agent.state.location }));
}

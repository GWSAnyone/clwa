/**
 * Social Module — universal social behavior for NPC-NPC conversations.
 *
 * Registers:
 * - Topic sources that drive NPC conversation topics
 * - Social affordances (socialize) for proactive social behavior
 *
 * This is CONTENT (what NPCs do/talk about), not ENGINE (how it's selected).
 */

import { TOPIC_SOURCE_REGISTRY, AFFORDANCE_REGISTRY, TARGET_FINDERS } from '@clwa/engine';
import type { Agent, AffordanceContext, AffordanceTarget } from '@clwa/engine';
import { SOCIAL_TOPIC_SOURCES } from './topic-sources';

/** Find a nearby NPC to socialize with (same or adjacent location) */
function findSocializeTarget(npcId: string, agent: Agent, ctx: AffordanceContext): AffordanceTarget | null {
  // Prefer co-located NPC
  for (const [otherId, other] of ctx.agents) {
    if (otherId === npcId || !other.state.alive || other.profile.isPlayer) continue;
    if (other.state.status) continue;
    if (other.state.location === agent.state.location) {
      return { targetId: otherId, targetName: other.profile.name, targetLocation: other.state.location };
    }
  }
  // Try adjacent locations
  const loc = ctx.locations.get(agent.state.location);
  if (loc) {
    for (const connId of loc.connections) {
      for (const [otherId, other] of ctx.agents) {
        if (otherId === npcId || !other.state.alive || other.profile.isPlayer) continue;
        if (other.state.status) continue;
        if (other.state.location === connId) {
          return { targetId: otherId, targetName: other.profile.name, targetLocation: connId };
        }
      }
    }
  }
  return null;
}

export function registerSocialModule(): void {
  // Register all social topic sources
  TOPIC_SOURCE_REGISTRY.push(...SOCIAL_TOPIC_SOURCES);

  // Social affordance — triggers LLM volition for extraverted NPCs even without crime events.
  // No actionVerb — doesn't appear in LLM action list. Provides instinct pressure only.
  // LLM chooses go/talk/wait freely. With socialOnly flag, "talk" becomes move-only → TopicEngine handles conversation.
  AFFORDANCE_REGISTRY.push({
    id: 'socialize',
    label: 'Seek out someone to talk to — the quiet gets to you',
    category: 'social',
    severity: 0,
    requires: { notGuard: true },
    weights: [
      { trait: 'E', direction: 'high', multiplier: 0.4 },  // E=0.9→0.36, E=0.5→0.20
      { trait: 'A', direction: 'high', multiplier: 0.1 },  // A=0.7→0.07
    ],
    moodWeight: 0,                // personality-driven, not mood-driven
    relationshipWeight: 0.0,
    baseProbability: 1.0,
    goalType: 'visit',
    goalPriority: 2,              // below schedule(3), doesn't interfere with routine
    stepTemplates: [
      { action: 'move_to', location: '$target', skipIfAt: true },
    ],
  });
  TARGET_FINDERS.set('socialize', findSocializeTarget);

  console.log(`[Social] Registered ${SOCIAL_TOPIC_SOURCES.length} topic sources + socialize affordance`);
}

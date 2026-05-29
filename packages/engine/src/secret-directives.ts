import type { Agent } from './agent';
import type { IEventStore } from './event-types';
import { getSecretDirectiveBuilders } from './event-registry';

/**
 * Build behavioral directives based on what an NPC secretly knows.
 * Injected into the LLM prompt so the NPC naturally acts on hidden knowledge.
 *
 * Universal aggregator — the engine owns NO directive prose. Every section is supplied by a
 * module/server via registerSecretDirectiveBuilder, keeping the engine genre-neutral. (Crime-justice
 * supplies own-crime concealment, covering-for-someone, want-justice, intimidated-witness, corrupt-guard
 * and heat directives.) No extra LLM calls — pure prompt enrichment.
 */
export function buildSecretDirectives(
  agent: Agent,
  agents: Map<string, Agent>,
  eventStore: IEventStore,
): string {
  const sections: string[] = [];
  for (const builder of getSecretDirectiveBuilders()) {
    sections.push(...builder({ agent, agents, eventStore }));
  }
  return sections.length === 0 ? '' : sections.join('\n\n');
}

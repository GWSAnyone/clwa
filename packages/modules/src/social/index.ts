/**
 * Social Module — universal social behavior for NPC-NPC conversations.
 *
 * Registers topic sources that drive NPC conversation topics:
 * beliefs, relationships, mood, inner conflict, role-specific, world facts, casual.
 *
 * This is CONTENT (what NPCs talk about), not ENGINE (how topics are selected).
 */

import { TOPIC_SOURCE_REGISTRY } from '@clwa/engine';
import { SOCIAL_TOPIC_SOURCES } from './topic-sources';

export function registerSocialModule(): void {
  // Register all social topic sources
  TOPIC_SOURCE_REGISTRY.push(...SOCIAL_TOPIC_SOURCES);
  console.log(`[Social] Registered ${SOCIAL_TOPIC_SOURCES.length} topic sources`);
}

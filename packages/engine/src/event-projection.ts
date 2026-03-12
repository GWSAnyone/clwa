import type { WorldEvent } from './cg-types';
import type { WorldState } from './event-types';

/** Mood shifts per consequence type (mirrors engine.ts values) */
const MOOD_SHIFTS: Record<string, number> = {
  WITNESS_MEMORY: -0.4,
  RUMOR_SPREAD: -0.15,
  WANTED_STATUS: -0.1,
};

/** Build world state as pure projection from events */
export function buildWorldState(events: WorldEvent[]): WorldState {
  const state: WorldState = {
    currentDay: 0,
    deadNpcs: new Set(),
    wantedSubjects: new Set(),
    locationFacts: new Map(),
    npcMoodShifts: new Map(),
  };

  for (const event of events) {
    if (event.gameDay > state.currentDay) {
      state.currentDay = event.gameDay;
    }

    // Track dead NPCs
    if (event.type === 'NPC_KILLED' && event.object) {
      state.deadNpcs.add(event.object);
    }

    // Track wanted subjects — prefer killerName from payload, fallback to subject
    if (event.type === 'WANTED_STATUS') {
      const wanted = (event.payload?.killerName as string) ?? event.subject;
      state.wantedSubjects.add(wanted);
    }

    // Accumulate mood shifts per affected target
    const moodShift = MOOD_SHIFTS[event.type] ?? 0;
    if (moodShift !== 0) {
      const targets = (event.payload?.affectedTargets as string[]) ?? [];
      for (const targetId of targets) {
        const current = state.npcMoodShifts.get(targetId) ?? 0;
        state.npcMoodShifts.set(targetId, current + moodShift);
      }
    }

    // Aggregate facts per location
    const fact = buildFactText(event);
    if (fact) {
      const existing = state.locationFacts.get(event.location) ?? [];
      existing.push(fact);
      state.locationFacts.set(event.location, existing);
    }
  }

  return state;
}

function buildFactText(event: WorldEvent): string | null {
  switch (event.type) {
    case 'NPC_KILLED':
      return `[day ${event.gameDay}] ${event.subject} killed ${event.object ?? 'someone'}`;
    case 'WITNESS_MEMORY':
      return `[day ${event.gameDay}] Witnesses observed a murder`;
    case 'RUMOR_SPREAD':
      return `[day ${event.gameDay}] Rumors spreading about a murder`;
    case 'WANTED_STATUS': {
      const wanted = (event.payload?.killerName as string) ?? event.subject;
      return `[day ${event.gameDay}] ${wanted} is now WANTED`;
    }
    case 'NPC_CONVERSATION':
      return `[day ${event.gameDay}] ${event.subject} talked to ${event.object ?? 'someone'}`;
    default:
      return null;
  }
}

import type { WorldEvent } from './cg-types';
import type { WorldState } from './event-types';
import { isDeathEvent, isPursuitEvent, getEventMoodShift, getEventLabel } from './event-registry';

/** Build world state as pure projection from events */
export function buildWorldState(events: WorldEvent[]): WorldState {
  const state: WorldState = {
    currentDay: 0,
    deadNpcs: new Set(),
    pursuedSubjects: new Set(),
    locationFacts: new Map(),
    npcMoodShifts: new Map(),
  };

  for (const event of events) {
    if (event.gameDay > state.currentDay) {
      state.currentDay = event.gameDay;
    }

    // Track dead NPCs (death events registered by modules)
    if (isDeathEvent(event.type) && event.object) {
      state.deadNpcs.add(event.object);
    }

    // Track pursued subjects (pursuit events registered by modules)
    if (isPursuitEvent(event.type)) {
      const pursued = event.subject ?? (event.payload?.perpetratorName as string);
      state.pursuedSubjects.add(pursued);
    }

    // Accumulate mood shifts per affected target
    const moodShift = getEventMoodShift(event.type);
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
  const label = getEventLabel(event.type);
  if (!label) return null;
  return `[day ${event.gameDay}] ${event.subject ?? 'someone'}: ${label} — ${event.object ?? ''}`;
}

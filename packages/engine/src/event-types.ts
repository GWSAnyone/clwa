import type { WorldEvent, EventType } from './cg-types';

/** Query filter — all fields optional, combined with AND */
export interface EventQuery {
  type?: EventType;
  location?: string;
  gameDay?: number;
  gameDayFrom?: number;
  gameDayTo?: number;
  subject?: string;
  object?: string;
}

/** Projected world state — reconstructed from events */
export interface WorldState {
  currentDay: number;
  deadNpcs: Set<string>;
  pursuedSubjects: Set<string>;
  locationFacts: Map<string, string[]>;
  npcMoodShifts: Map<string, number>;
}

/** Clean interface for future SpacetimeDB swap */
export interface IEventStore {
  append(event: WorldEvent): void;
  query(filter: EventQuery): WorldEvent[];
  getAll(): readonly WorldEvent[];
  getById(id: string): WorldEvent | undefined;
  getState(): WorldState;
  getStateAtDay(day: number): WorldState;
  readonly count: number;
}

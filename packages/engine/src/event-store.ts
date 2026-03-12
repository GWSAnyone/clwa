import type { WorldEvent } from './cg-types';
import type { EventQuery, WorldState, IEventStore } from './event-types';
import { buildWorldState } from './event-projection';

export class InMemoryEventStore implements IEventStore {
  private events: WorldEvent[] = [];
  private index: Map<string, WorldEvent> = new Map();

  get count(): number {
    return this.events.length;
  }

  append(event: WorldEvent): void {
    if (!event.id || !event.type || !event.location) {
      throw new Error(`Invalid event: missing required fields (id, type, location)`);
    }
    // Prevent duplicate events
    if (this.index.has(event.id)) return;

    this.events.push(event);
    this.index.set(event.id, event);
  }

  query(filter: EventQuery): WorldEvent[] {
    return this.events.filter((e) => {
      if (filter.type && e.type !== filter.type) return false;
      if (filter.location && e.location !== filter.location) return false;
      if (filter.gameDay !== undefined && e.gameDay !== filter.gameDay) return false;
      if (filter.gameDayFrom !== undefined && e.gameDay < filter.gameDayFrom) return false;
      if (filter.gameDayTo !== undefined && e.gameDay > filter.gameDayTo) return false;
      if (filter.subject && e.subject !== filter.subject) return false;
      if (filter.object && e.object !== filter.object) return false;
      return true;
    });
  }

  getAll(): readonly WorldEvent[] {
    return this.events;
  }

  getById(id: string): WorldEvent | undefined {
    return this.index.get(id);
  }

  getState(): WorldState {
    return buildWorldState(this.events);
  }

  getStateAtDay(day: number): WorldState {
    const filtered = this.events.filter((e) => e.gameDay <= day);
    return buildWorldState(filtered);
  }

  /** Serializable snapshot of all events */
  toJSON(): WorldEvent[] {
    return [...this.events];
  }

  /** Restore events from a saved snapshot */
  loadFromJSON(events: WorldEvent[]): void {
    this.events = [];
    this.index.clear();
    for (const event of events) {
      this.events.push(event);
      this.index.set(event.id, event);
    }
  }
}

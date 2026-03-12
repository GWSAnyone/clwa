/** A single entry in the player's investigation journal */
export interface JournalEntry {
  id: string;
  type: 'clue' | 'testimony' | 'observation';
  /** The actual content shown to the player */
  text: string;
  /** Where it came from — NPC name, location name, or "self" */
  source: string;
  /** NPC IDs related to this entry */
  relatedNpcs: string[];
  /** Location where this was discovered */
  locationId?: string;
  /** Game time */
  gameDay: number;
  tick: number;
  /** Link to crime scene if from examination */
  crimeSceneId?: string;
}

/**
 * Player's investigation journal — collects clues, testimonies, and observations.
 * Acts as the player's "case board" for piecing together what happened.
 */
export class PlayerJournal {
  private entries: JournalEntry[] = [];

  /** Add a clue from crime scene examination */
  addClue(
    text: string,
    locationId: string,
    gameDay: number,
    tick: number,
    crimeSceneId?: string,
    relatedNpcs: string[] = [],
  ): JournalEntry {
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      type: 'clue',
      text,
      source: locationId,
      relatedNpcs,
      locationId,
      gameDay,
      tick,
      crimeSceneId,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Add testimony from an NPC conversation */
  addTestimony(
    text: string,
    npcName: string,
    npcId: string,
    locationId: string,
    gameDay: number,
    tick: number,
    mentionedNpcs: string[] = [],
  ): JournalEntry {
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      type: 'testimony',
      text,
      source: npcName,
      relatedNpcs: [npcId, ...mentionedNpcs],
      locationId,
      gameDay,
      tick,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Add a player observation (witnessed event) */
  addObservation(
    text: string,
    locationId: string,
    gameDay: number,
    tick: number,
    relatedNpcs: string[] = [],
  ): JournalEntry {
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      type: 'observation',
      text,
      source: 'self',
      relatedNpcs,
      locationId,
      gameDay,
      tick,
    };
    this.entries.push(entry);
    return entry;
  }

  /** Get all entries, optionally filtered */
  getEntries(filter?: { type?: JournalEntry['type']; locationId?: string }): JournalEntry[] {
    let result = this.entries;
    if (filter?.type) {
      result = result.filter((e) => e.type === filter.type);
    }
    if (filter?.locationId) {
      result = result.filter((e) => e.locationId === filter.locationId);
    }
    return result;
  }

  /** Get entry count */
  get count(): number {
    return this.entries.length;
  }

  /** Serialize for persistence */
  toJSON(): JournalEntry[] {
    return this.entries;
  }

  /** Restore from saved data */
  static fromJSON(data: JournalEntry[]): PlayerJournal {
    const journal = new PlayerJournal();
    journal.entries = data;
    return journal;
  }
}

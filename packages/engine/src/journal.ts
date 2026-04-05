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
  /** Structured evidence fields — populated from EL at creation time */
  evidenceCategory?: string;
  evidenceWeight?: number;
  suspectId?: string;
  victimId?: string;
  eventType?: string;
  /** NPC IDs who've been shown this evidence via Evidence Presentation */
  presentedTo?: string[];
}

/** Aggregated evidence assessment for a suspect */
export interface CaseSummary {
  suspectId: string;
  suspectName: string;
  entries: JournalEntry[];
  /** Dynamic evidence category counts — keys come from module data, not engine */
  evidence: Record<string, number>;
  totalScore: number;
  quality: 'strong' | 'moderate' | 'weak' | 'insufficient';
  summary: string;
}

/**
 * Player's investigation journal — collects clues, testimonies, and observations.
 * Acts as the player's "case board" for piecing together what happened.
 */
const DEFAULT_WEIGHTS: Record<string, number> = {
  clue: 0.10,
  testimony: 0.12,
  observation: 0.08,
};

/**
 * Player's investigation journal — collects clues, testimonies, and observations.
 * Acts as the player's "case board" for piecing together what happened.
 */
export class PlayerJournal {
  private entries: JournalEntry[] = [];
  private _suspects: Set<string> = new Set();

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
      presentedTo: [],
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
      presentedTo: [],
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
      presentedTo: [],
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

  /** Get entry by ID */
  getEntry(id: string): JournalEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /** Get all entries related to a specific NPC */
  getEntriesForSuspect(npcId: string): JournalEntry[] {
    return this.entries.filter((e) => e.relatedNpcs.includes(npcId));
  }

  // ─── Suspect Tracking ───

  markSuspect(npcId: string): boolean {
    if (this._suspects.has(npcId)) {
      this._suspects.delete(npcId);
      return false;
    }
    this._suspects.add(npcId);
    return true;
  }

  isSuspect(npcId: string): boolean {
    return this._suspects.has(npcId);
  }

  getSuspects(): string[] {
    return [...this._suspects];
  }

  // ─── Evidence Presentation Tracking ───

  canPresent(entryId: string, npcId: string): boolean {
    const entry = this.getEntry(entryId);
    if (!entry) return false;
    if (!entry.evidenceCategory && entry.type !== 'testimony') return false;
    return !(entry.presentedTo ?? []).includes(npcId);
  }

  markPresented(entryId: string, npcId: string): boolean {
    const entry = this.getEntry(entryId);
    if (!entry) return false;
    if (!entry.presentedTo) entry.presentedTo = [];
    if (entry.presentedTo.includes(npcId)) return false;
    entry.presentedTo.push(npcId);
    return true;
  }

  // ─── Case Summary ───

  getCaseSummary(suspectId: string, suspectName: string): CaseSummary {
    const entries = this.getEntriesForSuspect(suspectId);

    const evidence: Record<string, number> = {};
    let totalScore = 0;

    for (const entry of entries) {
      const cat = entry.evidenceCategory ?? entry.type;
      const weight = entry.evidenceWeight ?? DEFAULT_WEIGHTS[entry.type] ?? 0.08;
      evidence[cat] = (evidence[cat] ?? 0) + 1;
      totalScore += weight;
    }
    totalScore = Math.min(totalScore, 1.0); // cap: volume of evidence doesn't exceed max quality

    const quality: CaseSummary['quality'] =
      totalScore >= 0.7 ? 'strong' :
      totalScore >= 0.4 ? 'moderate' :
      totalScore >= 0.2 ? 'weak' :
      'insufficient';

    const parts = Object.entries(evidence).map(([cat, count]) => `${count} ${cat}`);
    const summary = parts.length ? parts.join(', ') : 'no evidence';

    return { suspectId, suspectName, entries, evidence, totalScore, quality, summary };
  }

  /** Get entry count */
  get count(): number {
    return this.entries.length;
  }

  /** Serialize for persistence */
  toJSON(): { entries: JournalEntry[]; suspects: string[] } {
    return { entries: this.entries, suspects: [...this._suspects] };
  }

  /** Restore from saved data */
  static fromJSON(data: JournalEntry[] | { entries: JournalEntry[]; suspects: string[] }): PlayerJournal {
    const journal = new PlayerJournal();
    if (Array.isArray(data)) {
      // Backwards compat: old saves stored entries as flat array
      journal.entries = data.map((e) => ({ ...e, presentedTo: e.presentedTo ?? [] }));
    } else {
      journal.entries = data.entries.map((e) => ({ ...e, presentedTo: e.presentedTo ?? [] }));
      journal._suspects = new Set(data.suspects ?? []);
    }
    return journal;
  }
}

/**
 * Crime-justice INVESTIGATION subsystem (A10 + A4b) — moved OUT of the engine to keep it genre-neutral.
 *
 * Owns: the player's PlayerJournal (case board), evidence-presentation, and the formal-accusation flow.
 * The engine exposes only a generic `registerDialogueEffectHandler` hook + an opaque player-state slot;
 * this module fills them. The journal instance is owned by the SERVER (it persists it and feeds it into
 * ILEffectContext.playerJournal); this module supplies the class + the dialogue effects.
 *
 * Prose strings are preserved VERBATIM from the former engine implementation — behaviour is identical.
 */
import type { Agent, ILEffect, ILEffectContext, DialogueMeaning } from '@clwa/engine';
import { BELIEF_SOURCE, getEventLabelSafe, isTransferable, hasCapability, isAccusationSpeechAct, registerDialogueEffectHandler } from '@clwa/engine';

// ─── Player Journal (investigation case-board) ───

export interface JournalEntry {
  id: string;
  type: 'clue' | 'testimony' | 'observation';
  text: string;
  source: string;
  relatedNpcs: string[];
  locationId?: string;
  gameDay: number;
  tick: number;
  crimeSceneId?: string;
  evidenceCategory?: string;
  evidenceWeight?: number;
  suspectId?: string;
  victimId?: string;
  eventType?: string;
  presentedTo?: string[];
}

export interface CaseSummary {
  suspectId: string;
  perpetratorName: string;
  entries: JournalEntry[];
  evidence: Record<string, number>;
  totalScore: number;
  quality: 'strong' | 'moderate' | 'weak' | 'insufficient';
  summary: string;
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  clue: 0.10,
  testimony: 0.12,
  observation: 0.08,
};

export class PlayerJournal {
  private entries: JournalEntry[] = [];
  private _suspects: Set<string> = new Set();

  addClue(text: string, locationId: string, gameDay: number, tick: number, crimeSceneId?: string, relatedNpcs: string[] = []): JournalEntry {
    const entry: JournalEntry = { id: crypto.randomUUID(), type: 'clue', text, source: locationId, relatedNpcs, locationId, gameDay, tick, crimeSceneId, presentedTo: [] };
    this.entries.push(entry);
    return entry;
  }

  addTestimony(text: string, npcName: string, npcId: string, locationId: string, gameDay: number, tick: number, mentionedNpcs: string[] = []): JournalEntry {
    const entry: JournalEntry = { id: crypto.randomUUID(), type: 'testimony', text, source: npcName, relatedNpcs: [npcId, ...mentionedNpcs], locationId, gameDay, tick, presentedTo: [] };
    this.entries.push(entry);
    return entry;
  }

  addObservation(text: string, locationId: string, gameDay: number, tick: number, relatedNpcs: string[] = []): JournalEntry {
    const entry: JournalEntry = { id: crypto.randomUUID(), type: 'observation', text, source: 'self', relatedNpcs, locationId, gameDay, tick, presentedTo: [] };
    this.entries.push(entry);
    return entry;
  }

  getEntries(filter?: { type?: JournalEntry['type']; locationId?: string }): JournalEntry[] {
    let result = this.entries;
    if (filter?.type) result = result.filter((e) => e.type === filter.type);
    if (filter?.locationId) result = result.filter((e) => e.locationId === filter.locationId);
    return result;
  }

  getEntry(id: string): JournalEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  getEntriesForSuspect(npcId: string): JournalEntry[] {
    return this.entries.filter((e) => e.relatedNpcs.includes(npcId));
  }

  markSuspect(npcId: string): boolean {
    if (this._suspects.has(npcId)) { this._suspects.delete(npcId); return false; }
    this._suspects.add(npcId);
    return true;
  }

  isSuspect(npcId: string): boolean { return this._suspects.has(npcId); }
  getSuspects(): string[] { return [...this._suspects]; }

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

  getCaseSummary(suspectId: string, perpetratorName: string): CaseSummary {
    const entries = this.getEntriesForSuspect(suspectId);
    const evidence: Record<string, number> = {};
    let totalScore = 0;
    for (const entry of entries) {
      const cat = entry.evidenceCategory ?? entry.type;
      const weight = entry.evidenceWeight ?? DEFAULT_WEIGHTS[entry.type] ?? 0.08;
      evidence[cat] = (evidence[cat] ?? 0) + 1;
      totalScore += weight;
    }
    totalScore = Math.min(totalScore, 1.0);
    const quality: CaseSummary['quality'] =
      totalScore >= 0.7 ? 'strong' : totalScore >= 0.4 ? 'moderate' : totalScore >= 0.2 ? 'weak' : 'insufficient';
    const parts = Object.entries(evidence).map(([cat, count]) => `${count} ${cat}`);
    const summary = parts.length ? parts.join(', ') : 'no evidence';
    return { suspectId, perpetratorName, entries, evidence, totalScore, quality, summary };
  }

  get count(): number { return this.entries.length; }

  toJSON(): { entries: JournalEntry[]; suspects: string[] } {
    return { entries: this.entries, suspects: [...this._suspects] };
  }

  static fromJSON(data: JournalEntry[] | { entries: JournalEntry[]; suspects: string[] }): PlayerJournal {
    const journal = new PlayerJournal();
    if (Array.isArray(data)) {
      journal.entries = data.map((e) => ({ ...e, presentedTo: e.presentedTo ?? [] }));
    } else {
      journal.entries = data.entries.map((e) => ({ ...e, presentedTo: e.presentedTo ?? [] }));
      journal._suspects = new Set(data.suspects ?? []);
    }
    return journal;
  }
}

// ─── Evidence presentation + accusation types ───

export interface PresentedEvidence {
  entryId: string;
  text: string;
  evidenceCategory?: string;
  evidenceWeight?: number;
  eventType?: string;
  suspectId?: string;
  perpetratorName?: string;
  victimId?: string;
}

export interface ConversationSession {
  npcId: string;
  startedAt: number;
  messageCount: number;
  accusationHistory: Map<string, { count: number; lastJournalHash: number }>;
  formalAccusations: Array<{ suspectId: string; perpetratorName: string; gameDay: number }>;
}

interface AccusationContext {
  suspectId: string;
  perpetratorName: string;
  crimeLabel: string;
  journalEvidence: CaseSummary;
  npcMaxConfidence: number;
  npcHasOwnEvidence: boolean;
  playerTrust: number;
  combinedScore: number;
  combinedQuality: 'strong' | 'moderate' | 'weak' | 'insufficient';
}

// ─── Helpers (reimplemented from the former engine il.ts) ───

function findAgentByName(name: string, agents: Map<string, Agent>): Agent | undefined {
  const lower = name.toLowerCase();
  for (const agent of agents.values()) {
    if (agent.profile.name.toLowerCase() === lower) return agent;
  }
  let best: Agent | undefined;
  let bestLen = Infinity;
  for (const agent of agents.values()) {
    const aName = agent.profile.name.toLowerCase();
    if (aName.includes(lower) || lower.includes(aName)) {
      if (agent.profile.name.length < bestLen) { best = agent; bestLen = agent.profile.name.length; }
    }
  }
  return best;
}

function computeTrustBonus(trust: number): number {
  if (trust >= 0.7) return 1.0;
  if (trust >= 0.4) return 0.6;
  return 0.2;
}

function buildAccusationContext(suspectId: string, claimEventType: string, npc: Agent, journal: PlayerJournal, playerTrust: number, agents: Map<string, Agent>): AccusationContext {
  const suspectAgent = agents.get(suspectId);
  const perpetratorName = suspectAgent?.profile.name ?? suspectId;
  const crimeLabel = getEventLabelSafe(claimEventType, 'wrongdoing');
  const journalEvidence = journal.getCaseSummary(suspectId, perpetratorName);
  let npcMaxConfidence = 0;
  let npcHasOwnEvidence = false;
  if (npc.state.beliefs) {
    for (const b of npc.state.beliefs.getAllBeliefs()) {
      if (b.subject === suspectId && isTransferable(b.eventType)) {
        if (b.confidence > npcMaxConfidence) npcMaxConfidence = b.confidence;
        if (b.source !== BELIEF_SOURCE.TESTIMONY) npcHasOwnEvidence = true;
      }
    }
  }
  const trustBonus = computeTrustBonus(playerTrust);
  const combinedScore = journalEvidence.totalScore * 0.5 + npcMaxConfidence * 0.35 + trustBonus * 0.15;
  const combinedQuality: AccusationContext['combinedQuality'] =
    combinedScore >= 0.7 ? 'strong' : combinedScore >= 0.4 ? 'moderate' : combinedScore >= 0.2 ? 'weak' : 'insufficient';
  return { suspectId, perpetratorName, crimeLabel, journalEvidence, npcMaxConfidence, npcHasOwnEvidence, playerTrust, combinedScore, combinedQuality };
}

function buildAccusationPrompt(acc: AccusationContext, npc: Agent): string {
  const ev = acc.journalEvidence.evidence;
  const evParts = Object.entries(ev).filter(([, n]) => n > 0).map(([cat, n]) => `${n} ${cat}`);
  const evDesc = evParts.length ? evParts.join(', ') : 'none';
  const npcConfDesc = acc.npcMaxConfidence >= 0.6 ? 'significant suspicion'
    : acc.npcMaxConfidence >= 0.3 ? 'some suspicion'
    : acc.npcMaxConfidence > 0 ? 'faint suspicion'
    : 'no independent findings';
  const trustDesc = acc.playerTrust >= 0.7 ? 'well-established' : acc.playerTrust >= 0.4 ? 'moderate' : 'low';
  const qualityGuidance: Record<string, string> = {
    strong: 'This evidence warrants immediate action.',
    moderate: 'Worth investigating further. Tell the player what additional evidence would help.',
    weak: 'Not enough to act on. Explain what is missing.',
    insufficient: 'This accusation has no real basis. Warn the player about making unfounded accusations.',
  };
  let personalityNote = '';
  const H = npc.profile.bigFive.honesty;
  const C = npc.profile.bigFive.conscientiousness;
  if (hasCapability(npc.profile, 'investigator')) {
    personalityNote = C >= 0.7 ? 'As a disciplined investigator, you need solid evidence before acting.'
      : H < 0.5 ? 'You might be open to... alternative forms of persuasion.'
      : 'You want to do the right thing but need convincing evidence.';
  } else if (hasCapability(npc.profile, 'canSentence')) {
    personalityNote = 'You cannot arrest anyone. Tell the player to bring this to someone with the authority to make arrests.';
  }
  return [
    '[FORMAL ACCUSATION]',
    `The player formally accuses ${acc.perpetratorName} of ${acc.crimeLabel}.`,
    '',
    'Evidence assessment:',
    `- Player documented evidence: ${acc.journalEvidence.quality} (${evDesc})`,
    `- Your own findings: ${npcConfDesc}`,
    `- Player trustworthiness: ${trustDesc}`,
    `- Combined evidence quality: ${acc.combinedQuality.toUpperCase()}`,
    '',
    qualityGuidance[acc.combinedQuality],
    personalityNote,
  ].join('\n');
}

/** Crime-justice accusation policy (was registerAccusationResponseHandler in index.ts). */
function accusationResponse(quality: string, npc: Agent): { goalType?: string; affordanceId?: string; trustDelta?: number; rejectReason?: string } | null {
  if (quality === 'strong' && (hasCapability(npc.profile, 'investigator') || hasCapability(npc.profile, 'canSentence'))) {
    return { goalType: 'arrest', affordanceId: 'arrest', trustDelta: 0.05 };
  }
  if (quality === 'moderate' && hasCapability(npc.profile, 'investigator')) {
    return { goalType: 'investigate', affordanceId: 'investigate' };
  }
  if (quality === 'weak') return { trustDelta: -0.03 };
  if (quality === 'insufficient') return { trustDelta: -0.08, rejectReason: 'insufficient_evidence' };
  return null;
}

/** Process evidence entries attached to a chat message → beliefs with source EVIDENCE (NOT trust-scaled). */
function processEvidencePresentation(ctx: ILEffectContext): string {
  const evidence = ctx.presentedEvidence as PresentedEvidence[] | undefined;
  if (!evidence || evidence.length === 0) return '';
  const npc = ctx.targetAgent;
  const playerId = ctx.playerAgent.profile.id;
  const playerTrust = npc.state.relationships?.getRelationship(playerId)?.trust ?? 0;
  const lines: string[] = [];
  for (const ev of evidence) {
    if (!ev.eventType) continue;
    const confidence = ev.evidenceWeight != null ? ev.evidenceWeight : 0.4 * playerTrust;
    if (confidence < 0.05) continue;
    npc.state.beliefs?.addBelief({
      id: crypto.randomUUID(), eventType: ev.eventType, subject: ev.suspectId ?? null, object: null,
      location: null, confidence, source: BELIEF_SOURCE.EVIDENCE, sourceNpcId: playerId,
      gameDay: ctx.gameDay, lastUpdated: ctx.gameDay,
    });
    ctx.effects.push({ type: 'belief_created', eventType: ev.eventType, subject: ev.perpetratorName ?? null, confidence: +confidence.toFixed(2), trust: +playerTrust.toFixed(2) });
    const catLabel = ev.evidenceCategory ?? 'evidence';
    lines.push(`- "${ev.text}" (${catLabel}${ev.perpetratorName ? `, pointing to ${ev.perpetratorName}` : ''})`);
    console.log(`  [IL] Evidence belief: ${ev.eventType} suspect=${ev.perpetratorName} conf=${confidence.toFixed(2)} cat=${catLabel} (NOT trust-scaled)`);
  }
  if (lines.length === 0) return '';
  return [
    '[EVIDENCE PRESENTED]',
    'The player shows you documented evidence:',
    ...lines,
    'This is tangible evidence from the crime scene investigation, not just hearsay.',
    'Consider it alongside your own knowledge.',
  ].join('\n');
}

/** The accusation branch — formerly inline in engine applyDialogueMeaning (gated by isAccusationSpeechAct). */
function processAccusation(meaning: DialogueMeaning, ctx: ILEffectContext): string[] {
  if (!isAccusationSpeechAct(meaning.speechAct) || !meaning.claims || meaning.claims.length === 0) return [];
  const npc = ctx.targetAgent;
  const journal = ctx.playerJournal as PlayerJournal | undefined;
  const isAuthority = hasCapability(npc.profile, 'investigator') || hasCapability(npc.profile, 'canSentence');
  if (!isAuthority || !journal) return [];
  const suspectClaim = meaning.claims.find((c) => c.subject);
  if (!suspectClaim?.subject) return [];
  const suspectAgent = findAgentByName(suspectClaim.subject, ctx.agents);
  if (!suspectAgent) return [];

  const sections: string[] = [];
  const playerId = ctx.playerAgent.profile.id;
  const push = (e: ILEffect) => ctx.effects.push(e);

  if (!suspectAgent.state.alive) {
    sections.push(`${suspectAgent.profile.name} is dead. This accusation makes no sense.`);
    return sections;
  }
  if (suspectAgent.profile.isPlayer) {
    sections.push(`You cannot accuse yourself.`);
    return sections;
  }
  if (suspectAgent.profile.id === npc.profile.id) {
    sections.push(`You are accusing ME? That is absurd. I am the law here.`);
    npc.state.relationships?.adjustSentiment(playerId, -0.2);
    npc.state.relationships?.adjustTrust(playerId, -0.15);
    push({ type: 'relationship_change', field: 'sentiment', delta: -0.2 });
    push({ type: 'relationship_change', field: 'trust', delta: -0.15 });
    return sections;
  }

  const playerTrust = npc.state.relationships?.getRelationship(playerId)?.trust ?? 0;
  const acc = buildAccusationContext(suspectAgent.profile.id, suspectClaim.eventType ?? '', npc, journal, playerTrust, ctx.agents);
  sections.push(buildAccusationPrompt(acc, npc));

  const session = ctx.chatSession as ConversationSession | undefined;
  if (session) {
    const suspId = suspectAgent.profile.id;
    const suspName = suspectAgent.profile.name;
    const currentHash = journal.getEntriesForSuspect(suspId).length;
    const history = session.accusationHistory.get(suspId);
    if (history) {
      if (currentHash !== history.lastJournalHash) {
        history.count = 1;
        history.lastJournalHash = currentHash;
      } else {
        history.count++;
        if (history.count === 2) {
          sections.push(`The player has already accused ${suspName} of this. They haven't presented new evidence.`);
        } else {
          sections.push(`The player keeps repeating the same accusation against ${suspName} without new evidence. This is becoming tiresome and undermining their credibility.`);
        }
        const penalty = history.count === 2 ? -0.10 : -0.12;
        npc.state.relationships?.adjustTrust(playerId, penalty);
        push({ type: 'relationship_change', field: 'trust', delta: penalty });
      }
    } else {
      session.accusationHistory.set(suspId, { count: 1, lastJournalHash: currentHash });
    }
    const prevSuspects = session.formalAccusations.filter((a) => a.suspectId !== suspId);
    if (prevSuspects.length > 0) {
      const prevNames = [...new Set(prevSuspects.map((a) => a.perpetratorName))].join(', ');
      const uniqueCount = new Set(prevSuspects.map((a) => a.suspectId)).size;
      if (uniqueCount === 1) {
        sections.push(`Note: this player previously formally accused ${prevNames}. Now they're accusing ${suspName}. Their investigative judgment may be questionable.`);
      } else {
        sections.push(`This player has now accused ${uniqueCount + 1} different people (${prevNames}, now ${suspName}). They seem to be guessing rather than investigating.`);
      }
      npc.state.relationships?.adjustTrust(playerId, -0.05);
      push({ type: 'relationship_change', field: 'trust', delta: -0.05 });
    }
    if (!session.formalAccusations.some((a) => a.suspectId === suspId)) {
      session.formalAccusations.push({ suspectId: suspId, perpetratorName: suspName, gameDay: ctx.gameDay });
    }
  }

  const response = accusationResponse(acc.combinedQuality, npc);
  if (response) {
    if (response.goalType && response.affordanceId && ctx.goalCreator) {
      const created = ctx.goalCreator(npc.profile.id, response.goalType, suspectAgent.profile.name);
      if (created) push({ type: 'goal_created', action: response.goalType, affordanceId: response.affordanceId, target: suspectAgent.profile.name });
    }
    if (response.rejectReason) push({ type: 'goal_rejected', action: 'accuse', reason: response.rejectReason });
    if (response.trustDelta) {
      npc.state.relationships?.adjustTrust(playerId, response.trustDelta);
      push({ type: 'relationship_change', field: 'trust', delta: response.trustDelta });
    }
  }

  suspectAgent.state.relationships?.adjustSentiment(playerId, -0.3);
  suspectAgent.state.relationships?.adjustTrust(playerId, -0.3);
  push({ type: 'relationship_change', field: 'sentiment', delta: -0.3 });
  console.log(`  [IL] Accusation: ${suspectAgent.profile.name} — journal=${acc.journalEvidence.totalScore.toFixed(2)} npc=${acc.npcMaxConfidence.toFixed(2)} trust=${playerTrust.toFixed(2)} → combined=${acc.combinedScore.toFixed(2)} (${acc.combinedQuality}). Accused hostile: sent-0.3, trust-0.3`);
  return sections;
}

/** Register the crime-justice dialogue-effect handler: evidence presentation + formal accusation. */
export function registerInvestigationModule(): void {
  registerDialogueEffectHandler((meaning, ctx) => {
    const sections: string[] = [];
    const evidenceContext = processEvidencePresentation(ctx);
    if (evidenceContext) sections.push(evidenceContext);
    sections.push(...processAccusation(meaning, ctx));
    return sections;
  });
}

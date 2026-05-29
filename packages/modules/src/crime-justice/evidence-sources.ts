import {
  EVIDENCE_SOURCES,
  type EvidenceCandidate,
  type EvidenceContext,
  type EvidenceTemplate,
} from '@clwa/engine';

/** Profession-specific trace clues (same data as crime-scene.ts PROFESSION_CLUES) */
const PROFESSION_TRACES: Record<string, string> = {
  blacksmith: 'metal filings and soot',
  merchant: 'merchant goods and trade dust',
  bartender: 'ale stains and tavern grime',
  herbalist: 'herb residue and plant matter',
  bard: 'lute string fragments and ink',
  priest: 'incense and candle wax',
  guard: 'armor polish and weapon marks',
};

function interpolateDescription(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

// ─── Source: personsPresent ───
// Reads CrimeScene.personsPresent → one evidence per person (excluding victim)

function findPersonsPresent(template: EvidenceTemplate, ctx: EvidenceContext): EvidenceCandidate[] {
  const candidates: EvidenceCandidate[] = [];
  const scenes = ctx.sceneResidues?.get(ctx.event.location) ?? [];
  const activeScene = scenes.find((s) => s.active);
  if (!activeScene) return candidates;

  const victimId = activeScene.affectedId;
  const victimAgent = victimId ? ctx.agents.get(victimId) : null;

  for (const personId of activeScene.personsPresent) {
    if (personId === victimId) continue;
    const person = ctx.agents.get(personId);
    if (!person) continue;

    candidates.push({
      subjectId: person.profile.id,
      subjectName: person.profile.name,
      objectId: victimId ?? null,
      objectName: victimAgent?.profile.name ?? null,
      description: interpolateDescription(template.descriptionTemplate, {
        subjectName: person.profile.name,
        objectName: victimAgent?.profile.name ?? 'the victim',
        location: ctx.event.location,
      }),
    });
  }

  return candidates;
}

// ─── Source: negativeRelationship ───
// Checks all agents' sentiment toward victim → evidence for those below threshold

function findNegativeRelationships(template: EvidenceTemplate, ctx: EvidenceContext): EvidenceCandidate[] {
  const candidates: EvidenceCandidate[] = [];
  const threshold = (template.params?.threshold as number) ?? -0.3;
  const victimId = ctx.event.object;
  if (!victimId) return candidates;

  const victimAgent = ctx.agents.get(victimId);
  if (!victimAgent) return candidates;

  for (const [agentId, agent] of ctx.agents) {
    if (!agent.state.alive) continue;
    if (agentId === victimId) continue;

    const rel = agent.state.relationships?.getRelationship(victimId);
    if (rel && rel.sentiment < threshold) {
      candidates.push({
        subjectId: agent.profile.id,
        subjectName: agent.profile.name,
        objectId: victimId,
        objectName: victimAgent.profile.name,
        description: interpolateDescription(template.descriptionTemplate, {
          subjectName: agent.profile.name,
          objectName: victimAgent.profile.name,
        }),
      });
    }
  }

  return candidates;
}

// ─── Source: perpetratorTrace ───
// Uses event.subject (perpetrator) → profession-based physical evidence

function findPerpetratorTrace(template: EvidenceTemplate, ctx: EvidenceContext): EvidenceCandidate[] {
  const perpetratorId = ctx.event.subject;
  if (!perpetratorId) return [];

  const perpetrator = ctx.agents.get(perpetratorId);
  if (!perpetrator) return [];

  const trace = PROFESSION_TRACES[perpetrator.profile.role];
  if (!trace) return [];

  const victimId = ctx.event.object;
  const victimAgent = victimId ? ctx.agents.get(victimId) : null;

  return [{
    subjectId: perpetrator.profile.id,
    subjectName: perpetrator.profile.name,
    objectId: victimId ?? null,
    objectName: victimAgent?.profile.name ?? null,
    description: interpolateDescription(template.descriptionTemplate, {
      subjectName: perpetrator.profile.name,
      traceDetail: trace,
    }),
  }];
}

// ─── Source: stolenGoodsTrace ───
// From GOODS_STOLEN event payload → evidence pointing to thief

function findStolenGoodsTrace(template: EvidenceTemplate, ctx: EvidenceContext): EvidenceCandidate[] {
  const thiefId = ctx.event.subject;
  if (!thiefId) return [];

  const thief = ctx.agents.get(thiefId);
  if (!thief) return [];

  const victimId = ctx.event.object;
  const victimAgent = victimId ? ctx.agents.get(victimId) : null;

  return [{
    subjectId: thief.profile.id,
    subjectName: thief.profile.name,
    objectId: victimId ?? null,
    objectName: victimAgent?.profile.name ?? null,
    description: interpolateDescription(template.descriptionTemplate, {
      subjectName: thief.profile.name,
      objectName: victimAgent?.profile.name ?? 'the victim',
    }),
  }];
}

// ─── Registration ───

export function registerCrimeEvidenceSources(): void {
  EVIDENCE_SOURCES.set('personsPresent', findPersonsPresent);
  EVIDENCE_SOURCES.set('negativeRelationship', findNegativeRelationships);
  EVIDENCE_SOURCES.set('perpetratorTrace', findPerpetratorTrace);
  EVIDENCE_SOURCES.set('stolenGoodsTrace', findStolenGoodsTrace);
}

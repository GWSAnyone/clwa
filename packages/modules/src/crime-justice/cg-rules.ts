import type { ConsequenceRule } from '@clwa/engine';

export const CRIME_CG_RULES: ConsequenceRule[] = [
  // Rule 1: Kill witnessed → witnesses get memory (instant)
  {
    id: 'witness-murder',
    trigger: 'NPC_KILLED',
    conditions: [
      { field: 'location', op: 'has_witnesses' },
    ],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 8,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
  },

  // Rule 1b: Body discovered later → becomes witness memory → existing cascade handles rest
  {
    id: 'body-discovery-to-witness',
    trigger: 'BODY_DISCOVERED',
    conditions: [
      { field: 'location', op: 'has_witnesses' },
    ],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 8,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
    subjectUnknown: true,
  },

  // Rule 2: Guard witnesses murder → immediate wanted status
  {
    id: 'guard-witnessed-murder',
    trigger: 'WITNESS_MEMORY',
    conditions: [
      { field: 'target', op: 'is_guard' },
    ],
    consequence: {
      type: 'WANTED_STATUS',
      importance: 7,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
  },

  // Rule 3: Witness in public place → rumor spreads to non-witnesses
  {
    id: 'rumor-from-witness',
    trigger: 'WITNESS_MEMORY',
    conditions: [
      { field: 'location', op: 'is_public_place' },
    ],
    consequence: {
      type: 'RUMOR_SPREAD',
      importance: 6,
      delayDays: 0,
      probability: 0.8,
    },
    maxChainDepth: 3,
  },

  // Rule 4: Rumor reaches a guard (who wasn't present) → wanted status
  {
    id: 'guard-heard-rumor',
    trigger: 'RUMOR_SPREAD',
    conditions: [
      { field: 'target', op: 'is_guard' },
    ],
    consequence: {
      type: 'WANTED_STATUS',
      importance: 7,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
  },

  // Rule 5: Theft witnessed → witnesses get memory
  {
    id: 'witness-theft',
    trigger: 'GOODS_STOLEN',
    conditions: [
      { field: 'location', op: 'has_witnesses' },
    ],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 6,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
  },

  // Rule 6: Theft discovered by owner → rumor spreads (accusation)
  {
    id: 'theft-discovered-rumor',
    trigger: 'THEFT_DISCOVERED',
    conditions: [
      { field: 'location', op: 'is_public_place' },
    ],
    consequence: {
      type: 'RUMOR_SPREAD',
      importance: 5,
      delayDays: 0,
      probability: 0.9,
    },
    maxChainDepth: 3,
  },

  // Rule 7: Vigilante attack witnessed → witnesses get memory
  {
    id: 'witness-vigilante',
    trigger: 'SELF_JUSTICE',
    conditions: [
      { field: 'location', op: 'has_witnesses' },
    ],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 7,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
  },

  // ─── Investigation & Punishment Rules ─────────────────────────

  // Rule 8: Arrest → rumor spreads (major news)
  {
    id: 'arrest-rumor',
    trigger: 'NPC_ARRESTED',
    conditions: [
      { field: 'location', op: 'is_public_place' },
    ],
    consequence: {
      type: 'RUMOR_SPREAD',
      importance: 7,
      delayDays: 0,
      probability: 0.9,
    },
    maxChainDepth: 3,
  },

  // Rule 9: Sentence → rumor spreads (100% — everyone hears)
  {
    id: 'sentence-rumor',
    trigger: 'NPC_SENTENCED',
    conditions: [],
    consequence: {
      type: 'RUMOR_SPREAD',
      importance: 8,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 2,
  },

  // Rule 10: Criminal fled → rumor spreads (100%)
  {
    id: 'fled-rumor',
    trigger: 'NPC_FLED',
    conditions: [],
    consequence: {
      type: 'RUMOR_SPREAD',
      importance: 6,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 2,
  },

  // Rule 11: Evidence destroyed + witnesses → witness memory (destroying evidence is a crime!)
  {
    id: 'witness-evidence-destruction',
    trigger: 'EVIDENCE_DESTROYED',
    conditions: [
      { field: 'location', op: 'has_witnesses' },
    ],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 6,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
  },

  // Rule 12: Witness intimidated + other witnesses → witness memory (intimidation is a crime!)
  {
    id: 'witness-intimidation',
    trigger: 'WITNESS_INTIMIDATED',
    conditions: [
      { field: 'location', op: 'has_witnesses' },
    ],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 7,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
  },

  // Rule 13: Trial requested → rumor spreads (public interest)
  {
    id: 'trial-rumor',
    trigger: 'TRIAL_REQUESTED',
    conditions: [],
    consequence: {
      type: 'RUMOR_SPREAD',
      importance: 7,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 2,
  },
];

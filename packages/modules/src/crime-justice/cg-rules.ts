import type { ConsequenceRule } from '@clwa/engine';

export const CRIME_CG_RULES: ConsequenceRule[] = [
  // ─── Witness Rules ─────────────────────────────────────

  // Rule 1: Kill witnessed → witnesses get memory (instant)
  {
    id: 'witness-murder',
    trigger: 'NPC_KILLED',
    targetMode: 'witnesses',
    conditions: [],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 8,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
    tracksWitness: true,
  },

  // Rule 1b: Body discovered later → becomes witness memory
  {
    id: 'body-discovery-to-witness',
    trigger: 'BODY_DISCOVERED',
    targetMode: 'witnesses',
    conditions: [],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 8,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
    subjectUnknown: true,
    tracksWitness: true,
  },

  // Rule 5: Theft witnessed → witnesses get memory
  {
    id: 'witness-theft',
    trigger: 'GOODS_STOLEN',
    targetMode: 'witnesses',
    conditions: [],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 6,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
    tracksWitness: true,
  },

  // Rule 7: Vigilante attack witnessed → witnesses get memory
  {
    id: 'witness-vigilante',
    trigger: 'SELF_JUSTICE',
    targetMode: 'witnesses',
    conditions: [],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 7,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
    tracksWitness: true,
  },

  // Rule 9: Evidence destroyed + witnesses → witness memory
  {
    id: 'witness-evidence-destruction',
    trigger: 'EVIDENCE_DESTROYED',
    targetMode: 'witnesses',
    conditions: [],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 6,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
    tracksWitness: true,
  },

  // Rule 12: Witness intimidated + other witnesses → witness memory
  {
    id: 'witness-intimidation',
    trigger: 'WITNESS_INTIMIDATED',
    targetMode: 'witnesses',
    conditions: [],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 7,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
    tracksWitness: true,
  },

  // ─── Escalation Precursors ─────────────────────────────

  // Argument witnessed → low-importance witness memory (clue for observant player)
  {
    id: 'witness-argument',
    trigger: 'ARGUMENT_WITNESSED',
    targetMode: 'witnesses',
    conditions: [],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 3,
      delayDays: 0,
      probability: 0.7,
    },
    maxChainDepth: 2,
  },

  // Threat witnessed → medium-importance witness memory + may cascade to guard
  {
    id: 'witness-threat',
    trigger: 'THREAT_WITNESSED',
    targetMode: 'witnesses',
    conditions: [],
    consequence: {
      type: 'WITNESS_MEMORY',
      importance: 5,
      delayDays: 0,
      probability: 0.9,
    },
    maxChainDepth: 3,
    tracksWitness: true,
  },

  // ─── Witness Reaction (CG v2 exclusive group) ──────────
  // When a witness sees a crime, personality and relationships determine their reaction.
  // Exclusive group: only the highest-priority matching rule fires per witness.

  // Friend of criminal → covers up (stays silent, may lie if asked)
  {
    id: 'witness-cover-up',
    trigger: 'WITNESS_MEMORY',
    targetMode: 'affected',
    conditions: [
      { op: 'relationship', actor: 'target', toward: 'subject', field: 'sentiment', comparator: '>', value: 0.3 },
    ],
    consequence: {
      type: 'COVER_UP',
      importance: 5,
      delayDays: 0,
      probability: 0.6,
    },
    exclusive: 'witness_reaction',
    priority: 2,
    maxChainDepth: 3,
  },

  // Honest witness → eager to report (actively seeks guard)
  {
    id: 'witness-eager-report',
    trigger: 'WITNESS_MEMORY',
    targetMode: 'affected',
    conditions: [
      { op: 'trait', of: 'target', trait: 'honesty', comparator: '>', value: 0.6 },
    ],
    consequence: {
      type: 'REPORT_IMPULSE',
      importance: 6,
      delayDays: 0,
      probability: 0.9,
    },
    exclusive: 'witness_reaction',
    priority: 1,
    maxChainDepth: 3,
  },

  // ─── Guard Cascade Rules ───────────────────────────────

  // Rule 2: Guard witnesses murder → immediate wanted status
  {
    id: 'guard-witnessed-murder',
    trigger: 'WITNESS_MEMORY',
    targetMode: 'affected',
    conditions: [
      { op: 'has_capability', value: 'investigator' },
    ],
    consequence: {
      type: 'WANTED_STATUS',
      importance: 7,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
  },

  // Rule 4: Rumor reaches a guard → wanted status
  {
    id: 'guard-heard-rumor',
    trigger: 'RUMOR_SPREAD',
    targetMode: 'affected',
    conditions: [
      { op: 'has_capability', value: 'investigator' },
    ],
    consequence: {
      type: 'WANTED_STATUS',
      importance: 7,
      delayDays: 0,
      probability: 1.0,
    },
    maxChainDepth: 3,
  },

  // ─── Rumor Spread Rules ────────────────────────────────

  // Rule 3: Witness in public place → rumor spreads to non-witnesses
  {
    id: 'rumor-from-witness',
    trigger: 'WITNESS_MEMORY',
    targetMode: 'location',
    conditions: [
      { op: 'is_public_place' },
    ],
    consequence: {
      type: 'RUMOR_SPREAD',
      importance: 6,
      delayDays: 0,
      probability: 0.8,
    },
    maxChainDepth: 3,
  },

  // Rule 6: Theft discovered by owner → rumor spreads
  {
    id: 'theft-discovered-rumor',
    trigger: 'THEFT_DISCOVERED',
    targetMode: 'location',
    conditions: [
      { op: 'is_public_place' },
    ],
    consequence: {
      type: 'RUMOR_SPREAD',
      importance: 5,
      delayDays: 0,
      probability: 0.9,
    },
    maxChainDepth: 3,
  },

  // Rule 8: Arrest → rumor spreads (major news)
  {
    id: 'arrest-rumor',
    trigger: 'NPC_ARRESTED',
    targetMode: 'location',
    conditions: [
      { op: 'is_public_place' },
    ],
    consequence: {
      type: 'RUMOR_SPREAD',
      importance: 7,
      delayDays: 0,
      probability: 0.9,
    },
    maxChainDepth: 3,
  },
];

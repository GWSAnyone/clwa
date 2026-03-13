import type { EvidenceRule } from '@clwa/engine';

/** Declarative evidence rules for Crime & Justice module */
export const CRIME_EVIDENCE_RULES: EvidenceRule[] = [
  {
    trigger: 'NPC_KILLED',
    generate: [
      {
        category: 'opportunity',
        source: 'personsPresent',
        weight: 0.15,
        descriptionTemplate: '{subjectName} was seen near {location} around the time of the murder',
      },
      {
        category: 'motive',
        source: 'negativeRelationship',
        params: { threshold: -0.3 },
        weight: 0.2,
        descriptionTemplate: '{subjectName} had a known grudge against {objectName}',
      },
      {
        category: 'trace',
        source: 'perpetratorTrace',
        weight: 0.15,
        descriptionTemplate: 'Traces of {traceDetail} found near the body',
      },
    ],
  },
  {
    trigger: 'GOODS_STOLEN',
    generate: [
      {
        category: 'opportunity',
        source: 'personsPresent',
        weight: 0.15,
        descriptionTemplate: '{subjectName} was near the shop when the theft occurred',
      },
      {
        category: 'trace',
        source: 'stolenGoodsTrace',
        weight: 0.2,
        descriptionTemplate: 'Missing goods match items last seen with {subjectName}',
      },
    ],
  },
];

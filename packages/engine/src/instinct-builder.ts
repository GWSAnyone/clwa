/**
 * Instinct Builder — procedural generation of psychologically-rich instinct descriptions.
 *
 * Transforms raw AL score into vivid, personality-driven prompt text that naturally
 * guides LLM decisions without "MUST act" directives.
 *
 * 5 components compose each instinct description:
 * 1. Intensity (7 tiers from score)
 * 2. Texture (3 severity classes: emotional / calculating / primal)
 * 3. Motivation (Enneagram core fear/desire)
 * 4. Resistance (opposing PM traits → counter-voice)
 * 5. Escalation + Mood coloring
 */

import type { AgentProfile } from './agent-types';

// ─── Types ───

export interface InstinctInput {
  /** Affordance ID */
  id: string;
  /** Computed utility score (0-1) */
  score: number;
  /** Affordance severity (1-10) */
  severity: number;
  /** Human-readable label */
  label: string;
  /** Target NPC or location name */
  targetName?: string;
  /** Traits that resist this action: [{trait, direction}] */
  resistTraits?: Array<{ trait: keyof BigFiveTraits; direction: 'high' | 'low' }>;
  /** How many times this affordance appeared but NPC didn't choose it */
  considerationCount: number;
  /** Situational grounding — interpolated instinctContext from affordance (module data) */
  context?: string;
}

interface BigFiveTraits {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  honesty: number;
}

// ─── Constants ───

/** Score → tier index (0-6) */
function getIntensityTier(score: number): number {
  if (score >= 0.90) return 6;
  if (score >= 0.80) return 5;
  if (score >= 0.70) return 4;
  if (score >= 0.60) return 3;
  if (score >= 0.50) return 2;
  if (score >= 0.40) return 1;
  return 0;
}

/** Severity → texture class */
function getSeverityClass(severity: number): 'emotional' | 'calculating' | 'primal' {
  if (severity <= 3) return 'emotional';
  if (severity <= 6) return 'calculating';
  return 'primal';
}

// ─── Intensity × Texture templates (3 classes × 7 tiers = 21) ───

const TEMPLATES: Record<string, string[]> = {
  emotional: [
    /* 0 Whisper  */ 'A quiet ache stirs — a vague sense that something needs to be said or done.',
    /* 1 Echo     */ 'The feeling keeps returning. A weight you can\'t quite name, pulling at you.',
    /* 2 Pull     */ 'You feel it clearly now — a need to reach out, to connect, to act on what you feel.',
    /* 3 Grip     */ 'The emotion grips you. It\'s hard to think about anything else. You NEED to do this.',
    /* 4 Flood    */ 'Your chest tightens. The feeling overwhelms rational thought. Your feet are already moving.',
    /* 5 Torrent  */ 'It\'s all you can feel. The world narrows to this one need. Nothing else matters right now.',
    /* 6 Abyss    */ 'There is no separation between the feeling and the action. You are already doing it.',
  ],
  calculating: [
    /* 0 Whisper  */ 'A stray thought — what if? The idea barely forms before fading.',
    /* 1 Echo     */ 'The idea keeps coming back. You find yourself running the numbers, weighing the angles.',
    /* 2 Pull     */ 'The justification is building. You can see how it would work. The risk seems... manageable.',
    /* 3 Grip     */ 'The logic is airtight now. Every argument against it sounds thinner than the last. You deserve this.',
    /* 4 Flood    */ 'Your mind has already planned every step. The moral question feels abstract, distant. Only the practical remains.',
    /* 5 Torrent  */ 'It\'s no longer a question of whether — only when. The plan is complete. You\'re just waiting for the right moment.',
    /* 6 Abyss    */ 'The decision was made long ago. You didn\'t notice when thinking became planning became doing.',
  ],
  primal: [
    /* 0 Whisper  */ 'A violent image flashes through your mind — gone as quickly as it came.',
    /* 1 Echo     */ 'The dark thought returns. You notice your hands clenching, your jaw tightening.',
    /* 2 Pull     */ 'Something ancient stirs. A metallic taste. Your body is preparing for something your mind hasn\'t agreed to yet.',
    /* 3 Grip     */ 'Your peripheral vision narrows. Heartbeat loud in your ears. The target is all you see.',
    /* 4 Flood    */ 'Rational thought is drowning. Something primal has taken the wheel. Your hands tremble — not with fear.',
    /* 5 Torrent  */ 'You feel it in your bones. Every muscle coiled. The line between thought and violence has dissolved.',
    /* 6 Abyss    */ 'Cold clarity. No emotion left — just purpose. Your body moves with terrifying certainty.',
  ],
};

// ─── Enneagram motivation (9 types × 3 classes) ───

const ENNEAGRAM_DRIVE: Record<number, Record<string, string>> = {
  1: { // Perfectionist — fear: being corrupt
    emotional: 'This is about doing what\'s RIGHT. Someone must stand for truth.',
    calculating: 'The system is broken. This isn\'t wrong — it\'s correction.',
    primal: 'This isn\'t violence. This is JUSTICE. The world demands it.',
  },
  2: { // Helper — fear: being unloved
    emotional: 'They need you. You can\'t just stand by while someone suffers.',
    calculating: 'If you help now, they\'ll remember. They\'ll need you again.',
    primal: 'If you don\'t act, who will? This is what love demands.',
  },
  3: { // Achiever — fear: being worthless
    emotional: 'You refuse to be powerless. You WILL make this right.',
    calculating: 'If you don\'t act now, everything you\'ve built collapses. You refuse to be that person — the failure.',
    primal: 'Lose this, and you are nothing. You will NOT be nothing.',
  },
  4: { // Individualist — fear: no identity
    emotional: 'This pain is real and it\'s YOURS. You must honor it.',
    calculating: 'Nobody else sees the world like you do. This is your burden, your choice.',
    primal: 'Something deep and raw demands expression. This feeling will consume you if you don\'t act.',
  },
  5: { // Investigator — fear: being helpless
    emotional: 'You need to understand. The not-knowing is worse than any truth.',
    calculating: 'You\'ve analyzed every angle. The conclusion is inescapable. Act on what you know.',
    primal: 'Knowledge without action is cowardice. You know what must be done.',
  },
  6: { // Loyalist — fear: without security
    emotional: 'The world isn\'t safe. You need someone on your side.',
    calculating: 'If you don\'t secure this now, what happens tomorrow? Next week?',
    primal: 'The threat is real. Eliminate it or it eliminates you. There is no middle ground.',
  },
  7: { // Enthusiast — fear: being deprived
    emotional: 'Life is slipping through your fingers. Seize this moment.',
    calculating: 'Why deny yourself? The opportunity is right here. You\'ll regret not taking it.',
    primal: 'The hunger is overwhelming. Take what you need. Think later.',
  },
  8: { // Challenger — fear: being controlled
    emotional: 'Nobody tells you what to feel. This is YOUR response, YOUR choice.',
    calculating: 'Taking what you need is power. Asking is weakness. You answer to no one.',
    primal: 'Nobody threatens you. Nobody. They will learn what happens when they try.',
  },
  9: { // Peacemaker — fear: conflict/separation
    emotional: 'If you could just fix this one thing, everything would be peaceful again.',
    calculating: 'If this problem just... disappeared, the tension would dissolve. Quietly. No confrontation needed.',
    primal: 'The peace is GONE. Something inside has snapped. If the world won\'t give you peace, you\'ll TAKE it.',
  },
};

// ─── Resistance voice (opposing traits) ───

interface ResistanceThreshold {
  min: number;
  text: string;
}

const RESISTANCE_TEMPLATES: Record<string, ResistanceThreshold[]> = {
  // Honesty resisting crime (steal, blackmail)
  H_high: [
    { min: 0.0, text: '' }, // silence — no conscience
    { min: 0.3, text: 'A knot of guilt sits in your stomach. Easy to push aside — but it\'s there.' },
    { min: 0.5, text: 'Your conscience pulls hard. This isn\'t who you are. ...Is it?' },
    { min: 0.7, text: 'Every instinct screams NO. You feel physically sick at the thought. The moral barrier is immense.' },
    { min: 0.9, text: 'IMPOSSIBLE. Your entire being recoils. You would rather suffer than become this.' },
  ],
  // Agreeableness resisting violence (kill, attack)
  A_high: [
    { min: 0.0, text: '' }, // dehumanized target
    { min: 0.3, text: 'Some part of you still sees a person. Not a target — a person.' },
    { min: 0.5, text: 'You picture their daily life. Their small routines. The people who depend on them.' },
    { min: 0.7, text: 'Empathy floods in uninvited. You feel their fear. Their confusion. Can you really do this to another human being?' },
    { min: 0.9, text: 'You see their face — truly see it — and something inside you breaks. You CANNOT.' },
  ],
  // Neuroticism resisting exposure (report, testify, confront)
  N_high: [
    { min: 0.0, text: 'You feel no fear. This is simply what must be done.' },
    { min: 0.3, text: 'There\'s some risk. But manageable.' },
    { min: 0.5, text: 'What if they don\'t believe you? What if it makes things worse?' },
    { min: 0.7, text: 'Fear grips your chest. What if they come after you? What if you become the next target?' },
    { min: 0.9, text: 'Paralyzing terror. Your legs won\'t move. Every scenario ends in catastrophe.' },
  ],
  // Conscientiousness resisting impulsive action (steal, flee)
  C_high: [
    { min: 0.0, text: '' },
    { min: 0.3, text: 'A nagging sense that there should be a proper way to handle this.' },
    { min: 0.5, text: 'Discipline pushes back. You don\'t act on impulse. You plan. You prepare.' },
    { min: 0.7, text: 'Your sense of order rebels. This is chaos. This is beneath you.' },
  ],
  // Low extraversion resisting social actions (confront, announce, demand)
  E_low: [
    { min: 0.0, text: '' },
    { min: 0.3, text: '' },
    { min: 0.5, text: 'Drawing attention to yourself feels deeply uncomfortable.' },
    { min: 0.7, text: 'The thought of confrontation makes your stomach turn. You\'d rather endure in silence.' },
  ],
};

function getResistanceVoice(
  resistTraits: Array<{ trait: keyof BigFiveTraits; direction: 'high' | 'low' }> | undefined,
  bigFive: { openness: number; conscientiousness: number; extraversion: number; agreeableness: number; neuroticism: number; honesty: number },
): string {
  if (!resistTraits || resistTraits.length === 0) return '';

  const parts: string[] = [];
  for (const rt of resistTraits) {
    const traitValue = bigFive[rt.trait];
    // direction 'high' means high trait resists → use trait value directly
    // direction 'low' means low trait resists → use 1-traitValue
    const effectiveValue = rt.direction === 'high' ? traitValue : (1 - traitValue);

    const traitKey = `${rt.trait.charAt(0).toUpperCase()}_${rt.direction}`;
    const thresholds = RESISTANCE_TEMPLATES[traitKey];
    if (!thresholds) continue;

    // Find highest matching threshold
    let text = '';
    for (const t of thresholds) {
      if (effectiveValue >= t.min) text = t.text;
    }
    if (text) parts.push(text);
  }

  return parts.length > 0 ? parts.join(' ') : '';
}

// ─── Escalation ───

function getEscalationPrefix(count: number): string {
  if (count <= 0) return '';
  if (count <= 2) return 'The thought has visited before.';
  if (count <= 4) return 'Again. Like an old companion you can\'t shake.';
  return 'It\'s no longer a thought. It lives in you now. Patient. Always waiting.';
}

// ─── Mood coloring ───

function getMoodColoring(mood: number, tier: number): string {
  // Only add mood coloring at significant intensity + negative mood
  if (tier < 2 || mood > -0.2) return '';
  if (mood > -0.4) return 'A tightness behind your eyes.';
  if (mood > -0.7) return 'Your hands are unsteady. How long since you slept properly?';
  return 'The world has gone flat and grey. You barely recognize your own thoughts.';
}

// ─── Main builder ───

export function buildInstinctDescription(
  input: InstinctInput,
  profile: AgentProfile,
  mood: number,
): string {
  const tier = getIntensityTier(input.score);
  const sevClass = getSeverityClass(input.severity);

  // 1. Base intensity × texture
  const base = TEMPLATES[sevClass][tier];

  // 2. Enneagram motivation (only at tier 2+ — below that, motivation hasn't crystallized)
  let motivation = '';
  if (tier >= 2 && profile.enneagram) {
    const drives = ENNEAGRAM_DRIVE[profile.enneagram.type];
    if (drives) {
      motivation = drives[sevClass] || '';
    }
  }

  // 3. Resistance from opposing traits (always present if traits oppose)
  const resistance = getResistanceVoice(
    input.resistTraits,
    profile.bigFive,
  );

  // 4. Escalation prefix
  const escalation = getEscalationPrefix(input.considerationCount);

  // 5. Mood coloring
  const moodColor = getMoodColoring(mood, tier);

  // Compose: [escalation] base [context] [motivation] [resistance] [mood]
  // Flow: emotional intensity → situational grounding → enneagram drive → counter-voice → physical state
  const parts = [escalation, base, input.context, motivation, resistance, moodColor].filter(Boolean);
  return parts.join(' ');
}

// ─── Tier label for logging ───

const TIER_NAMES = ['whisper', 'echo', 'temptation', 'grip', 'flood', 'torrent', 'abyss'];

export function getTierName(score: number): string {
  return TIER_NAMES[getIntensityTier(score)] || 'unknown';
}

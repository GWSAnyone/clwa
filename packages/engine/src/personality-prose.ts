import type { BigFive, Enneagram } from './agent-types';

/** Convert Big Five scores to behavioral personality description */
export function bigFiveToDescription(bf: BigFive): string {
  const traits: string[] = [];
  if (bf.openness > 0.7) traits.push('curious and imaginative');
  else if (bf.openness < 0.3) traits.push('practical and conventional');
  if (bf.conscientiousness > 0.7) traits.push('organized and dependable');
  else if (bf.conscientiousness < 0.3) traits.push('spontaneous and flexible');
  if (bf.extraversion > 0.7) traits.push('outgoing and talkative');
  else if (bf.extraversion < 0.3) traits.push('reserved and quiet');
  if (bf.agreeableness > 0.7) traits.push('warm and cooperative');
  else if (bf.agreeableness < 0.3) traits.push('direct and competitive');
  if (bf.neuroticism > 0.7) traits.push('emotionally sensitive and anxious');
  else if (bf.neuroticism < 0.3) traits.push('calm and emotionally stable');
  if (bf.honesty > 0.7) traits.push('sincere and fair-minded');
  else if (bf.honesty < 0.3) traits.push('shrewd and self-serving');
  return traits.length > 0 ? traits.join(', ') : 'balanced personality';
}

const STRESS_DESC: Record<number, string> = {
  1: 'Under stress you become rigid and judgmental.',
  2: 'Under stress you become possessive and manipulative.',
  3: 'Under stress you obsess over control and image.',
  4: 'Under stress you withdraw into melancholy.',
  5: 'Under stress you retreat into isolation.',
  6: 'Under stress you become hypervigilant and paranoid.',
  7: 'Under stress you become scattered and escapist.',
  8: 'Under stress you become domineering and confrontational.',
  9: 'Under stress you become passive and disengaged.',
};

const GROWTH_DESC: Record<number, string> = {
  1: 'In growth you become accepting and forgiving.',
  2: 'In growth you care genuinely without expecting return.',
  3: 'In growth you invest in others\' success.',
  4: 'In growth you find beauty in ordinary things.',
  5: 'In growth you engage with the world confidently.',
  6: 'In growth you stand up for fairness without paranoia.',
  7: 'In growth you find deep joy in the present.',
  8: 'In growth you become protective and nurturing.',
  9: 'In growth you become a decisive mediator.',
};

/** Get stress/growth directive based on mood and Enneagram */
export function getStressGrowthDirective(mood: number, enn: Enneagram): string {
  if (mood < -0.5) return STRESS_DESC[enn.stressType] ?? '';
  if (mood > 0.3) return GROWTH_DESC[enn.growthType] ?? '';
  return '';
}

import type { Agent } from './agent';
import type { CrimeScene, ExaminationPoint } from './world-types';
import { getCrimeSceneTemplate } from './event-registry';

/**
 * Create a crime scene with examination points from registered templates.
 * Templates are registered by modules via registerCrimeSceneTemplate().
 */
export function createCrimeScene(
  locationId: string,
  sceneType: string,
  gameDay: number,
  tick: number,
  perpetrator?: Agent,
  victim?: Agent,
  witnesses?: string[],
): CrimeScene {
  const template = getCrimeSceneTemplate(sceneType);
  if (!template) {
    throw new Error(`No crime scene template registered for type: ${sceneType}`);
  }

  const points: ExaminationPoint[] = template.points.map((t) => ({
    ...t,
    id: crypto.randomUUID(),
    examined: false,
  }));

  // Personalize body description if template declares it and victim is known
  if (template.personalizeBody && victim) {
    const bodyPoint = points.find((p) => p.type === 'body');
    if (bodyPoint) {
      bodyPoint.description = `The body of ${victim.profile.name} the ${victim.profile.role} lies on the ground.`;
      bodyPoint.clueText = `${victim.profile.name} was killed here. The attack seems sudden — no signs of an attempted escape.`;
    }
  }

  // Profession-specific clue from template
  if (perpetrator && template.professionClues) {
    const profClue = template.professionClues[perpetrator.profile.role];
    if (profClue) {
      points.push({
        id: crypto.randomUUID(),
        type: 'profession_clue',
        description: profClue.description,
        clueText: profClue.clueText,
        examined: false,
      });
    }
  }

  // Pre-fill noticedBy with witnesses (they already know)
  const noticedBy = new Set<string>();
  if (perpetrator) noticedBy.add(perpetrator.profile.id);
  if (victim) noticedBy.add(victim.profile.id);
  if (witnesses) {
    for (const w of witnesses) noticedBy.add(w);
  }

  return {
    id: crypto.randomUUID(),
    locationId,
    crimeType: sceneType,
    points,
    gameDay,
    tick,
    noticedBy,
    active: true,
    perpetratorId: perpetrator?.profile.id,
    victimId: victim?.profile.id,
    personsPresent: [
      ...(perpetrator ? [perpetrator.profile.id] : []),
      ...(witnesses ?? []),
    ],
  };
}

/** Text that an NPC gets when passively noticing a crime scene */
export function getPassiveNoticeText(scene: CrimeScene, locationName: string): string {
  const template = getCrimeSceneTemplate(scene.crimeType);
  if (template?.passiveNoticeText) {
    return template.passiveNoticeText.replace('{locationName}', locationName);
  }
  return `I noticed something unusual at ${locationName} — signs of a disturbance.`;
}

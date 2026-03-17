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

  // Module-defined personalization — template declares how to customize points
  if (template.personalizePoints) {
    template.personalizePoints(points, { victim, perpetrator });
  }

  // Module-defined additional points — template generates extras based on context
  if (template.additionalPoints) {
    const extras = template.additionalPoints({ victim, perpetrator });
    for (const ep of extras) {
      points.push({ ...ep, id: crypto.randomUUID(), examined: false });
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

import type { Agent } from './agent';
import type { SceneResidue, ExaminationPoint } from './world-types';
import { getSceneResidueTemplate } from './event-registry';

/**
 * Create a scene residue (the inspectable state an event leaves at a location) with examination
 * points from registered templates. Templates are registered by modules via registerSceneResidueTemplate().
 * Genre-neutral: a crime scene, a fraud audit trail, a battlefield aftermath are all scene residues.
 */
export function createSceneResidue(
  locationId: string,
  sceneType: string,
  gameDay: number,
  gameMinute: number,
  actor?: Agent,
  affected?: Agent,
  witnesses?: string[],
): SceneResidue {
  const template = getSceneResidueTemplate(sceneType);
  if (!template) {
    throw new Error(`No scene-residue template registered for type: ${sceneType}`);
  }

  const points: ExaminationPoint[] = template.points.map((t) => ({
    ...t,
    id: crypto.randomUUID(),
    examined: false,
  }));

  // Module-defined personalization — template declares how to customize points
  if (template.personalizePoints) {
    template.personalizePoints(points, { affected, actor });
  }

  // Module-defined additional points — template generates extras based on context
  if (template.additionalPoints) {
    const extras = template.additionalPoints({ affected, actor });
    for (const ep of extras) {
      points.push({ ...ep, id: crypto.randomUUID(), examined: false });
    }
  }

  // Pre-fill noticedBy with witnesses (they already know)
  const noticedBy = new Set<string>();
  if (actor) noticedBy.add(actor.profile.id);
  if (affected) noticedBy.add(affected.profile.id);
  if (witnesses) {
    for (const w of witnesses) noticedBy.add(w);
  }

  return {
    id: crypto.randomUUID(),
    locationId,
    sceneType: sceneType,
    points,
    gameDay,
    gameMinute,
    noticedBy,
    active: true,
    actorId: actor?.profile.id,
    affectedId: affected?.profile.id,
    personsPresent: [
      ...(actor ? [actor.profile.id] : []),
      ...(witnesses ?? []),
    ],
  };
}

/** Text that an NPC gets when passively noticing a scene residue */
export function getPassiveNoticeText(scene: SceneResidue, locationName: string): string {
  const template = getSceneResidueTemplate(scene.sceneType);
  if (template?.passiveNoticeText) {
    return template.passiveNoticeText.replace('{locationName}', locationName);
  }
  return `I noticed something unusual at ${locationName} — signs of a disturbance.`;
}

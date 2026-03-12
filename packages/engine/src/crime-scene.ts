import type { Agent } from './agent';
import type { CrimeScene, ExaminationPoint } from './world-types';

/** Clue templates per crime type — generic evidence present at any scene */
const MURDER_TEMPLATES: Omit<ExaminationPoint, 'id' | 'examined'>[] = [
  {
    type: 'body',
    description: 'A lifeless body lies on the ground, face frozen in shock.',
    clueText: 'The victim was killed here. No signs they tried to flee — the attack was sudden.',
  },
  {
    type: 'bloodstain',
    description: 'Dark stains spread across the floor, still damp in places.',
    clueText: 'A large pool of blood. The wound was severe — this was no accident.',
  },
  {
    type: 'struggle',
    description: 'Furniture is overturned and objects scattered around the area.',
    clueText: 'Signs of a brief struggle. The victim may have tried to resist.',
  },
];

const ROBBERY_TEMPLATES: Omit<ExaminationPoint, 'id' | 'examined'>[] = [
  {
    type: 'damage',
    description: 'A lock has been forced open, the mechanism bent and broken.',
    clueText: 'The lock was broken with considerable force — someone strong or with the right tools.',
  },
  {
    type: 'stolen_goods',
    description: 'Shelves are bare and containers emptied, their contents gone.',
    clueText: 'Goods were taken deliberately — the thief knew what they were after.',
  },
  {
    type: 'struggle',
    description: 'Items knocked off tables, a chair overturned.',
    clueText: 'Whoever did this was in a hurry, or met some resistance.',
  },
];

const ASSAULT_TEMPLATES: Omit<ExaminationPoint, 'id' | 'examined'>[] = [
  {
    type: 'bloodstain',
    description: 'Spots of blood on the ground, as if from a wound.',
    clueText: 'Someone was hurt here, but not fatally. They likely walked away.',
  },
  {
    type: 'struggle',
    description: 'The area is disturbed — a scuffle clearly took place.',
    clueText: 'A fight happened here. From the marks, it was between two people.',
  },
];

const TEMPLATES: Record<CrimeScene['crimeType'], Omit<ExaminationPoint, 'id' | 'examined'>[]> = {
  murder: MURDER_TEMPLATES,
  robbery: ROBBERY_TEMPLATES,
  assault: ASSAULT_TEMPLATES,
};

/**
 * Profession-based clues — if the killer has a known profession,
 * add a contextual clue that hints at their identity without naming them.
 */
const PROFESSION_CLUES: Record<string, { description: string; clueText: string }> = {
  blacksmith: {
    description: 'Faint traces of soot and iron filings near the scene.',
    clueText: 'Soot and iron filings — whoever did this works with metal and fire.',
  },
  bartender: {
    description: 'A faint smell of ale and hops lingers in the air.',
    clueText: 'The smell of ale is out of place here — the perpetrator may work at a tavern.',
  },
  merchant: {
    description: 'A small coin has rolled under the furniture, freshly dropped.',
    clueText: 'A dropped coin — someone who handles money frequently was here.',
  },
  guard: {
    description: 'Boot prints with an official-looking tread pattern.',
    clueText: 'Military-style boot prints. Someone trained in combat was involved.',
  },
  bard: {
    description: 'A broken lute string caught on a splinter.',
    clueText: 'A lute string — a musician was at the scene.',
  },
  priest: {
    description: 'A small vial of anointing oil, half-spilled on the ground.',
    clueText: 'Anointing oil — someone from the temple was here.',
  },
  herbalist: {
    description: 'Crushed dried herbs underfoot, fragrant and out of place.',
    clueText: 'Dried herbs scattered around — an herbalist or healer was present.',
  },
};

/**
 * Create a crime scene with appropriate examination points.
 */
export function createCrimeScene(
  locationId: string,
  crimeType: CrimeScene['crimeType'],
  gameDay: number,
  tick: number,
  perpetrator?: Agent,
  victim?: Agent,
  witnesses?: string[],
): CrimeScene {
  const points: ExaminationPoint[] = [];

  // Generic templates for this crime type
  for (const template of TEMPLATES[crimeType]) {
    points.push({
      ...template,
      id: crypto.randomUUID(),
      examined: false,
    });
  }

  // Personalize body description if victim is known
  if (crimeType === 'murder' && victim) {
    const bodyPoint = points.find((p) => p.type === 'body');
    if (bodyPoint) {
      bodyPoint.description = `The body of ${victim.profile.name} the ${victim.profile.role} lies on the ground.`;
      bodyPoint.clueText = `${victim.profile.name} was killed here. The attack seems sudden — no signs of an attempted escape.`;
    }
  }

  // Profession-specific clue for the perpetrator
  if (perpetrator) {
    const profClue = PROFESSION_CLUES[perpetrator.profile.role];
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
    crimeType,
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
  switch (scene.crimeType) {
    case 'murder':
      return `I noticed something terrible at ${locationName} — blood on the floor and signs of violence. Something awful happened here.`;
    case 'robbery':
      return `I noticed signs of a break-in at ${locationName} — a broken lock and scattered goods. Someone was robbed.`;
    case 'assault':
      return `I saw signs of a fight at ${locationName} — blood spots and overturned furniture. Someone was attacked here.`;
  }
}

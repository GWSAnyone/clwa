import { Agent, VectorMemory, BeliefManager, RelationshipGraph, DEFAULT_TRUST, DEFAULT_SENTIMENT } from '@clwa/engine';
import { ConsequenceEngine } from '@clwa/engine';
import { InMemoryEventStore } from '@clwa/engine';
import { World } from '@clwa/engine';
import type { AgentProfile, AgentState, RelationType } from '@clwa/engine';
import type { LocationDef, LocationGraph, ScheduleEntry, NpcHome } from '@clwa/engine';
import { registerCrimeJusticeModule, CRIME_CG_RULES } from '@clwa/modules';
import { registerRoleTopicPool, registerSecretDirectiveBuilder, registerEventCategory, PLAYER_ACTION_EVENT, PLAYER_ACTIONS } from '@clwa/engine';
import { broadcast } from './ws';
import { startServer } from './server';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

// ─── Register World Modules ───
registerCrimeJusticeModule();
registerEventCategory('player_action', [PLAYER_ACTION_EVENT]);

// ─── Register Role Topic Pools (world-specific conversation content) ───
registerRoleTopicPool('bartender', [
  { subject: 'a regular who hasn\'t come in lately', tone: 'mildly concerned', weight: 2, initiatorHook: 'You haven\'t seen a regular customer in days. Ask if they know anything.', category: 'role:bartender' },
  { subject: 'the ale quality this week', tone: 'professional', weight: 2, initiatorHook: 'The latest batch turned out different. Mention it in passing.', category: 'role:bartender' },
  { subject: 'something overheard last night', tone: 'gossipy, leaning in', weight: 2, initiatorHook: 'You overheard something interesting at the bar. Share it casually.', category: 'role:bartender' },
]);
registerRoleTopicPool('merchant', [
  { subject: 'a tricky customer earlier today', tone: 'amused or exasperated', weight: 2, initiatorHook: 'A farmer tried to pay you in chickens. Tell them about it.', category: 'role:merchant' },
  { subject: 'a missing shipment', tone: 'worried, business-like', weight: 2, initiatorHook: 'A crate you expected hasn\'t arrived. You\'re worried.', category: 'role:merchant' },
  { subject: 'whether people appreciate quality goods', tone: 'slightly bitter', weight: 2, initiatorHook: 'Nobody here understands what fine goods cost.', category: 'role:merchant' },
]);
registerRoleTopicPool('guard', [
  { subject: 'suspicious footprints near the gate', tone: 'alert, dutiful', weight: 2, initiatorHook: 'You noticed something odd during patrol.', category: 'role:guard' },
  { subject: 'how quiet the roads have been', tone: 'contemplative', weight: 2, initiatorHook: 'It\'s been unusually quiet. Not sure if that\'s good.', category: 'role:guard' },
  { subject: 'the paperwork piling up', tone: 'weary sigh', weight: 2, initiatorHook: 'Duty weighs on you today.', category: 'role:guard' },
]);
registerRoleTopicPool('priest', [
  { subject: 'a parishioner who came for counsel', tone: 'thoughtful', weight: 2, initiatorHook: 'A young couple came with a disagreement. It made you think.', category: 'role:priest' },
  { subject: 'the temple roof needing repair', tone: 'practical concern', weight: 2, initiatorHook: 'Rain leaked through the roof last night.', category: 'role:priest' },
  { subject: 'a dream you had last night', tone: 'unsettled, reflective', weight: 2, initiatorHook: 'A strange dream won\'t leave you.', category: 'role:priest' },
]);
registerRoleTopicPool('bard', [
  { subject: 'a melody that keeps coming back', tone: 'playful, humming', weight: 2, initiatorHook: 'A tune is stuck in your head.', category: 'role:bard' },
  { subject: 'an old man\'s story at the tavern', tone: 'theatrical', weight: 2, initiatorHook: 'An old man told you something strange.', category: 'role:bard' },
  { subject: 'whether anyone even listens anymore', tone: 'wistful', weight: 2, initiatorHook: 'You played your heart out and nobody clapped.', category: 'role:bard' },
]);
registerRoleTopicPool('blacksmith', [
  { subject: 'a difficult piece you\'re working on', tone: 'focused', weight: 2, initiatorHook: 'A commission is giving you trouble.', category: 'role:blacksmith' },
  { subject: 'the price of iron going up', tone: 'annoyed', weight: 2, initiatorHook: 'Materials are getting expensive.', category: 'role:blacksmith' },
  { subject: 'a blade you\'re proud of', tone: 'quiet pride', weight: 2, initiatorHook: 'You finished something exceptional.', category: 'role:blacksmith' },
]);
registerRoleTopicPool('judge', [
  { subject: 'a difficult case from the past', tone: 'thoughtful, burdened', weight: 2, initiatorHook: 'A case from years ago still troubles you.', category: 'role:judge' },
  { subject: 'the burden of judgment', tone: 'weary, philosophical', weight: 2, initiatorHook: 'Deciding someone\'s fate weighs on you.', category: 'role:judge' },
]);
registerRoleTopicPool('herbalist', [
  { subject: 'a rare herb you found at dawn', tone: 'mysterious, pleased', weight: 2, initiatorHook: 'You found something unusual in the wild.', category: 'role:herbalist' },
  { subject: 'someone who came for a remedy', tone: 'knowing, cryptic', weight: 2, initiatorHook: 'Someone visited for help. Hint at what ailed them.', category: 'role:herbalist' },
  { subject: 'the weather changing', tone: 'observant', weight: 2, initiatorHook: 'Signs in the weather mean something for the herbs.', category: 'role:herbalist' },
]);

// ─── Secret Directive Builders (player interaction effects) ───
registerSecretDirectiveBuilder(({ agent, agents, eventStore }) => {
  const agentId = agent.profile.id;
  const sections: string[] = [];
  // Resolve player name from agents map
  let pName: string | null = null;
  for (const a of agents.values()) {
    if (a.profile.isPlayer) { pName = a.profile.name; break; }
  }
  if (!pName) {
    console.error('  [SecretDirective] BUG: Player Agent not found in agents map');
    return sections;
  }

  const threatMemories = eventStore.query({ type: PLAYER_ACTION_EVENT })
    .filter((e) => e.object === agentId && (e.payload?.action === PLAYER_ACTIONS.THREATEN));
  if (threatMemories.length > 0) {
    sections.push(
      `## HIDDEN: You have been threatened\n` +
      `${pName} threatened you recently. You are afraid of them.\n` +
      `- When talking to ${pName}: be cautious, guarded, avoid provoking them.\n` +
      `- You might comply with their requests out of fear, though you resent it.\n` +
      `- If someone else asks about the threat: you might mention it nervously.`,
    );
  }

  const bribeMemories = eventStore.query({ type: PLAYER_ACTION_EVENT })
    .filter((e) => e.object === agentId && (e.payload?.action === PLAYER_ACTIONS.BRIBE));
  if (bribeMemories.length > 0) {
    sections.push(
      `## HIDDEN: You were offered a bribe\n` +
      `${pName} tried to bribe you. This makes you uncomfortable.\n` +
      `- You feel conflicted — the offer is tempting but wrong.\n` +
      `- If asked about shady dealings: you become evasive.`,
    );
  }

  return sections;
});

// ─── Persistence ───

const SAVE_DIR = join(dirname(import.meta.dir), 'data');
const SAVE_PATH = join(SAVE_DIR, 'save.json');

interface SaveData {
  version: 1;
  savedAt: string;
  world: ReturnType<World['toJSON']>;
  events: ReturnType<InMemoryEventStore['toJSON']>;
}

function saveToDisk(world: World, eventStore: InMemoryEventStore): void {
  const data: SaveData = {
    version: 1,
    savedAt: new Date().toISOString(),
    world: world.toJSON(),
    events: eventStore.toJSON(),
  };
  mkdirSync(SAVE_DIR, { recursive: true });
  writeFileSync(SAVE_PATH, JSON.stringify(data, null, 2));
  console.log(`  [Save] State saved to ${SAVE_PATH}`);
}

function loadFromDisk(): SaveData | null {
  if (!existsSync(SAVE_PATH)) return null;
  try {
    const raw = readFileSync(SAVE_PATH, 'utf-8');
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 1) {
      console.warn(`  [Save] Unknown save version ${data.version}, ignoring`);
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`  [Save] Failed to load save: ${err}`);
    return null;
  }
}

// ─── Locations ───

const LOCATIONS: LocationDef[] = [
  {
    id: 'tavern',
    name: 'Silver Flagon Tavern',
    connections: ['town-square'],
    isPublic: true,
  },
  {
    id: 'town-square',
    name: 'Town Square',
    connections: ['tavern', 'gate', 'market', 'temple', 'residential', 'courthouse'],
    isPublic: true,
  },
  {
    id: 'gate',
    name: 'Town Gate',
    connections: ['town-square'],
    isPublic: true,
  },
  {
    id: 'market',
    name: 'Market Square',
    connections: ['town-square', 'blacksmith'],
    isPublic: true,
  },
  {
    id: 'blacksmith',
    name: 'Blacksmith',
    connections: ['market'],
    isPublic: false,
  },
  {
    id: 'temple',
    name: 'Temple of Dawn',
    connections: ['town-square'],
    isPublic: true,
  },
  {
    id: 'residential',
    name: 'Residential Lane',
    connections: ['town-square'],
    isPublic: false,
  },
  {
    id: 'courthouse',
    name: 'Courthouse',
    connections: ['town-square'],
    isPublic: true,
  },
];

function buildLocationGraph(): LocationGraph {
  const graph: LocationGraph = new Map();
  for (const loc of LOCATIONS) {
    graph.set(loc.id, loc);
  }
  return graph;
}

// ─── NPC Profiles ───

const PROFILES: AgentProfile[] = [
  {
    id: 'ted',
    name: 'Ted',
    role: 'bartender',
    background:
      'Runs the Silver Flagon tavern for 15 years. Knows everyone in town. ' +
      'Heard every story, served every drink. The tavern is his life.',
    speechStyle:
      'Wipes a mug while talking. Calls regulars by nicknames. Warm drawl, trails off when nervous.\n' +
      'Example (relaxed): "Aye, the usual? Coming right up, friend. ...Say, you look like you could use more than ale tonight."\n' +
      'Example (deflecting): "Me? I just pour the drinks, friend. *wipes counter harder* Don\'t go mixin\' me up in..."\n' +
      'Example (shaken): "Hah! That reminds me of— ...no. *sets mug down too hard* Nevermind. Forget I said anything."',
    bigFive: { openness: 0.5, conscientiousness: 0.6, extraversion: 0.8, agreeableness: 0.7, neuroticism: 0.3, honesty: 0.6 },
    enneagram: { type: 9, wing: 8, coreFear: 'Losing connection with people and being alone', coreDesire: 'To keep peace and harmony around you', stressType: 6, growthType: 3 },
    llm: { temperature: 0.7, maxTokens: 250 },
    secret: 'You have been watering down the ale for months to cover gambling debts. Nobody has noticed yet.',
    innerConflict: 'You want to be honest with your regulars but you cannot afford to stop. The guilt is eating at you.',
  },
  {
    id: 'mark',
    name: 'Mark',
    role: 'merchant',
    background:
      'Traveling merchant who set up shop at the Market Square. Deals in exotic goods ' +
      'and rare spices. Has connections in three kingdoms. Always looking for profit. ' +
      'Frequently visits the tavern for gossip and the town square for customers.',
    speechStyle:
      'Weighs every word like a coin. Drops distant city names casually. Slightly condescending to those without money.\n' +
      'Example: "Hmm. In Valdris they would pay triple for this. But for you... let us say, a fair price."\n' +
      'Example: "Interesting. Very interesting. ...I may have something. Depends on what you can offer."',
    bigFive: { openness: 0.5, conscientiousness: 0.3, extraversion: 0.7, agreeableness: 0.3, neuroticism: 0.6, honesty: 0.2 },
    enneagram: { type: 3, wing: 2, coreFear: 'Being worthless or a failure', coreDesire: 'To be admired and seen as successful', stressType: 9, growthType: 6 },
    llm: { temperature: 0.6, maxTokens: 200 },
    secret: 'Some of the "exotic spices" you sell are actually common herbs from the next town over, marked up tenfold.',
    innerConflict: 'You tell yourself it is just business, but Old Bess knows. She keeps hinting, smiling that knowing smile. One day she will talk, and everything will be over.',
    motive: {
      targetId: 'bess',
      reason: 'Old Bess figured out your exotic spices are common herbs. She hinted she might tell everyone. If she talks, your reputation and livelihood are finished.',
    },
    shop: [
      { id: 'spice_valdris', name: 'Valdris Fire Spice', price: 15, description: 'A pungent red spice from the eastern kingdoms. Or so Mark claims.' },
      { id: 'map_region', name: 'Regional Map', price: 8, description: 'A hand-drawn map of the surrounding area. Mostly accurate.' },
      { id: 'rope_silk', name: 'Silk Rope (30ft)', price: 12, description: 'Strong and lightweight. Good for climbing or binding.' },
      { id: 'potion_minor', name: 'Minor Healing Tonic', price: 20, description: 'A small vial of herbal remedy. Tastes terrible, works adequately.' },
      { id: 'lantern', name: 'Brass Lantern', price: 10, description: 'A sturdy lantern. Burns for 8 hours on one fill.' },
    ],
  },
  {
    id: 'elara',
    name: 'Elara',
    role: 'bard',
    background:
      'A traveling bard who performs at the Silver Flagon most evenings. ' +
      'She collects stories and gossip from every corner of town. ' +
      'Nothing escapes her sharp ears. Loves drama and intrigue. ' +
      'Wanders between the tavern, town square, market, and temple.',
    speechStyle:
      'Theatrical, vivid imagery. Hums between sentences. Treats everything as a story unfolding.\n' +
      'Example: "Ah, now THIS is a tale worth telling! *hums* ...But every tale has its dark chapter, no?"\n' +
      'Example: "Mmm-hmm-hmm... You know, I once heard a song about a stranger just like you. It did not end well."',
    bigFive: { openness: 0.9, conscientiousness: 0.3, extraversion: 0.9, agreeableness: 0.6, neuroticism: 0.5, honesty: 0.5 },
    enneagram: { type: 3, wing: 4, coreFear: 'Being insignificant and forgotten', coreDesire: 'To be remarkable and leave a lasting impression', stressType: 9, growthType: 6 },
    llm: { temperature: 0.9, maxTokens: 350 },
    secret: 'You are not just a wandering bard — you are gathering information for a noble house in a distant city. Your songs are reports.',
    innerConflict: 'You genuinely like these people now. Reporting on them feels like betrayal. But you owe your patron everything.',
  },
  {
    id: 'garrett',
    name: 'Garrett',
    role: 'guard',
    investigator: true,
    detersCrime: true,
    background:
      'Town guard stationed at the Town Gate. ' +
      '10 years of service. Takes his duty seriously. Patrols the gate area and ' +
      'only visits the tavern occasionally. Relies on townsfolk for news from inside.',
    speechStyle:
      'Clipped military tone. Short sentences, flat delivery. Emotion leaks through pauses and physical gestures, not words.\n' +
      'Example (routine): "Quiet night. ...Too quiet. *adjusts halberd* Move along."\n' +
      'Example (receiving report): "Tell me what you saw. All of it. *hand moves to weapon* Leave nothing out."\n' +
      'Example (under pressure): "*long pause* ...Right. *exhales through nose* I will handle this. Personally."\n' +
      'Example (frustrated): "Everyone talks. Nobody acts. *stares past you* Fine. I will go look myself."',
    bigFive: { openness: 0.3, conscientiousness: 0.9, extraversion: 0.5, agreeableness: 0.4, neuroticism: 0.2, honesty: 0.7 },
    enneagram: { type: 6, wing: 5, coreFear: 'Being without guidance or security', coreDesire: 'To have stability and support from authority', stressType: 3, growthType: 9 },
    llm: { temperature: 0.5, maxTokens: 150 },
    secret: 'Last winter you let a wanted fugitive pass through the gate because he bribed you. You have never told anyone.',
    innerConflict: 'You pride yourself on duty and honor, but that one lapse haunts you. Every time someone questions your integrity, you overreact.',
  },
  {
    id: 'aldric',
    name: 'Father Aldric',
    role: 'priest',
    background:
      'The elderly priest of the Temple of Dawn. Has served the town for 30 years. ' +
      'Wise and patient, he counsels townsfolk in times of trouble. Believes in justice ' +
      'and mercy in equal measure. Keeps records of births, deaths, and marriages.',
    speechStyle:
      'Gentle, deliberate. Uses parables. Begins with "My child" or "The Dawn teaches us". Never raises voice.\n' +
      'Example: "My child... sit. The Dawn teaches us that even the longest night must end. Tell me what troubles you."\n' +
      'Example: "Hmm. There is an old saying — the hammer that strikes too eagerly breaks itself. Perhaps patience is needed here."',
    bigFive: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.5, agreeableness: 0.9, neuroticism: 0.4, honesty: 0.9 },
    enneagram: { type: 1, wing: 9, coreFear: 'Being corrupt or morally flawed', coreDesire: 'To be good, righteous, and have integrity', stressType: 4, growthType: 7 },
    llm: { temperature: 0.65, maxTokens: 300 },
    secret: 'You lost your faith years ago. You go through the motions of prayer but feel nothing. The Dawn does not answer.',
    innerConflict: 'The townsfolk need you to be strong and certain. You cannot show doubt — it would destroy them. So you keep pretending.',
  },
  {
    id: 'hilda',
    name: 'Hilda',
    role: 'blacksmith',
    background:
      'The town blacksmith. Strong-willed woman who inherited the forge from her father. ' +
      'Makes weapons, tools, and horseshoes. Pragmatic and no-nonsense. ' +
      'Knows the quality of every blade in town. Respects hard work above all.',
    speechStyle:
      'Blunt, short sentences. Says "aye". Loud from forge years. Impatient with small talk, loyal to friends.\n' +
      'Example: "Aye. Good steel, that. ...What? No, I do not do discounts. You want cheap, go elsewhere."\n' +
      'Example: "Hmph. Heard something happened at the square. None of my business. ...Is Ted alright though?"',
    bigFive: { openness: 0.3, conscientiousness: 0.8, extraversion: 0.4, agreeableness: 0.3, neuroticism: 0.2, honesty: 0.7 },
    enneagram: { type: 8, wing: 9, coreFear: 'Being controlled or vulnerable', coreDesire: 'To protect yourself and those you love', stressType: 5, growthType: 2 },
    llm: { temperature: 0.55, maxTokens: 120 },
    shop: [
      { id: 'sword_iron', name: 'Iron Shortsword', price: 25, description: 'A reliable blade. Nothing fancy, but it will cut.' },
      { id: 'axe_hand', name: 'Hand Axe', price: 18, description: 'Good for chopping wood or skulls. Hilda does not judge.' },
      { id: 'shield_wood', name: 'Wooden Shield', price: 15, description: 'Reinforced oak with iron bands. Takes a beating.' },
      { id: 'dagger_steel', name: 'Steel Dagger', price: 12, description: 'A sharp dagger. Discreet and deadly.' },
      { id: 'horseshoes', name: 'Set of Horseshoes', price: 8, description: 'Quality horseshoes. Hilda takes pride in these.' },
    ],
    secret: 'Your father did not die of illness — he was killed in a bar fight that Ted broke up too late. You never blamed Ted openly.',
    innerConflict: 'Ted is your closest friend. But sometimes when he laughs, you remember your father bleeding on the tavern floor.',
    motive: {
      targetId: 'ted',
      reason: 'Your father bled out on the tavern floor while Ted watched and did nothing to help. Fifteen years of smiling at the man who let your father die.',
    },
  },
  {
    id: 'bess',
    name: 'Old Bess',
    role: 'herbalist',
    background:
      'An eccentric old herbalist who sells potions, remedies, and dried herbs ' +
      'at the Market Square. Claims to read fortunes in tea leaves. ' +
      'Knows every plant in the region. Some say she is a hedge witch. ' +
      'Has lived in town longer than anyone can remember.',
    speechStyle:
      'Cryptic riddles. Cackles at own jokes. Calls everyone "dearie" or "love". Mutters to herself.\n' +
      'Example: "Heh heh... dearie, the leaves told me you would come. They also told me something else, but... *mutters*"\n' +
      'Example: "Oh love, you want a remedy? For what ails you... or for what is about to? Heh heh heh."',
    bigFive: { openness: 0.8, conscientiousness: 0.4, extraversion: 0.3, agreeableness: 0.7, neuroticism: 0.6, honesty: 0.8 },
    enneagram: { type: 5, wing: 4, coreFear: 'Being helpless or incompetent', coreDesire: 'To understand the world and be self-sufficient', stressType: 7, growthType: 8 },
    llm: { temperature: 0.85, maxTokens: 280 },
    shop: [
      { id: 'herb_calm', name: 'Calming Herbs', price: 5, description: 'Dried lavender and chamomile. Good for nerves.' },
      { id: 'potion_heal', name: 'Healing Poultice', price: 15, description: 'A thick paste that speeds wound healing. Smells of moss.' },
      { id: 'tea_fortune', name: 'Fortune Tea Leaves', price: 10, description: 'Bess claims these reveal the future. Results may vary.' },
      { id: 'antidote', name: 'Antidote Vial', price: 20, description: 'Cures most common poisons. Bess tested it. On what, she will not say.' },
    ],
    secret: 'You can actually see glimpses of the future in your tea leaves. It is not a trick. You saw the murder before it happened and said nothing.',
    innerConflict: 'Could you have warned them? Would anyone have believed a crazy old woman? The guilt visits you every night.',
  },
  {
    id: 'magistrate',
    name: 'Magistrate Theron',
    role: 'judge',
    canSentence: true,
    background:
      'The town magistrate who presides over the Courthouse. A former scholar of law from the capital, ' +
      'sent to this frontier town as punishment for questioning the king\'s tax reforms. ' +
      'Despite resentment at his posting, he takes justice seriously. Weighs evidence carefully, ' +
      'distrusts hearsay, and insists on testimony before passing judgment.',
    speechStyle:
      'Precise, formal diction. Pauses before judgments. Uses legal phrases. Never emotional in public.\n' +
      'Example: "The court will hear the evidence. ...Proceed, but be precise — I have no patience for speculation."\n' +
      'Example: "*adjusts spectacles* Interesting. And do you have a witness to corroborate this claim? No? Then it remains allegation."',
    bigFive: { openness: 0.6, conscientiousness: 0.95, extraversion: 0.4, agreeableness: 0.4, neuroticism: 0.2, honesty: 0.9 },
    enneagram: { type: 1, wing: 9, coreFear: 'Making an unjust ruling that condemns an innocent', coreDesire: 'To uphold true justice regardless of pressure', stressType: 4, growthType: 7 },
    llm: { temperature: 0.5, maxTokens: 250 },
    secret: 'You were exiled from the capital for publicly accusing a duke of corruption. You were right, but no one cared.',
    innerConflict: 'You believe in the law absolutely, but this small town tests you — here, everyone knows everyone. Pure objectivity feels impossible.',
  },
];

const NPC_LOCATIONS: { id: string; location: string }[] = [
  { id: 'ted', location: 'Silver Flagon Tavern' },
  { id: 'mark', location: 'Market Square' },
  { id: 'elara', location: 'Silver Flagon Tavern' },
  { id: 'garrett', location: 'Town Gate' },
  { id: 'aldric', location: 'Temple of Dawn' },
  { id: 'hilda', location: 'Blacksmith' },
  { id: 'bess', location: 'Market Square' },
  { id: 'magistrate', location: 'Courthouse' },
];

const MOBILE_NPCS = new Set(['elara', 'mark']);

// ─── NPC Homes ───

const NPC_HOMES: NpcHome[] = [
  { npcId: 'ted', location: 'Silver Flagon Tavern' },
  { npcId: 'mark', location: 'Residential Lane' },
  { npcId: 'elara', location: 'Residential Lane' },
  { npcId: 'garrett', location: 'Town Gate' },
  { npcId: 'aldric', location: 'Temple of Dawn' },
  { npcId: 'hilda', location: 'Blacksmith' },
  { npcId: 'bess', location: 'Residential Lane' },
  { npcId: 'magistrate', location: 'Courthouse' },
];

// ─── NPC Schedules ───

const NPC_SCHEDULES: ScheduleEntry[] = [
  { npcId: 'ted', period: 'morning',   location: 'Silver Flagon Tavern', activity: 'cleaning and preparing the tavern' },
  { npcId: 'ted', period: 'afternoon', location: 'Silver Flagon Tavern', activity: 'serving drinks' },
  { npcId: 'ted', period: 'evening',   location: 'Silver Flagon Tavern', activity: 'busy serving the evening crowd' },
  { npcId: 'ted', period: 'night',     location: 'Silver Flagon Tavern', activity: 'sleeping upstairs' },
  { npcId: 'mark', period: 'dawn',      location: 'Residential Lane',       activity: 'waking up, getting ready for the day' },
  { npcId: 'mark', period: 'morning',   location: 'Market Square',          activity: 'trading goods' },
  { npcId: 'mark', period: 'afternoon', location: 'Blacksmith',             activity: 'picking up supplies from the blacksmith' },
  { npcId: 'mark', period: 'evening',   location: 'Silver Flagon Tavern',   activity: 'drinking and looking for gossip' },
  { npcId: 'mark', period: 'night',     location: 'Residential Lane',       activity: 'sleeping' },
  { npcId: 'elara', period: 'dawn',      location: 'Residential Lane',      activity: 'humming and stretching, chatting with neighbors' },
  { npcId: 'elara', period: 'morning',   location: 'Town Square',           activity: 'people-watching and collecting stories' },
  { npcId: 'elara', period: 'afternoon', location: 'Market Square',         activity: 'performing for shoppers' },
  { npcId: 'elara', period: 'evening',   location: 'Silver Flagon Tavern',  activity: 'performing songs and tales' },
  { npcId: 'elara', period: 'night',     location: 'Residential Lane',      activity: 'sleeping' },
  { npcId: 'garrett', period: 'dawn',      location: 'Town Gate',           activity: 'morning watch' },
  { npcId: 'garrett', period: 'morning',   location: 'Town Gate',           activity: 'guarding the gate' },
  { npcId: 'garrett', period: 'afternoon', location: 'Town Square',         activity: 'patrol through town' },
  { npcId: 'garrett', period: 'evening',   location: 'Town Gate',           activity: 'evening watch' },
  { npcId: 'garrett', period: 'night',     location: 'Town Gate',           activity: 'resting in guard quarters' },
  { npcId: 'aldric', period: 'dawn',      location: 'Temple of Dawn',       activity: 'morning prayers and meditation' },
  { npcId: 'aldric', period: 'morning',   location: 'Temple of Dawn',       activity: 'counseling townsfolk' },
  { npcId: 'aldric', period: 'afternoon', location: 'Town Square',          activity: 'blessing passersby and offering counsel' },
  { npcId: 'aldric', period: 'evening',   location: 'Temple of Dawn',       activity: 'evening vespers' },
  { npcId: 'aldric', period: 'night',     location: 'Temple of Dawn',       activity: 'sleeping in the temple quarters' },
  { npcId: 'hilda', period: 'dawn',      location: 'Blacksmith',            activity: 'stoking the forge' },
  { npcId: 'hilda', period: 'morning',   location: 'Blacksmith',            activity: 'forging and hammering' },
  { npcId: 'hilda', period: 'afternoon', location: 'Blacksmith',            activity: 'taking orders and working' },
  { npcId: 'hilda', period: 'evening',   location: 'Silver Flagon Tavern',  activity: 'having a drink after work' },
  { npcId: 'hilda', period: 'night',     location: 'Blacksmith',            activity: 'sleeping above the forge' },
  { npcId: 'bess', period: 'dawn',      location: 'Residential Lane',       activity: 'brewing morning tea, muttering to herself' },
  { npcId: 'bess', period: 'morning',   location: 'Market Square',          activity: 'selling remedies and reading fortunes' },
  { npcId: 'bess', period: 'afternoon', location: 'Market Square',          activity: 'selling remedies' },
  { npcId: 'bess', period: 'evening',   location: 'Temple of Dawn',         activity: 'praying and muttering to herself' },
  { npcId: 'bess', period: 'night',     location: 'Residential Lane',       activity: 'sleeping' },
  { npcId: 'magistrate', period: 'dawn',      location: 'Courthouse',              activity: 'reviewing case documents' },
  { npcId: 'magistrate', period: 'morning',   location: 'Courthouse',              activity: 'holding court and hearing matters' },
  { npcId: 'magistrate', period: 'afternoon', location: 'Town Square',             activity: 'taking a walk, observing the town' },
  { npcId: 'magistrate', period: 'evening',   location: 'Silver Flagon Tavern',    activity: 'having a quiet drink alone' },
  { npcId: 'magistrate', period: 'night',     location: 'Courthouse',              activity: 'sleeping in courthouse quarters' },
];

// ─── NPC Relationships ───

interface RelDef {
  from: string;
  to: string;
  type: RelationType;
  note?: string;
  sentiment?: number;
  trust?: number;
}

const RELATIONSHIP_DEFS: RelDef[] = [
  // Ted — friendly bartender, but debts create friction with Mark
  { from: 'ted', to: 'hilda',   type: 'friend',      note: 'old drinking buddies' },
  { from: 'ted', to: 'elara',   type: 'colleague',    note: 'performs at his tavern' },
  { from: 'ted', to: 'garrett', type: 'acquaintance',  note: 'occasional tavern visitor' },
  { from: 'ted', to: 'aldric',  type: 'acquaintance',  note: 'comes for counsel sometimes' },
  { from: 'ted', to: 'mark',    type: 'acquaintance',  note: 'owes Mark money from gambling debts', sentiment: -0.15, trust: 0.3 },
  { from: 'ted', to: 'bess',    type: 'acquaintance',  note: 'buys remedies for hangovers' },

  // Mark — paranoid merchant, hates Bess, resents paying Hilda, contempt for Ted
  { from: 'mark', to: 'bess',   type: 'acquaintance',  note: 'she knows too much about herbs', sentiment: -0.7, trust: 0.0 },
  { from: 'mark', to: 'hilda',  type: 'colleague',     note: 'resents paying full price for materials', sentiment: -0.15, trust: 0.3 },
  { from: 'mark', to: 'elara',  type: 'acquaintance',  note: 'entertains at the tavern' },
  { from: 'mark', to: 'garrett', type: 'acquaintance',  note: 'avoids the guard when possible', sentiment: -0.1 },
  { from: 'mark', to: 'ted',    type: 'acquaintance',  note: 'Ted still owes him money', sentiment: -0.1, trust: 0.2 },

  // Elara — spy, wary of Garrett who asks too many questions
  { from: 'elara', to: 'ted',    type: 'friend',      note: 'her favorite stage' },
  { from: 'elara', to: 'aldric', type: 'acquaintance',  note: 'visits the temple for stories' },
  { from: 'elara', to: 'bess',   type: 'acquaintance',  note: 'fascinated by her riddles' },
  { from: 'elara', to: 'garrett', type: 'acquaintance', note: 'he asks too many questions, she is wary', sentiment: -0.1, trust: 0.3 },

  // Garrett — dutiful guard, slightly suspicious of Elara
  { from: 'garrett', to: 'aldric', type: 'colleague',   note: 'both serve the town' },
  { from: 'garrett', to: 'hilda',  type: 'acquaintance', note: 'respects her work' },
  { from: 'garrett', to: 'elara',  type: 'acquaintance', note: 'something about her does not add up', sentiment: -0.1, trust: 0.3 },
  { from: 'garrett', to: 'magistrate', type: 'colleague', note: 'brings cases to the judge' },

  // Aldric — crisis of faith, close to Bess
  { from: 'aldric', to: 'bess',    type: 'friend',    note: 'elderly companionship, share tea' },
  { from: 'aldric', to: 'garrett', type: 'colleague',  note: 'both protectors of the town' },
  { from: 'aldric', to: 'magistrate', type: 'colleague', note: 'fellow pillars of the community' },

  // Hilda — suppressed rage toward Ted, pragmatic with Mark
  { from: 'hilda', to: 'ted',    type: 'friend',      note: 'old drinking buddies, but her father died in his tavern', sentiment: -0.2, trust: 0.4 },
  { from: 'hilda', to: 'mark',   type: 'colleague',    note: 'trades materials, resents his haggling', sentiment: -0.1 },

  // Bess — sees through Mark's lies, distrusts him
  { from: 'bess', to: 'aldric',  type: 'friend',      note: 'share wisdom and tea' },
  { from: 'bess', to: 'mark',    type: 'acquaintance', note: 'his spices smell like common weeds', sentiment: -0.3, trust: 0.1 },

  // Theron — law, order, partnerships
  { from: 'magistrate', to: 'garrett', type: 'colleague', note: 'law enforcement partnership' },
  { from: 'magistrate', to: 'aldric',  type: 'colleague', note: 'both serve the town, mutual respect' },
  { from: 'magistrate', to: 'ted',     type: 'acquaintance', note: 'evening tavern visitor' },
];

function buildRelationships(npcId: string, profiles: AgentProfile[]): RelationshipGraph {
  const graph = new RelationshipGraph();
  for (const def of RELATIONSHIP_DEFS) {
    if (def.from !== npcId) continue;
    const target = profiles.find((p) => p.id === def.to);
    if (!target) continue;
    graph.addRelationship({
      targetId: def.to,
      targetName: target.name,
      type: def.type,
      sentiment: def.sentiment ?? DEFAULT_SENTIMENT[def.type],
      trust: def.trust ?? DEFAULT_TRUST[def.type],
    });
  }
  return graph;
}

/** Starting moods derived from personality + situation. Creates varied tension landscape. */
/** Starting moods — spread across positive range. Crime requires significant mood deterioration. */
const STARTING_MOODS: Record<string, number> = {
  ted: 0.35,          // generally cheerful despite debt worries
  mark: -0.2,         // paranoid about Bess, debts pressing
  elara: 0.25,        // enjoying village life despite spy guilt
  garrett: 0.45,      // dutiful, stable
  aldric: 0.10,       // faith wavering but holding
  hilda: 0.20,        // content at the forge, father's memory simmers
  bess: 0.30,         // at peace with her herbs and visions
  magistrate: 0.40,   // found purpose in small-town justice
};

/** Shared world knowledge — every NPC knows these facts about the village. */
const WORLD_LORE: string[] = [
  'Millhaven is a small frontier village, founded over 200 years ago by settlers from the eastern kingdoms.',
  'The village has 8 locations: Silver Flagon Tavern (the social heart), Town Square (the central hub), Town Gate (the only way in or out), Market Square (trade and commerce), Blacksmith (Hilda\'s forge), Temple of Dawn (worship and counsel), Residential Lane (homes), and the Courthouse (law and order).',
  'The road to Valdris — the nearest city — is a week\'s journey through highlands known for bandits.',
  'The Silver Flagon has served ale since the village founding. It\'s where everyone gathers in the evenings.',
  'Magistrate Theron was sent here five years ago from the capital. Nobody knows exactly why.',
  'Market days draw a few traders from surrounding farms, but Millhaven is mostly self-sufficient.',
  'The Temple of Dawn was built by Brother Celwyn two generations ago. Father Aldric is his successor.',
  'Winters are harsh. The village depends on stored grain, preserved meat, and whatever Bess can grow.',
  'There is no formal jail — the courthouse has a holding cell used maybe once a year.',
  'Everyone knows everyone. Secrets don\'t stay hidden long in a village this small.',
];

/** Per-NPC background memories — seeded into Qdrant at startup. Their lived past. */
const BACKGROUND_MEMORIES: Record<string, string[]> = {
  ted: [
    'I\'ve been running the Silver Flagon for fifteen years. Every face that walks through that door, I know their name and their usual drink.',
    'My wife passed seven years ago. The tavern is all I have left. It keeps me busy, keeps me sane.',
    'Hilda comes in every evening after closing the forge. We sit, we drink, we talk about nothing. It\'s the only peace either of us gets.',
    'Three years ago, Mark rolled in with his wagon of "exotic spices." The market hasn\'t been the same since.',
    'The gambling started small — a few coins on card games with travelers. Now I owe more than I earn in three months. I\'ve been watering the ale to cover the difference.',
    'Father Aldric used to come in more often. Lately he just sits in the temple staring at the altar. Something changed in him.',
  ],
  mark: [
    'I came to Millhaven three years ago. These villagers don\'t know real trade — they pay premium for colored dirt I buy for pennies in the next town.',
    'Old Bess figured out my spices are common herbs within the first week. She just smiles that knowing smile and says nothing. Every day I wonder when she\'ll talk.',
    'The debts to the Valdris money-lenders are growing. They don\'t send polite reminders — they send men.',
    'I chose this village because it\'s remote enough that nobody checks credentials. A fresh start. Or so I thought.',
    'Hilda overcharges me for metalwork. I overcharge everyone for spices. We understand each other, in a way.',
  ],
  elara: [
    'I arrived in Millhaven two years ago, posing as a traveling bard. My patron — Lord Ashford of the eastern court — sends a courier every month for my reports.',
    'The people here have no idea. They think I\'m just a wandering musician who fell in love with the village. And honestly... I did.',
    'Ted lets me perform at the Flagon every evening. Free room, free ale, and a front-row seat to every secret this village whispers.',
    'I\'ve been watching Garrett closely. A guard who once took a bribe — that\'s the kind of information Lord Ashford pays well for.',
    'Sometimes I play songs about real events — the caravan robbery last autumn, the miller\'s affair. People laugh, not knowing I\'m documenting them.',
  ],
  garrett: [
    'Ten years at this gate. I know every merchant, every traveler, every suspicious shadow that passes through.',
    'Last winter, a fugitive came through. Offered me gold — more than I make in a year. I let him pass. I\'ve never told anyone.',
    'The magistrate trusts me. That trust is the only thing holding my conscience together after what I did.',
    'I trained with the King\'s Guard in the capital before being stationed here. This posting was supposed to be temporary. That was ten years ago.',
    'Hilda made my halberd. Best weapon I\'ve ever held. She takes pride in her craft — I respect that more than she knows.',
  ],
  aldric: [
    'I took the vows thirty years ago, full of fire and faith. Brother Celwyn himself ordained me at this very altar.',
    'The Dawn stopped answering my prayers five years ago. I go through the motions — the candles, the hymns, the sermons. But inside, there\'s only silence.',
    'Old Bess is the only person who doesn\'t need me to be strong. We share tea and silence. She knows something is wrong but never asks.',
    'I counsel the troubled, comfort the grieving, bless the newborn. All while feeling like a fraud. They deserve better.',
    'The temple needs repairs I can\'t afford. The roof leaks when it rains. Brother Celwyn would be heartbroken.',
  ],
  hilda: [
    'My father built this forge with his own hands. I was hammering horseshoes before I could read. This is my life — iron and fire.',
    'Father died in Ted\'s tavern. A bar fight. Ted tried to break it up but was too slow. Fifteen years and I still see the blood on the floorboards.',
    'Ted is my closest friend. We drink together almost every night. But sometimes when he laughs, I hear my father\'s last breath.',
    'I make weapons, tools, horseshoes. The work is honest. I don\'t need exotic spices or fancy words — just good steel and a hot forge.',
    'Mark haggles every time he picks up an order. Tries to talk the price down. I don\'t budge. He pays what it\'s worth or he walks.',
  ],
  bess: [
    'I\'ve lived in Millhaven longer than anyone remembers. They call me Old Bess now. I was just Bess once.',
    'The tea leaves show me things. Not clear pictures — fragments, feelings, shadows of what\'s coming. Most people think it\'s a trick. It\'s not.',
    'I saw the murder before it happened. In the leaves, clear as daylight. Someone in this village will die by another\'s hand. I said nothing.',
    'Mark thinks I don\'t know about his fake spices. I knew the moment he opened his first sack — common rosemary dusted with turmeric. I could expose him anytime.',
    'Father Aldric and I share evening tea. He\'s lost something precious — not an object, but his connection to whatever he used to pray to. I see it in his eyes.',
  ],
  magistrate: [
    'Five years ago I stood before the Duke and accused him of corruption. I was right. He was powerful. I was exiled to this village as punishment.',
    'The law is the law — whether in the capital or in Millhaven. I will uphold it with the same rigor here as I would before the King.',
    'Garrett is competent. Dutiful. But I sense something buried — a guilt he carries like a stone in his chest. I haven\'t pressed him on it.',
    'This village is small but its people are complex. Every case I judge, every dispute I settle — there are layers beneath layers.',
    'I miss the capital. The libraries, the courts, the debates. Here I judge disputes over goat ownership. But justice is justice, regardless of scale.',
  ],
};

function makeState(location: string, npcId: string): AgentState {
  return {
    alive: true,
    status: undefined,
    location,
    mood: STARTING_MOODS[npcId] ?? 0.2,
    currentDay: 1,
    knownFacts: WORLD_LORE.slice(), // each NPC gets a copy of shared world knowledge
    beliefs: new BeliefManager(),
    relationships: buildRelationships(npcId, PROFILES),
  };
}

// ─── Bootstrap ───

const PORT = parseInt(process.env.PORT ?? '3000');

async function main() {
  console.log('=== CLWA Server — Starting ===');
  console.log();

  const savedData = loadFromDisk();
  if (savedData) {
    console.log(`  [Save] Found save from ${savedData.savedAt}`);
  }

  const eventStore = new InMemoryEventStore();
  if (savedData) {
    eventStore.loadFromJSON(savedData.events);
    console.log(`  [+] Event Store — restored ${savedData.events.length} events`);
  } else {
    console.log('  [+] Event Store');
  }

  const locationGraph = buildLocationGraph();
  console.log(`  [+] Location Graph — ${locationGraph.size} locations`);

  const agents = new Map<string, Agent>();
  const shouldResetMemory = !savedData;
  for (const npc of NPC_LOCATIONS) {
    const profile = PROFILES.find((p) => p.id === npc.id)!;
    const memory = new VectorMemory(profile.id);
    await memory.init(shouldResetMemory ? { reset: true } : undefined);
    const agent = new Agent(profile, makeState(npc.location, npc.id), memory, {
      reflection: { threshold: 30 },
      onReflection: (name, text) => {
        console.log(`  [Reflection] ${name}: "${text}"`);
        broadcast({ type: 'reflection', data: { agentName: name, text } });
      },
    });
    agents.set(profile.id, agent);
    console.log(`  [+] ${profile.name} the ${profile.role} @ ${npc.location}`);
  }

  // ─── Seed background memories (unchangeable past) ───
  // Use memory.store() directly — NOT observe() — to avoid triggering reflection on startup
  if (!savedData) {
    for (const [npcId, agent] of agents) {
      const memories = BACKGROUND_MEMORIES[npcId];
      if (!memories || !agent.memory) continue;
      for (const memText of memories) {
        await agent.memory.store(memText, 6, 0); // gameDay 0 = before simulation, importance 6
      }
    }
    console.log(`  [+] Background memories seeded for ${Object.keys(BACKGROUND_MEMORIES).length} NPCs`);
  }

  // ─── Starting beliefs (economic pressure, secrets) ───
  const markAgent = agents.get('mark');
  if (markAgent?.state.beliefs) {
    markAgent.state.beliefs.addBelief({
      id: crypto.randomUUID(),
      eventType: 'DEBT_PRESSURE',
      subject: 'Mark',
      object: null,
      location: null,
      confidence: 0.8,
      source: 'observation',
      sourceNpcId: null,
      gameDay: 1,
      lastUpdated: 1,
    });
  }
  const tedAgent = agents.get('ted');
  if (tedAgent?.state.beliefs) {
    tedAgent.state.beliefs.addBelief({
      id: crypto.randomUUID(),
      eventType: 'DEBT_PRESSURE',
      subject: 'Ted',
      object: null,
      location: null,
      confidence: 0.6,
      source: 'observation',
      sourceNpcId: null,
      gameDay: 1,
      lastUpdated: 1,
    });
  }

  // ─── Player Agent — full participant in the world ───
  {
    const playerProfile: AgentProfile = {
      id: 'player',
      name: 'Traveler',
      role: 'traveler',
      background: 'A mysterious traveler who arrived in town recently.',
      speechStyle: '', // Not used — player types freely
      bigFive: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, honesty: 0.5 },
      enneagram: { type: 5, wing: 6, coreFear: '', coreDesire: '', stressType: 7, growthType: 8 },
      isPlayer: true,
    };
    const playerRelationships = new RelationshipGraph();
    for (const p of PROFILES) {
      playerRelationships.addRelationship({
        targetId: p.id,
        targetName: p.name,
        type: 'acquaintance' as RelationType,
        sentiment: 0.0,
        trust: 0.3, // Stranger — low initial trust
      });
    }
    // NPCs also get a relationship entry toward the player
    for (const [, npcAgent] of agents) {
      npcAgent.state.relationships?.addRelationship({
        targetId: 'player',
        targetName: 'Traveler',
        type: 'acquaintance' as RelationType,
        sentiment: 0.0,
        trust: 0.3,
      });
    }
    const playerMemory = new VectorMemory('player');
    await playerMemory.init(shouldResetMemory ? { reset: true } : undefined);
    const playerAgent = new Agent(playerProfile, {
      alive: true,
      status: undefined,
      location: 'Town Square',
      mood: 0.3,
      currentDay: 1,
      knownFacts: [
        '# You are a traveler who just arrived in this small town. You know nothing about the locals yet.',
      ],
      beliefs: new BeliefManager(),
      relationships: playerRelationships,
    }, playerMemory);
    agents.set('player', playerAgent);
    console.log('  [+] Player Agent (Traveler) @ Town Square');
  }

  const publicPlaces = new Set<string>();
  for (const loc of locationGraph.values()) {
    if (loc.isPublic) publicPlaces.add(loc.name);
  }

  let world: World;
  /** NPC approach prompt context — injected into NPC system prompt when player chats after approach */
  const approachContexts = new Map<string, string>();

  const engine = new ConsequenceEngine(CRIME_CG_RULES, {
    onEvent: (event) => {
      eventStore.append(event);
      broadcast({ type: 'event', data: event });
      if (world) {
        world.handleEventForGoals(event);
      }
    },
  });
  console.log(`  [+] Consequence engine — ${CRIME_CG_RULES.length} rules`);

  world = new World(
    agents,
    eventStore,
    engine,
    { minConversationScore: 1, publicPlaces, pairCooldownTicks: 16, affordanceCooldownTicks: 12, decisionCooldownTicks: 4, startTick: 28, moodBias: -0.01 },
    {
      onLine: (line) => {
        console.log(`    ${line.speakerName}: "${line.text}"`);
        broadcast({ type: 'conversation:line', data: line });
      },
      onConversation: (result) => {
        broadcast({ type: 'conversation:complete', data: result });
      },
      onTick: (result) => {
        if (result.time) {
          console.log(`  [Time] Tick ${result.tickNumber} — ${result.time.hour} (${result.time.period})`);
        }
        if (result.dayAdvanced) {
          console.log(`  [Time] === Day ${result.gameDay} ===`);
        }
        // Process NPC approach events
        if (result.approaches) {
          for (const approach of result.approaches) {
            approachContexts.set(approach.npcId, approach.promptContext);
            broadcast({ type: 'npc_approach', data: approach });
            console.log(`  [Approach] ${approach.npcName} wants to talk to player`);
          }
        }
        broadcast({ type: 'tick', data: result });
      },
      onMovement: (movements) => {
        for (const m of movements) {
          console.log(`  [Move] ${m.agentName}: ${m.from} -> ${m.to}`);
        }
        broadcast({ type: 'movement', data: movements });
      },
      onGoalAction: (action) => {
        console.log(`  [Goal] ${action.ownerName}: ${action.description}`);
        broadcast({ type: 'goal:action', data: action });
      },
      onMurder: (killerId, victimId, killerName, victimName) => {
        console.log(`  [MURDER] ${killerName} killed ${victimName}!`);
        broadcast({ type: 'murder', data: { killerId, victimId, killerName, victimName } });
      },
      onLlmCall: (reason, target) => {
        broadcast({ type: 'debug:llm', data: { reason, target } });
      },
      onCrimeScene: (scene) => {
        broadcast({ type: 'crime:scene', data: {
          id: scene.id,
          locationId: scene.locationId,
          crimeType: scene.crimeType,
          pointCount: scene.points.length,
        }});
      },
    },
    locationGraph,
    { mobileNpcs: MOBILE_NPCS, moveProbability: 0.08 },
    NPC_SCHEDULES,
    NPC_HOMES,
  );
  console.log('  [+] World orchestrator');
  console.log(`  [+] NPC schedules: ${NPC_SCHEDULES.length} entries for ${new Set(NPC_SCHEDULES.map((s) => s.npcId)).size} NPCs`);
  console.log(`  [+] Mobile NPCs: ${Array.from(MOBILE_NPCS).join(', ')}`);

  if (savedData) {
    world.loadState(savedData.world);
    console.log(`  [Save] World state restored (tick ${savedData.world.tickCount}, ${Object.keys(savedData.world.agents).length} agents)`);
  }

  const server = startServer(world, eventStore, agents, { port: PORT }, {
    onSave: () => saveToDisk(world, eventStore),
  }, approachContexts);
  console.log();
  console.log(`  HTTP:  http://localhost:${server.port}/api/agents`);
  console.log(`  WS:    ws://localhost:${server.port}/ws`);
  console.log();
  console.log('  REST endpoints:');
  console.log('    GET  /api/agents            — all NPCs');
  console.log('    GET  /api/events            — event log');
  console.log('    GET  /api/state             — world state');
  console.log('    GET  /api/locations          — location graph');
  console.log('    GET  /api/memories/:id       — agent memories');
  console.log('    GET  /api/beliefs/:id        — agent beliefs');
  console.log('    GET  /api/relationships/:id  — agent relationships');
  console.log('    POST /api/kill/:id           — player kills NPC');
  console.log('    POST /api/npc-kill/:kid/:vid — NPC kills NPC');
  console.log('    POST /api/observe            — inject event');
  console.log('    POST /api/day                — advance day');
  console.log('    POST /api/tick               — world tick');
  console.log('    POST /api/auto               — toggle auto-tick');
  console.log('    POST /api/save               — save state to disk');
  console.log();
  console.log('  Server ready. Waiting for connections...');

  const shutdown = () => {
    console.log('\n  [Save] Shutting down — saving state...');
    saveToDisk(world, eventStore);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(console.error);

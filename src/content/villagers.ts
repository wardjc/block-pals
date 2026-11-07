import type { HouseId } from '../core/houses';

export type VillagerId = 'bramble' | 'pebble' | 'fern' | 'willow';
/** Which pre-generated voice speaks (tools/voice/voices.json). */
export type Speaker = 'bramble' | 'pebble' | 'fern' | 'granny';

export interface VillagerDef {
  id: VillagerId;
  name: string;
  house: HouseId;
  /** The picture shown in the speech bubble and over the door. */
  icon: string;
  /** The one funny thing about them (also drives the model). */
  feature: string;
  speaker: Speaker;
}

/** Original characters. One per village house, in house order. */
export const VILLAGERS: VillagerDef[] = [
  { id: 'bramble', name: 'Bramble the Baker', house: 'bakery', icon: '🍞', feature: 'a tall floury hat that wobbles', speaker: 'bramble' },
  { id: 'pebble', name: 'Captain Pebble', house: 'shop', icon: '⛏️', feature: 'a huge moustache and a tiny pickaxe', speaker: 'pebble' },
  { id: 'fern', name: 'Fern the Farmer', house: 'farmhouse', icon: '🥕', feature: 'a sunhat with a carrot in the band', speaker: 'fern' },
  { id: 'willow', name: 'Granny Willow', house: 'granny', icon: '🧶', feature: 'round glasses and a very long knitted scarf', speaker: 'granny' },
];

/**
 * Hellos. Lines policy (tests enforce it): British, at most 12 words, no cheers or sound words,
 * four variants, true wherever and however often the greeting can fire (it repeats), nothing promised for
 * later steps and no claims about what he can see.
 */
export const VILLAGER_LINES: Record<VillagerId, string[]> = {
  bramble: [
    'Hello, neighbour! Welcome to my bakery.',
    'Hello! I am Bramble, the baker.',
    'My floury hat wobbles when I laugh!',
    'Hello, friend. You can come in.',
  ],
  pebble: [
    'Hello, neighbour! I am Captain Pebble.',
    'Welcome to my shop, friend.',
    'Shiny stones are my favourite thing in the world.',
    'Hello there, friend. My moustache says hello too.',
  ],
  fern: [
    "Hello! I'm Fern, the farmer.",
    "I'm going to grow lots of food.",
    'Welcome to my farmhouse, neighbour.',
    'Hello, neighbour. Come in if you like.',
  ],
  willow: [
    'Hello, dear. I am Granny Willow.',
    'Hello, dear. I like to knit.',
    'I knit all my own scarves, dear.',
    'Hello, dear. Come in and sit down.',
  ],
};

/** A variant for a villager, never the same one twice in a row. */
export function pickVillagerLine(id: VillagerId, last: string | undefined, rng: () => number = Math.random): string {
  const variants = VILLAGER_LINES[id];
  const pool = variants.length > 1 ? variants.filter(v => v !== last) : variants;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] ?? '';
}

/** The picture over each house door, so the houses can be told apart without reading. */
export const DOOR_EMBLEMS: Record<HouseId, string> = {
  cottage: '🏠',
  bakery: '🍞',
  shop: '⛏️',
  farmhouse: '🥕',
  granny: '🧶',
};

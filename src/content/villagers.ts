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
 * four variants, true wherever the greeting can fire (near their house), nothing promised for
 * later steps and no claims about what he can see.
 */
export const VILLAGER_LINES: Record<VillagerId, string[]> = {
  bramble: [
    'Hello, neighbour! Welcome to my bakery.',
    'Mind my floury hat. It wobbles when I laugh!',
    'Hello, hello! My bakery smells of warm bread.',
    'A visitor! How lovely to meet you.',
  ],
  pebble: [
    'Hello, neighbour! Mind the shiny stones.',
    'Welcome to my shop, friend. I love a good stone.',
    'Shiny stones are my favourite thing in the world.',
    'Hello there, friend. My moustache says hello too.',
  ],
  fern: [
    'Hello, hello! My carrots say hello too.',
    'Welcome to my farm. It is a lovely place.',
    'Do you like my hat? It has a carrot!',
    'Nice to meet you, neighbour. Come and visit again!',
  ],
  willow: [
    'Hello, dear. What a lovely surprise.',
    'Hello, dear. I am knitting a very long scarf.',
    'Mind my scarf, dear. It is rather long!',
    'How lovely to meet you, dear.',
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

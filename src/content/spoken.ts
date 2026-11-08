import { LINES } from './lines.ts';
import { FERN_LINES, VILLAGERS, VILLAGER_LINES } from './villagers.ts';

/**
 * Every line the game can speak, per speaker (pip, bramble, pebble, fern, granny), de-duplicated.
 * The voice exporter and the clip tests both read this, so a new line cannot be forgotten.
 */
export function spokenLines(): Record<string, string[]> {
  const out: Record<string, string[]> = { pip: [...new Set(Object.values(LINES).flat())] };
  for (const v of VILLAGERS) {
    const own = [...(out[v.speaker] ?? []), ...VILLAGER_LINES[v.id]];
    if (v.id === 'fern') own.push(...FERN_LINES.seedGift, ...FERN_LINES.moreSeeds);
    out[v.speaker] = [...new Set(own)];
  }
  return out;
}

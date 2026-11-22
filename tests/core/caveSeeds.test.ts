import { expect, test } from 'vitest';
import { darkStretches } from '../../src/core/caveDress';
import { generateWorld } from '../../src/core/worldgen';

/**
 * The promises hold on every seed, not just the four the other tests look at closely: all six
 * mouths, all three stairs, all three treasure rooms and the Old Hideout, and never a dark cell.
 * (Seeds 0, 8, 15, 37, 39, 93, 95 and 192 once broke one of them.)
 */
const SEEDS = Array.from({ length: 200 }, (_, i) => i);

test('seeds 0..199: six mouths, three stairs, three treasure rooms, the hideout, and no dark stretch', () => {
  const bad: string[] = [];
  for (const seed of SEEDS) {
    const { world, caves } = generateWorld(seed);
    const kinds = caves.mouths.map(m => m.kind).sort().join(',');
    if (kinds !== 'east,hill,north,quarry,south,west') bad.push(`${seed}: mouths ${kinds}`);
    if (caves.stairs.length !== 3) bad.push(`${seed}: ${caves.stairs.length} stairs`);
    if (caves.treasure.length !== 3) bad.push(`${seed}: ${caves.treasure.length} treasure rooms`);
    if (!caves.ruin) bad.push(`${seed}: no hideout`);
    const dark = darkStretches(world, caves);
    if (dark.length) bad.push(`${seed}: ${dark.length} dark cells, first ${dark[0].join(',')}`);
  }
  expect(bad).toEqual([]);
}, 1_200_000);

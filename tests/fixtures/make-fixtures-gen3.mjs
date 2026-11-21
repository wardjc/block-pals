// One-off, committed for traceability (bigger-world plan, chunk A reconciliation with the wizard's tower).
// Run ONCE on a checkout of main at GEN_VERSION 3 (the tower, still the 96 x 20 x 96 world):
//   node tests/fixtures/make-fixtures-gen3.mjs <path to a checkout of main>
// Frozen from main b6d77d7 (2026-11-21). Writes, into THIS repository's tests/fixtures:
//  - village-world-gen3-2026.json: the gen 3 world (seed 2026) with the tower, its hill and path, and
//    the layout of the village and the tower, in meadow coordinates;
//  - saves/v2-gen3-tower.json: a save as the live game writes it today (version 2, gen 3) with edits
//    round the tower, a block built on the hill, a dug tower wall, a mythical block on the roof top,
//    the wizard's fields, items, crops, trees and animals.
// Never re-run after the generator changes: the world fixture is the ground truth for the old-region compare.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, '../..'));
const server = await createServer({ root, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom', configFile: false });
try {
  const { generateWorld, GEN_VERSION } = await server.ssrLoadModule('/src/core/worldgen.ts');
  const { VILLAGE_PLAN } = await server.ssrLoadModule('/src/core/village.ts');
  const { TOWER_PLAN } = await server.ssrLoadModule('/src/core/tower.ts');
  const { BlockId } = await server.ssrLoadModule('/src/core/blocks.ts');
  const { ItemId } = await server.ssrLoadModule('/src/core/items.ts');

  const { world, spawn, village, tower, towerRoute, towerRects } = generateWorld(2026);
  if (world.sizeX !== 96 || world.sizeY !== 20 || world.sizeZ !== 96 || GEN_VERSION !== 3) {
    throw new Error('not the gen 3 (tower) 96 world: refusing to write');
  }

  const rle = [];
  for (let y = 0; y < world.sizeY; y++) {
    for (let z = 0; z < world.sizeZ; z++) {
      for (let x = 0; x < world.sizeX; x++) {
        const id = world.get(x, y, z);
        const last = rle[rle.length - 1];
        if (last && last[0] === id) last[1]++;
        else rle.push([id, 1]);
      }
    }
  }
  const layout = {
    houses: village.houses.map(h => ({ id: h.id, rect: h.rect, doorFront: h.doorFront, doorInside: h.doorInside })),
    square: village.square, farmPlot: village.farmPlot, pasture: village.farm.pasture, quarry: village.quarry, pad: VILLAGE_PLAN.pad,
  };
  const towerFixture = {
    pad: TOWER_PLAN.pad, rect: tower.rect, groundY: tower.groundY, doorFront: tower.doorFront, doorInside: tower.doorInside,
    wizardSpot: tower.wizardSpot, topLamp: tower.topLamp, beacon: tower.beacon, route: towerRoute, stampedRects: towerRects,
  };
  writeFileSync(join(here, 'village-world-gen3-2026.json'), JSON.stringify({
    seed: 2026, gen: 3, sizeX: 96, sizeY: 20, sizeZ: 96, spawn, rle, layout, tower: towerFixture,
  }));

  // A save as the live game writes it today. Names and values only, no personal data.
  const top = (x, z) => world.topSolidY(x, z);
  const r = tower.rect;
  const hill = [TOWER_PLAN.pad.x0 + 1, top(TOWER_PLAN.pad.x0 + 1, TOWER_PLAN.pad.z0 + 1) + 1, TOWER_PLAN.pad.z0 + 1];
  const hill2 = [TOWER_PLAN.pad.x1 - 1, top(TOWER_PLAN.pad.x1 - 1, TOWER_PLAN.pad.z1 - 1) + 1, TOWER_PLAN.pad.z1 - 1];
  const wall = [r.x0, tower.groundY + 2, r.z0 + 2]; // a west wall block, dug out (Air)
  const inside = [tower.interior.x0, tower.groundY + 1, tower.interior.z1]; // a block he built in the ground room
  const path = towerRoute[Math.floor(towerRoute.length / 2)];
  const pathUnder = [path[0], path[1] - 1, path[2]]; // a PathStone he dug up
  const cropA = [72, 6, 35];
  const treeA = [hill2[0] - 2, hill2[1], hill2[2]];
  const edits = [
    [hill[0], hill[1], hill[2], BlockId.Bricks],
    [hill[0], hill[1] + 1, hill[2], BlockId.MoonBlock],
    [hill2[0], hill2[1], hill2[2], BlockId.StarlightCrystal],
    [...wall, BlockId.Air],
    [...inside, BlockId.Planks],
    [...tower.topLamp, BlockId.SunBlock], // the very top block of the world, swapped for a mythical one
    [...pathUnder, BlockId.Air],
    [24, top(24, 30), 30, BlockId.Air],
    [24, top(24, 30) - 1, 30, BlockId.Air],
    [0, 1, 0, BlockId.Bricks],
    [95, 19, 95, BlockId.Lamp],
    [cropA[0], cropA[1], cropA[2], BlockId.Wheat1],
    [treeA[0], treeA[1], treeA[2], BlockId.Sapling],
  ];
  const save = {
    version: 2, gen: 3, seed: 2026, edits,
    inventory: {
      [BlockId.Planks]: 12, [BlockId.Stone]: 40, [BlockId.Lamp]: 3,
      [BlockId.StarlightCrystal]: 3, [BlockId.MoonBlock]: 2, [BlockId.SunBlock]: 1, [BlockId.RainbowBlock]: 4,
    },
    order: [BlockId.Stone, BlockId.Planks, BlockId.Lamp, BlockId.StarlightCrystal, BlockId.MoonBlock, BlockId.SunBlock, BlockId.RainbowBlock],
    player: { x: tower.doorFront[0] + 0.5, y: tower.doorFront[1], z: tower.doorFront[2] + 0.5 },
    items: { [ItemId.WheatSeed]: 4, [ItemId.Apple]: 2 },
    itemOrder: [ItemId.Apple, ItemId.WheatSeed],
    savedAt: 1_795_000_000_000,
    crops: [[...cropA, 1234]],
    trees: [[...treeA, 0, 5000]],
    animals: [[0, 70.5, 6, 49.5, 30, 0], [2, 80.5, 6, 40.5, 0, 1]],
    flags: { ledToVillage: true, fernSeeds: true, hints: ['plantSome', 'cropReady'] },
    wizard: { gift: true, met: true, led: true, solved: 7, clean: 4, bought: 2, hints: ['seeLight', 'towerHint'] },
  };
  mkdirSync(join(here, 'saves'), { recursive: true });
  writeFileSync(join(here, 'saves/v2-gen3-tower.json'), `${JSON.stringify(save, null, 1)}\n`);
  console.log(`gen 3 world: ${rle.length} runs; spawn ${JSON.stringify(spawn)}; tower ${JSON.stringify(r)}; ${edits.length} edits`);
} finally {
  await server.close();
}

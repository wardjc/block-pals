// One-off, committed for traceability (bigger-world plan, Task 1). Run ONCE on step 2's merged main,
// before any generator change:  node tests/fixtures/make-fixtures.mjs
// Writes the frozen step 2 world (seed 2026) and two hand-built legacy saves with edits at the extremes.
// Never re-run after the generator changes: the world fixture is the ground truth for the old-region compare.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const server = await createServer({ root: join(here, '../..'), logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
try {
  const { generateWorld } = await server.ssrLoadModule('/src/core/worldgen.ts');
  const { VILLAGE_PLAN } = await server.ssrLoadModule('/src/core/village.ts');
  const { BlockId } = await server.ssrLoadModule('/src/core/blocks.ts');
  const { ItemId } = await server.ssrLoadModule('/src/core/items.ts');

  const { world, spawn, village } = generateWorld(2026);
  if (world.sizeX !== 96 || world.sizeY !== 20 || world.sizeZ !== 96) throw new Error('not the step 2 world: refusing to write');

  // Run-length encode in World.index order: x fastest, then z, then y.
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
  writeFileSync(join(here, 'village-world-gen2-2026.json'), JSON.stringify({ seed: 2026, sizeX: 96, sizeY: 20, sizeZ: 96, spawn, rle, layout }));

  // Hand-built saves. Names and values only, no personal data.
  const top = (x, z) => world.topSolidY(x, z);
  const cottage = village.houses.find(h => h.id === 'cottage');
  const roofY = Math.max(...[0, 1, 2].map(d => top(cottage.rect.x0 + 1 + d, cottage.rect.z0 + 1)));
  const cropA = [72, 6, 35]; // on the first farm bed (Farmland at y 5)
  const cropB = [2, top(2, 93) + 1, 93]; // far corner: a hand-tilled bed of his own
  const treeA = [3, top(3, 3) + 1, 3];
  const treeB = [93, top(93, 2) + 1, 2];
  const edits = [
    [0, 1, 0, BlockId.Bricks],
    [95, 1, 0, BlockId.Planks],
    [0, 1, 95, BlockId.Glass],
    [95, 1, 95, BlockId.WoolRed],
    [0, 19, 0, BlockId.Lamp],
    [95, 19, 95, BlockId.Bricks],
    [47, 5, 47, BlockId.Planks],
    [48, 6, 48, BlockId.Air],
    [cottage.rect.x0 + 2, roofY + 1, cottage.rect.z0 + 1, BlockId.Lamp],
    [1, 6, 94, BlockId.Planks],
    [cropA[0], cropA[1], cropA[2], BlockId.Wheat1],
    [cropB[0], cropB[1] - 1, cropB[2], BlockId.Farmland],
    [cropB[0], cropB[1], cropB[2], BlockId.Carrot0],
    [treeA[0], treeA[1], treeA[2], BlockId.Sapling],
    [treeB[0], treeB[1], treeB[2], BlockId.Sapling],
  ];
  const base = {
    version: 2, gen: 2, seed: 2026, edits,
    inventory: { [BlockId.Planks]: 12, [BlockId.Stone]: 40, [BlockId.Lamp]: 3, [BlockId.Bricks]: 99 },
    order: [BlockId.Stone, BlockId.Planks, BlockId.Bricks, BlockId.Lamp],
    items: { [ItemId.WheatSeed]: 4, [ItemId.Apple]: 2, [ItemId.Wool]: 1 },
    itemOrder: [ItemId.Apple, ItemId.WheatSeed, ItemId.Wool],
    savedAt: 1_793_000_000_000,
    crops: [[...cropA, 1234], [...cropB, 0]],
    trees: [[...treeA, 0, 5000], [...treeB, 1, 100]],
    animals: [[0, 0.5, 6, 49.5, 30, 0], [1, 70.5, 6, 94.5, 12.5, 1]],
    flags: { ledToVillage: true, fernSeeds: true, hints: ['plantSome', 'cropReady'] },
  };
  mkdirSync(join(here, 'saves'), { recursive: true });
  const spawnPlayer = { x: 24.5, y: spawn.y, z: 24.5 };
  const cornerPlayer = { x: 94.5, y: top(94, 94) + 1, z: 94.5 };
  writeFileSync(join(here, 'saves/v2-extremes.json'), `${JSON.stringify({ ...base, player: spawnPlayer }, null, 1)}\n`);
  writeFileSync(join(here, 'saves/v2-extremes-corner.json'), `${JSON.stringify({ ...base, player: cornerPlayer }, null, 1)}\n`);
  const v1 = {
    version: 1, seed: 2026,
    edits: [[0, 1, 0, BlockId.Planks], [47, 15, 47, BlockId.Glass], [46, 1, 1, BlockId.Air], [24, 9, 26, BlockId.Bricks]],
    inventory: { [BlockId.Wood]: 5, [BlockId.Dirt]: 9 },
    order: [BlockId.Dirt, BlockId.Wood],
    player: { x: 24.5, y: 8, z: 24.5 },
  };
  writeFileSync(join(here, 'saves/v1-extremes.json'), `${JSON.stringify(v1, null, 1)}\n`);
  console.log(`world: ${rle.length} runs; spawn ${JSON.stringify(spawn)}; corner player ${JSON.stringify(cornerPlayer)}; roof lamp y ${roofY + 1}`);
} finally {
  await server.close();
}

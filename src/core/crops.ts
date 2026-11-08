import { BlockId } from './blocks';
import { ItemId } from './items';
import type { Cell } from './pathfind';
import type { World } from './world';

export type CropKind = 'wheat' | 'carrot' | 'potato';
export type PlantKind = CropKind | 'apple';

const FIRST: Record<CropKind, BlockId> = {
  wheat: BlockId.Wheat0, carrot: BlockId.Carrot0, potato: BlockId.Potato0,
};

/** The plant block of a crop at a stage 0 (sprout) to 3 (ripe). */
export function cropBlock(kind: CropKind, stage: number): BlockId {
  return FIRST[kind] + Math.max(0, Math.min(3, Math.floor(stage)));
}

/** Kind and stage of a plant block (the sapling is apple stage 0), or null for anything else. */
export function cropOf(id: BlockId): { kind: PlantKind; stage: number } | null {
  if (id === BlockId.Sapling) return { kind: 'apple', stage: 0 };
  for (const kind of Object.keys(FIRST) as CropKind[]) {
    const d = id - FIRST[kind];
    if (d >= 0 && d <= 3) return { kind, stage: d };
  }
  return null;
}

export function seedFor(kind: PlantKind): ItemId {
  switch (kind) {
    case 'wheat': return ItemId.WheatSeed;
    case 'carrot': return ItemId.CarrotSeed;
    case 'potato': return ItemId.PotatoSeed;
    case 'apple': return ItemId.AppleSapling;
  }
}

const FOOD: Record<CropKind, ItemId> = { wheat: ItemId.Wheat, carrot: ItemId.Carrot, potato: ItemId.Potato };

/**
 * What picking gives. Ripe crop: 2 food and 2 seeds. Ripe apple tree: 2 apples and 1 sapling.
 * Pulled early: the seed back, so a pull never loses anything and seeds never run out.
 */
export function yields(kind: PlantKind, stage: number): Array<{ id: ItemId; n: number }> {
  if (stage < 3) return [{ id: seedFor(kind), n: 1 }];
  if (kind === 'apple') return [{ id: ItemId.Apple, n: 2 }, { id: ItemId.AppleSapling, n: 1 }];
  return [{ id: FOOD[kind], n: 2 }, { id: seedFor(kind), n: 2 }];
}

/** What a helping tap gives the plant as it leaves this stage: 0 water, 1 sunshine, 2 both. */
export function cue(stage: number): 'water' | 'sun' | 'both' {
  return stage <= 0 ? 'water' : stage === 1 ? 'sun' : 'both';
}

/** How fast a plant grows here. 1 today; the water step may return more near water. */
export function growthRateAt(_world: World, _cell: Cell): number {
  return 1;
}

const SOIL = new Set<BlockId>([BlockId.Grass, BlockId.Dirt, BlockId.Farmland]);

/** Air at the cell and above it, Grass, Dirt or Farmland below, and nobody standing in it. */
export function canPlant(world: World, cell: Cell, occupied: Cell[]): boolean {
  const [x, y, z] = cell;
  if (!world.inBounds(x, y, z) || !world.inBounds(x, y - 1, z)) return false;
  if (world.get(x, y, z) !== BlockId.Air || world.get(x, y + 1, z) !== BlockId.Air) return false;
  if (!SOIL.has(world.get(x, y - 1, z))) return false;
  return !occupied.some(([ox, oy, oz]) => ox === x && oy === y && oz === z);
}

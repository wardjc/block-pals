export enum BlockId {
  Air = 0,
  Grass,
  Dirt,
  Stone,
  Wood,
  Leaves,
  Sand,
  Water,
  Planks,
  Glass,
  Bricks,
  Bedrock,
  // Appended for the village. Existing ids never change: saves store them as numbers.
  PathStone,
  RoofTile,
  DoorFrame,
  Lamp,
  // Appended for the farm (Village step 2). Existing ids still never change.
  Farmland = 16,
  Fence,
  WoolWhite,
  WoolRed,
  WoolBlue,
  WoolYellow,
  Sapling,
  AppleLeaves,
  Wheat0 = 24,
  Wheat1,
  Wheat2,
  Wheat3,
  Carrot0 = 28,
  Carrot1,
  Carrot2,
  Carrot3,
  Potato0 = 32,
  Potato1,
  Potato2,
  Potato3,
  // The wizard's eight mythical blocks. 36 to 39 stay spare; 48 to 55 are kept for later mythical
  // blocks; the caves plan uses 56 to 64 (65 to 71 reserved). Existing ids still never change.
  StarlightCrystal = 40,
  RainbowBlock,
  CloudBlock,
  MoonBlock,
  SunBlock,
  DragonScaleBlock,
  StarBlock,
  MagicMirror,
}

export interface BlockDef {
  id: BlockId;
  name: string;
  solid: boolean;
  collectable: boolean;
  transparent: boolean;
  icon: string;
  /** 'cube' (default) or 'cross': two crossed quads, for plants. */
  shape?: 'cube' | 'cross';
  plant?: { kind: 'wheat' | 'carrot' | 'potato' | 'apple'; stage: number };
  /** Gives light like a Lamp: an always-bright tile that side shading cannot dim (no real light). */
  light?: boolean;
  /** Its atlas tile slowly repaints (a texture swap, never a chunk rebuild). */
  shimmer?: boolean;
}

/** A plain bright cube from the wizard: solid, collectable, never a recipe. */
function mythical(id: BlockId, name: string, icon: string, flags: { light?: boolean; shimmer?: boolean; transparent?: boolean } = {}): BlockDef {
  const def: BlockDef = { id, name, solid: true, collectable: true, transparent: flags.transparent ?? false, icon };
  if (flags.light) def.light = true;
  if (flags.shimmer) def.shimmer = true;
  return def;
}

/** Plants are walk-through, picked by the farm, and drawn as two crossed quads. */
function plant(id: BlockId, name: string, kind: 'wheat' | 'carrot' | 'potato' | 'apple', stage: number): BlockDef {
  return {
    id, name, solid: false, collectable: true, transparent: true, icon: `${name}${stage}`,
    shape: 'cross', plant: { kind, stage },
  };
}

export const BLOCKS: Record<BlockId, BlockDef> = {
  [BlockId.Air]: { id: BlockId.Air, name: 'air', solid: false, collectable: false, transparent: true, icon: 'air' },
  [BlockId.Grass]: { id: BlockId.Grass, name: 'grass', solid: true, collectable: true, transparent: false, icon: 'grass' },
  [BlockId.Dirt]: { id: BlockId.Dirt, name: 'dirt', solid: true, collectable: true, transparent: false, icon: 'dirt' },
  [BlockId.Stone]: { id: BlockId.Stone, name: 'stone', solid: true, collectable: true, transparent: false, icon: 'stone' },
  [BlockId.Wood]: { id: BlockId.Wood, name: 'wood', solid: true, collectable: true, transparent: false, icon: 'wood' },
  [BlockId.Leaves]: { id: BlockId.Leaves, name: 'leaves', solid: true, collectable: true, transparent: true, icon: 'leaves' },
  [BlockId.Sand]: { id: BlockId.Sand, name: 'sand', solid: true, collectable: true, transparent: false, icon: 'sand' },
  [BlockId.Water]: { id: BlockId.Water, name: 'water', solid: false, collectable: false, transparent: true, icon: 'water' },
  [BlockId.Planks]: { id: BlockId.Planks, name: 'planks', solid: true, collectable: true, transparent: false, icon: 'planks' },
  [BlockId.Glass]: { id: BlockId.Glass, name: 'glass', solid: true, collectable: true, transparent: true, icon: 'glass' },
  [BlockId.Bricks]: { id: BlockId.Bricks, name: 'bricks', solid: true, collectable: true, transparent: false, icon: 'bricks' },
  [BlockId.Bedrock]: { id: BlockId.Bedrock, name: 'bedrock', solid: true, collectable: false, transparent: false, icon: 'bedrock' },
  [BlockId.PathStone]: { id: BlockId.PathStone, name: 'path', solid: true, collectable: true, transparent: false, icon: 'path' },
  [BlockId.RoofTile]: { id: BlockId.RoofTile, name: 'roof', solid: true, collectable: true, transparent: false, icon: 'roof' },
  [BlockId.DoorFrame]: { id: BlockId.DoorFrame, name: 'frame', solid: true, collectable: true, transparent: false, icon: 'frame' },
  [BlockId.Lamp]: { id: BlockId.Lamp, name: 'lamp', solid: true, collectable: true, transparent: false, icon: 'lamp' },
  [BlockId.Farmland]: { id: BlockId.Farmland, name: 'soil', solid: true, collectable: true, transparent: false, icon: 'farmland' },
  [BlockId.Fence]: { id: BlockId.Fence, name: 'fence', solid: true, collectable: true, transparent: false, icon: 'fence' },
  [BlockId.WoolWhite]: { id: BlockId.WoolWhite, name: 'white wool', solid: true, collectable: true, transparent: false, icon: 'woolWhite' },
  [BlockId.WoolRed]: { id: BlockId.WoolRed, name: 'red wool', solid: true, collectable: true, transparent: false, icon: 'woolRed' },
  [BlockId.WoolBlue]: { id: BlockId.WoolBlue, name: 'blue wool', solid: true, collectable: true, transparent: false, icon: 'woolBlue' },
  [BlockId.WoolYellow]: { id: BlockId.WoolYellow, name: 'yellow wool', solid: true, collectable: true, transparent: false, icon: 'woolYellow' },
  [BlockId.Sapling]: plant(BlockId.Sapling, 'sapling', 'apple', 0),
  [BlockId.AppleLeaves]: { id: BlockId.AppleLeaves, name: 'apple leaves', solid: true, collectable: true, transparent: true, icon: 'appleLeaves' },
  [BlockId.Wheat0]: plant(BlockId.Wheat0, 'wheat', 'wheat', 0),
  [BlockId.Wheat1]: plant(BlockId.Wheat1, 'wheat', 'wheat', 1),
  [BlockId.Wheat2]: plant(BlockId.Wheat2, 'wheat', 'wheat', 2),
  [BlockId.Wheat3]: plant(BlockId.Wheat3, 'wheat', 'wheat', 3),
  [BlockId.Carrot0]: plant(BlockId.Carrot0, 'carrot', 'carrot', 0),
  [BlockId.Carrot1]: plant(BlockId.Carrot1, 'carrot', 'carrot', 1),
  [BlockId.Carrot2]: plant(BlockId.Carrot2, 'carrot', 'carrot', 2),
  [BlockId.Carrot3]: plant(BlockId.Carrot3, 'carrot', 'carrot', 3),
  [BlockId.Potato0]: plant(BlockId.Potato0, 'potato', 'potato', 0),
  [BlockId.Potato1]: plant(BlockId.Potato1, 'potato', 'potato', 1),
  [BlockId.Potato2]: plant(BlockId.Potato2, 'potato', 'potato', 2),
  [BlockId.Potato3]: plant(BlockId.Potato3, 'potato', 'potato', 3),
  [BlockId.StarlightCrystal]: mythical(BlockId.StarlightCrystal, 'starlight crystal', 'starlight', { light: true, shimmer: true }),
  [BlockId.RainbowBlock]: mythical(BlockId.RainbowBlock, 'rainbow block', 'rainbow', { shimmer: true }),
  [BlockId.CloudBlock]: mythical(BlockId.CloudBlock, 'cloud block', 'cloud'),
  [BlockId.MoonBlock]: mythical(BlockId.MoonBlock, 'moon block', 'moon', { light: true }),
  [BlockId.SunBlock]: mythical(BlockId.SunBlock, 'sun block', 'sun', { light: true }),
  [BlockId.DragonScaleBlock]: mythical(BlockId.DragonScaleBlock, 'dragon scale block', 'dragonScale'),
  [BlockId.StarBlock]: mythical(BlockId.StarBlock, 'star block', 'star', { shimmer: true }),
  [BlockId.MagicMirror]: mythical(BlockId.MagicMirror, 'magic mirror', 'mirror', { shimmer: true, transparent: true }),
};

/** What digging this block leaves in the bag: tilled soil gives plain dirt, everything else itself. */
export function dropFor(id: BlockId): BlockId {
  return id === BlockId.Farmland ? BlockId.Dirt : id;
}

/** A growing crop or sapling: a block in the world, never a thing he carries. */
export function isPlantBlock(id: BlockId): boolean {
  return BLOCKS[id]?.plant !== undefined;
}

/**
 * Whether a block can sit in the bag and be placed. Air and bedrock cannot; plants and ripe apple
 * leaves are world-only (digging them gives seeds and fruit through the farm instead).
 */
export function isCarriable(id: number): id is BlockId {
  return Number.isInteger(id) && Object.hasOwn(BLOCKS, id)
    && id !== BlockId.Air && id !== BlockId.Bedrock && id !== BlockId.AppleLeaves && !isPlantBlock(id);
}

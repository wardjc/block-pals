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
}

export interface BlockDef {
  id: BlockId;
  name: string;
  solid: boolean;
  collectable: boolean;
  transparent: boolean;
  icon: string;
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
};

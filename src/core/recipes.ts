import { BlockId } from './blocks';
import { ItemId, type StackId } from './items';

export interface Recipe {
  id: string;
  inputs: Array<{ id: StackId; n: number }>;
  output: { id: StackId; n: number };
  word: string;
}

export const RECIPES: Recipe[] = [
  {
    id: 'planks',
    inputs: [{ id: BlockId.Wood, n: 1 }],
    output: { id: BlockId.Planks, n: 2 },
    word: 'wood',
  },
  {
    id: 'glass',
    inputs: [{ id: BlockId.Sand, n: 3 }],
    output: { id: BlockId.Glass, n: 1 },
    word: 'glass',
  },
  {
    id: 'bricks',
    inputs: [{ id: BlockId.Dirt, n: 2 }, { id: BlockId.Stone, n: 2 }],
    output: { id: BlockId.Bricks, n: 1 },
    word: 'brick',
  },
  ...([
    ['white', BlockId.WoolWhite],
    ['red', BlockId.WoolRed],
    ['blue', BlockId.WoolBlue],
    ['yellow', BlockId.WoolYellow],
  ] as const).map(([colour, block]): Recipe => ({
    id: `wool-${colour}`,
    inputs: [{ id: ItemId.Wool, n: 1 }],
    output: { id: block, n: 2 },
    word: colour,
  })),
];

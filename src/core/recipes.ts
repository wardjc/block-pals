import { BlockId } from './blocks';

export interface Recipe {
  id: string;
  inputs: Array<{ id: BlockId; n: number }>;
  output: { id: BlockId; n: number };
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
];

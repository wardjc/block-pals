import { BlockId } from './blocks';
import { ItemId, type StackId } from './items';

export interface Recipe {
  id: string;
  inputs: Array<{ id: StackId; n: number }>;
  output: { id: StackId; n: number };
  word: string;
  /** A one-off (the friendly weapons): once owned it cannot be made again, so a spare is never wasted. */
  once?: boolean;
}

/** A once-only recipe whose result is already in the bag. */
export const owns = (inv: { count(id: StackId): number }, r: Recipe): boolean =>
  r.once === true && inv.count(r.output.id) > 0;

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
  {
    id: 'bubble-blaster',
    inputs: [{ id: BlockId.Glass, n: 3 }, { id: BlockId.Planks, n: 2 }],
    output: { id: ItemId.BubbleBlaster, n: 1 },
    word: 'bubble blaster',
    once: true,
  },
  {
    id: 'magic-wand',
    inputs: [{ id: BlockId.Planks, n: 2 }, { id: BlockId.WoolYellow, n: 2 }],
    output: { id: ItemId.MagicWand, n: 1 },
    word: 'magic wand',
    once: true,
  },
  {
    id: 'water-squirter',
    inputs: [{ id: BlockId.Glass, n: 2 }, { id: BlockId.Stone, n: 3 }, { id: BlockId.WoolBlue, n: 1 }],
    output: { id: ItemId.WaterSquirter, n: 1 },
    word: 'water squirter',
    once: true,
  },
];

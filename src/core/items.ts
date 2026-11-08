import { BLOCKS, BlockId, isCarriable } from './blocks';

/**
 * Things that are not blocks. Ids start at 100 so one number identifies anything in the bag and
 * no block id (all below 100) ever changes. 111 to 119 are kept for step 3's baked foods.
 */
export enum ItemId {
  WheatSeed = 100,
  CarrotSeed,
  PotatoSeed,
  AppleSapling,
  Apple,
  Carrot,
  Potato,
  Wheat,
  Egg,
  Milk,
  Wool,
}

/** A bag stack: a block or an item. */
export type StackId = BlockId | ItemId;

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Picture (emoji, like bubbles and door signs). */
  icon: string;
  /** A small second picture, so each seed shows which crop it grows. */
  badge?: string;
  kind: 'seed' | 'food' | 'gift';
  edible: boolean;
}

const def = (id: ItemId, name: string, icon: string, kind: ItemDef['kind'], edible: boolean, badge?: string): ItemDef =>
  badge === undefined ? { id, name, icon, kind, edible } : { id, name, icon, badge, kind, edible };

export const ITEMS: Record<ItemId, ItemDef> = {
  [ItemId.WheatSeed]: def(ItemId.WheatSeed, 'wheat seeds', '🌱', 'seed', false, '🌾'),
  [ItemId.CarrotSeed]: def(ItemId.CarrotSeed, 'carrot seeds', '🌱', 'seed', false, '🥕'),
  [ItemId.PotatoSeed]: def(ItemId.PotatoSeed, 'potato seeds', '🌱', 'seed', false, '🥔'),
  [ItemId.AppleSapling]: def(ItemId.AppleSapling, 'apple sapling', '🌳', 'seed', false, '🍎'),
  [ItemId.Apple]: def(ItemId.Apple, 'apple', '🍎', 'food', true),
  [ItemId.Carrot]: def(ItemId.Carrot, 'carrot', '🥕', 'food', true),
  [ItemId.Potato]: def(ItemId.Potato, 'potato', '🥔', 'food', true),
  [ItemId.Wheat]: def(ItemId.Wheat, 'wheat', '🌾', 'food', false),
  [ItemId.Egg]: def(ItemId.Egg, 'egg', '🥚', 'gift', false),
  [ItemId.Milk]: def(ItemId.Milk, 'milk', '🥛', 'food', true),
  [ItemId.Wool]: def(ItemId.Wool, 'wool', '🧶', 'gift', false),
};

export const isItemId = (n: number): n is ItemId => Number.isInteger(n) && Object.hasOwn(ITEMS, n);

/** A block that can be in the bag (not Air, Bedrock or a plant) or an item. */
export const isStackId = (n: number): n is StackId => isItemId(n) || isCarriable(n);

/** Accepted by every animal (seeds and milk are not feed). */
export const FEEDS: readonly ItemId[] = [ItemId.Apple, ItemId.Carrot, ItemId.Potato, ItemId.Wheat];

export const GIFT: Record<'chicken' | 'cow' | 'sheep' | 'pig', ItemId> = {
  chicken: ItemId.Egg,
  cow: ItemId.Milk,
  sheep: ItemId.Wool,
  pig: ItemId.Potato,
};

/** The word for a stack, for the few places that say it aloud. */
export function stackName(id: StackId): string {
  if (isItemId(id)) return ITEMS[id].name;
  return Object.hasOwn(BLOCKS, id) ? BLOCKS[id].name : '';
}

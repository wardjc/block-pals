import { BLOCKS } from '../core/blocks';
import { canPlant } from '../core/crops';
import { FEEDS, isItemId, ITEMS, type StackId } from '../core/items';
import type { Cell } from '../core/pathfind';
import { isStandable } from '../core/pathfind';
import { canCollect, canPlace, withinPickReach, withinReach } from '../core/placement';
import type { World } from '../core/world';

/** What a quick tap does (spec §7a): walk or build. A tap never digs. */
export type TapIntent =
  | { kind: 'walk'; to: Cell }
  | { kind: 'place'; cell: Cell }
  /** A seed or sapling goes into the soil at this (free) cell. */
  | { kind: 'plant'; cell: Cell }
  /** Water or sunshine for the plant in this cell (or a block of an apple tree). */
  | { kind: 'help'; cell: Cell }
  | { kind: 'feed'; animal: number }
  | { kind: 'pet'; animal: number }
  /** Opens the wizard's screen (spec §7g). Costs nothing, places nothing. */
  | { kind: 'talk' }
  | { kind: 'none' };

/** What a press and hold does (spec §7a): dig it, walk next to it, or nothing. */
export type HoldIntent =
  | { kind: 'dig'; cell: Cell }
  /** Too far: the game walks to a standable cell beside `block` (never on top of it). */
  | { kind: 'walkNear'; block: Cell }
  | { kind: 'none' };

const REACH = 3;
/** A quick tap on the wizard within this many blocks talks to him; farther walks over beside him. */
export const WIZARD_REACH = 4;
/** Walking over to the wizard stops at least this far from his middle (never inside him). */
export const WIZARD_KEEP_AWAY = 1.5;

const frontOf = ({ cell: c, normal: n }: { cell: Cell; normal: Cell }): Cell => [c[0] + n[0], c[1] + n[1], c[2] + n[2]];

/** An animal under the finger: its id, how far it is from the player, and (for walking over) its feet cell. */
export interface AnimalHit { id: number; dist: number; cell?: Cell }

/** The wizard under the finger: how far he is from the player, and his feet cell. */
export interface WizardHit { dist: number; cell: Cell }

export interface TapExtras {
  animalHit?: AnimalHit | null;
  wizardHit?: WizardHit | null;
  /** Whether a cell is a plant or part of an apple tree. Defaults to "the block is a plant". */
  plantAt?: (cell: Cell) => boolean;
}

/**
 * The standable cell to walk to when he taps the wizard from far away: at least 1.5 from the
 * wizard's middle, as near to him as possible (ties go to the cell nearer the player), on his floor.
 */
export function besideWizard(world: World, wizard: Cell, playerFeet: Cell): Cell {
  const [wx, wy, wz] = wizard;
  let best: Cell | null = null;
  let bestD = Infinity;
  let bestP = Infinity;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const d = Math.hypot(dx, dz);
      if (d < WIZARD_KEEP_AWAY) continue;
      const c: Cell = [wx + dx, wy, wz + dz];
      if (!isStandable(world, c)) continue;
      const p = Math.hypot(c[0] - playerFeet[0], c[2] - playerFeet[2]);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && p < bestP)) { best = c; bestD = d; bestP = p; }
    }
  }
  return best ?? [wx, wy, wz - 2];
}

/**
 * Quick tap. Order: (0) the wizard under the finger (in reach 4: talk, whatever is selected;
 * farther: walk to a cell beside him); (1) an animal under the finger (in reach: feed with any food selected, else
 * pet; farther: walk next to it); (2) a plant or apple tree: in reach it is helped, farther the
 * player walks to the plant's own cell (plants are walkable); (3) a seed selected and room to
 * plant: plant in reach, walk otherwise; (4) with the hand walk to the cell in front of the tapped
 * face; with a block build on the tapped face if within reach and there is room, otherwise walk.
 * A tap never digs or harvests.
 */
export function resolveTap(
  hit: { cell: Cell; normal: Cell } | null,
  selected: StackId | 'hand',
  playerFeet: Cell,
  world: World,
  occupied: Cell[],
  extras: TapExtras = {},
): TapIntent {
  const wizard = extras.wizardHit;
  if (wizard) {
    return wizard.dist <= WIZARD_REACH ? { kind: 'talk' } : { kind: 'walk', to: besideWizard(world, wizard.cell, playerFeet) };
  }
  const animal = extras.animalHit;
  if (animal) {
    if (animal.dist <= REACH) {
      return FEEDS.includes(selected as never) ? { kind: 'feed', animal: animal.id } : { kind: 'pet', animal: animal.id };
    }
    if (animal.cell) return { kind: 'walk', to: animal.cell };
  }
  if (!hit) return { kind: 'none' };
  const front = frontOf(hit);
  const isPlant = extras.plantAt ?? ((c: Cell) => BLOCKS[world.get(...c)].plant !== undefined);
  if (isPlant(hit.cell)) {
    return withinReach(playerFeet, hit.cell) ? { kind: 'help', cell: hit.cell } : { kind: 'walk', to: hit.cell };
  }
  if (selected !== 'hand' && isItemId(selected) && ITEMS[selected].kind === 'seed' && canPlant(world, front, occupied)) {
    return withinReach(playerFeet, front) ? { kind: 'plant', cell: front } : { kind: 'walk', to: front };
  }
  if (selected !== 'hand' && !isItemId(selected) && withinReach(playerFeet, hit.cell) && canPlace(world, front, occupied, selected)) {
    return { kind: 'place', cell: front };
  }
  return { kind: 'walk', to: front };
}

/**
 * Press and hold, whichever slot is selected. Blocks that can't be dug (air, water, bedrock,
 * the block under his or Pip's feet) give none, so the ring never starts. A diggable block
 * within reach (3, Chebyshev from the feet cell) digs; one further away walks beside it.
 */
export function resolveHold(
  hit: { cell: Cell; normal: Cell } | null,
  playerFeet: Cell,
  world: World,
  occupied: Cell[],
  onAnimal = false,
): HoldIntent {
  // A finger on an animal or the wizard does nothing, and never digs the ground behind it.
  if (!hit || onAnimal) return { kind: 'none' };
  const [x, y, z] = hit.cell;
  if (!world.inBounds(x, y, z) || !canCollect(world, hit.cell)) return { kind: 'none' };
  const standers = [playerFeet, ...occupied];
  if (standers.some(([sx, sy, sz]) => sx === x && sy === y + 1 && sz === z)) return { kind: 'none' };
  if (!withinPickReach(world, playerFeet, hit.cell)) return { kind: 'walkNear', block: hit.cell };
  return { kind: 'dig', cell: hit.cell };
}

export function createDebouncer(ms = 150): (key: string, now: number) => boolean {
  const lastAllowed = new Map<string, number>();
  return (key, now) => {
    const last = lastAllowed.get(key);
    if (last !== undefined && now - last < ms) return false;
    lastAllowed.set(key, now);
    return true;
  };
}

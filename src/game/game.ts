import { BlockId, dropFor, isCarriable, isPlantBlock } from '../core/blocks';
import { insideWall } from '../core/bounds';
import { canCraft, craft } from '../core/crafting';
import { cropOf, yields } from '../core/crops';
import { Inventory, MAX_STACK } from '../core/inventory';
import { GIFT, isItemId, ITEMS, type ItemId, type StackId } from '../core/items';
import { findPath, isStandable, pathTowards, smoothPath, type Cell } from '../core/pathfind';

import { canCollect, canPlace, withinPickReach, withinReach } from '../core/placement';
import { RECIPES } from '../core/recipes';
import type { World } from '../core/world';
import type { Action } from '../input/mapping';
import type { HoldIntent, TapIntent } from '../input/tap';
import type { AnimalKind, Herd } from './animals';
import { Farm } from './farm';
import { Player } from './player';

export type GameEvent =
  | { type: 'collected'; id: BlockId }
  | { type: 'placed'; id: BlockId }
  | { type: 'crafted'; recipe: string }
  | { type: 'full'; id: StackId }
  | { type: 'noPath' }
  | { type: 'walking'; to: Cell }
  | { type: 'lifted' }
  /** A food went to an animal and its gift is in the bag. */
  | { type: 'fed'; animal: number; kind: AnimalKind; gift: ItemId; food: ItemId }
  /** The animal is resting after a gift: it was only happy, nothing was used. */
  | { type: 'resting'; animal: number; kind: AnimalKind }
  | { type: 'petted'; animal: number; kind: AnimalKind }
  | { type: 'idle' };

/** Seconds of quiet before each idle hint; after the last one Pip waits for the next action. */
const IDLE_SECONDS = [20, 60];
/** A reachable region this small (cells) with no way nearer the tap counts as a pit. */
const PIT_CELLS = 30;
const LIFT_RADIUS = 8;

/** Tap and hold intents from the touch screen, plus the pad's collect. */
export type Intent = TapIntent | HoldIntent | { kind: 'collect'; cell: Cell };

export class Game {
  readonly world: World;
  readonly inventory: Inventory;
  readonly player: Player;
  /** Growth timers for the plants (the plants themselves are blocks in the world). */
  readonly farm: Farm;
  /** The friendly herd in the pasture (set by main). Animals are not blocks: no dig path reaches them. */
  herd: Herd | null = null;
  /** Bumps when an animal gives a gift, so the autosave notices. */
  herdRevision = 0;
  selected: StackId | 'hand' = 'hand';
  /** Hook for the HUD craft screen (Task 11). */
  /** While true (overlay open) the player does not move. */
  paused = false;
  onCraftRequest: () => void = () => {};

  private readonly listeners: Array<(e: GameEvent) => void> = [];
  private occupiedFn: () => Cell[];
  private idleFor = 0;
  private idleHints = 0;

  constructor(opts: { world: World; spawn: { x: number; y: number; z: number }; inventory?: Inventory }) {
    this.world = opts.world;
    this.inventory = opts.inventory ?? new Inventory();
    this.player = new Player(opts.spawn);
    this.farm = new Farm(this.world, this.inventory);
    this.occupiedFn = () => {
      const [x, y, z] = this.player.feetCell();
      return [[x, y, z], [x, y + 1, z]];
    };
  }

  on(cb: (e: GameEvent) => void): void {
    this.listeners.push(cb);
  }

  setOccupied(fn: () => Cell[]): void {
    this.occupiedFn = fn;
  }

  occupied(): Cell[] {
    return this.occupiedFn();
  }

  /** The selection as the player experiences it: an empty stack is the hand. */
  effectiveSelected(): StackId | 'hand' {
    this.normaliseSelection();
    return this.selected;
  }

  private emit(e: GameEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  private normaliseSelection(): void {
    if (this.selected !== 'hand' && this.inventory.count(this.selected) <= 0) this.selected = 'hand';
  }

  applyIntent(intent: Intent): void {
    switch (intent.kind) {
      case 'walk':
        this.active();
        this.walk(intent.to);
        return;
      case 'walkNear':
        this.active();
        this.walkBeside(intent.block);
        return;
      case 'collect':
      case 'dig':
        this.active();
        this.collect(intent.cell);
        return;
      case 'place':
        this.active();
        this.place(intent.cell);
        return;
      case 'plant':
        this.active();
        this.plant(intent.cell);
        return;
      case 'help':
        this.active();
        if (withinReach(this.player.feetCell(), intent.cell)) this.farm.help(intent.cell);
        return;
      case 'feed':
        this.active();
        this.feedAnimal(intent.animal);
        return;
      case 'pet': {
        this.active();
        const a = this.herd?.animals.find(o => o.id === intent.animal);
        if (a) { this.herd!.pet(a.id); this.emit({ type: 'petted', animal: a.id, kind: a.kind }); }
        return;
      }
      default:
    }
  }

  /**
   * Any food feeds any animal: one food is used and its gift goes in the bag, all or nothing. A
   * resting animal is only happy (no food used). A gift that would not fit is refused whole.
   */
  private feedAnimal(id: number): void {
    const herd = this.herd;
    const animal = herd?.animals.find(o => o.id === id);
    if (!herd || !animal) return;
    const held = this.effectiveSelected();
    const result = herd.feed(id, held, gift => this.inventory.count(gift) - (gift === held ? 1 : 0) + 1 <= MAX_STACK);
    switch (result.result) {
      case 'gift':
        this.inventory.remove(result.usedFood, 1);
        this.inventory.add(result.gift, 1);
        this.herdRevision++;
        this.normaliseSelection();
        this.emit({ type: 'fed', animal: id, kind: animal.kind, gift: result.gift, food: result.usedFood });
        return;
      case 'resting':
        this.emit({ type: 'resting', animal: id, kind: animal.kind });
        return;
      case 'full': {
        this.emit({ type: 'full', id: GIFT[animal.kind] });
        return;
      }
      default: // notFood: a quick tap with something else is a pet (the tap resolver already chose)
        herd.pet(id);
        this.emit({ type: 'petted', animal: id, kind: animal.kind });
    }
  }

  /** Same bounds as the player's soft wall. */
  private insideWall = ([x, , z]: Cell): boolean =>
    insideWall(this.world, x, z);

  /**
   * One BFS from the player to the reachable standable cell nearest the goal
   * (pathTowards). If he can get no nearer and is in a small enclosed pit, lift him to
   * the nearest surface cell outside it and carry on; otherwise Pip gives the noPath hint.
   */
  private walk(goal: Cell, mayLift = true, avoid?: (cell: Cell) => boolean): void {
    const allowed = avoid ? (c: Cell) => this.insideWall(c) && !avoid(c) : this.insideWall;
    const start = this.player.feetCell();
    const approach = pathTowards(this.world, start, goal, allowed);
    if (approach && approach.distance < approach.startDistance) {
      const route = findPath(this.world, start, approach.end, 4000, allowed);
      this.player.setPath(route ? smoothPath(this.world, route, start, allowed) : approach.path);
      this.emit({ type: 'walking', to: approach.end });
      return;
    }
    if (approach && approach.distance === 0) return; // already there
    if (mayLift && approach && approach.visited <= PIT_CELLS && this.liftOut(approach.reached)) {
      this.emit({ type: 'lifted' });
      this.walk(goal, false, avoid);
      return;
    }
    this.emit({ type: 'noPath' });
  }

  /**
   * Walks to the reachable standable cell nearest a block, never one in the block's own
   * column (on top of it), so a second hold can dig it (fix round 1).
   */
  private walkBeside(block: Cell): void {
    this.walk(block, true, ([x, , z]) => x === block[0] && z === block[2]);
  }

  /** Puts the player on the nearest open surface (not a tree top) outside his pit. */
  private liftOut(inPit: (cell: Cell) => boolean): boolean {
    const [px, py, pz] = this.player.feetCell();
    let best: Cell | null = null;
    let bestScore = Infinity;
    for (let x = px - LIFT_RADIUS; x <= px + LIFT_RADIUS; x++) {
      for (let z = pz - LIFT_RADIUS; z <= pz + LIFT_RADIUS; z++) {
        const top = this.world.topSolidY(x, z);
        const cell: Cell = [x, top + 1, z];
        if (top < 0 || !this.insideWall(cell) || inPit(cell) || !isStandable(this.world, cell)) continue;
        const ground = this.world.get(x, top, z);
        if (ground === BlockId.Wood || ground === BlockId.Leaves) continue;
        const score = Math.hypot(x - px, z - pz) + Math.abs(cell[1] - py) * 0.1;
        if (score < bestScore) {
          best = cell;
          bestScore = score;
        }
      }
    }
    if (!best) return false;
    this.player.pos = { x: best[0] + 0.5, y: best[1], z: best[2] + 0.5 };
    this.player.setPath(null);
    return true;
  }

  /** The cells directly under the player's and Pip's feet hold them up, so they stay. */
  private holdsSomeoneUp([x, y, z]: Cell): boolean {
    const [fx, fy, fz] = this.player.feetCell();
    if (x === fx && y === fy - 1 && z === fz) return true;
    return this.occupied().some(([ox, oy, oz]) => x === ox && y === oy - 1 && z === oz);
  }

  private collect(cell: Cell): void {
    if (!canCollect(this.world, cell) || !withinPickReach(this.world, this.player.feetCell(), cell) || this.holdsSomeoneUp(cell)) return;
    const here = this.world.get(...cell);
    // Every drop goes through here. A plant (or ripe apple leaves) is never carried: the farm
    // gives seeds and harvest items instead, all or nothing.
    if (isPlantBlock(here) || here === BlockId.AppleLeaves) {
      const result = this.farm.harvest(cell);
      if (result.type === 'full') {
        const info = cropOf(here);
        this.emit({ type: 'full', id: yields(info?.kind ?? 'apple', info?.stage ?? 3)[0].id });
      }
      return;
    }
    const id = dropFor(here); // tilled soil gives plain dirt
    if (!isCarriable(id)) return;
    if (this.inventory.add(id, 1) === 0) {
      this.emit({ type: 'full', id });
      return;
    }
    this.world.set(...cell, BlockId.Air);
    this.emit({ type: 'collected', id });
  }

  private place(cell: Cell): void {
    const id = this.effectiveSelected();
    if (id === 'hand' || isItemId(id)) return; // items are never placed as blocks
    if (!withinReach(this.player.feetCell(), cell) || !canPlace(this.world, cell, this.occupied(), id)) return;
    if (!this.inventory.remove(id, 1)) return;
    this.world.set(...cell, id);
    this.normaliseSelection();
    this.emit({ type: 'placed', id });
  }

  /** A quick tap with a seed or sapling selected, on soil in reach: uses one seed. */
  private plant(cell: Cell): void {
    const seed = this.effectiveSelected();
    if (seed === 'hand' || !isItemId(seed) || ITEMS[seed].kind !== 'seed') return;
    if (!withinReach(this.player.feetCell(), cell)) return;
    this.farm.plant(cell, seed, this.occupied());
    this.normaliseSelection();
  }

  /** The cell the player faces (nearest of 8 directions) at the given height offset. */
  private frontCell(dy: number): Cell {
    const [x, y, z] = this.player.feetCell();
    const h = this.player.heading;
    return [x + Math.round(Math.sin(h)), y + dy, z + Math.round(Math.cos(h))];
  }

  padAction(action: Action): void {
    switch (action) {
      case 'collect':
        for (const dy of [0, 1]) {
          const cell = this.frontCell(dy);
          if (canCollect(this.world, cell)) {
            this.applyIntent({ kind: 'collect', cell });
            return;
          }
        }
        return;
      case 'place':
        this.applyIntent({ kind: 'place', cell: this.frontCell(0) });
        return;
      case 'nextSlot':
        this.active();
        this.selectNext();
        return;
      case 'craft':
        this.active();
        this.onCraftRequest();
        return;
    }
  }

  selectNext(): void {
    const order: Array<StackId | 'hand'> = ['hand', ...this.inventory.slots()];
    const i = order.indexOf(this.selected);
    this.selected = order[(i + 1) % order.length];
  }

  tryCraft(recipeId: string): boolean {
    const recipe = RECIPES.find(r => r.id === recipeId);
    if (!recipe || !canCraft(this.inventory, recipe) || !craft(this.inventory, recipe)) return false;
    this.active();
    this.selected = recipe.output.id; // ready to place straight away
    this.emit({ type: 'crafted', recipe: recipeId });
    return true;
  }

  /** Called by input code when the pad stick is held. */
  noteActivity(): void {
    this.active();
  }

  /** Any action restarts the idle hints from the first one. */
  private active(): void {
    this.idleFor = 0;
    this.idleHints = 0;
  }

  update(dt: number): void {
    if (!this.paused) this.player.update(this.world, dt);
    this.normaliseSelection();
    if (this.paused) return;
    if (this.idleHints >= IDLE_SECONDS.length) return;
    this.idleFor += dt;
    if (this.idleFor >= IDLE_SECONDS[this.idleHints]) {
      this.idleFor = 0;
      this.idleHints++;
      this.emit({ type: 'idle' });
    }
  }
}

import { BlockId } from '../core/blocks';
import { canCraft, craft } from '../core/crafting';
import { Inventory } from '../core/inventory';
import { findPath, type Cell } from '../core/pathfind';
import { canCollect, canPlace, withinReach } from '../core/placement';
import { RECIPES } from '../core/recipes';
import type { World } from '../core/world';
import type { Action } from '../input/mapping';
import type { TapIntent } from '../input/tap';
import { Player } from './player';

export type GameEvent =
  | { type: 'collected'; id: BlockId }
  | { type: 'placed'; id: BlockId }
  | { type: 'crafted'; recipe: string }
  | { type: 'full'; id: BlockId }
  | { type: 'noPath' }
  | { type: 'idle' };

const IDLE_SECONDS = 20;

export class Game {
  readonly world: World;
  readonly inventory: Inventory;
  readonly player: Player;
  selected: BlockId | 'hand' = 'hand';
  /** Hook for the HUD craft screen (Task 11). */
  onCraftRequest: () => void = () => {};

  private readonly listeners: Array<(e: GameEvent) => void> = [];
  private occupiedFn: () => Cell[];
  private idleFor = 0;

  constructor(opts: { world: World; spawn: { x: number; y: number; z: number }; inventory?: Inventory }) {
    this.world = opts.world;
    this.inventory = opts.inventory ?? new Inventory();
    this.player = new Player(opts.spawn);
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
  effectiveSelected(): BlockId | 'hand' {
    this.normaliseSelection();
    return this.selected;
  }

  private emit(e: GameEvent): void {
    for (const cb of this.listeners) cb(e);
  }

  private normaliseSelection(): void {
    if (this.selected !== 'hand' && this.inventory.count(this.selected) <= 0) this.selected = 'hand';
  }

  applyIntent(intent: TapIntent): void {
    switch (intent.kind) {
      case 'walk': {
        this.idleFor = 0;
        const path = findPath(this.world, this.player.feetCell(), intent.to);
        if (!path) {
          this.emit({ type: 'noPath' });
          return;
        }
        this.player.setPath(path);
        return;
      }
      case 'collect':
        this.idleFor = 0;
        this.collect(intent.cell);
        return;
      case 'place':
        this.idleFor = 0;
        this.place(intent.cell);
        return;
      default:
    }
  }

  private collect(cell: Cell): void {
    if (!canCollect(this.world, cell) || !withinReach(this.player.feetCell(), cell)) return;
    const id = this.world.get(...cell);
    if (this.inventory.add(id, 1) === 0) {
      this.emit({ type: 'full', id });
      return;
    }
    this.world.set(...cell, BlockId.Air);
    this.emit({ type: 'collected', id });
  }

  private place(cell: Cell): void {
    const id = this.effectiveSelected();
    if (id === 'hand') return;
    if (!withinReach(this.player.feetCell(), cell) || !canPlace(this.world, cell, this.occupied())) return;
    if (!this.inventory.remove(id, 1)) return;
    this.world.set(...cell, id);
    this.normaliseSelection();
    this.emit({ type: 'placed', id });
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
        this.idleFor = 0;
        this.selectNext();
        return;
      case 'craft':
        this.idleFor = 0;
        this.onCraftRequest();
        return;
    }
  }

  selectNext(): void {
    const items = this.inventory.hotbar();
    const order: Array<BlockId | 'hand'> = ['hand', ...items];
    const i = order.indexOf(this.selected);
    this.selected = order[(i + 1) % order.length];
  }

  tryCraft(recipeId: string): boolean {
    const recipe = RECIPES.find(r => r.id === recipeId);
    if (!recipe || !canCraft(this.inventory, recipe) || !craft(this.inventory, recipe)) return false;
    this.idleFor = 0;
    this.emit({ type: 'crafted', recipe: recipeId });
    return true;
  }

  update(dt: number): void {
    this.player.update(this.world, dt);
    this.normaliseSelection();
    this.idleFor += dt;
    if (this.idleFor >= IDLE_SECONDS) {
      this.idleFor = 0;
      this.emit({ type: 'idle' });
    }
  }
}

import { BlockId, isPlantBlock, yieldOf } from '../core/blocks';
import { insideWall } from '../core/bounds';
import { canCraft, craft } from '../core/crafting';
import { cropOf, yields } from '../core/crops';
import { Inventory, MAX_STACK } from '../core/inventory';
import { FIRE_COOLDOWN, WEAPON_REACH, becomesFriend, rewardFor, type RewardEntry as GrumpReward } from '../core/grumpRules';
import { FEEDS, GIFT, isItemId, isWeapon, ITEMS, weaponKind, type ItemId, type StackId, type WeaponKind } from '../core/items';
import { findPath, GENTLE_DROP, isStandable, pathTowards, smoothPath, type Cell } from '../core/pathfind';
import { EMPTY_CAVES, type CaveLayout } from '../core/caves';
import { homeSpot, isDeep } from '../core/home';
import { canOpen, chestReward, openChest, type RewardEntry } from '../core/treasure';
import type { Rect, VillageLayout } from '../core/village';

import { canCollect, canPlace, withinPickReach, withinReach } from '../core/placement';
import { RECIPES } from '../core/recipes';
import type { World } from '../core/world';
import type { Action } from '../input/mapping';
import type { HoldIntent, TapIntent } from '../input/tap';
import type { AnimalKind, Herd } from './animals';
import { EatState } from './eating';
import { Farm } from './farm';
import type { GrumpKind, GrumpSystem } from './grumps';
import { Player } from './player';

export type GameEvent =
  /** A dig put this in the bag (a block, or a Gem from gem stone). */
  | { type: 'collected'; id: StackId }
  /** The dig was gem stone: one Gem came in (after its 'collected'). */
  | { type: 'gem' }
  /** A closed chest opened: the whole reward is in the bag (all or nothing) and the chest is open for good. */
  | { type: 'chestOpened'; reward: readonly RewardEntry[]; cell: Cell }
  | { type: 'placed'; id: BlockId }
  | { type: 'crafted'; recipe: string }
  | { type: 'full'; id: StackId }
  | { type: 'noPath' }
  /** A tap he cannot walk to while deep underground: the way-up hint, not the plain one. */
  | { type: 'noPathDeep' }
  | { type: 'walking'; to: Cell }
  | { type: 'lifted' }
  /** The Home lift put him on the surface (Pip follows). */
  | { type: 'homeLift' }
  /** A food went to an animal and its gift is in the bag. */
  | { type: 'fed'; animal: number; kind: AnimalKind; gift: ItemId; food: ItemId }
  /** The animal is resting after a gift: it was only happy, nothing was used. */
  | { type: 'resting'; animal: number; kind: AnimalKind }
  | { type: 'petted'; animal: number; kind: AnimalKind }
  /** One edible was eaten (or drunk). Nothing else changes: there is no hunger and no stat. */
  | { type: 'ate'; id: ItemId }
  /** He asked to talk to the wizard (a tap on him, or the pad facing him): main opens his screen. */
  | { type: 'talk' }
  /** A friendly weapon was fired at a grump (the picture flies; the result below is already decided). */
  | { type: 'fired'; weapon: WeaponKind; grump: number; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }
  /** The first hit: the grump is less sulky and the plants around it grow again. */
  | { type: 'unsure'; grump: number; kind: GrumpKind; at: { x: number; y: number; z: number } }
  /** The second hit: it bursts into confetti (or becomes a friend) and the reward is already in the bag. */
  | { type: 'cheered'; grump: number; kind: GrumpKind; friend: boolean; reward: readonly GrumpReward[]; at: { x: number; y: number; z: number } }
  /** A cheered-up grump stays as a friend. */
  | { type: 'friendMade'; friend: number }
  | { type: 'friendPetted'; friend: number }
  /** n: which idle hint this is (1 after 20 s of quiet, 2 after another 60 s). */
  | { type: 'idle'; n?: number };

/** Seconds of quiet before each idle hint; after the last one Pip waits for the next action. */
const IDLE_SECONDS = [20, 60];
/** A reachable region this small (cells) with no way nearer the tap counts as a pit. */
const PIT_CELLS = 30;
const LIFT_RADIUS = 8;

/** Tap and hold intents from the touch screen, plus the pad's collect. */
export type Intent = TapIntent | HoldIntent | { kind: 'collect'; cell: Cell } | { kind: 'eat' };

export class Game {
  readonly world: World;
  readonly inventory: Inventory;
  readonly player: Player;
  /** Growth timers for the plants (the plants themselves are blocks in the world). */
  readonly farm: Farm;
  /** The 1.3 s munch clock (animation only; it is also the debounce). */
  readonly eating = new EatState();
  /** The friendly herd in the pasture (set by main). Animals are not blocks: no dig path reaches them. */
  herd: Herd | null = null;
  /** Bumps when an animal gives a gift, so the autosave notices. */
  herdRevision = 0;
  /** The grumps and friends on the farm (set by main). Entities, not blocks. */
  grumps: GrumpSystem | null = null;
  /** Randomness for rewards (injectable for tests). */
  grumpRng: () => number = Math.random;
  /** Grumps cheered up, ever (saved). Every fifth one becomes a friend. */
  cheered = 0;
  /** Bumps on every hit, cheer-up and friend, so the autosave notices. */
  grumpRevision = 0;
  private fireCooldown = 0;
  selected: StackId | 'hand' = 'hand';
  /** Hook for the HUD craft screen (Task 11). */
  /** While true (overlay open) the player does not move. */
  paused = false;
  onCraftRequest: () => void = () => {};
  /** The pad asked for the Home lift (main plays the fade, then calls goHome). */
  onHomeRequest: () => void = () => {};
  /** True when the wizard is right in front of him (set by main): the pad's place button talks instead. */
  wizardInFront: () => boolean = () => false;

  private readonly listeners: Array<(e: GameEvent) => void> = [];
  private occupiedFn: () => Cell[];
  private idleFor = 0;
  private idleHints = 0;

  /** For the Home lift: where the houses, farm beds and mouths are (world coordinates). */
  private readonly village: VillageLayout | null;
  private readonly caves: CaveLayout;
  private readonly homeAvoid: Rect[];
  private readonly spawnCell: Cell;
  private deep = false;

  constructor(opts: {
    world: World; spawn: { x: number; y: number; z: number }; inventory?: Inventory;
    village?: VillageLayout; caves?: CaveLayout; tower?: { rect: Rect };
  }) {
    this.world = opts.world;
    this.inventory = opts.inventory ?? new Inventory();
    this.player = new Player(opts.spawn);
    this.village = opts.village ?? null;
    this.caves = opts.caves ?? EMPTY_CAVES;
    this.homeAvoid = opts.tower ? [opts.tower.rect] : [];
    this.spawnCell = [Math.floor(opts.spawn.x), Math.floor(opts.spawn.y), Math.floor(opts.spawn.z)];
    this.deep = isDeep(this.world, this.player.feetCell(), false);
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
      case 'open':
        this.openChestAt(intent.cell);
        return;
      case 'plant':
        this.active();
        this.plant(intent.cell);
        return;
      case 'help':
        this.active();
        if (withinReach(this.player.feetCell(), intent.cell)) this.farm.help(intent.cell);
        return;
      case 'eat':
        this.eat();
        return;
      case 'feed':
        this.active();
        this.feedAnimal(intent.animal);
        return;
      case 'talk':
        // Costs nothing and changes nothing: the screen opens (never while another overlay has paused the game).
        if (this.paused) return;
        this.active();
        this.emit({ type: 'talk' });
        return;
      case 'fire':
        this.active();
        this.fireWeapon(intent.grump);
        return;
      case 'petFriend':
        this.active();
        this.petFriend(intent.friend);
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

  /** The eye the shot leaves from. */
  private eye(): { x: number; y: number; z: number } {
    const p = this.player.pos;
    return { x: p.x, y: p.y + 1.6, z: p.z };
  }

  /**
   * A quick tap with a friendly weapon on a grump. Decided at once and deterministically (the picture
   * follows a moment later): needs a selected weapon, a grump within reach, no cooldown and no
   * pause. The first hit makes it unsure, the second cheers it up (reward into the bag, every fifth
   * becomes a friend). Nothing is ever used up and nothing else changes.
   */
  fireWeapon(grumpId: number): GameEvent[] {
    const out: GameEvent[] = [];
    const sys = this.grumps;
    const sel = this.effectiveSelected();
    if (!sys || this.paused || this.fireCooldown > 0 || sel === 'hand' || !isWeapon(sel)) return out;
    const weapon = weaponKind(sel);
    const g = sys.grumps.find(o => o.id === grumpId);
    if (!g || !weapon) return out;
    const eye = this.eye();
    const to = { x: g.x, y: g.y + 0.5, z: g.z };
    if (Math.hypot(to.x - eye.x, to.y - eye.y, to.z - eye.z) > WEAPON_REACH) return out;
    this.fireCooldown = FIRE_COOLDOWN;
    out.push({ type: 'fired', weapon, grump: g.id, from: eye, to });
    const kind = g.kind, at = { x: g.x, y: g.y, z: g.z };
    const hit = sys.hit(g.id);
    this.grumpRevision++;
    if (hit.result === 'unsure') {
      out.push({ type: 'unsure', grump: g.id, kind, at });
    } else if (hit.result === 'cheered') {
      this.cheered++;
      const friend = becomesFriend(this.cheered, sys.friends.length);
      const atCap = !friend && this.cheered % 5 === 0 && sys.friends.length >= 5;
      const reward = rewardFor(this.grumpRng, this.inventory, { friend, atCap });
      for (const r of reward) this.inventory.add(r.id, r.n);
      if (friend) {
        // The burst already removed the grump; a friend stands where it was.
        const spot = hit.grump ?? g;
        sys.grumps.push(spot);
        sys.makeFriend(spot.id);
      }
      out.push({ type: 'cheered', grump: g.id, kind, friend, reward, at });
      if (friend) out.push({ type: 'friendMade', friend: g.id });
    }
    for (const e of out) this.emit(e);
    return out;
  }

  /** A pat for a friend: it hops. Costs nothing, changes nothing else. */
  petFriend(id: number): void {
    const f = this.grumps?.friends.find(o => o.id === id);
    if (!f) return;
    f.state = 'hop';
    f.stateT = 1;
    this.emit({ type: 'friendPetted', friend: id });
  }

  /** The pad's Place button with a weapon: the nearest grump in reach. False (and nothing happens) when none. */
  fireNearest(): boolean {
    const sys = this.grumps;
    if (!sys) return false;
    const eye = this.eye();
    let best: number | null = null;
    let bestD = WEAPON_REACH;
    for (const g of sys.grumps) {
      const d = Math.hypot(g.x - eye.x, g.y + 0.5 - eye.y, g.z - eye.z);
      if (d <= bestD) { best = g.id; bestD = d; }
    }
    if (best === null) return false;
    this.active();
    return this.fireWeapon(best).length > 0;
  }

  /**
   * Eats (or drinks) one of the selected edible: exactly one item, nothing else. Refused while the
   * game is paused, while a munch is running (the debounce), and for anything that is not edible.
   */
  private eat(): void {
    if (this.paused) return;
    const sel = this.effectiveSelected();
    if (sel === 'hand' || !isItemId(sel) || !ITEMS[sel].edible || this.inventory.count(sel) <= 0) return;
    if (!this.eating.start(sel)) return;
    this.active();
    this.inventory.remove(sel, 1);
    this.normaliseSelection();
    this.emit({ type: 'ate', id: sel });
  }

  /** The animal right in front of him (pad Place), if any. */
  private animalInFront(): number | null {
    const { x, z } = this.player.pos;
    const h = this.player.heading;
    let best: number | null = null;
    let bestD = 2.4;
    for (const a of this.herd?.animals ?? []) {
      const dx = a.x - x;
      const dz = a.z - z;
      const d = Math.hypot(dx, dz);
      if (d > bestD || Math.abs(a.y - this.player.pos.y) > 1.5) continue;
      if (d > 0.5 && (dx * Math.sin(h) + dz * Math.cos(h)) / d < 0.3) continue;
      best = a.id;
      bestD = d;
    }
    return best;
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
    const approach = pathTowards(this.world, start, goal, allowed, 8000, GENTLE_DROP);
    if (approach && approach.distance < approach.startDistance) {
      const route = findPath(this.world, start, approach.end, 4000, allowed, GENTLE_DROP);
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
    // Deep underground a failed tap points him at the way up instead (the Home button wobbles).
    this.emit({ type: this.isDeep() ? 'noPathDeep' : 'noPath' });
  }

  /** True while he is deep underground (7 blocks in, 5 out), updated every frame. */
  isDeep(): boolean {
    return this.deep;
  }

  /**
   * The Home lift: puts him on the nearest open surface (homeSpot) and nothing else changes: his bag,
   * the world and the farm are untouched. Pip joins him (homeLift). Refused while the game is paused.
   */
  goHome(): boolean {
    if (this.paused) return false;
    const spot = homeSpot(this.world, this.player.feetCell(), this.caves, this.village, this.spawnCell, this.homeAvoid);
    this.player.pos = { x: spot[0] + 0.5, y: spot[1], z: spot[2] + 0.5 };
    this.player.setPath(null);
    this.player.snapVisual();
    this.deep = isDeep(this.world, spot, false);
    this.active();
    this.emit({ type: 'homeLift' });
    return true;
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
    // Tilled soil gives plain dirt, gem stone one Gem; a closed chest or bedrock gives nothing (and stays).
    const id = yieldOf(here);
    if (id === null) return;
    if (this.inventory.add(id, 1) === 0) {
      this.emit({ type: 'full', id });
      return;
    }
    this.world.set(...cell, BlockId.Air);
    this.emit({ type: 'collected', id });
    if (here === BlockId.GemOre) this.emit({ type: 'gem' });
  }

  /**
   * Opens a closed chest in reach (plan Task 19): every entry of its reward goes into the bag and
   * the chest becomes ChestOpen (an ordinary edit, so it is saved and never pays twice), or, if any
   * entry would not fit under 99, nothing changes and Pip says the bag is full (he can come back).
   * Refused while the game is paused.
   */
  private openChestAt(cell: Cell): void {
    if (this.paused) return;
    if (this.world.get(...cell) !== BlockId.Chest || !withinPickReach(this.world, this.player.feetCell(), cell)) return;
    this.active();
    const reward = chestReward(this.caves, cell);
    if (!canOpen(this.inventory, reward)) {
      const tooMany = reward.find(e => this.inventory.count(e.id) + e.n > MAX_STACK) ?? reward[0];
      this.emit({ type: 'full', id: tooMany.id });
      return;
    }
    const result = openChest(this.world, this.inventory, this.caves, cell);
    if (result.ok) this.emit({ type: 'chestOpened', reward: result.reward, cell: [cell[0], cell[1], cell[2]] });
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
      case 'place': {
        if (this.wizardInFront()) { this.applyIntent({ kind: 'talk' }); return; }
        // A closed chest right in front (at his feet or one up) opens, whatever is selected.
        for (const dy of [0, 1]) {
          const cell = this.frontCell(dy);
          if (this.world.get(...cell) === BlockId.Chest) { this.applyIntent({ kind: 'open', cell }); return; }
        }
        // A friendly weapon selected: Place fires at the nearest grump in reach (never builds, never fires at nothing).
        {
          const held = this.effectiveSelected();
          if (held !== 'hand' && isWeapon(held)) { this.fireNearest(); return; }
        }
        // With a food selected: an animal right in front is fed; otherwise an edible is eaten. Blocks place as before.
        const sel = this.effectiveSelected();
        if (sel !== 'hand' && isItemId(sel)) {
          const animal = FEEDS.includes(sel) ? this.animalInFront() : null;
          if (animal !== null) {
            this.active();
            this.feedAnimal(animal);
            return;
          }
          if (ITEMS[sel].edible) {
            this.eat();
            return;
          }
        }
        this.applyIntent({ kind: 'place', cell: this.frontCell(0) });
        return;
      }
      case 'nextSlot':
        this.active();
        this.selectNext();
        return;
      case 'craft':
        this.active();
        this.onCraftRequest();
        return;
      case 'home':
        // The Home button's pad twin: only while he is deep (when the button shows), never while paused.
        if (this.paused || !this.deep) return;
        this.active();
        this.onHomeRequest();
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
    if (!this.paused) {
      this.player.update(this.world, dt);
      this.eating.update(dt);
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    }
    this.deep = isDeep(this.world, this.player.feetCell(), this.deep);
    this.normaliseSelection();
    if (this.paused) return;
    if (this.idleHints >= IDLE_SECONDS.length) return;
    this.idleFor += dt;
    if (this.idleFor >= IDLE_SECONDS[this.idleHints]) {
      this.idleFor = 0;
      this.idleHints++;
      this.emit({ type: 'idle', n: this.idleHints });
    }
  }
}

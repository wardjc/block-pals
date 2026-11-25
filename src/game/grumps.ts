import { HITS_TO_CHEER, becomesFriend } from '../core/grumpRules';
import type { SavedFriend, SavedGrump } from '../core/grumpSave';
import type { Rect } from '../core/houses';
import { isStandable, settleCell, type Cell } from '../core/pathfind';
import type { World } from '../core/world';
import { HEIGHTS, insideRect, nearestFree, stepWander, type WanderRules } from './wander';

/**
 * Grumps are small, slow, wobbly and harmless: they settle on the farm near the plants (which then
 * pause growing), keep their distance from him, and are cheered up by a friendly weapon. Every few
 * cheered-up ones stay on as friends. Entities, not blocks: never solid, one cell wide, kept inside
 * the farm zone and off doors and paths. Pure and DOM-free.
 */
export type GrumpKind = 'jelly' | 'cloud';
/** 0 sulky, 1 unsure. A cheered-up grump bursts and is gone: there is no third mood. */
export type GrumpMood = 0 | 1;
export type GrumpState = 'wobbleIn' | 'settle' | 'idle' | 'hop' | 'cheered';
export const GRUMP_STATES: readonly GrumpState[] = ['wobbleIn', 'settle', 'idle', 'hop', 'cheered'];

export interface PlayerPos { x: number; y: number; z: number }
export interface Grump {
  id: number; kind: GrumpKind; variant: number;
  x: number; y: number; z: number; heading: number;
  mood: GrumpMood; hits: number; state: GrumpState; stateT: number; spawnT: number; sulkNoiseIn: number; stuckFor: number;
  settle: Cell | null;
  /** The plant this grump settled beside (null when none was planted). */
  crop: Cell | null;
  /** Where it lives: 'farm' or the id of a spot added with addSpot. */
  spot: string;
  target: { x: number; z: number } | null;
  /** Seconds spent walking to the settle cell. */
  walkT: number;
}
export interface Friend {
  id: number; kind: GrumpKind; variant: number;
  x: number; y: number; z: number; heading: number;
  state: 'idle' | 'walk' | 'hop' | 'help'; stateT: number; jobIn: number; stuckFor: number;
  target: { x: number; z: number } | null;
}

export const PERSONAL_SPACE = 4;
export const PAUSE_RADIUS = 3;
export const FRIEND_JOB_SECONDS = 240;
const MAX_DT = 0.25;
const WOBBLE_IN_SPEED = 0.8;
const FRIEND_SPEED = 0.6;
const FOLLOW_LIMIT = 12;
const KINDS: readonly GrumpKind[] = ['jelly', 'cloud'];

export interface GrumpContext {
  world: World;
  player: PlayerPos;
  /** Cells other bodies stand in (him, Pip, villagers, animals). */
  occupied: Cell[];
  plantCells: Cell[];
  dt: number;
}
export type GrumpEvent = { type: 'arrived'; id: number } | { type: 'sulk'; id: number; dist: number };
export type FriendEvent = { type: 'helped'; friend: number; cell: Cell };
export type FarmHelper = { growingNear(c: Cell, r: number): Cell | null; help(c: Cell): unknown };
export interface Spot { id: string; cell: Cell; kind: 'farm' | 'door' }

const key3 = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const cheb = (a: Cell, b: Cell): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2]));
const within = (g: { x: number; z: number }, p: PlayerPos): number => Math.hypot(g.x - p.x, g.z - p.z);
const tenths = (v: number): number => Math.floor(v * 10 + 1e-9);

export class GrumpSystem {
  grumps: Grump[] = [];
  friends: Friend[] = [];
  private nextId = 1;
  private readonly spots = new Map<string, Spot>();

  constructor(private readonly rng: () => number, private readonly zone: Rect, private readonly avoid: Set<string>) {}

  /** A place grumps may live. The farm zone is the only one in use; a villager's door is ready for later. */
  addSpot(spot: Spot): void {
    this.spots.set(spot.id, { ...spot, cell: [...spot.cell] });
  }

  spawn(cell: Cell, kind: GrumpKind, spot = 'farm'): Grump {
    const g: Grump = {
      id: this.nextId++, kind, variant: Math.floor(this.rng() * 4),
      x: cell[0] + 0.5, y: cell[1], z: cell[2] + 0.5, heading: this.rng() * Math.PI * 2,
      mood: 0, hits: 0, state: 'wobbleIn', stateT: 0, spawnT: 0, sulkNoiseIn: 6 + this.rng() * 6, stuckFor: 0,
      settle: null, crop: null, spot, target: null, walkT: 0,
    };
    this.grumps.push(g);
    return g;
  }

  // ------------------------------------------------------------------ rules of the place

  private roamOf(spot: string): Rect {
    const s = this.spots.get(spot);
    if (!s || s.kind !== 'door') return this.zone;
    return { x0: s.cell[0] - 5, x1: s.cell[0] + 5, z0: s.cell[2] - 5, z1: s.cell[2] + 5 };
  }

  private nearDoor(x: number, z: number): boolean {
    for (const s of this.spots.values()) if (s.kind === 'door' && Math.max(Math.abs(x - s.cell[0]), Math.abs(z - s.cell[2])) <= 1) return true;
    return false;
  }

  /** A cell nobody may stand in: avoided, beside a door, a plant, or held by another body. */
  private makeBlocked(selfId: number, occ: Map<string, number>, plants: Set<string>): (c: Cell) => boolean {
    return (c: Cell): boolean => {
      if (this.avoid.has(`${c[0]},${c[2]}`) || this.nearDoor(c[0], c[2])) return true;
      if (plants.has(key3(c[0], c[1], c[2]))) return true;
      const owner = occ.get(key3(c[0], c[1], c[2]));
      return owner !== undefined && owner !== selfId;
    };
  }

  private occupy(map: Map<string, number>, e: { id: number; x: number; y: number; z: number }, on: boolean): void {
    const x = Math.floor(e.x), z = Math.floor(e.z);
    for (const dy of [0, 1]) {
      const k = key3(x, e.y + dy, z);
      if (on) map.set(k, e.id); else if (map.get(k) === e.id) map.delete(k);
    }
  }

  private occupancy(ctx: GrumpContext): Map<string, number> {
    const map = new Map<string, number>();
    for (const c of ctx.occupied) map.set(key3(c[0], c[1], c[2]), -1);
    for (const e of [...this.grumps, ...this.friends]) this.occupy(map, e, true);
    return map;
  }

  // ------------------------------------------------------------------ settling

  private pickSettle(g: Grump, ctx: GrumpContext, blocked: (c: Cell) => boolean): void {
    const spot = this.spots.get(g.spot);
    const roam = this.roamOf(g.spot);
    const ok = (c: Cell): boolean => insideRect(roam, c[0], c[2]) && !blocked(c) && isStandable(ctx.world, c);
    const anyOf = (cells: Cell[]): Cell | null => (cells.length > 0 ? cells[Math.floor(this.rng() * cells.length)] : null);
    g.crop = null;
    if (spot && spot.kind === 'door') {
      const ring: Cell[] = [];
      for (let x = spot.cell[0] - 3; x <= spot.cell[0] + 3; x++) for (let z = spot.cell[2] - 3; z <= spot.cell[2] + 3; z++) {
        if (Math.max(Math.abs(x - spot.cell[0]), Math.abs(z - spot.cell[2])) !== 3) continue;
        for (const dy of HEIGHTS) { const c: Cell = [x, spot.cell[1] + dy, z]; if (ok(c)) { ring.push(c); break; } }
      }
      g.settle = anyOf(ring) ?? [Math.floor(g.x), g.y, Math.floor(g.z)];
      return;
    }
    const plants = ctx.plantCells.filter(p => insideRect(roam, p[0], p[2]));
    for (let tries = 0; tries < 6 && plants.length > 0; tries++) {
      const plant = plants[Math.floor(this.rng() * plants.length)];
      const near: Cell[] = [];
      for (let x = plant[0] - 2; x <= plant[0] + 2; x++) for (let z = plant[2] - 2; z <= plant[2] + 2; z++) {
        for (const dy of HEIGHTS) { const c: Cell = [x, plant[1] + dy, z]; if (ok(c)) { near.push(c); break; } }
      }
      const c = anyOf(near);
      if (c) { g.settle = c; g.crop = [...plant]; return; }
    }
    for (let tries = 0; tries < 30; tries++) {
      const x = roam.x0 + Math.floor(this.rng() * (roam.x1 - roam.x0 + 1));
      const z = roam.z0 + Math.floor(this.rng() * (roam.z1 - roam.z0 + 1));
      for (const dy of HEIGHTS) { const c: Cell = [x, g.y + dy, z]; if (ok(c)) { g.settle = c; return; } }
    }
    g.settle = nearestFree(ctx.world, roam, c => !blocked(c), g.x, g.y, g.z, g) ?? [Math.floor(g.x), g.y, Math.floor(g.z)];
  }

  // ------------------------------------------------------------------ updating

  /** Keeps its distance: never closer than 4 to him, never closer at all once nearer, never towards him within 12. */
  private keepAway(player: PlayerPos, space: number): WanderRules['allow'] {
    return (from, to): boolean => {
      const before = Math.hypot(from.x - player.x, from.z - player.z);
      const after = Math.hypot(to.x - player.x, to.z - player.z);
      if (before <= FOLLOW_LIMIT) return after >= before - 1e-9;
      return after >= space;
    };
  }

  update(raw: GrumpContext): GrumpEvent[] {
    if (!(raw.dt > 0) || !Number.isFinite(raw.dt)) return [];
    const ctx: GrumpContext = raw.dt <= MAX_DT ? raw : { ...raw, dt: MAX_DT };
    const events: GrumpEvent[] = [];
    const occ = this.occupancy(ctx);
    const plants = new Set(ctx.plantCells.map(c => key3(c[0], c[1], c[2])));
    for (const g of this.grumps) this.updateGrump(g, ctx, occ, plants, events);
    for (const f of this.friends) this.updateFriend(f, ctx, occ, plants);
    return events;
  }

  private updateGrump(g: Grump, ctx: GrumpContext, occ: Map<string, number>, plants: Set<string>, events: GrumpEvent[]): void {
    const dt = ctx.dt;
    const blocked = this.makeBlocked(g.id, occ, plants);
    g.spawnT = Math.min(1, g.spawnT + dt);
    g.stateT = Math.max(0, g.stateT - dt);
    const distance = within(g, ctx.player);
    g.sulkNoiseIn -= dt;
    if (g.sulkNoiseIn <= 0) {
      if (g.mood === 0 && distance <= 10) events.push({ type: 'sulk', id: g.id, dist: distance });
      g.sulkNoiseIn = 12;
    }
    const cropGone = g.crop !== null && !plants.has(key3(g.crop[0], g.crop[1], g.crop[2]));
    if (!g.settle || cropGone || g.walkT > 45) {
      this.pickSettle(g, ctx, blocked);
      g.walkT = 0;
      g.target = null;
      if (g.state !== 'wobbleIn') g.state = 'settle';
    }
    const roam = this.roamOf(g.spot);
    const rules = (speed: number, area: Rect, hop: [number, number]): WanderRules => ({
      roam: area, speed, hop, blocked,
      allow: this.keepAway(ctx.player, PERSONAL_SPACE),
      // A lift out of a walled-in place never takes it closer to him.
      rescueBlocked: c => blocked(c) || (distance <= FOLLOW_LIMIT && Math.hypot(c[0] + 0.5 - ctx.player.x, c[2] + 0.5 - ctx.player.z) < distance),
    });
    this.occupy(occ, g, false);
    if (g.state === 'wobbleIn' || g.state === 'settle') {
      g.walkT += dt;
      const goal = { x: g.settle![0] + 0.5, z: g.settle![2] + 0.5 };
      stepWander(g, goal, rules(WOBBLE_IN_SPEED, roam, [1, 3]), ctx.world, this.rng, dt);
      if (Math.hypot(goal.x - g.x, goal.z - g.z) < 0.3) {
        if (g.state === 'wobbleIn') events.push({ type: 'arrived', id: g.id });
        g.state = 'idle';
        g.stateT = 1 + this.rng() * 3;
        g.walkT = 0;
        g.target = null;
      }
    } else if (g.state === 'idle') {
      if (g.stateT === 0) { g.state = 'hop'; g.stateT = 2 + this.rng() * 3; g.target = null; }
    } else if (g.state === 'hop') {
      const area = this.hopArea(g, roam);
      const had = g.target !== null;
      const r = stepWander(g, g.target, rules(0.5 + (g.id % 4) * 0.1, area, [1, 3]), ctx.world, this.rng, dt);
      g.target = r.target;
      // Stops when the hop is over (or blocked); a hop that found nowhere to go keeps trying, so a walled-in one is lifted out.
      if ((!r.moved && had && g.target === null) || (g.stateT === 0 && g.target === null)) {
        g.state = 'idle';
        g.stateT = 1 + this.rng() * 3;
      }
    }
    this.occupy(occ, g, true);
  }

  private hopArea(g: Grump, roam: Rect): Rect {
    const s = g.settle ?? [Math.floor(g.x), g.y, Math.floor(g.z)];
    return {
      x0: Math.max(roam.x0, s[0] - 3), x1: Math.min(roam.x1, s[0] + 3),
      z0: Math.max(roam.z0, s[2] - 3), z1: Math.min(roam.z1, s[2] + 3),
    };
  }

  private updateFriend(f: Friend, ctx: GrumpContext, occ: Map<string, number>, plants: Set<string>): void {
    const dt = ctx.dt;
    f.stateT = Math.max(0, f.stateT - dt);
    if ((f.state === 'hop' || f.state === 'help') && f.stateT > 0) return;
    if (f.state === 'hop' || f.state === 'help') { f.state = 'idle'; f.stateT = 1 + this.rng() * 3; }
    if (f.state === 'idle') {
      if (f.stateT > 0) return;
      f.state = 'walk';
      f.target = null;
    }
    const blocked = this.makeBlocked(f.id, occ, plants);
    const rules: WanderRules = {
      roam: this.zone, speed: FRIEND_SPEED, hop: [1, 3], blocked,
      allow: this.keepAway(ctx.player, 0),
      rescueBlocked: c => blocked(c),
    };
    this.occupy(occ, f, false);
    const had = f.target !== null;
    const r = stepWander(f, f.target, rules, ctx.world, this.rng, dt);
    f.target = r.target;
    if (!r.moved && had && f.target === null) { f.state = 'idle'; f.stateT = 1 + this.rng() * 3; }
    this.occupy(occ, f, true);
  }

  // ------------------------------------------------------------------ friends

  /** Becomes a friend where it stands: same place and kind, colour variant by how many friends came before. */
  makeFriend(grumpId: number): Friend {
    const i = this.grumps.findIndex(g => g.id === grumpId);
    if (i < 0) throw new Error('No such grump');
    const g = this.grumps[i];
    this.grumps.splice(i, 1);
    const f: Friend = {
      id: g.id, kind: g.kind, variant: this.friends.length % 5, x: g.x, y: g.y, z: g.z, heading: g.heading,
      state: 'hop', stateT: 1, jobIn: FRIEND_JOB_SECONDS, stuckFor: 0, target: null,
    };
    this.friends.push(f);
    return f;
  }

  /** Makes the friend if the rule says so (every 5th cheer-up, fewer than 5 friends); otherwise leaves it. */
  tryMakeFriend(grumpId: number, cheeredAfter: number): Friend | null {
    return becomesFriend(cheeredAfter, this.friends.length) && this.grumps.some(g => g.id === grumpId) ? this.makeFriend(grumpId) : null;
  }

  /** Friends lend a hand with a growing plant every FRIEND_JOB_SECONDS of play time. Time away is not counted. */
  updateFriends(ctx: GrumpContext & { farm: FarmHelper }): FriendEvent[] {
    const events: FriendEvent[] = [];
    if (!(ctx.dt > 0) || !Number.isFinite(ctx.dt)) return events;
    const dt = Math.min(ctx.dt, 1);
    for (const f of this.friends) {
      f.jobIn = Math.max(0, f.jobIn - dt);
      if (f.jobIn > 0) continue;
      const cell = ctx.farm.growingNear([Math.floor(f.x), f.y, Math.floor(f.z)], 60);
      if (!cell) continue; // wait at zero: no job piles up, and it tries again next time
      ctx.farm.help(cell);
      f.jobIn = FRIEND_JOB_SECONDS;
      f.state = 'help';
      f.stateT = 0.8;
      events.push({ type: 'helped', friend: f.id, cell });
    }
    return events;
  }

  // ------------------------------------------------------------------ cheering up

  /** One friendly hit. Sulky becomes unsure; unsure is cheered up and gone (the game gives the reward). */
  hit(id: number): { result: 'unsure' | 'cheered' | 'ignored'; grump?: Grump } {
    const i = this.grumps.findIndex(g => g.id === id);
    if (i < 0) return { result: 'ignored' };
    const g = this.grumps[i];
    g.hits++;
    if (g.hits >= HITS_TO_CHEER) {
      this.grumps.splice(i, 1);
      g.state = 'cheered';
      return { result: 'cheered', grump: g };
    }
    g.mood = 1;
    return { result: 'unsure', grump: g };
  }

  // ------------------------------------------------------------------ plants and bodies

  /** True within PAUSE_RADIUS of a sulky grump's middle. Unsure grumps and friends pause nothing. */
  pausesCell(c: Cell): boolean {
    for (const g of this.grumps) {
      if (g.mood !== 0) continue;
      if (Math.hypot(c[0] + 0.5 - g.x, c[1] + 0.5 - (g.y + 0.5), c[2] + 0.5 - g.z) <= PAUSE_RADIUS) return true;
    }
    return false;
  }

  pausedCells(plants: Cell[]): Cell[] {
    return plants.filter(c => this.pausesCell(c));
  }

  /** The feet cell and the cell above of every grump and friend: placing a block there is refused. */
  occupiedCells(): Cell[] {
    const cells: Cell[] = [];
    for (const e of [...this.grumps, ...this.friends]) cells.push([Math.floor(e.x), e.y, Math.floor(e.z)], [Math.floor(e.x), e.y + 1, Math.floor(e.z)]);
    return cells;
  }

  // ------------------------------------------------------------------ saving

  toJSON(): { grumps: SavedGrump[]; friends: SavedFriend[] } {
    return {
      grumps: this.grumps.map((g): SavedGrump => [KINDS.indexOf(g.kind), tenths(g.x), g.y, tenths(g.z), g.mood]),
      friends: this.friends.map((f): SavedFriend => [KINDS.indexOf(f.kind), f.variant, tenths(f.x), f.y, tenths(f.z), Math.ceil(f.jobIn)]),
    };
  }

  /**
   * A grump whose saved place is no longer good is dropped (the spawner brings new ones). A friend is
   * never lost: it is put in the nearest free standable cell of the zone.
   */
  restore(saved: { grumps: SavedGrump[]; friends: SavedFriend[] }, world: World, occupied: Cell[]): void {
    this.grumps = [];
    this.friends = [];
    this.nextId = 1;
    const taken = new Set<string>(occupied.map(c => key3(c[0], c[1], c[2])));
    const free = (c: Cell): boolean => insideRect(this.zone, c[0], c[2]) && !this.avoid.has(`${c[0]},${c[2]}`) && !taken.has(key3(c[0], c[1], c[2]));
    for (const [k, x10, y, z10, mood] of saved.grumps) {
      const cell: Cell = [Math.floor(x10 / 10), y, Math.floor(z10 / 10)];
      if (!free(cell) || !isStandable(world, cell)) continue;
      const g = this.spawn(cell, KINDS[k] ?? 'jelly');
      g.x = x10 / 10; g.z = z10 / 10;
      g.mood = mood === 1 ? 1 : 0; g.hits = g.mood;
      g.state = 'idle'; g.stateT = 1; g.spawnT = 1;
      taken.add(key3(cell[0], cell[1], cell[2])); taken.add(key3(cell[0], cell[1] + 1, cell[2]));
    }
    for (const [k, variant, x10, y, z10, jobIn] of saved.friends) {
      let cell: Cell = [Math.floor(x10 / 10), y, Math.floor(z10 / 10)];
      const exact = free(cell) && isStandable(world, cell);
      if (!exact) {
        cell = nearestFree(world, this.zone, free, x10 / 10, y, z10 / 10)
          ?? nearestFree(world, this.zone, c => insideRect(this.zone, c[0], c[2]), x10 / 10, y, z10 / 10)
          ?? settleCell(world, cell);
      }
      const f: Friend = {
        id: this.nextId++, kind: KINDS[k] ?? 'jelly', variant: ((variant % 5) + 5) % 5,
        x: exact ? x10 / 10 : cell[0] + 0.5, y: cell[1], z: exact ? z10 / 10 : cell[2] + 0.5, heading: this.rng() * Math.PI * 2,
        state: 'idle', stateT: 1, jobIn: Math.max(0, Math.min(FRIEND_JOB_SECONDS, jobIn)), stuckFor: 0, target: null,
      };
      this.friends.push(f);
      taken.add(key3(cell[0], cell[1], cell[2])); taken.add(key3(cell[0], cell[1] + 1, cell[2]));
    }
  }
}

// ====================================================================== spawning

export const SPAWN_SECONDS = 120;
export const FIRST_SPAWN_SECONDS = 45;
/** The next interval is SPAWN_SECONDS plus or minus this. */
export const SPAWN_JITTER = 20;
export const SPAWN_MIN_PLAYER = 8;
export const NEAR_FARM = 16;
export const CAP_WITH_WEAPON = 3;
export const CAP_WITHOUT_WEAPON = 1;

export interface SpawnContext {
  dt: number; nearFarm: boolean; plantedCrops: number; count: number; hasWeapon: boolean;
  overlayOpen: boolean; paused: boolean; player: PlayerPos; borderCells: Cell[]; occupied: Cell[];
}
export interface SpawnerState { timer: number; interval: number; first: boolean }

/**
 * Decides when a new grump wobbles in. The timer only counts while he is near the farm, something is
 * planted, there is room, and nothing is open or paused. Deterministic for a given rng and inputs.
 */
export class GrumpSpawner {
  private timer = 0;
  private interval = FIRST_SPAWN_SECONDS;
  private first = true;

  constructor(private readonly rng: () => number, saved?: SpawnerState) {
    if (saved) { this.timer = saved.timer; this.interval = saved.interval; this.first = saved.first; }
  }

  state(): SpawnerState {
    return { timer: this.timer, interval: this.interval, first: this.first };
  }

  update(ctx: SpawnContext): { cell: Cell; kind: GrumpKind } | null {
    if (!(ctx.dt > 0) || !Number.isFinite(ctx.dt)) return null;
    const cap = ctx.hasWeapon ? CAP_WITH_WEAPON : CAP_WITHOUT_WEAPON;
    if (!ctx.nearFarm || ctx.plantedCrops < 1 || ctx.count >= cap || ctx.overlayOpen || ctx.paused) return null;
    this.timer = Math.min(this.interval, this.timer + ctx.dt);
    if (this.timer < this.interval) return null;
    const busy = new Set(ctx.occupied.map(c => key3(c[0], c[1], c[2])));
    const options = ctx.borderCells.filter(c =>
      Math.hypot(c[0] + 0.5 - ctx.player.x, c[2] + 0.5 - ctx.player.z) >= SPAWN_MIN_PLAYER && !busy.has(key3(c[0], c[1], c[2])));
    if (options.length === 0) return null; // wait with the timer full and try again next second
    const cell = options[Math.floor(this.rng() * options.length)];
    const kind = this.rng() < 0.5 ? 'jelly' : 'cloud';
    this.first = false;
    this.interval = SPAWN_SECONDS - SPAWN_JITTER + this.rng() * 2 * SPAWN_JITTER;
    this.timer = 0;
    return { cell: [...cell], kind };
  }
}

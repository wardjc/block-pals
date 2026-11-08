import type { Rect } from '../core/houses';
import { FEEDS, GIFT, type ItemId, type StackId } from '../core/items';
import { canStep, isStandable, type Cell } from '../core/pathfind';
import type { SavedAnimalTuple } from '../core/save';
import type { World } from '../core/world';

export type { Rect } from '../core/houses';
export type AnimalKind = 'chicken' | 'cow' | 'sheep' | 'pig';
export type AnimalState = 'idle' | 'walk' | 'graze' | 'come' | 'happy';
export const ANIMAL_STATES: readonly AnimalState[] = ['idle', 'walk', 'graze', 'come', 'happy'];
export interface Animal {
  id: number;
  kind: AnimalKind;
  variant: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  state: AnimalState;
  stateT: number;
  giftIn: number;
  noiseIn: number;
  stuckFor: number;
  tx: number;
  tz: number;
  waypoint: Cell | null;
}
export interface HerdContext {
  world: World;
  roam: Rect;
  player: { x: number; y: number; z: number };
  held: StackId | 'hand';
  occupied: Cell[];
  dt: number;
}
export type HerdEvent = {
  type: 'noise'; id: number; kind: AnimalKind; dist: number; reason: 'idle' | 'happy';
};
export const DEFAULT_HERD: Record<AnimalKind, number> = { chicken: 4, cow: 2, sheep: 3, pig: 1 };
export const GIFT_REST_SECONDS = 45;
/** The longest step the herd will take in one update (seconds). */
const MAX_DT = 0.25;

const KINDS: readonly AnimalKind[] = ['chicken', 'cow', 'sheep', 'pig'];
const SPEED: Record<AnimalKind, number> = { chicken: 1, cow: 0.7, sheep: 0.8, pig: 0.9 };
const HEIGHTS = [0, 1, -1] as const;
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const inside = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const food = (held: StackId | 'hand'): held is ItemId => held !== 'hand' && FEEDS.includes(held as ItemId);

export class Herd {
  animals: Animal[] = [];
  private spawns: Cell[] = [];
  private spawnIndex = 0;
  private happySounds: Animal[] = [];
  private quietFor = 0;
  private readonly from: Cell = [0, 0, 0];
  private readonly to: Cell = [0, 0, 0];

  constructor(private readonly rng: () => number) {}

  private reset(spawns: Cell[]): void {
    this.animals = [];
    this.spawns = spawns.map(c => [...c]);
    this.spawnIndex = 0;
    this.happySounds = [];
    this.quietFor = 0;
  }

  private create(kind: AnimalKind, cell: Cell, variant: number): Animal {
    const a: Animal = {
      id: this.animals.length, kind, variant,
      x: cell[0] + 0.5, y: cell[1], z: cell[2] + 0.5,
      heading: this.rng() * Math.PI * 2, state: 'walk', stateT: 0,
      giftIn: 0, noiseIn: 12 + this.rng() * 18, stuckFor: 0,
      tx: NaN, tz: NaN, waypoint: null,
    };
    if (this.rng() < 0.5) this.calm(a);
    this.animals.push(a);
    return a;
  }

  populate(spawns: Cell[], counts = DEFAULT_HERD): void {
    this.reset(spawns);
    for (const kind of KINDS) {
      for (let i = 0; i < counts[kind]; i++) {
        const cell = spawns[this.spawnIndex++ % spawns.length];
        if (!cell) throw new Error('A herd needs spawn cells');
        this.create(kind, cell, i % 2);
      }
    }
  }

  private free(cell: Cell, roam: Rect, occupied: Cell[], self?: Animal): boolean {
    if (!inside(roam, cell[0], cell[2])) return false;
    for (const c of occupied) {
      if (c[0] === cell[0] && c[1] === cell[1] && c[2] === cell[2]) return false;
    }
    for (const a of this.animals) {
      if (a !== self && Math.floor(a.x) === cell[0] && a.y === cell[1] && Math.floor(a.z) === cell[2]) return false;
    }
    return true;
  }

  private spawn(world: World, roam: Rect, occupied: Cell[], self?: Animal): Cell | null {
    for (let i = 0; i < this.spawns.length; i++) {
      const c = this.spawns[this.spawnIndex++ % this.spawns.length];
      if (this.free(c, roam, occupied, self) && isStandable(world, c)) return c;
    }
    return null;
  }

  private nearest(world: World, roam: Rect, occupied: Cell[], x: number, y: number, z: number, self?: Animal): Cell | null {
    const cx = Math.max(roam.x0, Math.min(roam.x1, Math.floor(x)));
    const cz = Math.max(roam.z0, Math.min(roam.z1, Math.floor(z)));
    const radius = Math.max(cx - roam.x0, roam.x1 - cx, cz - roam.z0, roam.z1 - cz);
    // Prefer the existing ground level before looking on other surfaces.
    for (let level = 0; level <= world.sizeY; level++) {
      const cy = level === 0 ? Math.floor(y) : level;
      if (level !== 0 && cy === Math.floor(y)) continue;
      for (let r = 0; r <= radius; r++) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const c: Cell = [cx + dx, cy, cz + dz];
          if (self && c[0] === Math.floor(self.x) && c[1] === self.y && c[2] === Math.floor(self.z)) continue;
          if (this.free(c, roam, occupied, self) && isStandable(world, c)) return c;
        }
      }
    }
    return null;
  }

  restore(saved: SavedAnimalTuple[], spawns: Cell[], world: World, roam: Rect, elapsedSeconds: number): void {
    this.reset(spawns);
    const counts: Record<AnimalKind, number> = { chicken: 0, cow: 0, sheep: 0, pig: 0 };
    const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
    const placement = (): Cell => this.spawn(world, roam, [])
      ?? this.nearest(world, roam, [], roam.x0, spawns[0]?.[1] ?? 1, roam.z0)
      // Retain the full herd even when every surface has been filled in.
      ?? spawns[0] ?? [roam.x0, 1, roam.z0];
    for (const entry of saved) {
      if (!Array.isArray(entry) || entry.length !== 6 || !entry.every(n => typeof n === 'number' && Number.isFinite(n))) continue;
      const [k, x, y, z, giftIn, variant] = entry;
      if (!Number.isInteger(k) || k < 0 || k > 3 || giftIn < 0 || !Number.isInteger(variant) || variant < 0) continue;
      const kind = KINDS[k];
      if (counts[kind] >= DEFAULT_HERD[kind]) continue;
      const cell: Cell = [Math.floor(x), y, Math.floor(z)];
      const keep = this.free(cell, roam, []) && isStandable(world, cell);
      const a = this.create(kind, keep ? cell : placement(), variant);
      if (keep) { a.x = x; a.z = z; }
      a.giftIn = Math.max(0, giftIn - elapsed);
      counts[kind]++;
    }
    for (const kind of KINDS) {
      while (counts[kind] < DEFAULT_HERD[kind]) this.create(kind, placement(), counts[kind]++ % 2);
    }
  }

  private calm(a: Animal): void {
    a.state = this.rng() < 0.5 ? 'idle' : 'graze';
    a.stateT = a.state === 'idle' ? 1 + this.rng() * 3 : 2 + this.rng() * 2;
    a.tx = NaN;
    a.waypoint = null;
  }

  private happy(a: Animal): void {
    a.state = 'happy';
    a.stateT = 1.2;
    a.tx = NaN;
    a.waypoint = null;
    this.happySounds.push(a);
  }

  feed(id: number, held: StackId | 'hand', fits?: (gift: ItemId) => boolean):
    { result: 'gift'; gift: ItemId; usedFood: ItemId } | { result: 'resting' } | { result: 'notFood' } | { result: 'full' } {
    const a = this.animals.find(a => a.id === id);
    if (!a || !food(held)) return { result: 'notFood' };
    if (a.giftIn > 0) { this.happy(a); return { result: 'resting' }; }
    const gift = GIFT[a.kind];
    if (fits && !fits(gift)) return { result: 'full' };
    a.giftIn = GIFT_REST_SECONDS;
    this.happy(a);
    return { result: 'gift', gift, usedFood: held };
  }

  pet(id: number): void {
    const a = this.animals.find(a => a.id === id);
    if (a) this.happy(a);
  }

  private wanderTarget(a: Animal, ctx: HerdContext, allowed: (c: Cell) => boolean): boolean {
    for (let i = 0; i < 16; i++) {
      const angle = this.rng() * Math.PI * 2;
      const distance = 2 + this.rng() * 3;
      const x = Math.floor(a.x + Math.cos(angle) * distance);
      const z = Math.floor(a.z + Math.sin(angle) * distance);
      const d = Math.hypot(x + 0.5 - a.x, z + 0.5 - a.z);
      if (d < 2 || d > 5) continue;
      for (const dy of HEIGHTS) {
        this.to[0] = x; this.to[1] = a.y + dy; this.to[2] = z;
        if (!allowed(this.to) || !isStandable(ctx.world, this.to)) continue;
        a.tx = x + 0.5; a.tz = z + 0.5;
        return true;
      }
    }
    return false;
  }

  private comeTarget(a: Animal, ctx: HerdContext, allowed: (c: Cell) => boolean): boolean {
    let best = Infinity;
    const px = Math.floor(ctx.player.x), pz = Math.floor(ctx.player.z);
    for (let z = pz - 3; z <= pz + 3; z++) for (let x = px - 3; x <= px + 3; x++) {
      const d = Math.hypot(x + 0.5 - ctx.player.x, z + 0.5 - ctx.player.z);
      if (d < 1.5 || d > 2.8) continue;
      if (this.animals.some(o => o !== a && o.state === 'come' && o.tx === x + 0.5 && o.tz === z + 0.5)) continue;
      for (const dy of HEIGHTS) {
        this.to[0] = x; this.to[1] = a.y + dy; this.to[2] = z;
        if (!allowed(this.to) || !isStandable(ctx.world, this.to)) continue;
        const angle = Math.atan2(z + 0.5 - ctx.player.z, x + 0.5 - ctx.player.x);
        const score = Math.hypot(x + 0.5 - a.x, z + 0.5 - a.z) + 0.1 * (1 - Math.cos(angle - a.id * 2.4));
        if (score < best) { best = score; a.tx = x + 0.5; a.tz = z + 0.5; }
        break;
      }
    }
    return best < Infinity;
  }

  // Check each crossed cell before committing the whole, constant-length move.
  private move(a: Animal, ctx: HerdContext, allowed: (c: Cell) => boolean, tx: number, tz: number, speed: number, come: boolean): 'moved' | 'arrived' | 'blocked' {
    const dx = tx - a.x, dz = tz - a.z;
    const distance = Math.hypot(dx, dz), step = speed * ctx.dt;
    if (distance < step || distance < 1e-8) return 'arrived';
    const nx = a.x + dx / distance * step, nz = a.z + dz / distance * step;
    const samples = Math.max(1, Math.ceil(step / 0.2));
    this.from[0] = Math.floor(a.x); this.from[1] = a.y; this.from[2] = Math.floor(a.z);
    for (let i = 1; i <= samples; i++) {
      const x = a.x + (nx - a.x) * i / samples, z = a.z + (nz - a.z) * i / samples;
      if (come) {
        const before = Math.hypot(a.x - ctx.player.x, a.z - ctx.player.z);
        if (Math.hypot(x - ctx.player.x, z - ctx.player.z) < Math.min(1.2, before)) return 'blocked';
      }
      this.to[0] = Math.floor(x); this.to[2] = Math.floor(z);
      if (this.to[0] === this.from[0] && this.to[2] === this.from[2]) continue;
      let valid = false;
      for (const dy of HEIGHTS) {
        this.to[1] = this.from[1] + dy;
        if (canStep(ctx.world, this.from, this.to, allowed)) { valid = true; break; }
      }
      if (!valid) return 'blocked';
      this.from[0] = this.to[0]; this.from[1] = this.to[1]; this.from[2] = this.to[2];
    }
    a.x = nx; a.y = this.from[1]; a.z = nz;
    a.heading = Math.atan2(dx, dz);
    a.stuckFor = 0;
    return 'moved';
  }

  private neighbour(a: Animal, ctx: HerdContext, allowed: (c: Cell) => boolean): Cell | null {
    this.from[0] = Math.floor(a.x); this.from[1] = a.y; this.from[2] = Math.floor(a.z);
    let best: Cell | null = null, score = Infinity;
    for (const [dx, dz] of NEIGHBOURS) for (const dy of HEIGHTS) {
      this.to[0] = this.from[0] + dx; this.to[1] = a.y + dy; this.to[2] = this.from[2] + dz;
      if (a.state === 'come' && Math.hypot(this.to[0] + 0.5 - ctx.player.x, this.to[2] + 0.5 - ctx.player.z) < 1.5) continue;
      if (!canStep(ctx.world, this.from, this.to, allowed)) continue;
      const d = Number.isFinite(a.tx) ? Math.hypot(this.to[0] + 0.5 - a.tx, this.to[2] + 0.5 - a.tz) : 0;
      if (d < score) { best = [...this.to]; score = d; }
      break;
    }
    return best;
  }

  private blocked(a: Animal, ctx: HerdContext, allowed: (c: Cell) => boolean): void {
    const next = this.neighbour(a, ctx, allowed);
    if (next) { a.stuckFor = 0; a.waypoint = next; }
    else a.stuckFor += ctx.dt;
  }

  update(rawCtx: HerdContext): HerdEvent[] {
    // Time only ever goes forward and in small steps: a bad, negative or huge dt never moves anyone far.
    const ctx: HerdContext = Number.isFinite(rawCtx.dt) && rawCtx.dt > 0 && rawCtx.dt <= MAX_DT
      ? rawCtx : { ...rawCtx, dt: Number.isFinite(rawCtx.dt) && rawCtx.dt > 0 ? MAX_DT : 0 };
    const events: HerdEvent[] = [];
    const distance = (a: Animal): number => Math.hypot(a.x - ctx.player.x, a.z - ctx.player.z);
    for (const a of this.happySounds) events.push({ type: 'noise', id: a.id, kind: a.kind, dist: distance(a), reason: 'happy' });
    this.happySounds.length = 0;
    this.quietFor = Math.max(0, this.quietFor - ctx.dt);
    const r = ctx.roam, p = ctx.player;
    const nearRoam = Math.hypot(Math.max(r.x0 - p.x, 0, p.x - (r.x1 + 1)), Math.max(r.z0 - p.z, 0, p.z - (r.z1 + 1))) <= 2;
    const calling = food(ctx.held) && nearRoam;
    let current: Animal;
    const allowed = (c: Cell): boolean => this.free(c, r, ctx.occupied, current);
    for (const a of this.animals) {
      current = a;
      a.giftIn = Math.max(0, a.giftIn - ctx.dt);
      a.noiseIn -= ctx.dt;
      const d = distance(a);
      if (a.noiseIn <= 0) {
        if (d <= 12 && this.quietFor <= 0) {
          events.push({ type: 'noise', id: a.id, kind: a.kind, dist: d, reason: 'idle' });
          this.quietFor = 3;
        }
        a.noiseIn = 12 + this.rng() * 18;
      }
      a.stateT = Math.max(0, a.stateT - ctx.dt);
      this.from[0] = Math.floor(a.x); this.from[1] = a.y; this.from[2] = Math.floor(a.z);
      if (!inside(r, this.from[0], this.from[2]) || !isStandable(ctx.world, this.from)) {
        a.stuckFor += ctx.dt;
      } else if (a.stuckFor > 0 && !this.neighbour(a, ctx, allowed)) {
        a.stuckFor += ctx.dt;
      } else if (a.state === 'happy' && a.stateT > 0) {
        continue;
      } else {
        if (a.state === 'happy') { a.state = 'idle'; a.stateT = 1 + this.rng() * 3; }
        if (d < 1) {
          a.state = 'walk'; a.waypoint = null;
          const ux = d > 1e-8 ? (a.x - p.x) / d : Math.cos(a.id * 2.4);
          const uz = d > 1e-8 ? (a.z - p.z) / d : Math.sin(a.id * 2.4);
          a.tx = a.x + ux * 2; a.tz = a.z + uz * 2;
          if (this.move(a, ctx, allowed, a.tx, a.tz, 1, false) === 'blocked') this.blocked(a, ctx, allowed);
        } else {
          const come = calling && d <= 10;
          if (come && a.state !== 'come') { a.state = 'come'; a.tx = NaN; a.waypoint = null; }
          if (!come && a.state === 'come') this.calm(a);
          if (a.state === 'come') {
            if (Number.isFinite(a.tx)) {
              const td = Math.hypot(a.tx - p.x, a.tz - p.z);
              this.to[0] = Math.floor(a.tx); this.to[1] = a.y; this.to[2] = Math.floor(a.tz);
              if (td < 1.5 || td > 2.8 || !allowed(this.to)) { a.tx = NaN; a.waypoint = null; }
            }
            if (!Number.isFinite(a.tx)) this.comeTarget(a, ctx, allowed);
          } else if (a.state !== 'walk' && a.stateT === 0) {
            a.state = 'walk'; a.tx = NaN;
          }
          if (a.state === 'walk' && !Number.isFinite(a.tx)) this.wanderTarget(a, ctx, allowed);
          if (a.state === 'walk' || a.state === 'come') {
            if (!Number.isFinite(a.tx)) this.blocked(a, ctx, allowed);
            else {
              const tx = a.waypoint ? a.waypoint[0] + 0.5 : a.tx;
              const tz = a.waypoint ? a.waypoint[2] + 0.5 : a.tz;
              const result = this.move(a, ctx, allowed, tx, tz, come ? 1.6 : SPEED[a.kind], come);
              if (result === 'arrived') {
                if (a.waypoint) a.waypoint = null;
                else if (!come) this.calm(a);
                else a.heading = Math.atan2(p.x - a.x, p.z - a.z);
                a.stuckFor = 0;
              } else if (result === 'blocked') {
                this.blocked(a, ctx, allowed);
                if (!come) { a.tx = NaN; a.waypoint = null; }
                else if (!a.waypoint) a.tx = NaN;
              }
            }
          }
        }
      }
      if (a.stuckFor >= 6) {
        const c = this.nearest(ctx.world, r, ctx.occupied, a.x, a.y, a.z, a)
          ?? this.spawn(ctx.world, r, ctx.occupied, a);
        if (c) { a.x = c[0] + 0.5; a.y = c[1]; a.z = c[2] + 0.5; a.stuckFor = 0; this.calm(a); }
      }
    }
    return events;
  }

  occupiedCells(): Cell[] {
    const cells: Cell[] = [];
    for (const a of this.animals) {
      cells.push([Math.floor(a.x), a.y, Math.floor(a.z)], [Math.floor(a.x), a.y + 1, Math.floor(a.z)]);
    }
    return cells;
  }

  toJSON(): SavedAnimalTuple[] {
    return this.animals.map(a => [KINDS.indexOf(a.kind), Math.round(a.x * 100) / 100, a.y, Math.round(a.z * 100) / 100, Math.ceil(a.giftIn), a.variant]);
  }
}

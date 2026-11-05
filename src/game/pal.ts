import type { LineKey } from '../content/lines';
import { BLOCKS } from '../core/blocks';
import { findPath, isStandable, type Cell } from '../core/pathfind';
import type { World } from '../core/world';
import type { GameEvent } from './game';
import type { Player } from './player';

const SPEED = 4.5;
const REPATH_DIST = 3;
const TELEPORT_DIST = 10;
const STUCK_SECONDS = 3;
const MIN_GAP_MS = 4000;

type Vec = { x: number; y: number; z: number };

/**
 * Pip, the player's fox companion. Pure logic (no three.js) so it runs in Node tests.
 * The clock `now` returns milliseconds and is injectable for tests.
 */
export class Pal {
  pos: Vec;
  /** Radians from +z towards +x, like Player.heading. */
  heading = 0;
  private path: Cell[] = [];
  private waypoint = 0;
  private stuckFor = 0;
  private repathCooldown = 0;
  private lastSpoke = -Infinity;
  private collectCount = 0;
  private hop = false;
  private hasWood: () => boolean = () => true;

  constructor(
    start: Vec,
    private readonly say: (key: LineKey) => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.pos = { ...start };
  }

  /** Lets Pip know whether the player holds any wood (for the idle hint). */
  setHasWood(fn: () => boolean): void {
    this.hasWood = fn;
  }

  feetCell(): Cell {
    return [Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)];
  }

  /** True once after a 'crafted' event; the renderer plays a happy hop. */
  takeHop(): boolean {
    const h = this.hop;
    this.hop = false;
    return h;
  }

  greet(hadSave: boolean): void {
    this.speak(hadSave ? 'welcomeBack' : 'hello', true);
  }

  /** The gentle break suggestion; never held back by the chatter gap. */
  remindBreak(): void {
    this.speak('breakTime', true);
  }

  handle(e: GameEvent): void {
    switch (e.type) {
      case 'collected':
        this.collectCount++;
        if (this.collectCount === 1) this.speak('collectedFirst');
        else if (this.collectCount % 5 === 0) this.speak('collectedMore');
        return;
      case 'crafted':
        this.hop = true;
        this.speak('crafted', true);
        return;
      case 'full':
        this.speak('full');
        return;
      case 'lifted':
        this.speak('upYouCome', true);
        return;
      case 'noPath':
        this.speak('noPath');
        return;
      case 'idle':
        this.speak(this.hasWood() ? 'idleHint' : 'letsFindWood');
        return;
      default:
    }
  }

  private speak(key: LineKey, always = false): void {
    const t = this.now();
    if (!always && t - this.lastSpoke < MIN_GAP_MS) return;
    this.lastSpoke = t;
    this.say(key);
  }

  update(world: World, player: Player, dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.repathCooldown = Math.max(0, this.repathCooldown - dt);
    const dist = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    const playerCell = player.feetCell();
    const here = this.feetCell();
    const inPlayer = here[0] === playerCell[0] && here[2] === playerCell[2];
    const inSolid = BLOCKS[world.get(here[0], here[1], here[2])].solid
      || BLOCKS[world.get(here[0], here[1] + 1, here[2])].solid;

    if (dist > TELEPORT_DIST || inPlayer || inSolid || Math.abs(player.pos.y - this.pos.y) > 4) {
      this.teleport(world, player);
      return;
    }

    if (dist <= REPATH_DIST) {
      this.stuckFor = 0;
      if (dist <= 2.2) this.path = [];
      this.follow(world, player, dt);
      return;
    }

    if (!this.pathLeadsNear(player) && this.repathCooldown <= 0) this.repath(world, player);
    const before = { ...this.pos };
    this.follow(world, player, dt);
    // Stuck means "trying to follow but not moving", not merely "far away".
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    if (moved > SPEED * dt * 0.2) this.stuckFor = 0;
    else this.stuckFor += dt;
    if (this.stuckFor >= STUCK_SECONDS) this.teleport(world, player);
  }

  private pathLeadsNear(player: Player): boolean {
    const end = this.path[this.path.length - 1];
    if (!end || this.waypoint >= this.path.length) return false;
    return Math.hypot(end[0] + 0.5 - player.pos.x, end[2] + 0.5 - player.pos.z) <= REPATH_DIST - 0.5;
  }

  /** Standable cells around the player (never the player's own column), best first: behind, then close to `from`. */
  private spots(world: World, player: Player, radii: number[], from: Vec): Cell[] {
    const [px, py, pz] = player.feetCell();
    const bx = -Math.sin(player.heading);
    const bz = -Math.cos(player.heading);
    const out: Array<{ cell: Cell; score: number }> = [];
    for (const r of radii) {
      for (let ox = -r; ox <= r; ox++) {
        for (let oz = -r; oz <= r; oz++) {
          if (Math.max(Math.abs(ox), Math.abs(oz)) !== r) continue;
          const x = px + ox;
          const z = pz + oz;
          if (!world.inBounds(x, 0, z)) continue;
          for (const y of [py, py - 1, py + 1]) {
            const cell: Cell = [x, y, z];
            if (!isStandable(world, cell)) continue;
            const behind = (ox * bx + oz * bz) / Math.hypot(ox, oz);
            const far = Math.hypot(x + 0.5 - from.x, z + 0.5 - from.z);
            out.push({ cell, score: -behind * 2 + far * 0.1 + Math.abs(y - py) });
            break;
          }
        }
      }
    }
    return out.sort((a, b) => a.score - b.score).map(o => o.cell);
  }

  private repath(world: World, player: Player): void {
    this.path = [];
    this.waypoint = 0;
    this.repathCooldown = 1;
    const from = this.feetCell();
    for (const goal of this.spots(world, player, [2, 1], this.pos).slice(0, 6)) {
      const p = findPath(world, from, goal, 1500);
      if (p) {
        this.path = p;
        return;
      }
    }
    this.speak('noPath');
  }

  private follow(world: World, player: Player, dt: number): void {
    let remaining = SPEED * dt;
    while (remaining > 1e-6 && this.waypoint < this.path.length) {
      const [cx, cy, cz] = this.path[this.waypoint];
      if (!isStandable(world, [cx, cy, cz])) {
        // The world changed under the cached path (e.g. a block was placed).
        this.repath(world, player);
        return;
      }
      // Step up first (the column above is clear); step down on entering the lower cell.
      if (cy > this.pos.y) this.pos.y = cy;
      const tx = cx + 0.5;
      const tz = cz + 0.5;
      const dx = tx - this.pos.x;
      const dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) this.heading = Math.atan2(dx, dz);
      if (d <= remaining) {
        this.pos = { x: tx, y: cy, z: tz };
        remaining -= d;
        this.waypoint++;
      } else {
        this.pos.x += (dx / d) * remaining;
        this.pos.z += (dz / d) * remaining;
        if (Math.floor(this.pos.x) === cx && Math.floor(this.pos.z) === cz) this.pos.y = cy;
        remaining = 0;
      }
    }
    if (this.waypoint >= this.path.length) this.path = [];
  }

  private teleport(world: World, player: Player): void {
    const spot = this.spots(world, player, [1, 2, 3], player.pos)[0];
    this.path = [];
    this.waypoint = 0;
    this.stuckFor = 0;
    if (!spot) return;
    this.pos = { x: spot[0] + 0.5, y: spot[1], z: spot[2] + 0.5 };
    this.heading = player.heading;
  }
}

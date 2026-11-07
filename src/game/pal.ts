import type { LineKey } from '../content/lines';
import { insideWall } from '../core/bounds';
import { canStep, findPath, isStandable, smoothPath, type Cell } from '../core/pathfind';
import type { World } from '../core/world';
import type { GameEvent } from './game';
import { easeHeading, type Player } from './player';

const STEP_DYS = [0, 1, -1];
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
  private placeCount = 0;
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
      case 'placed':
        this.placeCount++;
        if (this.placeCount === 1 || this.placeCount % 5 === 0) this.speak('placed');
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
    const unsupported = !isStandable(world, here);

    if (dist > TELEPORT_DIST || inPlayer || unsupported || Math.abs(player.pos.y - this.pos.y) > 4) {
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
          if (!this.insideWall(world, [x, 0, z])) continue;
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
      const p = findPath(world, from, goal, 1500, this.allowed(world));
      if (p) {
        this.path = smoothPath(world, p, from, this.allowed(world));
        return;
      }
    }
    // No line here: 'noPath' is for the player's own taps; the stuck teleport fixes Pip.
  }

  private follow(world: World, player: Player, dt: number): void {
    let remaining = SPEED * dt;
    while (remaining > 1e-6 && this.waypoint < this.path.length) {
      const [cx, cy, cz] = this.path[this.waypoint];
      if (!isStandable(world, [cx, cy, cz])) {
        // The world changed under the cached path (e.g. a block was placed).
        this.repathGated(world, player);
        return;
      }
      const dx = cx + 0.5 - this.pos.x;
      const dz = cz + 0.5 - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-8) {
        this.waypoint++;
        continue;
      }
      const step = Math.min(0.2, remaining, d);
      const x = this.pos.x + dx / d * step;
      const z = this.pos.z + dz / d * step;
      const from = this.feetCell();
      const nx = Math.floor(x);
      const nz = Math.floor(z);
      const destination = nx === from[0] && nz === from[2] ? from
        : this.findDestination(world, from, nx, nz);
      if (!destination || !this.insideWall(world, destination) || !isStandable(world, destination)) {
        this.repathGated(world, player);
        return;
      }
      this.heading = easeHeading(this.heading, Math.atan2(dx, dz), 10 * step / SPEED);
      this.pos = { x, y: destination[1], z };
      remaining -= step;
      if (step === d) {
        this.pos.x = cx + 0.5;
        this.pos.z = cz + 0.5;
        this.waypoint++;
      }
    }
    if (this.waypoint >= this.path.length) this.path = [];
  }

  /** A blocked Pip repaths at most once per cooldown; otherwise he waits (the stuck teleport is the backstop). */
  private repathGated(world: World, player: Player): void {
    if (this.repathCooldown <= 0) this.repath(world, player);
    else {
      this.path = [];
      this.waypoint = 0;
    }
  }

  private findDestination(world: World, from: Cell, nx: number, nz: number): Cell | undefined {
    const allowed = this.allowed(world);
    for (const dy of STEP_DYS) {
      const to = this.scratch;
      to[0] = nx; to[1] = from[1] + dy; to[2] = nz;
      if (canStep(world, from, to, allowed)) return [nx, to[1], nz];
    }
    return undefined;
  }

  private allowedWorld: World | null = null;
  private allowedFn: (cell: Cell) => boolean = () => true;
  private scratch: Cell = [0, 0, 0];

  private allowed(world: World): (cell: Cell) => boolean {
    if (this.allowedWorld !== world) {
      this.allowedWorld = world;
      this.allowedFn = cell => this.insideWall(world, cell);
    }
    return this.allowedFn;
  }

  private insideWall(world: World, [x, , z]: Cell): boolean {
    return insideWall(world, x, z);
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

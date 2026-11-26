import type { Rect } from '../core/houses';
import { DEFAULT_STATS, type SavedGrumps } from '../core/grumpSave';
import { WEAPONS } from '../core/items';
import type { Cell } from '../core/pathfind';
import type { World } from '../core/world';
import type { Game } from './game';
import {
  GrumpSpawner, GrumpSystem, NEAR_FARM, type FriendEvent, type Grump, type GrumpEvent, type PlayerPos,
} from './grumps';

/** What the play loop needs to know each frame. */
export interface PlayEnv {
  player: PlayerPos;
  /** Cells other bodies stand in (him, Pip, villagers, animals, the wizard). */
  occupied: Cell[];
  /** Every planted crop and tree base cell on the farm. */
  plantCells: Cell[];
  /** A menu or the break bubble is open. */
  overlayOpen: boolean;
  paused: boolean;
  /** He is deep underground: grumps never come then. */
  deep: boolean;
}

export interface PlayResult { grumps: GrumpEvent[]; friends: FriendEvent[]; spawned: Grump | null }

/**
 * Brings the grump parts together for one place: the system, the spawner and the friends' jobs, with
 * the rules that decide when they run. Time stands still (dt 0) while any menu is open or the game is
 * paused, so nothing arrives, moves, helps or counts down behind a menu. No drawing or sound here.
 */
export class GrumpPlay {
  readonly system: GrumpSystem;
  readonly spawner: GrumpSpawner;
  private readonly game: Game;
  private readonly world: World;
  private readonly zone: Rect;
  private readonly border: Cell[];
  private readonly level: number;

  constructor(o: {
    game: Game; world: World; zone: Rect; avoid: Set<string>; border: Cell[]; rng: () => number;
    /** The farm's feet level: nothing is ever lifted or restored off it by more than one block. */
    level: number;
    saved?: SavedGrumps;
  }) {
    this.game = o.game; this.world = o.world; this.zone = o.zone; this.border = o.border; this.level = o.level;
    this.system = new GrumpSystem(o.rng, o.zone, o.avoid, o.level);
    const stats = o.saved?.stats ?? DEFAULT_STATS;
    if (o.saved) this.system.restore(o.saved, o.world, []);
    this.spawner = new GrumpSpawner(o.rng, { timer: stats[1], interval: stats[2], first: stats[3] === 0 });
    o.game.grumps = this.system;
    o.game.cheered = stats[0];
  }

  /** He is within 16 blocks of the zone, on the surface (never deep underground or far above or below it). */
  nearFarm(p: PlayerPos, deep: boolean): boolean {
    if (deep || Math.abs(p.y - this.level) > 6) return false;
    const dx = Math.max(this.zone.x0 - p.x, 0, p.x - (this.zone.x1 + 1));
    const dz = Math.max(this.zone.z0 - p.z, 0, p.z - (this.zone.z1 + 1));
    return Math.hypot(dx, dz) <= NEAR_FARM;
  }

  update(rawDt: number, env: PlayEnv): PlayResult {
    const out: PlayResult = { grumps: [], friends: [], spawned: null };
    const dt = env.paused || env.overlayOpen || !(rawDt > 0) ? 0 : rawDt;
    if (dt === 0) return out;
    const ctx = { world: this.world, player: env.player, occupied: env.occupied, plantCells: env.plantCells, dt };
    out.grumps = this.system.update(ctx);
    out.friends = this.system.updateFriends({ ...ctx, farm: this.game.farm });
    const planted = env.plantCells.filter(c => c[0] >= this.zone.x0 && c[0] <= this.zone.x1 && c[2] >= this.zone.z0 && c[2] <= this.zone.z1).length;
    const spawn = this.spawner.update({
      dt, nearFarm: this.nearFarm(env.player, env.deep), plantedCrops: planted, count: this.system.grumps.length,
      hasWeapon: WEAPONS.some(id => this.game.inventory.count(id) > 0), overlayOpen: env.overlayOpen, paused: env.paused,
      player: env.player, borderCells: this.border, occupied: [...env.occupied, ...this.system.occupiedCells()],
    });
    if (spawn) {
      out.spawned = this.system.spawn(spawn.cell, spawn.kind);
      this.game.grumpRevision++;
    }
    return out;
  }

  /** What the save keeps: positions, moods, friends and the spawner's numbers (never counted down offline). */
  saved(): SavedGrumps {
    const s = this.spawner.state();
    const { grumps, friends } = this.system.toJSON();
    return { grumps, friends, stats: [this.game.cheered, Math.round(s.timer), Math.round(s.interval), s.first ? 0 : 1] };
  }
}

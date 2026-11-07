import { VILLAGERS, type VillagerId } from '../content/villagers';
import type { HouseInfo } from '../core/houses';
import type { Cell } from '../core/pathfind';

/** A villager says hello at most once a minute. */
export const GREET_COOLDOWN_MS = 60_000;
/** Two neighbours never greet back to back: at least this long between any two hellos. */
export const GREET_GAP_MS = 8_000;
/** Walking away cancels a hello only while it can still be speaking. */
export const GREET_SPEAK_MS = 8_000;

/**
 * Decides when a neighbour says hello. Pure: no audio, no DOM. The caller passes `busy` (a voice
 * line is playing, an overlay is open, he is holding or dragging) and speaks what it returns.
 * Neighbours are not solid and never move; this only reads where he stands.
 */
export class GreetTracker {
  private readonly lastGreeted = new Map<VillagerId, number>();
  /** Villagers whose zone he is still standing in after being greeted (or after waiting). */
  private readonly visited = new Set<VillagerId>();
  private lastAny = -Infinity;
  private active: { id: VillagerId; at: number } | null = null;
  private cancel = false;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Call every frame. Returns the villager to greet, or null. */
  update(playerCell: Cell, houses: HouseInfo[], busy: boolean): VillagerId | null {
    const t = this.now();
    const inZone = (house: HouseInfo): boolean => {
      const r = house.greetRect;
      return playerCell[0] >= r.x0 && playerCell[0] <= r.x1 && playerCell[2] >= r.z0 && playerCell[2] <= r.z1
        && Math.abs(playerCell[1] - house.groundY) <= 8;
    };

    // Walked away from the one who is still talking: stop that line.
    if (this.active) {
      const house = houses.find(h => h.id === VILLAGERS.find(v => v.id === this.active!.id)!.house);
      if (t - this.active.at >= GREET_SPEAK_MS) this.active = null;
      else if (!house || !inZone(house)) {
        this.cancel = true;
        this.active = null;
      }
    }

    let chosen: VillagerId | null = null;
    for (const v of VILLAGERS) {
      const house = houses.find(h => h.id === v.house);
      if (!house) continue;
      if (!inZone(house)) { this.visited.delete(v.id); continue; }
      if (chosen || busy || this.visited.has(v.id)) continue;
      if (t - this.lastAny < GREET_GAP_MS) continue;
      if (t - (this.lastGreeted.get(v.id) ?? -Infinity) < GREET_COOLDOWN_MS) { this.visited.add(v.id); continue; }
      chosen = v.id;
    }
    if (chosen) {
      this.visited.add(chosen);
      this.lastGreeted.set(chosen, t);
      this.lastAny = t;
      this.active = { id: chosen, at: t };
    }
    return chosen;
  }

  /** True once after he walked away from a hello that was still being spoken. */
  takeCancel(): boolean {
    const c = this.cancel;
    this.cancel = false;
    return c;
  }
}

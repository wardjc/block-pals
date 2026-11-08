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

  private zonesFor: HouseInfo[] | null = null;
  private zones: Array<{ id: VillagerId; house: HouseInfo }> = [];

  private static inZone(house: HouseInfo, c: Cell): boolean {
    const r = house.greetRect;
    return c[0] >= r.x0 && c[0] <= r.x1 && c[2] >= r.z0 && c[2] <= r.z1 && Math.abs(c[1] - house.groundY) <= 8;
  }

  /** Call every frame. Returns the villager to greet, or null. No allocation after the first call per house list. */
  update(playerCell: Cell, houses: HouseInfo[], busy: boolean): VillagerId | null {
    if (this.zonesFor !== houses) { // the house list is fixed for a world: look each villager's house up once
      this.zonesFor = houses;
      this.zones = [];
      for (const v of VILLAGERS) {
        const house = houses.find(h => h.id === v.house);
        if (house) this.zones.push({ id: v.id, house });
      }
    }
    const t = this.now();

    // Walked away from the one who is still talking: stop that line.
    if (this.active) {
      const activeId = this.active.id;
      if (t - this.active.at >= GREET_SPEAK_MS) this.active = null;
      else {
        let zone: HouseInfo | undefined;
        for (const z of this.zones) if (z.id === activeId) zone = z.house;
        if (!zone || !GreetTracker.inZone(zone, playerCell)) {
          this.cancel = true;
          this.active = null;
        }
      }
    }

    let chosen: VillagerId | null = null;
    for (const { id, house } of this.zones) {
      if (!GreetTracker.inZone(house, playerCell)) { this.visited.delete(id); continue; }
      if (chosen || busy || this.visited.has(id)) continue;
      if (t - this.lastAny < GREET_GAP_MS) continue;
      if (t - (this.lastGreeted.get(id) ?? -Infinity) < GREET_COOLDOWN_MS) { this.visited.add(id); continue; }
      chosen = id;
    }
    if (chosen) {
      this.visited.add(chosen);
      this.lastGreeted.set(chosen, t);
      this.lastAny = t;
      this.active = { id: chosen, at: t };
    }
    return chosen;
  }

  /**
   * Gives up on the hellos he is standing in the zone of right now (they were held too long): no
   * hello until he leaves and comes back, and the once-a-minute cooldown is NOT used up.
   */
  skipCurrent(playerCell: Cell, houses: HouseInfo[]): void {
    for (const v of VILLAGERS) {
      const house = houses.find(h => h.id === v.house);
      if (house && GreetTracker.inZone(house, playerCell)) this.visited.add(v.id);
    }
  }

  /** True once after he walked away from a hello that was still being spoken. */
  takeCancel(): boolean {
    const c = this.cancel;
    this.cancel = false;
    return c;
  }
}

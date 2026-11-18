import type { Rect } from '../core/houses';
import type { Cell } from '../core/pathfind';
import type { TowerInfo } from '../core/tower';
import { LeadToVillage } from './lead';

/** He counts as "near the tower path" within this many blocks of it. */
export const NEAR_ROUTE = 10;

/** The doorstep: the door front and a cell round it. Standing there (or on the hilltop pad) is arriving. */
export function doorstepRect(tower: Pick<TowerInfo, 'doorFront'>): Rect {
  const [x, , z] = tower.doorFront;
  return { x0: x - 1, z0: z - 1, x1: x + 2, z1: z + 1 };
}

export interface TowerOfferFacts {
  /** He holds at least one gem. */
  hasGem(): boolean;
  /** The walk to the village is finished (the first lead comes first, always). */
  ledToVillage(): boolean;
  /** The village lead is running right now (two leads never run together). */
  villageLeading(): boolean;
  villagePad: Rect;
}

const inRect = (r: Rect, c: Cell, pad = 0): boolean =>
  c[0] >= r.x0 - pad && c[0] <= r.x1 + pad && c[2] >= r.z0 - pad && c[2] <= r.z1 + pad;

/**
 * Pip offers the walk to the wizard only when: he has a gem, the village walk is done and not
 * running, and he is in the village or within 10 of the tower path.
 */
export function towerOffer(route: readonly Cell[], facts: TowerOfferFacts): (playerCell: Cell) => boolean {
  return cell => {
    if (!facts.hasGem() || !facts.ledToVillage() || facts.villageLeading()) return false;
    if (inRect(facts.villagePad, cell)) return true;
    for (const r of route) if (Math.hypot(r[0] - cell[0], r[2] - cell[2]) <= NEAR_ROUTE) return true;
    return false;
  };
}

/** The second lead: the same machine as the walk to the village, along the tower path, once per save. */
export function makeTowerLead(
  tower: Pick<TowerInfo, 'doorFront'>, route: Cell[], hilltop: Rect, led: boolean, facts: TowerOfferFacts,
): LeadToVillage {
  return new LeadToVillage(route, doorstepRect(tower), led, hilltop, towerOffer(route, facts));
}

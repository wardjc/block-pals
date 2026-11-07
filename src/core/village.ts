import type { Rect } from './houses';

export type { Rect };

export interface VillageLayout {
  stampedRects: Rect[];
}

export function emptyVillage(): VillageLayout {
  return { stampedRects: [] };
}

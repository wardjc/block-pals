/** Inclusive rectangle on the x/z plane. (Task 4 moves this to houses.ts.) */
export interface Rect { x0: number; z0: number; x1: number; z1: number }

export interface VillageLayout {
  stampedRects: Rect[];
}

export function emptyVillage(): VillageLayout {
  return { stampedRects: [] };
}

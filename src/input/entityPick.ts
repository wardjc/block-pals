export interface ScreenAnimal { id: number; sx: number; sy: number; sz: number }

/**
 * Which animal is under a screen point: a disc of `radius` px (112 px across, above the 88 px
 * minimum target) around each animal's projected centre. Nearest to the point wins; a tie goes to
 * the one closer to the camera (smaller depth `sz`). Pure.
 */
export function pickAnimal(screen: { x: number; y: number }, animals: ScreenAnimal[], radius = 56): number | null {
  let best: ScreenAnimal | null = null;
  let bestD = Infinity;
  for (const a of animals) {
    const d = Math.hypot(a.sx - screen.x, a.sy - screen.y);
    if (d > radius) continue;
    if (d < bestD || (d === bestD && best !== null && a.sz < best.sz)) { best = a; bestD = d; }
  }
  return best ? best.id : null;
}

export interface AnimalBox { id: number; min: [number, number, number]; max: [number, number, number] }
type V3 = { x: number; y: number; z: number };

/** Distance along a unit ray at which it enters an axis-aligned box (0 when it starts inside), or null. */
export function rayBoxDistance(o: V3, d: V3, min: [number, number, number], max: [number, number, number]): number | null {
  let t0 = 0;
  let t1 = Infinity;
  const oo = [o.x, o.y, o.z];
  const dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-12) {
      if (oo[i] < min[i] || oo[i] > max[i]) return null;
      continue;
    }
    let a = (min[i] - oo[i]) / dd[i];
    let b = (max[i] - oo[i]) / dd[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/**
 * The animal the pick ray reaches first, or null. Each box is padded (generous, so a small finger
 * on a small animal still counts). An animal behind a block the ray hits first (`blockT`, the
 * distance to that block) is hidden and never picked; the nearest of animal and block wins.
 */
export function pickAnimalAlongRay(o: V3, d: V3, boxes: readonly AnimalBox[], blockT: number | null, pad = 0.3): number | null {
  let best: number | null = null;
  let bestT = Infinity;
  for (const b of boxes) {
    const t = rayBoxDistance(
      o, d,
      [b.min[0] - pad, b.min[1] - pad, b.min[2] - pad],
      [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad],
    );
    if (t === null || (blockT !== null && t >= blockT) || t >= bestT) continue;
    best = b.id;
    bestT = t;
  }
  return best;
}

/** Anyone a tap can land on: the animals and the wizard, in one list. */
export type EntityType = 'animal' | 'wizard';
export interface ScreenEntity { type: EntityType; id: number; sx: number; sy: number; sz: number }
/** Disc radius per kind (CSS px): the wizard is bigger than any animal. */
export const PICK_RADIUS: Record<EntityType, number> = { animal: 56, wizard: 72 };

/**
 * Which entity is under a screen point: a disc round each one's projected middle, the radius by
 * kind (animals 56, the wizard 72). Nearest to the point wins; a tie goes to the one nearer the
 * camera. Pure.
 */
export function pickEntity(screen: { x: number; y: number }, entities: readonly ScreenEntity[]): { type: EntityType; id: number } | null {
  let best: ScreenEntity | null = null;
  let bestD = Infinity;
  for (const e of entities) {
    const d = Math.hypot(e.sx - screen.x, e.sy - screen.y);
    if (d > PICK_RADIUS[e.type]) continue;
    if (d < bestD || (d === bestD && best !== null && e.sz < best.sz)) { best = e; bestD = d; }
  }
  return best ? { type: best.type, id: best.id } : null;
}

export interface EntityBox extends AnimalBox { type: EntityType }

/**
 * The entity the pick ray reaches first (animals and the wizard in one list), or null. As
 * `pickAnimalAlongRay`: padded boxes, anything behind the first block hit is hidden, nearest wins.
 */
export function pickEntityAlongRay(o: V3, d: V3, boxes: readonly EntityBox[], blockT: number | null, pad = 0.3): { type: EntityType; id: number } | null {
  let best: EntityBox | null = null;
  let bestT = Infinity;
  for (const b of boxes) {
    const t = rayBoxDistance(
      o, d,
      [b.min[0] - pad, b.min[1] - pad, b.min[2] - pad],
      [b.max[0] + pad, b.max[1] + pad, b.max[2] + pad],
    );
    if (t === null || (blockT !== null && t >= blockT) || t >= bestT) continue;
    best = b;
    bestT = t;
  }
  return best ? { type: best.type, id: best.id } : null;
}

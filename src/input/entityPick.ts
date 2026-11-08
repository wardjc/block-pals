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

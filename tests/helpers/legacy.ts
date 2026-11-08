import { ORIGIN, V2_WORLD } from '../../src/core/bounds';
import { ShiftedWorld, shiftLayout } from '../../src/core/shifted';
import type { VillageLayout } from '../../src/core/village';
import { generateWorld, type GeneratedWorld } from '../../src/core/worldgen';

/**
 * The step 2 tests read the old meadow in its own coordinates. Since the bigger world (Task 4) the
 * meadow sits at +ORIGIN; this is the ONE place their coordinate source changes: the old region as a
 * 96 x 20 x 96 view of the real generated world, and the layout and spawn moved back by -ORIGIN.
 * Writes through `world` land in the real world (at +ORIGIN).
 */
export interface LegacyView {
  world: ShiftedWorld;
  spawn: { x: number; y: number; z: number };
  village: VillageLayout;
  /** The real generated world, in world coordinates. */
  generated: GeneratedWorld;
}

export function legacyView(generated: GeneratedWorld): LegacyView {
  const back = { x: -ORIGIN.x, y: -ORIGIN.y, z: -ORIGIN.z };
  const { world } = generated;
  return {
    world: new ShiftedWorld(world),
    spawn: { x: generated.spawn.x + back.x, y: generated.spawn.y + back.y, z: generated.spawn.z + back.z },
    village: shiftLayout(generated.village, { sizeX: V2_WORLD.x, sizeZ: V2_WORLD.z }, back, { x: world.sizeX, y: world.sizeY, z: world.sizeZ }),
    generated,
  };
}

/** generateWorld(seed) seen in the old meadow's coordinates. */
export function generateLegacy(seed = 2026): LegacyView {
  return legacyView(generateWorld(seed));
}

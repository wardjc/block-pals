import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rect } from '../../src/core/village';

const dir = join(__dirname, '../fixtures');

export interface WorldFixture {
  seed: number; sizeX: number; sizeY: number; sizeZ: number;
  spawn: { x: number; y: number; z: number };
  rle: Array<[number, number]>;
  layout: {
    houses: Array<{ id: string; rect: Rect; doorFront: [number, number, number]; doorInside: [number, number, number] }>;
    square: Rect; farmPlot: Rect; pasture: Rect; quarry: Rect; pad: Rect;
  };
  /** Gen 3 only: the wizard's tower (meadow coordinates). */
  tower?: {
    pad: Rect; rect: Rect; groundY: number; doorFront: Cell3; doorInside: Cell3; wizardSpot: Cell3; topLamp: Cell3;
    beacon: { x: number; y: number; z: number }; route: Cell3[]; stampedRects: Rect[];
  };
}

type Cell3 = [number, number, number];

/**
 * The frozen 96 x 20 x 96 world (seed 2026). Gen 3 (main with the wizard's tower, frozen from main
 * b6d77d7) is the old region the big world must contain; gen 2 (village step 2) is what the oldest
 * v2 saves were made on.
 */
export function loadWorldFixture(gen: 2 | 3 = 3): WorldFixture {
  return JSON.parse(readFileSync(join(dir, `village-world-gen${gen}-2026.json`), 'utf8')) as WorldFixture;
}

/** Cells in World.index order (x fastest, then z, then y). */
export function decodeRle(rle: Array<[number, number]>): Uint8Array {
  const total = rle.reduce((n, [, run]) => n + run, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const [id, run] of rle) { out.fill(id, i, i + run); i += run; }
  return out;
}

/** Raw text of a saved-game fixture (tests/fixtures/saves/<name>.json). */
export function saveFixtureRaw(name: 'v2-extremes' | 'v2-extremes-corner' | 'v1-extremes' | 'v2-gen3-tower'): string {
  return readFileSync(join(dir, 'saves', `${name}.json`), 'utf8');
}

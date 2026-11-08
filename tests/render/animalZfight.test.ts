import { describe, expect, it } from 'vitest';
import { ANIMAL_KINDS, animalParts } from '../../src/render/animals';

/** Two boxes of different colours with a face on the same plane, facing the same way, overlapping in area: they flicker. */
describe('animal models have no coplanar faces', () => {
  for (const kind of ANIMAL_KINDS) for (const variant of [0, 1]) {
    it(`${kind} ${variant}`, () => {
      const parts = animalParts(kind, variant);
      const bad: string[] = [];
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]; const b = parts[j];
        if (a[6] === b[6]) continue; // same colour: a flip is invisible
        for (let ax = 0; ax < 3; ax++) {
          const [u, v] = [0, 1, 2].filter(k => k !== ax);
          const lo = (p: readonly number[], k: number) => p[k] - p[3 + k] / 2;
          const hi = (p: readonly number[], k: number) => p[k] + p[3 + k] / 2;
          const area = Math.max(0, Math.min(hi(a, u), hi(b, u)) - Math.max(lo(a, u), lo(b, u)))
            * Math.max(0, Math.min(hi(a, v), hi(b, v)) - Math.max(lo(a, v), lo(b, v)));
          if (area <= 1e-5) continue;
          if (Math.abs(lo(a, ax) - lo(b, ax)) < 1e-4 || Math.abs(hi(a, ax) - hi(b, ax)) < 1e-4) bad.push(`box ${i} vs ${j} on axis ${'xyz'[ax]}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});

import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { parseSave } from '../../src/core/save';
import { decodeRle, loadWorldFixture, saveFixtureRaw } from '../helpers/fixtures';

describe('legacy fixtures (kept green forever: the old formats stay readable)', () => {
  test.each(['v2-extremes', 'v2-extremes-corner', 'v1-extremes', 'v2-gen3-tower'] as const)('%s parses with the save parser and keeps every edit', name => {
    const raw = JSON.parse(saveFixtureRaw(name)) as { edits: unknown[] };
    const data = parseSave(saveFixtureRaw(name));
    expect(data).not.toBeNull();
    expect(data!.edits).toHaveLength(raw.edits.length);
  });

  test.each([2, 3] as const)('the gen %i world fixture decodes to 96*96*20 cells', gen => {
    const f = loadWorldFixture(gen);
    expect([f.sizeX, f.sizeY, f.sizeZ]).toEqual([96, 20, 96]);
    expect(decodeRle(f.rle).length).toBe(96 * 96 * 20);
    expect(f.layout.houses.map(h => h.id)).toEqual(['cottage', 'bakery', 'shop', 'farmhouse', 'granny']);
  });

  test('the gen 3 fixture has the tower where the plan says (meadow coordinates)', () => {
    const t = loadWorldFixture(3).tower!;
    expect(t.rect).toEqual({ x0: 33, z0: 78, x1: 39, z1: 84 });
    expect(t.groundY).toBe(9);
    expect(t.topLamp[1]).toBe(19);
  });

  test('the gen 2 and gen 3 worlds differ only inside the tower\'s stamped rectangles or by a tree', () => {
    const g2 = decodeRle(loadWorldFixture(2).rle);
    const g3f = loadWorldFixture(3);
    const g3 = decodeRle(g3f.rle);
    const rects = g3f.tower!.stampedRects;
    let differ = 0;
    for (let i = 0; i < g2.length; i++) {
      if (g2[i] === g3[i]) continue;
      differ++;
      const x = i % 96, z = Math.floor(i / 96) % 96;
      if (rects.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1)) continue;
      // The stage 4 scatter shares one stream, so keeping trees off the tower moves later trees.
      const tree = [BlockId.Air, BlockId.Wood, BlockId.Leaves];
      expect(tree.includes(g2[i]) && tree.includes(g3[i]), `${x},${z}: ${g2[i]} -> ${g3[i]}`).toBe(true);
    }
    expect(differ).toBeGreaterThan(100);
  });
});

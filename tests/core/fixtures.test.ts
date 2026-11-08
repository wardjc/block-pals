import { describe, expect, test } from 'vitest';
import { parseSave } from '../../src/core/save';
import { decodeRle, loadWorldFixture, saveFixtureRaw } from '../helpers/fixtures';

describe('legacy fixtures (kept green forever: the old formats stay readable)', () => {
  test.each(['v2-extremes', 'v2-extremes-corner', 'v1-extremes'] as const)('%s parses with the save parser and keeps every edit', name => {
    const raw = JSON.parse(saveFixtureRaw(name)) as { edits: unknown[] };
    const data = parseSave(saveFixtureRaw(name));
    expect(data).not.toBeNull();
    expect(data!.edits).toHaveLength(raw.edits.length);
  });

  test('the world fixture decodes to 96*96*20 cells', () => {
    const f = loadWorldFixture();
    expect([f.sizeX, f.sizeY, f.sizeZ]).toEqual([96, 20, 96]);
    expect(decodeRle(f.rle).length).toBe(96 * 96 * 20);
    expect(f.layout.houses.map(h => h.id)).toEqual(['cottage', 'bakery', 'shop', 'farmhouse', 'granny']);
  });
});

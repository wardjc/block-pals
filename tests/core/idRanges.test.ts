import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { MYTHICAL } from '../../src/core/mythical';
import { ATLAS_ROWS } from '../../src/render/atlas';

/**
 * Guards for the caves chunks (bigger-world plan, reconciled with the wizard): the mythical blocks
 * own 40 to 47 with 48 to 55 kept for later ones; the caves blocks will be 56 to 64 (65 to 71
 * reserved); their atlas tiles go after the mythical rows (12 rows today); BlockDef.light already
 * exists on main and is reused, never duplicated.
 */
describe('block id ranges and the atlas, before the caves blocks are added', () => {
  const ids = Object.keys(BLOCKS).map(Number);

  test('the mythical blocks are 40 to 47, and 48 to 71 are free for later mythical and cave blocks', () => {
    expect([...MYTHICAL]).toEqual([40, 41, 42, 43, 44, 45, 46, 47]);
    for (let id = 48; id <= 71; id++) expect(ids, `id ${id}`).not.toContain(id);
    expect(Math.max(...ids)).toBe(BlockId.MagicMirror);
    expect(BlockId.MagicMirror).toBe(47);
  });

  test('the atlas has 12 rows (farm 10, mythical 2): cave tiles start at row 12', () => {
    expect(ATLAS_ROWS).toBe(12);
  });

  test('BlockDef.light exists and is set only on the lights the wizard step made (and the Lamp is not one of them)', () => {
    const lit = ids.filter(id => BLOCKS[id as BlockId].light === true);
    expect(lit.sort((a, b) => a - b)).toEqual([BlockId.StarlightCrystal, BlockId.MoonBlock, BlockId.SunBlock]);
  });
});

import { describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { MYTHICAL } from '../../src/core/mythical';
import { ATLAS_ROWS } from '../../src/render/atlas';

/**
 * Guards for the caves chunks (bigger-world plan, reconciled with the wizard): the mythical blocks
 * own 40 to 47 with 48 to 55 kept for later ones; the caves blocks are 56 to 64 (65 to 71
 * reserved); their atlas tiles go after the mythical rows (rows 12 and 13); BlockDef.light
 * existed on main and is reused, never duplicated.
 */
describe('block id ranges and the atlas, with the caves blocks added', () => {
  const ids = Object.keys(BLOCKS).map(Number);

  test('the mythical blocks are 40 to 47 with 48 to 55 free; the caves use 56 to 64 and 65 to 71 stay free', () => {
    expect([...MYTHICAL]).toEqual([40, 41, 42, 43, 44, 45, 46, 47]);
    for (let id = 48; id <= 55; id++) expect(ids, `id ${id}`).not.toContain(id);
    for (let id = 56; id <= 64; id++) expect(ids, `id ${id}`).toContain(id);
    for (let id = 65; id <= 71; id++) expect(ids, `id ${id}`).not.toContain(id);
    expect(Math.max(...ids)).toBe(BlockId.RuinCrystal);
    expect(BlockId.MagicMirror).toBe(47);
  });

  test('the atlas has 14 rows (farm 10, mythical 2, caves 2): the cave tiles start at row 12', () => {
    expect(ATLAS_ROWS).toBe(14);
  });

  test('BlockDef.light is set on the wizard\'s three lights and the five cave glow blocks (the Lamp is not one of them)', () => {
    const lit = ids.filter(id => BLOCKS[id as BlockId].light === true);
    expect(lit.sort((a, b) => a - b)).toEqual([
      BlockId.StarlightCrystal, BlockId.MoonBlock, BlockId.SunBlock,
      BlockId.GlowMushroom, BlockId.CrystalBlue, BlockId.CrystalPink, BlockId.CrystalGreen, BlockId.RuinCrystal,
    ]);
    expect(BLOCKS[BlockId.Lamp].light).toBeUndefined();
  });
});

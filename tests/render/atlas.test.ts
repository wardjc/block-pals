import { describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { ATLAS_COLS, ATLAS_ROWS, TILE_NAMES, tileFor } from '../../src/render/atlas';
import type { Face } from '../../src/render/mesher';

const FACES: Face[] = ['top', 'bottom', 'north', 'south', 'east', 'west'];
const NEW_IDS = [
  BlockId.Farmland, BlockId.Fence, BlockId.WoolWhite, BlockId.WoolRed, BlockId.WoolBlue, BlockId.WoolYellow,
  BlockId.Sapling, BlockId.AppleLeaves,
  BlockId.Wheat0, BlockId.Wheat1, BlockId.Wheat2, BlockId.Wheat3,
  BlockId.Carrot0, BlockId.Carrot1, BlockId.Carrot2, BlockId.Carrot3,
  BlockId.Potato0, BlockId.Potato1, BlockId.Potato2, BlockId.Potato3,
];

describe('atlas', () => {
  it('has a tile for every new block, and no two plant stages share one', () => {
    const plantTiles = new Set<string>();
    for (const id of NEW_IDS) {
      for (const face of FACES) {
        const tile = tileFor(id, face);
        expect(TILE_NAMES).toContain(tile);
        if (id !== BlockId.Farmland) expect(tile).not.toBe('dirt'); // none falls through to the default tile
      }
      if (BLOCKS[id].shape === 'cross') plantTiles.add(tileFor(id, 'south'));
    }
    expect(plantTiles.size).toBe(13);
  });

  it('tile rows fit: every tile sits inside the atlas and names are unique', () => {
    expect(ATLAS_ROWS).toBe(10);
    expect(TILE_NAMES.length).toBeLessThanOrEqual(ATLAS_COLS * ATLAS_ROWS);
    expect(new Set(TILE_NAMES).size).toBe(TILE_NAMES.length);
  });

  it('the old blocks keep their tiles', () => {
    expect(tileFor(BlockId.Grass, 'top')).toBe('grassTop');
    expect(tileFor(BlockId.Lamp, 'south')).toBe('lamp');
    expect(TILE_NAMES.indexOf('lamp')).toBe(16); // existing tile positions never move
    expect(TILE_NAMES.indexOf('grassTop')).toBe(0);
  });

  it('farmland has its own top, dirt underneath', () => {
    expect(tileFor(BlockId.Farmland, 'top')).toBe('farmTop');
    expect(tileFor(BlockId.Farmland, 'bottom')).toBe('dirt');
    expect(tileFor(BlockId.Farmland, 'east')).toBe('farmSide');
  });
});

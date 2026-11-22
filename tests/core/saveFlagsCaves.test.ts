// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { HINT_NAMES, LEGACY_SAVE_KEY, SAVE_KEY, V2_SAVE_KEY, parseSave, readSave, storeSave, type SaveData } from '../../src/core/save';
import { GEN_VERSION } from '../../src/core/worldgen';
import { addHint, digDownReady, hasHint } from '../../src/game/hints';

/** The caves' flags and once-hints in the save (plan Task 21): additive, optional, never lowered. */
const v3 = (patch: Partial<SaveData> = {}): SaveData => ({
  version: 3, gen: GEN_VERSION, origin: [48, 48, 48], seed: 2026, edits: [[100, 60, 100, BlockId.Planks]], inventory: {},
  player: { x: 72.5, y: 56, z: 72.5 }, flags: { ledToVillage: false }, ...patch,
});
const stored = (): SaveData => JSON.parse(localStorage.getItem(SAVE_KEY)!) as SaveData;

beforeEach(() => localStorage.clear());

describe('cave hint names', () => {
  test('digDown and gemFound are saved hint names; unknown names are still dropped', () => {
    expect(HINT_NAMES).toContain('digDown');
    expect(HINT_NAMES).toContain('gemFound');
    const data = parseSave(JSON.stringify(v3({ flags: { ledToVillage: true, hints: ['digDown', 'gemFound', 'plantSome', 'nonsense', 'digDown'] } })))!;
    expect(data.flags.hints).toEqual(['digDown', 'gemFound', 'plantSome']);
  });

  test('addHint adds once and keeps every other hint; hasHint reads it', () => {
    const flags: SaveData['flags'] = { ledToVillage: true, hints: ['plantSome'] };
    addHint(flags, 'gemFound');
    addHint(flags, 'gemFound');
    expect(flags.hints).toEqual(['plantSome', 'gemFound']);
    expect(hasHint(flags, 'gemFound')).toBe(true);
    expect(hasHint(flags, 'digDown')).toBe(false);
    const bare: SaveData['flags'] = { ledToVillage: false };
    addHint(bare, 'digDown');
    expect(bare.hints).toEqual(['digDown']);
  });

  test('digDown is the second idle hint only, once, after the village walk and before he has been deep', () => {
    expect(digDownReady({ ledToVillage: true }, 2)).toBe(true);
    expect(digDownReady({ ledToVillage: true }, 1)).toBe(false);
    expect(digDownReady({ ledToVillage: false }, 2)).toBe(false);
    expect(digDownReady({ ledToVillage: true, cavesSeen: true }, 2)).toBe(false);
    expect(digDownReady({ ledToVillage: true, hints: ['digDown'] }, 2)).toBe(false);
  });
});

describe('storeSave never lowers a flag or a hint', () => {
  test('a stored true cavesSeen, ruinFound, ledToVillage or fernSeeds is kept when the next write has them false', () => {
    readSave(localStorage);
    expect(storeSave(localStorage, v3({ flags: { ledToVillage: true, fernSeeds: true, cavesSeen: true, ruinFound: true, hints: ['digDown'] } }))).toBe(true);
    expect(storeSave(localStorage, v3({ flags: { ledToVillage: false, hints: ['gemFound'] } }))).toBe(true);
    expect(stored().flags).toEqual({ ledToVillage: true, fernSeeds: true, cavesSeen: true, ruinFound: true, hints: ['gemFound', 'digDown'] });
  });

  test('new flags are written as they are (optional fields only appear when true)', () => {
    readSave(localStorage);
    expect(storeSave(localStorage, v3({ flags: { ledToVillage: false } }))).toBe(true);
    expect(stored().flags).toEqual({ ledToVillage: false });
    expect(storeSave(localStorage, v3({ flags: { ledToVillage: false, cavesSeen: true } }))).toBe(true);
    expect(stored().flags).toEqual({ ledToVillage: false, cavesSeen: true });
  });

  test('the flags round-trip through a save and a read', () => {
    readSave(localStorage);
    storeSave(localStorage, v3({ flags: { ledToVillage: true, cavesSeen: true, ruinFound: true, hints: ['digDown', 'gemFound'] } }));
    expect(readSave(localStorage)!.flags).toEqual({ ledToVillage: true, cavesSeen: true, ruinFound: true, hints: ['digDown', 'gemFound'] });
  });

  test('the v1 and v2 keys are never written by any of this', () => {
    const v2raw = JSON.stringify({ version: 2, seed: 2026, edits: [], inventory: {}, player: { x: 24.5, y: 8, z: 24.5 }, flags: { ledToVillage: true } });
    localStorage.setItem(V2_SAVE_KEY, v2raw);
    localStorage.setItem(LEGACY_SAVE_KEY, 'v1 stays');
    readSave(localStorage);
    storeSave(localStorage, v3({ flags: { ledToVillage: true, cavesSeen: true, hints: ['gemFound'] } }));
    storeSave(localStorage, v3({ flags: { ledToVillage: false } }));
    expect(localStorage.getItem(V2_SAVE_KEY)).toBe(v2raw);
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe('v1 stays');
  });
});

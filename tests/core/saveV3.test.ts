// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import {
  ALL_SAVE_KEYS, BACKUP_KEY, BACKUP_V2_KEY, BAD_V3_KEY, LEGACY_SAVE_KEY, SAVE_KEY, V2_SAVE_KEY, applySave, inspectSave, parseSave,
  readSave, serialise, storeSave, type SaveData,
} from '../../src/core/save';
import { GEN_VERSION, generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { saveFixtureRaw } from '../helpers/fixtures';

const v3 = (patch: Partial<SaveData> = {}): SaveData => ({
  version: 3, gen: GEN_VERSION, origin: [48, 48, 48], seed: 2026, edits: [[100, 60, 100, BlockId.Planks]], inventory: {},
  player: { x: 72.5, y: 56, z: 72.5 }, flags: { ledToVillage: false }, ...patch,
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('save v3: keys and format', () => {
  test('the keys', () => {
    expect(SAVE_KEY).toBe('blockpals.save.v3');
    expect(V2_SAVE_KEY).toBe('blockpals.save.v2');
    expect(LEGACY_SAVE_KEY).toBe('blockpals.save.v1');
    expect(BACKUP_V2_KEY).toBe('blockpals.save.v2.backup');
    expect(BACKUP_KEY).toBe('blockpals.save.v1.backup');
    expect(BAD_V3_KEY).toBe('blockpals.save.v3.bad');
    expect([...ALL_SAVE_KEYS].sort()).toEqual([
      'blockpals.save.v1', 'blockpals.save.v1.backup', 'blockpals.save.v2', 'blockpals.save.v2.backup',
      'blockpals.save.v2.bad', 'blockpals.save.v2.bad.2', 'blockpals.save.v2.bad.3', 'blockpals.save.v2.bad.4',
      'blockpals.save.v3', 'blockpals.save.v3.bad', 'blockpals.save.v3.bad.2', 'blockpals.save.v3.bad.3', 'blockpals.save.v3.bad.4',
    ]);
  });

  test('serialise writes version 3, origin [48,48,48] and gen GEN_VERSION, in world coordinates', () => {
    const game = new Game(generateWorld(2026));
    game.world.set(150, 60, 20, BlockId.Bricks);
    const data = serialise(game, 2026);
    expect(data.version).toBe(3);
    expect(data.origin).toEqual([48, 48, 48]);
    expect(data.gen).toBe(GEN_VERSION);
    expect(data.migratedFrom).toBeUndefined();
    expect(data.edits).toEqual([[150, 60, 20, BlockId.Bricks]]);
    expect(storeSave(localStorage, data)).toBe(true);
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).origin).toEqual([48, 48, 48]);
    expect(readSave(localStorage)).toEqual(data);
  });

  test('edits are validated in the 192 x 68 x 192 box', () => {
    const checked = inspectSave(JSON.stringify(v3({ edits: [[0, 0, 0, 3], [191, 67, 191, 3], [192, 1, 1, 3], [1, 68, 1, 3], [1, 1, -1, 3]] })))!;
    expect(checked.data.edits).toEqual([[0, 0, 0, 3], [191, 67, 191, 3]]);
    expect(checked.skipped).toBe(3);
  });

  test('crops, trees and animals are validated in the 192 box and are not shifted', () => {
    const data = parseSave(JSON.stringify(v3({
      crops: [[150, 60, 150, 10], [192, 60, 1, 0]], trees: [[10, 55, 10, 3, 0]], animals: [[2, 190.5, 55, 1.5, 3, 0], [2, 192.5, 55, 1.5, 3, 0]],
    })))!;
    expect(data.crops).toEqual([[150, 60, 150, 10]]);
    expect(data.trees).toEqual([[10, 55, 10, 3, 0]]);
    expect(data.animals).toEqual([[2, 190.5, 55, 1.5, 3, 0]]);
  });

  test('a v3 save with a different origin still loads unshifted and logs a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = parseSave(JSON.stringify(v3({ origin: [0, 0, 0] as unknown as [48, 48, 48] })))!;
    expect(data.edits).toEqual([[100, 60, 100, BlockId.Planks]]);
    expect(data.origin).toEqual([48, 48, 48]);
    expect(warn).toHaveBeenCalled();
    const missing = { ...v3() } as Record<string, unknown>;
    delete missing.origin;
    expect(parseSave(JSON.stringify(missing))!.edits).toEqual([[100, 60, 100, BlockId.Planks]]);
  });

  test('migratedFrom survives a round trip; a bad value is dropped', () => {
    expect(parseSave(JSON.stringify(v3({ migratedFrom: 2 })))!.migratedFrom).toBe(2);
    expect(parseSave(JSON.stringify({ ...v3(), migratedFrom: 'x' }))!.migratedFrom).toBeUndefined();
  });

  test('20,000 edits serialise under 600 KB and parse (with the shift) in under 100 ms', () => {
    const edits: SaveData['edits'] = [];
    for (let i = 0; i < 20_000; i++) edits.push([i % 96, (i >> 7) % 20, (i * 7) % 96, BlockId.Planks]);
    const v2Raw = JSON.stringify({ ...JSON.parse(saveFixtureRaw('v2-extremes')), edits });
    const t0 = performance.now();
    const data = parseSave(v2Raw)!;
    const ms = performance.now() - t0;
    const out = JSON.stringify(data);
    console.log(`save size: 20,000 edits = ${(out.length / 1024).toFixed(0)} KB, parse + shift ${ms.toFixed(1)} ms`);
    expect(data.edits).toHaveLength(20_000);
    expect(out.length).toBeLessThan(600 * 1024);
    expect(ms).toBeLessThan(100);
  });
});

describe('save v3: flags', () => {
  test('cavesSeen and ruinFound round-trip; unknown flags dropped; a wrong type drops that flag only', () => {
    const game = new Game(generateWorld(2026));
    const data = serialise(game, 2026, { ledToVillage: true, cavesSeen: true, ruinFound: true, hints: ['plantSome'] });
    expect(data.flags).toEqual({ ledToVillage: true, cavesSeen: true, ruinFound: true, hints: ['plantSome'] });
    expect(parseSave(JSON.stringify(data))!.flags).toEqual(data.flags);
    expect(applySave(data).flags).toEqual(data.flags);
    const odd = parseSave(JSON.stringify(v3({ flags: { ledToVillage: true, cavesSeen: 'yes', ruinFound: true, magic: 1 } as never })))!;
    expect(odd.flags).toEqual({ ledToVillage: true, ruinFound: true });
    expect(serialise(game, 2026, { ledToVillage: false }).flags).toEqual({ ledToVillage: false });
  });
});

describe('save v3: damaged, newer and unreadable', () => {
  test('a damaged v3 is copied to .bad before being replaced; four spares; a slot is never overwritten', () => {
    const game = new Game(generateWorld(2026));
    const payloads = ['bad-one', 'bad-two', 'bad-three', 'bad-four'];
    for (const bad of payloads) {
      localStorage.setItem(SAVE_KEY, bad);
      expect(storeSave(localStorage, serialise(game, 2026))).toBe(true);
    }
    expect([BAD_V3_KEY, `${BAD_V3_KEY}.2`, `${BAD_V3_KEY}.3`, `${BAD_V3_KEY}.4`].map(k => localStorage.getItem(k))).toEqual(payloads);
    // A fifth damaged payload finds no free slot: it is not replaced.
    localStorage.setItem(SAVE_KEY, 'bad-five');
    expect(storeSave(localStorage, serialise(game, 2026))).toBe(false);
    expect(localStorage.getItem(SAVE_KEY)).toBe('bad-five');
    expect(localStorage.getItem(BAD_V3_KEY)).toBe('bad-one');
  });

  test('a v3 with skipped edits keeps the rest and is preserved once', () => {
    const raw = JSON.stringify(v3({ edits: [[100, 60, 100, BlockId.Planks], [1, 1, 1, 999]] }));
    localStorage.setItem(SAVE_KEY, raw);
    expect(readSave(localStorage)!.edits).toEqual([[100, 60, 100, BlockId.Planks]]);
    expect(localStorage.getItem(BAD_V3_KEY)).toBe(raw);
  });

  test('a stored version above 3 is never overwritten and never crashes; the v2 save is played instead', () => {
    const newer = JSON.stringify({ ...v3(), version: 4, extra: 'later' });
    localStorage.setItem(SAVE_KEY, newer);
    localStorage.setItem(V2_SAVE_KEY, saveFixtureRaw('v2-extremes'));
    const data = readSave(localStorage)!;
    expect(data.migratedFrom).toBe(2);
    expect(storeSave(localStorage, data)).toBe(false);
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);
    expect(localStorage.getItem(V2_SAVE_KEY)).toBe(saveFixtureRaw('v2-extremes'));
  });

  test('a version 2 payload under the v3 key is not shifted again: it is kept as damaged', () => {
    const odd = saveFixtureRaw('v2-extremes');
    localStorage.setItem(SAVE_KEY, odd);
    expect(readSave(localStorage)).toBeNull();
    const game = new Game(generateWorld(2026));
    expect(storeSave(localStorage, serialise(game, 2026))).toBe(true);
    expect(localStorage.getItem(BAD_V3_KEY)).toBe(odd);
  });

  test('unreadable storage: nothing written (blind session rule), plays from a fresh world', () => {
    localStorage.setItem(V2_SAVE_KEY, saveFixtureRaw('v2-extremes'));
    const real = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
      if (k === V2_SAVE_KEY) throw new Error('blocked');
      return real.call(this, k);
    });
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(readSave(localStorage)).toBeNull();
    expect(storeSave(localStorage, serialise(new Game(generateWorld(2026)), 2026))).toBe(false);
    expect(write).not.toHaveBeenCalled();
    spy.mockRestore();
    // Readable again, but this page started blind and the v2 key holds his world: still never written.
    expect(storeSave(localStorage, serialise(new Game(generateWorld(2026)), 2026))).toBe(false);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  test('a higher stored gen is not lowered', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify(v3({ gen: 9 })));
    expect(readSave(localStorage)!.gen).toBe(9); // a page load always reads first
    expect(storeSave(localStorage, serialise(new Game(generateWorld(2026)), 2026))).toBe(true);
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).gen).toBe(9);
  });
});

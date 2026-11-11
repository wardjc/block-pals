// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { MYTHICAL } from '../../src/core/mythical';
import {
  BAD_V2_KEY, LEGACY_SAVE_KEY, SAVE_KEY, WIZARD_COUNT_MAX, WIZARD_HINT_NAMES, applySave, parseSave, readSave, serialise,
  startAutosave, storeSave, type SaveData,
} from '../../src/core/save';
import { GEN_VERSION, generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { newWizardState, type WizardState } from '../../src/game/wizardTrade';

const base = (): SaveData => ({
  version: 2, gen: 1, seed: 1234, edits: [], inventory: { [BlockId.Wood]: 4 }, player: { x: 24, y: 9, z: 24 },
  flags: { ledToVillage: false },
});
const raw = (extra: Record<string, unknown>): string => JSON.stringify({ ...base(), ...extra });
const wiz = (over: Partial<WizardState> = {}): WizardState => ({ ...newWizardState(), ...over });
const stored = (): Record<string, unknown> => JSON.parse(localStorage.getItem(SAVE_KEY)!) as Record<string, unknown>;

let world: ReturnType<typeof generateWorld>;
const makeGame = (): Game => new Game(world);

beforeEach(() => {
  localStorage.clear();
  world = generateWorld(1234);
});
afterEach(() => vi.restoreAllMocks());

describe('wizard save fields', () => {
  test('a save without any wizard field loads with the defaults', () => {
    const data = parseSave(raw({}))!;
    expect(data).not.toBeNull();
    expect('wizard' in data).toBe(false);
    expect(applySave(data).wizard).toEqual(newWizardState());
  });

  test('the key and version are unchanged', () => {
    expect(SAVE_KEY).toBe('blockpals.save.v2');
    const data = serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ gift: true }));
    expect(data.version).toBe(2);
  });

  test('a default wizard is not written at all (the save is what the step before wrote)', () => {
    expect('wizard' in serialise(makeGame(), 1234)).toBe(false);
    expect('wizard' in serialise(makeGame(), 1234, undefined, 0, undefined, newWizardState())).toBe(false);
  });

  test('new fields round-trip', () => {
    const w = wiz({ gift: true, met: true, led: true, solved: 12, clean: 7, bought: 3, hints: ['seeLight', 'towerHint'] });
    const data = serialise(makeGame(), 1234, undefined, 0, undefined, w);
    expect(storeSave(localStorage, data)).toBe(true);
    const back = readSave(localStorage)!;
    expect(back.wizard).toEqual(w);
    expect(applySave(back).wizard).toEqual(w);
  });

  test('serialise takes a copy, never the live object', () => {
    const w = wiz({ gift: true, hints: ['seeLight'] });
    const data = serialise(makeGame(), 1234, undefined, 0, undefined, w);
    w.hints.push('towerHint');
    w.solved = 50;
    expect(data.wizard).toEqual({ gift: true, met: false, led: false, solved: 0, clean: 0, bought: 0, hints: ['seeLight'] });
  });

  test('the mythical blocks round-trip in inventory, order and edits', () => {
    const game = makeGame();
    for (const [i, id] of MYTHICAL.entries()) {
      game.inventory.add(id, i + 1);
      game.world.set(30 + i, 15, 30, id);
    }
    const data = serialise(game, 1234, undefined, 0, undefined, wiz({ gift: true }));
    expect(storeSave(localStorage, data)).toBe(true);
    const restored = applySave(readSave(localStorage)!);
    for (const [i, id] of MYTHICAL.entries()) {
      expect(restored.inventory.count(id)).toBe(i + 1);
      expect(restored.world.get(30 + i, 15, 30)).toBe(id);
    }
    expect(restored.inventory.order().filter(id => (MYTHICAL as readonly number[]).includes(id))).toEqual([...MYTHICAL]);
  });

  test.each([
    ['a string', 'yes'], ['a number', 3], ['null', null], ['a list', [true, true]],
  ])('a wizard field that is %s is dropped, the rest of the save survives', (_name, value) => {
    const edits = [[30, 15, 30, BlockId.MoonBlock]];
    const data = parseSave(raw({ wizard: value, edits, inventory: { [BlockId.SunBlock]: 5 } }))!;
    expect(data).not.toBeNull();
    expect('wizard' in data).toBe(false);
    expect(data.edits).toEqual(edits);
    expect(data.inventory).toEqual({ [BlockId.SunBlock]: 5 });
    expect(applySave(data).wizard).toEqual(newWizardState());
  });

  test('a bad field drops only that field', () => {
    const data = parseSave(raw({
      wizard: { gift: 'true', met: true, led: 1, solved: 'many', clean: 2, bought: 1.5, hints: 'seeLight' },
      inventory: { [BlockId.StarBlock]: 9 },
    }))!;
    expect(data.wizard).toEqual({ met: true, clean: 2 });
    expect(data.inventory).toEqual({ [BlockId.StarBlock]: 9 });
    // A dropped `solved` is never less than the clean solves that are kept: the level survives.
    expect(applySave(data).wizard).toEqual(wiz({ met: true, solved: 2, clean: 2 }));
  });

  test.each([Infinity, NaN, -Infinity])('a non-finite count %s is dropped', n => {
    // JSON cannot carry these, so they arrive through an object handed to applySave after parsing.
    const data = parseSave(raw({ wizard: { solved: 4 } }))!;
    (data.wizard as Record<string, unknown>).clean = n;
    expect(applySave(data).wizard).toEqual(wiz({ solved: 4 }));
  });

  test('solved, clean and bought are clamped, and clean never exceeds solved', () => {
    const data = parseSave(raw({ wizard: { solved: -4, clean: 3, bought: 10_000_000 } }))!;
    expect(data.wizard).toEqual({ solved: 0, clean: 0, bought: WIZARD_COUNT_MAX });
    const big = parseSave(raw({ wizard: { solved: 500_000, clean: 900_000 } }))!;
    expect(big.wizard).toEqual({ solved: WIZARD_COUNT_MAX, clean: WIZARD_COUNT_MAX });
    expect(parseSave(raw({ wizard: { solved: 5, clean: 9 } }))!.wizard).toEqual({ solved: 5, clean: 5 });
  });

  test('unknown hints are dropped, known ones kept once', () => {
    expect([...WIZARD_HINT_NAMES]).toEqual(['seeLight', 'towerHint']);
    const data = parseSave(raw({ wizard: { hints: ['seeLight', 'boo', 7, 'seeLight', 'towerHint', null] } }))!;
    expect(data.wizard).toEqual({ hints: ['seeLight', 'towerHint'] });
    expect('hints' in parseSave(raw({ wizard: { gift: true, hints: ['nope'] } }))!.wizard!).toBe(false);
  });

  test('unknown keys inside the wizard object are not kept', () => {
    const data = parseSave(raw({ wizard: { gift: true, secret: 'x' } }))!;
    expect(data.wizard).toEqual({ gift: true });
  });

  test('a stored true flag is never written back as false', () => {
    const first = serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ gift: true, met: true, led: true }));
    expect(storeSave(localStorage, first)).toBe(true);
    // A stale tab that never saw the gift or the visit writes later.
    expect(storeSave(localStorage, serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ solved: 1 })))).toBe(true);
    expect(stored().wizard).toMatchObject({ gift: true, met: true, led: true, solved: 1 });
    // A write with no wizard at all (an older call site) keeps everything too.
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(true);
    expect(stored().wizard).toMatchObject({ gift: true, met: true, led: true, solved: 1 });
    expect(applySave(readSave(localStorage)!).wizard).toMatchObject({ gift: true, met: true, led: true });
  });

  test('a stored higher clean is not lowered, so the level never goes down', () => {
    expect(storeSave(localStorage, serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ solved: 20, clean: 15, bought: 4 })))).toBe(true);
    expect(storeSave(localStorage, serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ solved: 3, clean: 1, bought: 1 })))).toBe(true);
    expect(stored().wizard).toMatchObject({ solved: 20, clean: 15, bought: 4 });
    expect(applySave(readSave(localStorage)!).wizard).toMatchObject({ solved: 20, clean: 15 });
  });

  test('hints already stored are kept by a later write', () => {
    expect(storeSave(localStorage, serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ hints: ['seeLight'] })))).toBe(true);
    expect(storeSave(localStorage, serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ hints: ['towerHint'] })))).toBe(true);
    expect(stored().wizard).toMatchObject({ hints: ['towerHint', 'seeLight'] });
  });

  test('a write with higher values than stored raises them', () => {
    expect(storeSave(localStorage, serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ solved: 2, clean: 1 })))).toBe(true);
    expect(storeSave(localStorage, serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ solved: 6, clean: 4, gift: true })))).toBe(true);
    expect(stored().wizard).toEqual({ gift: true, met: false, led: false, solved: 6, clean: 4, bought: 0 });
  });

  test('a save from a newer build (version above 2) is never overwritten', () => {
    const newer = JSON.stringify({ ...base(), version: 3, wizard: { gift: true } });
    localStorage.setItem(SAVE_KEY, newer);
    expect(readSave(localStorage)).toBeNull();
    expect(storeSave(localStorage, serialise(makeGame(), 1234, undefined, 0, undefined, wiz({ gift: true })))).toBe(false);
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);
  });

  test('a damaged v2 is copied to .bad before it is replaced, with the wizard fields present', () => {
    const damaged = raw({ wizard: { gift: true, clean: 6, solved: 6 }, edits: [[30, 6, 30, BlockId.Planks], [1, 2, 3, 999]] });
    localStorage.setItem(SAVE_KEY, damaged);
    const data = readSave(localStorage)!;
    expect(data.wizard).toEqual({ gift: true, clean: 6, solved: 6 });
    expect(localStorage.getItem(BAD_V2_KEY)).toBe(damaged);
    const game = new Game(applySave(data));
    expect(storeSave(localStorage, serialise(game, 1234, undefined, 0, undefined, applySave(data).wizard))).toBe(true);
    expect(localStorage.getItem(BAD_V2_KEY)).toBe(damaged);
    expect(stored().wizard).toMatchObject({ gift: true, clean: 6, solved: 6 });
  });

  test('a bad wizard field never marks the save as damaged (no .bad copy, nothing skipped)', () => {
    localStorage.setItem(SAVE_KEY, raw({ wizard: { gift: 'maybe' } }));
    expect(readSave(localStorage)).not.toBeNull();
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(true);
    expect(localStorage.getItem(BAD_V2_KEY)).toBeNull();
  });

  test('a v1 save still migrates with the default wizard and the v1 key is never written', () => {
    const v1 = JSON.stringify({ version: 1, seed: 1234, edits: [[3, 8, 3, BlockId.Planks]], inventory: {}, player: { x: 24, y: 9, z: 24 } });
    localStorage.setItem(LEGACY_SAVE_KEY, v1);
    const data = readSave(localStorage)!;
    expect('wizard' in data).toBe(false);
    const applied = applySave(data);
    expect(applied.wizard).toEqual(newWizardState());
    applied.wizard.gift = true;
    expect(storeSave(localStorage, serialise(new Game(applied), 1234, undefined, 0, undefined, applied.wizard))).toBe(true);
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe(v1);
    expect(stored().wizard).toMatchObject({ gift: true });
  });

  test('an old-gen save regenerates the tower and replays edits on top; gen is written new and never lowered', () => {
    const { tower } = world;
    const [dx, dy, dz] = tower.doorInside;
    const data = parseSave(raw({ gen: 1, edits: [[dx, dy, dz, BlockId.CloudBlock]] }))!;
    const applied = applySave(data);
    // The tower stands (its top lamp is there) and his block wins over the stamp.
    const [lx, ly, lz] = applied.tower.topLamp;
    expect(applied.world.get(lx, ly, lz)).toBe(BlockId.Lamp);
    expect(applied.world.get(dx, dy, dz)).toBe(BlockId.CloudBlock);
    expect(storeSave(localStorage, serialise(new Game(applied), 1234))).toBe(true);
    expect(stored().gen).toBe(GEN_VERSION);
    localStorage.setItem(SAVE_KEY, raw({ gen: GEN_VERSION + 4, wizard: { clean: 3, solved: 3 } }));
    expect(storeSave(localStorage, serialise(new Game(applied), 1234))).toBe(true);
    expect(stored().gen).toBe(GEN_VERSION + 4);
    expect(stored().wizard).toMatchObject({ clean: 3 });
  });

  test('the inventory holds no key of 100 or more (items live in their own field)', () => {
    const game = makeGame();
    for (const id of MYTHICAL) game.inventory.add(id, 99);
    const data = serialise(game, 1234, undefined, 0, undefined, wiz({ gift: true }));
    expect(Object.keys(data.inventory).every(k => Number(k) < 100)).toBe(true);
  });

  test('autosave writes the wizard when it changes, read live', () => {
    vi.useFakeTimers();
    try {
      const game = makeGame();
      const w = newWizardState();
      const stop = startAutosave(game, 1234, localStorage, { ledToVillage: false }, undefined, w);
      vi.advanceTimersByTime(10_000);
      expect(localStorage.getItem(SAVE_KEY)).toBeNull(); // nothing changed yet
      w.gift = true;
      vi.advanceTimersByTime(10_000);
      expect(stored().wizard).toMatchObject({ gift: true });
      w.solved = 1;
      w.clean = 1;
      vi.advanceTimersByTime(10_000);
      expect(stored().wizard).toMatchObject({ gift: true, solved: 1, clean: 1 });
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

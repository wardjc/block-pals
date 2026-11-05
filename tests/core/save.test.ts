// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { isStandable } from '../../src/core/pathfind';
import {
  SAVE_KEY, applySave, parseSave, readSave, serialise, startAutosave, storeSave,
  type SaveData,
} from '../../src/core/save';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';

function makeGame(seed = 1234): Game {
  return new Game(generateWorld(seed));
}

function validSave(): SaveData {
  return { version: 1, seed: 1234, edits: [], inventory: {}, player: { x: 24, y: 9, z: 24 } };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('save data', () => {
  test('the hotbar order survives a reload', () => {
    const game = makeGame();
    for (const id of [BlockId.Planks, BlockId.Stone, BlockId.Wood]) game.inventory.add(id, 2);
    expect(storeSave(localStorage, serialise(game, 1234))).toBe(true);
    const restored = applySave(readSave(localStorage)!);
    expect(restored.inventory.hotbar()).toEqual([BlockId.Planks, BlockId.Stone, BlockId.Wood]);
  });

  test('old saves without order still load (id order)', () => {
    const raw = JSON.stringify({ ...validSave(), inventory: { [BlockId.Planks]: 2, [BlockId.Wood]: 1 } });
    const data = parseSave(raw)!;
    expect(data).not.toBeNull();
    expect(data.order).toBeUndefined();
    expect(applySave(data).inventory.hotbar()).toEqual([BlockId.Wood, BlockId.Planks]);
  });

  test.each([['x'], [[999]], [[1.5]], [{}]])('a bad order %j is dropped, save kept', order => {
    const data = parseSave(JSON.stringify({ ...validSave(), inventory: { [BlockId.Wood]: 1 }, order }))!;
    expect(data).not.toBeNull();
    expect(data.order).toBeUndefined();
    expect(data.inventory).toEqual({ [BlockId.Wood]: 1 });
  });

  test('round-trips a game with edits and inventory', () => {
    const game = makeGame();
    game.world.set(24, 1, 24, BlockId.Air);
    game.world.set(25, 14, 25, BlockId.Bricks);
    game.inventory.add(BlockId.Wood, 7);
    game.inventory.add(BlockId.Glass, 20);
    game.player.pos.x += 0.5;
    game.player.pos.z += 0.25;
    const data = serialise(game, 1234);
    expect(SAVE_KEY).toBe('blockpals.save.v1');
    expect(data).toEqual({
      version: 1, seed: 1234,
      edits: [[24, 1, 24, BlockId.Air], [25, 14, 25, BlockId.Bricks]],
      inventory: { [BlockId.Wood]: 7, [BlockId.Glass]: 20 }, player: game.player.pos,
      order: [BlockId.Wood, BlockId.Glass],
    });
    expect(game.world.isDirty()).toBe(true);
    expect(storeSave(localStorage, data)).toBe(true);
    expect(readSave(localStorage)).toEqual(data);
    const restored = applySave(readSave(localStorage)!);
    expect(restored.inventory.toJSON()).toEqual(data.inventory);
    expect(restored.spawn).toEqual(game.player.pos);
    expect(restored.world.isDirty()).toBe(false);
    expect(restored.world.edits()).toEqual(data.edits);
    for (let x = 0; x < 48; x++) {
      for (let y = 0; y < 16; y++) {
        for (let z = 0; z < 48; z++) {
          expect(restored.world.get(x, y, z)).toBe(game.world.get(x, y, z));
        }
      }
    }
  });

  test('serialise returns an independent snapshot', () => {
    const game = makeGame();
    game.world.set(24, 1, 24, BlockId.Air);
    game.inventory.add(BlockId.Wood, 3);
    const data = serialise(game, 1234);
    data.edits[0][3] = BlockId.Glass;
    data.inventory[BlockId.Wood] = 19;
    data.player.x = 10;
    expect(game.world.edits()).toEqual([[24, 1, 24, BlockId.Air]]);
    expect(game.inventory.count(BlockId.Wood)).toBe(3);
    expect(game.player.pos.x).toBe(24);
  });

  test.each([null, '{', 'null', '[]', '42', '{}', '{"version":2}'])('ignores corrupt save: %s', raw => {
    expect(parseSave(raw)).toBeNull();
  });

  test.each([
    { version: 2 }, { seed: '1234' }, { seed: null }, { seed: 1.5 },
    { edits: null }, { edits: {} }, { edits: [[1, 2, 3]] },
    { edits: [[1, 2, 3, 4, 5]] }, { edits: [[1, 2, 3, -1]] },
    { edits: [[1, 2, 3, 12]] }, { edits: [[1, 2, 3, 256]] },
    { edits: [[1, 2, 3, '4']] }, { edits: [[1, 2, 3, 1.5]] },
    { edits: [[-1, 2, 3, 4]] }, { edits: [[48, 2, 3, 4]] },
    { edits: [[1, 16, 3, 4]] }, { edits: [[1, 2, 48, 4]] },
    { edits: [[1.5, 2, 3, 4]] }, { edits: [null] },
    { player: null }, { player: [] },
    { player: { x: 24, y: 9 } }, { player: { x: '24', y: 9, z: 24 } },
  ])('rejects malformed fields: %j', patch => {
    expect(parseSave(JSON.stringify({ ...validSave(), ...patch }))).toBeNull();
  });

  test('rejects non-finite JSON numbers and missing required fields', () => {
    expect(parseSave(JSON.stringify(validSave()).replace('1234', '1e400'))).toBeNull();
    expect(parseSave(JSON.stringify(validSave()).replace('"x":24', '"x":1e400'))).toBeNull();
    for (const key of Object.keys(validSave()).filter(k => k !== 'inventory')) {
      const data: Record<string, unknown> = { ...validSave() };
      delete data[key];
      expect(parseSave(JSON.stringify(data))).toBeNull();
    }
  });

  test('storeSave returns false when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    expect(storeSave(localStorage, validSave())).toBe(false);
  });

  test('readSave with null storage returns null', () => {
    expect(readSave(null)).toBeNull();
    expect(storeSave(null, validSave())).toBe(false);
  });

  test('readSave tolerates blocked reads and corrupt stored data', () => {
    localStorage.setItem(SAVE_KEY, '{');
    expect(readSave(localStorage)).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(readSave(localStorage)).toBeNull();
  });

  test.each(['underground', 'outside', 'water', 'edited feet', 'edited head', 'removed support'])
  ('unstandable saved position falls back to spawn: %s', kind => {
    const game = makeGame();
    const data = serialise(game, 1234);
    const { x, y, z } = data.player;
    if (kind === 'underground') data.player.y = 1;
    if (kind === 'outside') data.player.x = -5;
    if (kind === 'water') data.player = { x: 14, y: 4, z: 32 };
    if (kind === 'edited feet') data.edits.push([x, y, z, BlockId.Stone]);
    if (kind === 'edited head') data.edits.push([x, y + 1, z, BlockId.Stone]);
    if (kind === 'removed support') data.edits.push([x, y - 1, z, BlockId.Air]);
    expect(parseSave(JSON.stringify(data))).toEqual(data);
    const restored = applySave(data);
    expect(restored.spawn).toEqual(generateWorld(1234).spawn);
    expect(restored.world.edits()).toEqual(data.edits);
  });

  test('checks standability after replaying edits', () => {
    const data = validSave();
    data.player = { x: 25.5, y: 14, z: 25.5 };
    data.edits = [[25, 13, 25, BlockId.Planks]];
    const restored = applySave(data);
    expect(isStandable(restored.world, [25, 14, 25])).toBe(true);
    expect(restored.spawn).toEqual(data.player);
  });
});

describe('autosave', () => {
  let stop: (() => void) | undefined;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
  });

  test('saves changed worlds every 10 seconds and retains earlier edits through reloads', () => {
    let game = makeGame();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    stop = startAutosave(game, 1234, localStorage);
    vi.advanceTimersByTime(10_000);
    expect(write).not.toHaveBeenCalled();
    game.world.set(24, 1, 24, BlockId.Air);
    vi.advanceTimersByTime(9999);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(game.world.isDirty()).toBe(false);
    game.world.set(25, 14, 25, BlockId.Glass);
    vi.advanceTimersByTime(10_000);
    expect(readSave(localStorage)!.edits).toHaveLength(2);
    stop();
    game = new Game(applySave(readSave(localStorage)!));
    stop = startAutosave(game, 1234, localStorage);
    game.inventory.add(BlockId.Wood, 3);
    vi.advanceTimersByTime(10_000);
    expect(readSave(localStorage)!.edits).toEqual([
      [24, 1, 24, BlockId.Air], [25, 14, 25, BlockId.Glass],
    ]);
    expect(readSave(localStorage)!.inventory).toEqual({ [BlockId.Wood]: 3 });
    vi.advanceTimersByTime(20_000);
    expect(write).toHaveBeenCalledTimes(3);
  });

  test.each(['world', 'inventory'])('retries failed %s saves without acknowledging changes', kind => {
    const game = makeGame();
    const write = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw new Error('Full'); });
    stop = startAutosave(game, 1234, localStorage);
    if (kind === 'world') game.world.set(24, 1, 24, BlockId.Air);
    else game.inventory.add(BlockId.Wood, 3);
    vi.advanceTimersByTime(10_000);
    expect(readSave(localStorage)).toBeNull();
    if (kind === 'world') expect(game.world.isDirty()).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(readSave(localStorage)).toEqual(serialise(game, 1234));
    expect(game.world.isDirty()).toBe(false);
  });

  test('saves on hidden even when only the player moved, and can stop listening', () => {
    const game = makeGame();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    stop = startAutosave(game, 1234, localStorage);
    game.player.pos.x += 0.5;
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(write).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(readSave(localStorage)!.player).toEqual(game.player.pos);
    stop();
    game.inventory.add(BlockId.Wood, 2);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(10_000);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('save extras', () => {
  test.each([null, [], { 4: 21 }, { 4: -1 }, { 4: 1.5 }, { 4: '3' }, { 0: 1 }, { 11: 1 }, { 12: 1 }, { '04': 1 }])(
    'bad inventory %j is emptied, save kept', inv => {
      const d = parseSave(JSON.stringify({ ...validSave(), inventory: inv }));
      expect(d).not.toBeNull();
      expect(d!.inventory).toEqual({});
    });
  test('keeps edits but empties a bad inventory', () => {
    const raw = JSON.stringify({ version: 1, seed: 1, edits: [[1, 5, 1, 2]], inventory: { '999': 3 }, player: { x: 1, y: 5, z: 1 } });
    const d = parseSave(raw);
    expect(d?.edits).toEqual([[1, 5, 1, 2]]);
    expect(d?.inventory).toEqual({});
  });
  test('saves on pagehide', () => {
    const store = new Map<string, string>();
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
    const stop = startAutosave(makeGame(7), 7, st);
    window.dispatchEvent(new Event('pagehide'));
    stop();
    expect(store.size).toBe(1);
  });
});

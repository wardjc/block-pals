// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { isStandable } from '../../src/core/pathfind';
import {
  ALL_SAVE_KEYS, BACKUP_KEY, BAD_V3_KEY, LEGACY_SAVE_KEY, SAVE_KEY, V2_SAVE_KEY, applySave, inspectSave, migrateV1, parseSave, readSave, serialise,
  startAutosave, storeSave, type SaveData,
} from '../../src/core/save';
import { GEN_VERSION } from '../../src/core/worldgen';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';

/** One past the highest registered block id: never a valid block, however many blocks are added later. */
const FIRST_INVALID_ID = Math.max(...Object.keys(BLOCKS).map(Number)) + 1;

function makeGame(seed = 1234): Game {
  return new Game(generateWorld(seed));
}

function validSave(): SaveData {
  // Version 3: world coordinates in the 192 x 68 x 192 world.
  return { version: 3, gen: 1, origin: [48, 48, 48], seed: 1234, edits: [], inventory: {}, player: { x: 72, y: 57, z: 72 }, flags: { ledToVillage: false } };
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
    game.inventory.add(BlockId.Glass, 99);
    game.player.pos.x += 0.5;
    game.player.pos.z += 0.25;
    const data = serialise(game, 1234);
    expect(SAVE_KEY).toBe('blockpals.save.v3');
    expect(LEGACY_SAVE_KEY).toBe('blockpals.save.v1');
    expect(data).toEqual({
      version: 3, gen: GEN_VERSION, origin: [48, 48, 48], seed: 1234, flags: { ledToVillage: false },
      edits: [[24, 1, 24, BlockId.Air], [25, 14, 25, BlockId.Bricks]],
      inventory: { [BlockId.Wood]: 7, [BlockId.Glass]: 99 }, player: game.player.pos,
      order: [BlockId.Wood, BlockId.Glass], savedAt: expect.any(Number),
    });
    expect(game.world.isDirty()).toBe(true);
    expect(storeSave(localStorage, data)).toBe(true);
    expect(readSave(localStorage)).toEqual(data);
    const restored = applySave(readSave(localStorage)!);
    expect(restored.inventory.toJSON()).toEqual(data.inventory);
    expect(restored.spawn).toEqual(game.player.pos);
    expect(restored.world.isDirty()).toBe(false);
    expect(restored.world.edits()).toEqual(data.edits);
    expect(restored.world.buffer).toEqual(game.world.buffer);
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
    expect(game.player.pos.x).toBe(generateWorld(1234).spawn.x);
  });

  test.each([null, '{', 'null', '[]', '42', '{}', '{"version":2}'])('ignores corrupt save: %s', raw => {
    expect(parseSave(raw)).toBeNull();
  });

  test.each([
    { seed: '1234' }, { seed: null }, { seed: 1.5 },
    { edits: null }, { edits: {} },
    { gen: 0 }, { gen: 'x' },
    { version: 4 }, { version: 0 },
    { player: null }, { player: [] },
    { player: { x: 24, y: 9 } }, { player: { x: '24', y: 9, z: 24 } },
  ])('rejects malformed fields: %j', patch => {
    expect(parseSave(JSON.stringify({ ...validSave(), ...patch }))).toBeNull();
  });

  const BAD_EDITS: unknown[] = [[1, 2, 3], [1, 2, 3, 4, 5], [1, 2, 3, -1], [1, 2, 3, FIRST_INVALID_ID], [1, 2, 3, 999], [1, 2, 3, '4'],
    [1, 2, 3, 1.5], [-1, 2, 3, 4], [192, 2, 3, 4], [1, 68, 3, 4], [1, 2, 192, 4], [1.5, 2, 3, 4], null];

  test.each(BAD_EDITS.map(e => [e]))('one invalid edit %j is skipped, the valid ones are kept', bad => {
    const good: Array<[number, number, number, number]> = [[5, 5, 5, BlockId.Stone], [90, 6, 90, BlockId.Planks]];
    const raw = JSON.stringify({ ...validSave(), edits: [good[0], bad, good[1]] });
    const parsed = parseSave(raw)!;
    expect(parsed).not.toBeNull();
    expect(parsed.edits).toEqual(good);
    expect(inspectSave(raw)!.skipped).toBe(1);
  });

  test('structural problems still reject the whole save', () => {
    for (const patch of [{ edits: 'x' }, { seed: 'x' }, { version: 9 }, { player: 3 }]) {
      expect(inspectSave(JSON.stringify({ ...validSave(), ...patch }))).toBeNull();
    }
  });

  test('rejects non-finite JSON numbers and missing required fields', () => {
    expect(parseSave(JSON.stringify(validSave()).replace('1234', '1e400'))).toBeNull();
    expect(parseSave(JSON.stringify(validSave()).replace('"x":72', '"x":1e400'))).toBeNull();
    // origin is informational (a v3 save without it still loads, unshifted: tests/core/saveV3.test.ts).
    for (const key of Object.keys(validSave()).filter(k => k !== 'inventory' && k !== 'flags' && k !== 'origin')) {
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
    if (kind === 'water') data.player = { x: 62, y: 52, z: 80 }; // in the meadow pond (old 14, 4, 32)
    if (kind === 'edited feet') data.edits.push([x, y, z, BlockId.Stone]);
    if (kind === 'edited head') data.edits.push([x, y + 1, z, BlockId.Stone]);
    if (kind === 'removed support') data.edits.push([x, y - 1, z, BlockId.Air]);
    expect(parseSave(JSON.stringify(data))).toEqual(data);
    const restored = applySave(data);
    const spawn = generateWorld(1234).spawn;
    if (kind.startsWith('edited') || kind === 'removed support') {
      // His saved spot IS the spawn here, so the spawn itself is now buried or over a hole: it is
      // lifted (or lowered) to a free standing cell in the same column, never left inside a block.
      const c: [number, number, number] = [Math.floor(restored.spawn.x), restored.spawn.y, Math.floor(restored.spawn.z)];
      expect(isStandable(restored.world, c)).toBe(true);
      expect([restored.spawn.x, restored.spawn.z]).toEqual([spawn.x, spawn.z]);
      expect(restored.spawn.y).not.toBe(spawn.y);
    } else {
      expect(restored.spawn).toEqual(spawn);
    }
    expect(restored.world.edits()).toEqual(data.edits);
  });

  test('checks standability after replaying edits', () => {
    const data = validSave();
    data.player = { x: 73.5, y: 62, z: 73.5 };
    data.edits = [[73, 61, 73, BlockId.Planks]];
    const restored = applySave(data);
    expect(isStandable(restored.world, [73, 62, 73])).toBe(true);
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
    expect(readSave(localStorage)).toEqual({ ...serialise(game, 1234), savedAt: expect.any(Number) });
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
  test.each([null, [], { 4: 100 }, { 4: -1 }, { 4: 1.5 }, { 4: '3' }, { 0: 1 }, { 11: 1 }, { [FIRST_INVALID_ID]: 1 }, { '04': 1 }])(
    'bad inventory %j is emptied, save kept', inv => {
      const d = parseSave(JSON.stringify({ ...validSave(), inventory: inv }));
      expect(d).not.toBeNull();
      expect(d!.inventory).toEqual({});
    });
  test.each([21, 50, 99])('keeps a saved stack of %i (bag holds 99 since v1.1)', n => {
    const d = parseSave(JSON.stringify({ ...validSave(), inventory: { 4: n } }));
    expect(d!.inventory).toEqual({ 4: n });
  });
  test('keeps edits but empties a bad inventory (a v2 payload: the edit is shifted by 48)', () => {
    const raw = JSON.stringify({ version: 2, gen: 1, seed: 1, edits: [[1, 5, 1, 2]], inventory: { '999': 3 }, player: { x: 1, y: 5, z: 1 } });
    const d = parseSave(raw);
    expect(d?.edits).toEqual([[49, 53, 49, 2]]);
    expect(d?.inventory).toEqual({});
  });
  test('saves on pagehide', () => {
    const store = new Map<string, string>();
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
    const stop = startAutosave(makeGame(7), 7, st);
    window.dispatchEvent(new Event('pagehide'));
    stop();
    expect([...store.keys()]).toEqual([SAVE_KEY]);
  });
});


// ---- Village step 1 (v2 on its own key, migration from v1), carried to version 3: the v1 chain ends shifted by +48 ----

import fixture from '../fixtures/legacy-meadow-2026.json';

/** A hand-built v1 save: corners, a removed tree trunk, a placed block, and builds where the cottage and path go. */
function legacySave(): { raw: string; edits: Array<[number, number, number, number]> } {
  const trunk = findTreeTrunk();
  const edits: Array<[number, number, number, number]> = [
    [0, 5, 0, BlockId.Bricks], [47, 7, 47, BlockId.Glass], [0, 6, 47, BlockId.Planks], [47, 6, 0, BlockId.Lamp],
    [trunk[0], trunk[1], trunk[2], BlockId.Air], [30, 6, 30, BlockId.Bricks],
    // Inside the starter cottage footprint (x 14..20, z 15..21) and on its walls and floor.
    [16, 8, 18, BlockId.Grass], [14, 9, 15, BlockId.Glass], [17, 7, 17, BlockId.Dirt], [20, 9, 21, BlockId.Planks],
    // On the route out of the spawn (z 23..25) and the cottage link.
    [26, 7, 24, BlockId.Air], [27, 7, 25, BlockId.Air], [28, 8, 24, BlockId.Bricks], [22, 7, 17, BlockId.Air],
    // Where Granny's tree used to be cleared: his own wood must stay.
    [36, 7, 17, BlockId.Wood],
  ];
  for (let i = 0; i < 25; i++) edits.push([5 + i, 12, 40, BlockId.Stone]);
  const v1 = {
    version: 1, seed: 2026, edits,
    inventory: { [BlockId.Wood]: 12, [BlockId.Bricks]: 99, [BlockId.Lamp]: 3 },
    player: legacyPlayer(), order: [BlockId.Bricks, BlockId.Wood, BlockId.Lamp],
  };
  return { raw: JSON.stringify(v1), edits };
}

/** Standing on open v1 meadow far from every stamp. */
function legacyPlayer(): { x: number; y: number; z: number } {
  const { world } = generateMeadowStageForTests();
  return { x: 10.5, y: world.topSolidY(10, 4) + 1, z: 4.5 };
}

function findTreeTrunk(): [number, number, number] {
  const { world } = generateMeadowStageForTests();
  for (let x = 8; x < 40; x++) for (let z = 8; z < 40; z++) {
    for (let y = 1; y < 16; y++) if (world.get(x, y, z) === BlockId.Wood) return [x, y, z];
  }
  throw new Error('no tree');
}

import { generateMeadowStage as generateMeadowStageForTests } from '../../src/core/worldgen';

const shift = (e: number[]): [number, number, number, number] => [e[0] + 48, e[1] + 48, e[2] + 48, e[3]];
const shiftedPlayer = (p: { x: number; y: number; z: number }) => ({ x: p.x + 48, y: p.y + 48, z: p.z + 48 });

describe('save v3 and migration from v1', () => {
  test('migrates v1 to v3 carrying everything over (shifted by 48 into the big world)', () => {
    const { raw, edits } = legacySave();
    const data = parseSave(raw)!;
    expect(data.version).toBe(3);
    expect(data.migratedFrom).toBe(1);
    expect(data.gen).toBe(1);
    expect(data.seed).toBe(2026);
    expect(data.edits).toEqual(edits.map(shift));
    expect(data.inventory).toEqual({ [BlockId.Wood]: 12, [BlockId.Bricks]: 99, [BlockId.Lamp]: 3 });
    expect(data.order).toEqual([BlockId.Bricks, BlockId.Wood, BlockId.Lamp]);
    expect(data.player).toEqual(shiftedPlayer(legacyPlayer()));
    expect(data.flags.ledToVillage).toBe(false);
    expect(migrateV1(JSON.parse(raw)).edits).toEqual(edits);
  });

  test('keeps every edit at its coordinates, the bag, the order and his position', () => {
    const { raw, edits } = legacySave();
    const restored = applySave(parseSave(raw)!);
    for (const [x, y, z, id] of edits.map(shift)) expect(restored.world.get(x, y, z), `${x},${y},${z}`).toBe(id);
    expect(restored.world.edits()).toEqual(edits.map(shift));
    expect(restored.inventory.count(BlockId.Bricks)).toBe(99);
    expect(restored.inventory.hotbar()).toEqual([BlockId.Bricks, BlockId.Wood, BlockId.Lamp]);
    expect(restored.spawn).toEqual(shiftedPlayer(legacyPlayer()));
  });

  test('edits win over stamps (cottage, path)', () => {
    const { raw } = legacySave();
    const fresh = generateWorld(2026).world;
    const restored = applySave(parseSave(raw)!).world;
    const at = (w: typeof fresh, x: number, y: number, z: number) => w.get(x + 48, y + 48, z + 48);
    // Sanity: these cells really are stamped differently in the fresh world.
    expect(at(fresh, 16, 8, 18)).not.toBe(BlockId.Grass);
    expect(at(restored, 16, 8, 18)).toBe(BlockId.Grass);
    expect(at(restored, 14, 9, 15)).toBe(BlockId.Glass);
    expect(at(restored, 20, 9, 21)).toBe(BlockId.Planks);
    expect(at(restored, 26, 7, 24)).toBe(BlockId.Air);
    expect(at(restored, 28, 8, 24)).toBe(BlockId.Bricks);
    expect(at(restored, 36, 7, 17)).toBe(BlockId.Wood);
  });

  test('a legacy save with no edits matches the fixture meadow outside the stamps', () => {
    const data = parseSave(JSON.stringify({
      version: 1, seed: 2026, edits: [], inventory: {}, player: { x: 24.5, y: fixture.spawn.y, z: 24.5 },
    }))!;
    const { world, spawn } = applySave(data);
    expect(spawn.y).toBe(fixture.spawn.y + 48);
    expect(world.sizeX).toBe(192);
    expect(world.edits()).toEqual([]);
  });

  test('keeps player position on standable ground, else falls back to the spawn', () => {
    const game = makeGame(2026);
    const base = parseSave(legacySave().raw)!;
    const ok = applySave(base);
    expect(isStandable(ok.world, [58, Math.floor(base.player.y), 52])).toBe(true);
    expect(ok.spawn).toEqual(base.player);
    const inWall = applySave({ ...base, edits: [], player: { x: 62.5, y: 57, z: 66.5 } }); // the cottage wall (old 14.5, 9, 18.5)
    expect(inWall.spawn).toEqual(game.player.pos);
  });

  test('v1 edit outside 48 is skipped; v2 allows up to 95/19/95 (then shifted); v3 up to 191/67/191', () => {
    const v1 = JSON.parse(legacySave().raw);
    expect(parseSave(JSON.stringify({ ...v1, edits: [[60, 5, 5, BlockId.Stone]] }))!.edits).toEqual([]);
    expect(parseSave(JSON.stringify({ ...validSave(), version: 2, edits: [[95, 19, 95, BlockId.Stone]] }))!.edits).toEqual([[143, 67, 143, BlockId.Stone]]);
    expect(parseSave(JSON.stringify({ ...validSave(), version: 2, edits: [[96, 19, 95, BlockId.Stone]] }))!.edits).toEqual([]);
    expect(parseSave(JSON.stringify({ ...validSave(), edits: [[191, 67, 191, BlockId.Stone]] }))!.edits).toEqual([[191, 67, 191, BlockId.Stone]]);
    expect(parseSave(JSON.stringify({ ...validSave(), edits: [[192, 67, 191, BlockId.Stone]] }))!.edits).toEqual([]);
  });

  test('accepts new block ids in edits and bag', () => {
    const data = parseSave(JSON.stringify({
      ...validSave(), edits: [[5, 5, 5, BlockId.PathStone], [5, 6, 5, BlockId.Lamp]],
      inventory: { [BlockId.RoofTile]: 4, [BlockId.DoorFrame]: 2 },
    }))!;
    expect(data.edits).toHaveLength(2);
    expect(data.inventory).toEqual({ [BlockId.RoofTile]: 4, [BlockId.DoorFrame]: 2 });
  });

  test('flags round-trip', () => {
    const game = makeGame();
    const data = serialise(game, 1234, { ledToVillage: true });
    expect(parseSave(JSON.stringify(data))!.flags.ledToVillage).toBe(true);
    expect(applySave(data).flags.ledToVillage).toBe(true);
  });

  test('migration leaves the v1 key byte-identical and backs it up', () => {
    const { raw } = legacySave();
    localStorage.setItem(LEGACY_SAVE_KEY, raw);
    const data = readSave(localStorage)!;
    expect(data.version).toBe(3);
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe(raw);
    expect(localStorage.getItem(BACKUP_KEY)).toBe(raw);
  });

  test('v3 is written to its own key (never the v1 or v2 key)', () => {
    const { raw } = legacySave();
    localStorage.setItem(LEGACY_SAVE_KEY, raw);
    readSave(localStorage);
    const stored = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    expect(stored.version).toBe(3);
    expect(localStorage.getItem(V2_SAVE_KEY)).toBeNull();
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(true);
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe(raw);
  });

  test('autosave never writes the v1 key', () => {
    vi.useFakeTimers();
    const { raw } = legacySave();
    localStorage.setItem(LEGACY_SAVE_KEY, raw);
    const game = new Game(applySave(readSave(localStorage)!));
    const stop = startAutosave(game, 2026, localStorage);
    game.world.set(88, 58, 88, BlockId.Stone);
    vi.advanceTimersByTime(10_000);
    stop();
    vi.useRealTimers();
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe(raw);
    expect(localStorage.getItem(V2_SAVE_KEY)).toBeNull();
    expect(readSave(localStorage)!.edits.some(e => e[0] === 88 && e[1] === 58)).toBe(true);
  });

  test('second launch loads v3 and does not migrate again', () => {
    const { raw } = legacySave();
    localStorage.setItem(LEGACY_SAVE_KEY, raw);
    readSave(localStorage);
    const game = new Game(applySave(readSave(localStorage)!));
    game.world.set(89, 58, 89, BlockId.Stone);
    expect(storeSave(localStorage, serialise(game, 2026))).toBe(true);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const again = readSave(localStorage)!;
    expect(write).not.toHaveBeenCalled();
    expect(again.edits.some(e => e[0] === 89)).toBe(true);
  });

  test('a corrupt v3 does NOT fall back to migrating v1: kept, copied to .bad, a fresh world in memory', () => {
    const { raw } = legacySave();
    localStorage.setItem(LEGACY_SAVE_KEY, raw);
    localStorage.setItem(SAVE_KEY, '{oops');
    expect(readSave(localStorage)).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBe('{oops');
    expect(localStorage.getItem(BAD_V3_KEY)).toBe('{oops');
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe(raw);
  });

  test('the backup is never overwritten', () => {
    const { raw } = legacySave();
    localStorage.setItem(BACKUP_KEY, 'first backup');
    localStorage.setItem(LEGACY_SAVE_KEY, raw);
    readSave(localStorage);
    expect(localStorage.getItem(BACKUP_KEY)).toBe('first backup');
  });

  test('a full storage that refuses the backup still migrates', () => {
    const { raw, edits } = legacySave();
    localStorage.setItem(LEGACY_SAVE_KEY, raw);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === BACKUP_KEY) throw new Error('Quota');
      real.call(this, k, v);
    });
    expect(readSave(localStorage)!.edits).toEqual(edits.map(shift));
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    expect(localStorage.getItem(BACKUP_KEY)).toBeNull();
  });

  test('newer saves and unknown versions never crash and are never overwritten', () => {
    const newer = JSON.stringify({ ...validSave(), version: 4, extra: 'later' });
    localStorage.setItem(SAVE_KEY, newer);
    expect(readSave(localStorage)).toBeNull();
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(false);
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);
  });

  test('a higher stored gen is never lowered', () => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...validSave(), gen: 5 }));
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(true);
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).gen).toBe(5);
  });

  test('a bad v3 payload is backed up once (v1 is not used instead)', () => {
    const { raw } = legacySave();
    localStorage.setItem(LEGACY_SAVE_KEY, raw);
    localStorage.setItem(SAVE_KEY, '{"version":3,"broken":true}');
    expect(readSave(localStorage)).toBeNull();
    expect(localStorage.getItem(BAD_V3_KEY)).toBe('{"version":3,"broken":true}');
    // A second bad v3 never overwrites the first backup.
    localStorage.setItem(SAVE_KEY, 'garbage');
    readSave(localStorage);
    expect(localStorage.getItem(BAD_V3_KEY)).toBe('{"version":3,"broken":true}');
  });

  test('no backup when v3 is simply absent', () => {
    localStorage.setItem(LEGACY_SAVE_KEY, legacySave().raw);
    readSave(localStorage);
    expect(localStorage.getItem(BAD_V3_KEY)).toBeNull();
  });

  test.each([1, 2, 3])('a v%i saved position inside any house footprint falls back to spawn', version => {
    const { village, spawn } = generateWorld(1234);
    for (const house of village.houses) {
      const r = house.rect;
      const world = { x: r.x0 + 1.5, y: house.groundY + 1, z: r.z0 + 1.5 };
      // v1 and v2 saves hold meadow coordinates (48 less on every axis).
      const meadow = { x: world.x - 48, y: world.y - 48, z: world.z - 48 };
      const raw = version === 1
        ? JSON.stringify({ version: 1, seed: 1234, edits: [], inventory: {}, player: meadow })
        : version === 2 ? JSON.stringify({ ...validSave(), version: 2, player: meadow })
          : JSON.stringify({ ...validSave(), player: world });
      const parsed = parseSave(raw);
      // v1 saves only validate inside the old 48x48 meadow; the cottage is the one that can be there.
      if (!parsed) { expect(version).toBe(1); continue; }
      expect(applySave(parsed).spawn, house.id).toEqual(spawn);
    }
  });

  test('the reset key list covers v3, v2, v1 and the backups', () => {
    expect([...ALL_SAVE_KEYS]).toEqual(expect.arrayContaining([BACKUP_KEY, BAD_V3_KEY, LEGACY_SAVE_KEY, SAVE_KEY, V2_SAVE_KEY]));
  });
});

describe('save safety: damaged, unreadable and failing storage', () => {
  const PLANK_EDIT = [30, 6, 30, BlockId.Planks];
  const lossyV3 = (): string => JSON.stringify({ ...validSave(), edits: [PLANK_EDIT, [1, 2, 3, 999]] });
  const throwOn = (keys: string[], what: 'getItem' | 'setItem') => {
    const real = Storage.prototype[what] as (this: Storage, ...a: string[]) => string | null | void;
    return vi.spyOn(Storage.prototype, what).mockImplementation(function (this: Storage, k: string, v?: string) {
      if (keys.includes(k)) throw new Error('blocked');
      return (real as (this: Storage, k: string, v?: string) => string | null | void).call(this, k, v);
    } as never);
  };

  test('S1: a damaged v3 keeps its valid edits and is preserved once before the next save', () => {
    const raw = lossyV3();
    localStorage.setItem(SAVE_KEY, raw);
    localStorage.setItem(LEGACY_SAVE_KEY, legacySave().raw);
    const data = readSave(localStorage)!;
    expect(data.edits).toEqual([PLANK_EDIT]); // not v1's edits
    expect(localStorage.getItem(BAD_V3_KEY)).toBe(raw);
    const game = new Game(applySave(data));
    expect(storeSave(localStorage, serialise(game, 1234))).toBe(true);
    expect(parseSave(localStorage.getItem(SAVE_KEY))!.edits).toEqual([PLANK_EDIT]);
    expect(localStorage.getItem(BAD_V3_KEY)).toBe(raw);
  });

  test('S1: if the copy of a damaged v3 cannot be kept, v3 is not replaced and the next tick retries', () => {
    vi.useFakeTimers();
    const raw = lossyV3();
    localStorage.setItem(SAVE_KEY, raw);
    throwOn([BAD_V3_KEY, `${BAD_V3_KEY}.2`, `${BAD_V3_KEY}.3`, `${BAD_V3_KEY}.4`], 'setItem');
    const data = readSave(localStorage)!;
    const game = new Game(applySave(data));
    const stop = startAutosave(game, 1234, localStorage);
    game.world.set(24, 1, 24, BlockId.Air);
    vi.advanceTimersByTime(10_000);
    expect(localStorage.getItem(SAVE_KEY)).toBe(raw); // untouched
    vi.restoreAllMocks();
    vi.advanceTimersByTime(10_000); // the copy works now: the retry saves and the original is kept
    expect(localStorage.getItem(BAD_V3_KEY)).toBe(raw);
    expect(parseSave(localStorage.getItem(SAVE_KEY))!.edits).toEqual(expect.arrayContaining([PLANK_EDIT]));
    expect(parseSave(localStorage.getItem(SAVE_KEY))!.edits).toHaveLength(2);
    stop();
    vi.useRealTimers();
  });

  test('S2: a corrupt v3 plus v1: when the .bad write throws, v3 is not overwritten by the older v1', () => {
    localStorage.setItem(SAVE_KEY, '{"version":3,"broken":true}');
    localStorage.setItem(LEGACY_SAVE_KEY, legacySave().raw);
    throwOn([BAD_V3_KEY, `${BAD_V3_KEY}.2`, `${BAD_V3_KEY}.3`, `${BAD_V3_KEY}.4`], 'setItem');
    const data = readSave(localStorage);
    expect(data).toBeNull(); // he still plays (a fresh world in memory); the older v1 is never loaded over it
    expect(localStorage.getItem(SAVE_KEY)).toBe('{"version":3,"broken":true}');
  });

  test('a second damaged payload goes to a spare slot, the first copy is never overwritten', () => {
    localStorage.setItem(LEGACY_SAVE_KEY, legacySave().raw);
    localStorage.setItem(SAVE_KEY, 'garbage-one');
    readSave(localStorage);
    localStorage.setItem(SAVE_KEY, 'garbage-two');
    readSave(localStorage);
    expect(localStorage.getItem(BAD_V3_KEY)).toBe('garbage-one');
    expect(localStorage.getItem(`${BAD_V3_KEY}.2`)).toBe('garbage-two');
  });

  test('S3: a throwing v3 READ is not "absent": v1 is not migrated and nothing is written', () => {
    const v2 = JSON.stringify({ ...validSave(), edits: [PLANK_EDIT] });
    localStorage.setItem(SAVE_KEY, v2);
    localStorage.setItem(LEGACY_SAVE_KEY, legacySave().raw);
    const spy = throwOn([SAVE_KEY], 'getItem');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    expect(readSave(localStorage)).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(false);
    expect(write).not.toHaveBeenCalled();
    spy.mockRestore();
    write.mockRestore();
    // The storage reads again, but this page started blind: it still never overwrites what it now finds.
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(false);
    expect(localStorage.getItem(SAVE_KEY)).toBe(v2);
  });

  test('S3: a throwing read of a version-4 guard cannot be overwritten', () => {
    const newer = JSON.stringify({ ...validSave(), version: 4 });
    localStorage.setItem(SAVE_KEY, newer);
    throwOn([SAVE_KEY], 'getItem');
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(false);
    vi.restoreAllMocks();
    expect(localStorage.getItem(SAVE_KEY)).toBe(newer);
  });

  test('S3: a throwing v1 read with no v3 or v2 does not start a blind overwrite either', () => {
    localStorage.setItem(LEGACY_SAVE_KEY, legacySave().raw);
    throwOn([LEGACY_SAVE_KEY], 'getItem');
    expect(readSave(localStorage)).toBeNull();
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    vi.restoreAllMocks();
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(false); // v1 holds a world we did not load
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  test('S3: blind start on a truly empty storage may save once the storage reads again', () => {
    throwOn([SAVE_KEY], 'getItem');
    expect(readSave(localStorage)).toBeNull();
    vi.restoreAllMocks();
    expect(storeSave(localStorage, serialise(makeGame(), 1234))).toBe(true);
  });

  test('S4: a failed migration write is retried by the autosave even though nothing is dirty', () => {
    vi.useFakeTimers();
    localStorage.setItem(LEGACY_SAVE_KEY, legacySave().raw);
    const real = Storage.prototype.setItem;
    let failing = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (failing && k === SAVE_KEY) throw new Error('Quota');
      real.call(this, k, v);
    });
    const data = readSave(localStorage)!;
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    const game = new Game(applySave(data)); // markClean: nothing is dirty
    const stop = startAutosave(game, data.seed, localStorage);
    vi.advanceTimersByTime(10_000);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    failing = false;
    vi.advanceTimersByTime(10_000);
    expect(localStorage.getItem(SAVE_KEY)).not.toBeNull();
    stop();
    vi.useRealTimers();
  });

  test('S4: walking more than a block with no other change is saved; a small step is not', () => {
    vi.useFakeTimers();
    const game = makeGame();
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const stop = startAutosave(game, 1234, localStorage);
    game.player.pos.x += 0.6;
    vi.advanceTimersByTime(10_000);
    expect(write).not.toHaveBeenCalled();
    game.player.pos.x += 3;
    vi.advanceTimersByTime(10_000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(readSave(localStorage)!.player.x).toBeCloseTo(game.player.pos.x);
    vi.advanceTimersByTime(20_000);
    expect(write).toHaveBeenCalledTimes(1);
    stop();
    vi.useRealTimers();
  });
});

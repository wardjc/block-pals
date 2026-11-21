// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ORIGIN, V2_WORLD, WORLD, fromWorld, toWorld, type Cell3 } from '../../src/core/bounds';
import { mulberry32 } from '../../src/core/rng';
import {
  BACKUP_KEY, BACKUP_V2_KEY, LEGACY_SAVE_KEY, SAVE_KEY, V2_SAVE_KEY, applySave, inspectSave, migrateV1, parseSave, readSave,
  serialise, shiftV2, startAutosave, storeSave, type SaveDataV2,
} from '../../src/core/save';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { loadWorldFixture, saveFixtureRaw } from '../helpers/fixtures';

const v2Raw = saveFixtureRaw('v2-extremes');
const v2 = (): SaveDataV2 => JSON.parse(v2Raw) as SaveDataV2;
const plus = ([x, y, z]: number[]): number[] => [x + 48, y + 48, z + 48];

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

/** A Storage that records every write and removal, so tests can prove the old keys are never touched. */
function recordingStorage(initial: Record<string, string> = {}): { storage: Storage; writes: string[]; removes: string[]; map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  const writes: string[] = [];
  const removes: string[] = [];
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); map.set(k, v); },
    removeItem: (k: string) => { removes.push(k); map.delete(k); },
    clear: () => { throw new Error('clear is never called'); },
    key: () => null,
    get length() { return map.size; },
  } as unknown as Storage;
  return { storage, writes, removes, map };
}

describe('shiftV2: exact and complete', () => {
  test('every edit of v2-extremes lands at +48,+48,+48 with the same id (Air removals too)', () => {
    const before = v2();
    const after = shiftV2(before);
    expect(after.edits).toHaveLength(before.edits.length);
    before.edits.forEach((e, i) => expect(after.edits[i]).toEqual([e[0] + 48, e[1] + 48, e[2] + 48, e[3]]));
    expect(after.edits).toContainEqual([96, 54, 96, BlockId.Air]); // the removal at old (48, 6, 48)
  });

  test('player, crops, trees and animals shift; every other field is byte-identical', () => {
    const before = v2();
    const after = shiftV2(before);
    expect(after.version).toBe(3);
    expect(after.migratedFrom).toBe(2);
    expect(after.origin).toEqual([48, 48, 48]);
    expect(after.player).toEqual({ x: before.player.x + 48, y: before.player.y + 48, z: before.player.z + 48 });
    expect(after.crops).toEqual(before.crops!.map(c => [...plus(c), c[3]]));
    expect(after.trees).toEqual(before.trees!.map(t => [...plus(t), t[3], t[4]]));
    expect(after.animals).toEqual(before.animals!.map(a => [a[0], a[1] + 48, a[2] + 48, a[3] + 48, a[4], a[5]]));
    for (const key of ['seed', 'gen', 'inventory', 'order', 'items', 'itemOrder', 'savedAt', 'flags'] as const) {
      expect(JSON.stringify(after[key]), key).toBe(JSON.stringify(before[key]));
    }
    const known = new Set(['version', 'gen', 'origin', 'migratedFrom', 'seed', 'edits', 'inventory', 'player', 'order', 'items', 'itemOrder', 'savedAt', 'crops', 'trees', 'animals', 'flags']);
    expect(Object.keys(after).filter(k => !known.has(k))).toEqual([]);
  });

  test('an animal at x 0.5 keeps its fractional part (48.5), and one at z 94.5 is at 142.5', () => {
    const after = shiftV2(v2());
    expect(after.animals![0][1]).toBe(48.5);
    expect(after.animals![1][3]).toBe(142.5);
  });

  test('shiftV2 does not mutate its input and shares no arrays with it', () => {
    const before = v2();
    const copy = structuredClone(before);
    const after = shiftV2(before);
    expect(before).toEqual(copy);
    after.edits[0][0] = -1;
    after.inventory[3] = 1;
    after.flags.hints!.push('x');
    after.order!.push(1);
    expect(before).toEqual(copy);
  });
});

describe('the same relative place', () => {
  test('property: for 2,000 random in-box edits, fromWorld(shifted) equals the original', () => {
    const random = mulberry32(99);
    const edits: SaveDataV2['edits'] = [];
    for (let i = 0; i < 2000; i++) {
      edits.push([Math.floor(random() * V2_WORLD.x), Math.floor(random() * V2_WORLD.y), Math.floor(random() * V2_WORLD.z), BlockId.Planks]);
    }
    const after = shiftV2({ ...v2(), edits });
    after.edits.forEach((e, i) => {
      expect(fromWorld([e[0], e[1], e[2]])).toEqual(edits[i].slice(0, 3));
      expect(e[0] < WORLD.x && e[1] < WORLD.y && e[2] < WORLD.z).toBe(true);
    });
  });

  test('applySave on the migrated fixture puts every block at the same cell relative to the village (doors)', () => {
    const fixture = loadWorldFixture();
    const data = parseSave(v2Raw)!;
    const loaded = applySave(data);
    for (const [i, house] of fixture.layout.houses.entries()) {
      const oldDoor = house.doorFront;
      const newDoor = loaded.village.houses[i].doorFront;
      for (const [x, y, z, id] of v2().edits) {
        const rel = [x - oldDoor[0], y - oldDoor[1], z - oldDoor[2]];
        expect(loaded.world.get(newDoor[0] + rel[0], newDoor[1] + rel[1], newDoor[2] + rel[2]), `${house.id} ${x},${y},${z}`).toBe(id);
      }
    }
    // And relative to the pasture and the bed of the farm plot.
    const pa = loaded.village.farm.pasture;
    expect([pa.x0 - fixture.layout.pasture.x0, pa.z0 - fixture.layout.pasture.z0]).toEqual([48, 48]);
  });
});

describe('extreme edits', () => {
  test('corner edits [0,1,0] and [95,19,95] survive and are inside the 192 box', () => {
    const data = parseSave(v2Raw)!;
    expect(data.edits).toContainEqual([48, 49, 48, BlockId.Bricks]);
    expect(data.edits).toContainEqual([143, 67, 143, BlockId.Bricks]);
    const loaded = applySave(data);
    expect(loaded.world.get(48, 49, 48)).toBe(BlockId.Bricks);
    expect(loaded.world.get(143, 67, 143)).toBe(BlockId.Bricks); // the very top of the world
    expect(loaded.world.get(48, 67, 48)).toBe(BlockId.Lamp);
    for (const [x, y, z, id] of data.edits) {
      expect(loaded.world.inBounds(x, y, z)).toBe(true);
      expect(loaded.world.get(x, y, z)).toBe(id);
    }
    expect(loaded.world.edits()).toHaveLength(data.edits.length);
  });

  test('an edit at old y 0 (now 48) is kept; anything past the old box is skipped before the shift', () => {
    const raw = JSON.stringify({ ...v2(), edits: [[10, 0, 10, BlockId.Planks], [96, 1, 1, BlockId.Planks], [1, 20, 1, BlockId.Planks], [-1, 1, 1, BlockId.Planks]] });
    const checked = inspectSave(raw)!;
    expect(checked.data.edits).toEqual([[58, 48, 58, BlockId.Planks]]);
    expect(checked.skipped).toBe(3);
    expect(applySave(checked.data).world.get(58, 48, 58)).toBe(BlockId.Planks);
  });

  test('v1 extremes ([0,1,0], [47,15,47], [46,1,1]) survive the chain', () => {
    const data = parseSave(saveFixtureRaw('v1-extremes'))!;
    expect(data.version).toBe(3);
    expect(data.migratedFrom).toBe(1);
    expect(data.edits).toEqual(expect.arrayContaining([[48, 49, 48, BlockId.Planks], [95, 63, 95, BlockId.Glass], [94, 49, 49, BlockId.Air]]));
    const loaded = applySave(data);
    for (const [x, y, z, id] of data.edits) expect(loaded.world.get(x, y, z)).toBe(id);
  });

  test('chain: v1 save to v3 equals v1 to v2 (the step 2 function) then shiftV2', () => {
    const raw = saveFixtureRaw('v1-extremes');
    expect(parseSave(raw)).toEqual({ ...shiftV2(migrateV1(JSON.parse(raw))), migratedFrom: 1 });
  });

  test('crops, trees and animals at the extremes shift and are restored at the shifted cells', () => {
    const data = parseSave(v2Raw)!;
    expect(data.crops).toEqual([[120, 54, 83, 1234], [50, 56, 141, 0]]);
    expect(data.trees).toEqual([[51, 55, 51, 0, 5000], [141, 55, 50, 1, 100]]);
    const loaded = applySave(data);
    for (const c of loaded.farm.crops) expect([BlockId.Wheat1, BlockId.Carrot0]).toContain(loaded.world.get(c.x, c.y, c.z));
    for (const t of loaded.farm.trees) expect(loaded.world.get(t.x, t.y, t.z)).toBe(BlockId.Sapling);
    expect(loaded.animals.map(a => [a[1], a[2], a[3]])).toEqual([[48.5, 54, 97.5], [118.5, 54, 142.5]]);
  });
});

describe('player position', () => {
  test('his saved spot at spawn is kept, shifted', () => {
    const loaded = applySave(parseSave(v2Raw)!);
    expect(loaded.spawn).toEqual({ x: 72.5, y: 56, z: 72.5 });
  });

  test('the far corner spot is kept, shifted (standable ground)', () => {
    const corner = JSON.parse(saveFixtureRaw('v2-extremes-corner')) as SaveDataV2;
    const loaded = applySave(parseSave(JSON.stringify(corner))!);
    expect(loaded.spawn).toEqual({ x: corner.player.x + 48, y: corner.player.y + 48, z: corner.player.z + 48 });
  });

  test('a spot inside a house footprint or inside a wall falls back to the spawn (step 1 rule)', () => {
    const fixture = loadWorldFixture();
    const { spawn } = generateWorld(2026);
    for (const house of fixture.layout.houses) {
      const r = house.rect;
      const inHouse = { ...v2(), player: { x: r.x0 + 1.5, y: house.doorInside[1], z: r.z0 + 1.5 } };
      expect(applySave(parseSave(JSON.stringify(inHouse))!).spawn, house.id).toEqual(spawn);
    }
    const cottage = fixture.layout.houses[0];
    const inWall = { ...v2(), edits: [], player: { x: cottage.rect.x0 + 0.5, y: cottage.doorInside[1], z: cottage.rect.z0 + 3.5 } };
    expect(applySave(parseSave(JSON.stringify(inWall))!).spawn).toEqual(spawn);
  });
});

describe('idempotent migration', () => {
  test('migrating the same v2 payload twice gives byte-identical v3', () => {
    expect(JSON.stringify(parseSave(v2Raw))).toBe(JSON.stringify(parseSave(v2Raw)));
    expect(JSON.stringify(shiftV2(v2()))).toBe(JSON.stringify(shiftV2(v2())));
  });

  test('reading twice (write succeeded) returns the same data and never shifts again', () => {
    localStorage.setItem(V2_SAVE_KEY, v2Raw);
    const first = readSave(localStorage)!;
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).version).toBe(3);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const second = readSave(localStorage)!;
    expect(write).not.toHaveBeenCalled();
    expect(second).toEqual({ ...first, gen: first.gen });
    expect(second.edits).toEqual(first.edits);
    expect(second.player).toEqual(first.player);
  });

  test('reading after a failed write re-migrates from the untouched v2 and gives the same result', () => {
    localStorage.setItem(V2_SAVE_KEY, v2Raw);
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === SAVE_KEY) throw new Error('Quota');
      real.call(this, k, v);
    });
    const first = readSave(localStorage)!;
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    spy.mockRestore();
    const second = readSave(localStorage)!;
    expect(second).toEqual(first);
    expect(localStorage.getItem(V2_SAVE_KEY)).toBe(v2Raw);
  });

  test('a v3 save is never shifted', () => {
    const v3 = parseSave(v2Raw)!;
    expect(parseSave(JSON.stringify(v3))).toEqual(v3);
    localStorage.setItem(SAVE_KEY, JSON.stringify(v3));
    localStorage.setItem(V2_SAVE_KEY, v2Raw);
    expect(readSave(localStorage)).toEqual(v3);
  });
});

describe('rollback safe: the v1 and v2 keys are never written', () => {
  test('the v2 and v1 keys are byte-identical after read, after write, after 3 autosaves', () => {
    vi.useFakeTimers();
    const v1Raw = saveFixtureRaw('v1-extremes');
    localStorage.setItem(V2_SAVE_KEY, v2Raw);
    localStorage.setItem(LEGACY_SAVE_KEY, v1Raw);
    const data = readSave(localStorage)!;
    expect(localStorage.getItem(V2_SAVE_KEY)).toBe(v2Raw);
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe(v1Raw);
    const game = new Game(applySave(data));
    expect(storeSave(localStorage, serialise(game, data.seed))).toBe(true);
    const stop = startAutosave(game, data.seed, localStorage);
    for (let i = 0; i < 3; i++) {
      game.world.set(100 + i, 60, 100, BlockId.Stone);
      vi.advanceTimersByTime(10_000);
    }
    stop();
    expect(localStorage.getItem(V2_SAVE_KEY)).toBe(v2Raw);
    expect(localStorage.getItem(LEGACY_SAVE_KEY)).toBe(v1Raw);
    expect(readSave(localStorage)!.edits).toEqual(expect.arrayContaining([[102, 60, 100, BlockId.Stone]]));
  });

  test('no code path calls setItem or removeItem on the v1 or v2 key (recording storage)', () => {
    vi.useFakeTimers();
    const scenarios: Array<Record<string, string>> = [
      { [V2_SAVE_KEY]: v2Raw },
      { [LEGACY_SAVE_KEY]: saveFixtureRaw('v1-extremes') },
      { [V2_SAVE_KEY]: v2Raw, [LEGACY_SAVE_KEY]: saveFixtureRaw('v1-extremes') },
      { [V2_SAVE_KEY]: '{broken', [LEGACY_SAVE_KEY]: saveFixtureRaw('v1-extremes') },
      { [V2_SAVE_KEY]: JSON.stringify({ ...v2(), edits: [[1, 1, 1, 999], ...v2().edits] }) },
      { [SAVE_KEY]: '{damaged v3', [V2_SAVE_KEY]: v2Raw },
      { [SAVE_KEY]: JSON.stringify({ version: 4 }), [V2_SAVE_KEY]: v2Raw },
      {},
    ];
    for (const initial of scenarios) {
      const { storage, writes, removes, map } = recordingStorage(initial);
      const data = readSave(storage);
      const game = new Game(data ? applySave(data) : generateWorld(2026));
      storeSave(storage, serialise(game, 2026));
      const stop = startAutosave(game, 2026, storage);
      game.world.set(100, 60, 100, BlockId.Stone);
      vi.advanceTimersByTime(30_000);
      window.dispatchEvent(new Event('pagehide'));
      stop();
      expect(writes.filter(k => k === V2_SAVE_KEY || k === LEGACY_SAVE_KEY), JSON.stringify(Object.keys(initial))).toEqual([]);
      expect(removes).toEqual([]);
      for (const key of [V2_SAVE_KEY, LEGACY_SAVE_KEY]) expect(map.get(key) ?? null).toBe(initial[key] ?? null);
    }
  });
});

describe('backups', () => {
  test('the raw v2 payload is copied once to blockpals.save.v2.backup and never overwritten', () => {
    localStorage.setItem(V2_SAVE_KEY, v2Raw);
    readSave(localStorage);
    expect(localStorage.getItem(BACKUP_V2_KEY)).toBe(v2Raw);
    // A second migration (v3 gone) with a different v2 leaves the first copy.
    localStorage.removeItem(SAVE_KEY);
    const other = JSON.stringify({ ...v2(), seed: 7 });
    localStorage.setItem(V2_SAVE_KEY, other);
    expect(readSave(localStorage)!.seed).toBe(7);
    expect(localStorage.getItem(BACKUP_V2_KEY)).toBe(v2Raw);
  });

  test('a failed backup write does not stop the load (or the v3 write)', () => {
    localStorage.setItem(V2_SAVE_KEY, v2Raw);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === BACKUP_V2_KEY) throw new Error('Quota');
      real.call(this, k, v);
    });
    const data = readSave(localStorage)!;
    expect(data.edits).toHaveLength(v2().edits.length);
    expect(localStorage.getItem(BACKUP_V2_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(SAVE_KEY)!).version).toBe(3);
  });

  test('the v1 backup behaves as before (copied once, never overwritten); no v2 backup without a v2', () => {
    const v1Raw = saveFixtureRaw('v1-extremes');
    localStorage.setItem(LEGACY_SAVE_KEY, v1Raw);
    readSave(localStorage);
    expect(localStorage.getItem(BACKUP_KEY)).toBe(v1Raw);
    expect(localStorage.getItem(BACKUP_V2_KEY)).toBeNull();
    localStorage.removeItem(SAVE_KEY);
    localStorage.setItem(BACKUP_KEY, 'first');
    readSave(localStorage);
    expect(localStorage.getItem(BACKUP_KEY)).toBe('first');
  });

  test('a corrupt v2 falls back to the v1 save, and the corrupt v2 is still copied raw to the backup', () => {
    const v1Raw = saveFixtureRaw('v1-extremes');
    localStorage.setItem(V2_SAVE_KEY, '{"version":2,"broken":true}');
    localStorage.setItem(LEGACY_SAVE_KEY, v1Raw);
    const data = readSave(localStorage)!;
    expect(data.migratedFrom).toBe(1);
    expect(localStorage.getItem(V2_SAVE_KEY)).toBe('{"version":2,"broken":true}');
    expect(localStorage.getItem(BACKUP_V2_KEY)).toBe('{"version":2,"broken":true}');
  });
});

describe('damaged v2 payloads', () => {
  test('a v2 payload with a bad inventory keeps the builds; one bad edit never costs the rest', () => {
    const raw = JSON.stringify({ ...v2(), inventory: { 999: 3 }, edits: [[1, 2, 3, 999], ...v2().edits, 'x'] });
    const checked = inspectSave(raw)!;
    expect(checked.skipped).toBe(2);
    expect(checked.data.edits).toHaveLength(v2().edits.length);
    expect(checked.data.inventory).toEqual({});
    expect(checked.data.items).toEqual(v2().items);
  });

  test('bad crop, tree and animal entries are dropped one by one (validated in the 96 box, then shifted)', () => {
    const raw = JSON.stringify({
      ...v2(),
      crops: [[96, 6, 1, 0], [1, 6, 1, 0]],
      trees: [[1, 20, 1, 0, 0], [2, 6, 2, 1, 0]],
      animals: [[0, 96.5, 6, 1, 0, 0], [0, 95.5, 6, 1, 0, 0]],
    });
    const data = parseSave(raw)!;
    expect(data.crops).toEqual([[49, 54, 49, 0]]);
    expect(data.trees).toEqual([[50, 54, 50, 1, 0]]);
    expect(data.animals).toEqual([[0, 143.5, 54, 49, 0, 0]]);
  });
});

describe('origin', () => {
  test('toWorld is the shift the migration applies', () => {
    for (const e of v2().edits) expect(toWorld([e[0], e[1], e[2]] as Cell3)).toEqual(plus(e).slice(0, 3));
    expect(ORIGIN).toEqual({ x: 48, y: 48, z: 48 });
  });
});

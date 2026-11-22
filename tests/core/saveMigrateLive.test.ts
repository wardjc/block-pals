// @vitest-environment jsdom
import { beforeAll, describe, expect, test } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { ORIGIN, V2_WORLD } from '../../src/core/bounds';
import { ItemId } from '../../src/core/items';
import { MYTHICAL } from '../../src/core/mythical';
import {
  BACKUP_KEY, BACKUP_V2_KEY, LEGACY_SAVE_KEY, SAVE_KEY, V2_SAVE_KEY, applySave, readSave, serialise, storeSave,
  type Applied, type SaveData,
} from '../../src/core/save';
import { World } from '../../src/core/world';
import { generateMeadowWorld, generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { decodeRle, loadWorldFixture, saveFixtureRaw } from '../helpers/fixtures';

/**
 * The save our player has on the tablet today: version 2 under the v2 key, made by main's gen 3
 * generator (the village, the farm and the wizard's tower on its hill). Built here by RUNNING that
 * generator (the step 2 + tower stages on a plain 96 x 20 x 96 world, exactly what main's
 * generateWorld does) and editing it the way he plays: dig, build, items, the wizard's fields.
 * Then it is migrated by the real readSave and replayed by applySave. Every edit must land at +48
 * on every axis and win; every cell he did not touch must equal the generated old region at +48.
 */
type Edit = [number, number, number, number];
const SEED = 2026;

/** Main's world (gen 3) in meadow coordinates, made by the generator, clean. */
function mainWorld(): { world: World; meadow: ReturnType<typeof generateMeadowWorld> } {
  const world = new World(V2_WORLD.x, V2_WORLD.y, V2_WORLD.z);
  const meadow = generateMeadowWorld(SEED, world);
  world.clearEdits();
  world.markClean();
  return { world, meadow };
}

function recordingStorage(initial: Record<string, string>): { storage: Storage; writes: string[]; removes: string[]; map: Map<string, string> } {
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

const ground = (w: World, x: number, z: number): number => w.topSolidY(x, z);

let pristine: World; // main's world as generated, never edited
let edited: World; // the same world after his play
let v2Raw: string;
let edits: Edit[];
let rec: ReturnType<typeof recordingStorage>;
let migrated: SaveData;
let applied: Applied;
let tower: ReturnType<typeof generateMeadowWorld>['tower']['info'];

beforeAll(() => {
  pristine = mainWorld().world;
  const live = mainWorld();
  edited = live.world;
  tower = live.meadow.tower.info;
  const village = live.meadow.village;
  const w = edited;
  const set = (x: number, y: number, z: number, id: BlockId): void => w.set(x, y, z, id);

  // Dig a staircase down near the spawn, through to the old bottom (y 1; y 0 was bedrock).
  for (let k = 0; k < 6; k++) {
    const x = 28 + k, z = 28;
    for (let y = ground(w, x, z); y >= Math.max(1, ground(w, x, z) - k); y--) set(x, y, z, BlockId.Air);
  }
  // A little brick house with a lamp on the tower's hill, and a mythical block on top.
  const hx = tower.rect.x0 - 3, hz = tower.rect.z0 + 1;
  const hy = ground(w, hx, hz) + 1;
  for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) set(hx - dx, hy + dy, hz + dz, BlockId.Bricks);
  set(hx, hy + 2, hz, BlockId.Lamp);
  set(hx - 1, hy + 2, hz + 1, BlockId.MoonBlock);
  // A window knocked into the tower wall, a block built in the ground room, the top lamp swapped.
  set(tower.rect.x0, tower.groundY + 2, tower.rect.z0 + 2, BlockId.Air);
  set(tower.rect.x0, tower.groundY + 3, tower.rect.z0 + 2, BlockId.Air);
  set(tower.interior.x0, tower.groundY + 1, tower.interior.z1, BlockId.Planks);
  set(...tower.topLamp, BlockId.SunBlock);
  // A PathStone of the tower path dug up, a cobble of the village path replaced.
  const p = live.meadow.tower.route[30];
  set(p[0], p[1] - 1, p[2], BlockId.Air);
  const q = village.route[10];
  set(q[0], q[1] - 1, q[2], BlockId.Glass);
  // Every mythical block placed in a row on the meadow; the very corners and the very top.
  MYTHICAL.forEach((id, i) => set(60 + i, ground(w, 60 + i, 20) + 1, 20, id));
  set(0, 1, 0, BlockId.Bricks);
  set(95, 19, 95, BlockId.Lamp);
  set(1, 19, 94, BlockId.Planks);
  // Wheat on the first farm bed (Farmland under it is generated), and a sapling.
  const bed = village.farm.beds[0];
  const cx = bed.x0 + 1, cz = bed.z0 + 1, cy = ground(w, cx, cz) + 1;
  set(cx, cy, cz, BlockId.Wheat1);
  const sx = 70, sz = 40, sy = ground(w, sx, sz) + 1;
  set(sx, sy, sz, BlockId.Sapling);

  edits = w.edits() as Edit[];
  const payload = {
    version: 2, gen: 3, seed: SEED, edits,
    inventory: { [BlockId.Planks]: 12, [BlockId.Bricks]: 30, [BlockId.StarlightCrystal]: 2, [BlockId.MagicMirror]: 1 },
    order: [BlockId.Planks, BlockId.Bricks, BlockId.StarlightCrystal, BlockId.MagicMirror],
    player: { x: tower.doorFront[0] + 0.5, y: tower.doorFront[1], z: tower.doorFront[2] + 0.5 },
    items: { [ItemId.WheatSeed]: 3, [ItemId.Apple]: 2 },
    itemOrder: [ItemId.Apple, ItemId.WheatSeed],
    savedAt: 1_795_000_000_000,
    crops: [[cx, cy, cz, 1000]],
    trees: [[sx, sy, sz, 0, 2500]],
    animals: [[0, 70.5, 6, 49.5, 30, 0], [3, 60.25, 6, 40.75, 0, 2]],
    flags: { ledToVillage: true, fernSeeds: true, hints: ['plantSome', 'cropReady'] },
    wizard: { gift: true, met: true, led: true, solved: 11, clean: 6, bought: 3, hints: ['seeLight', 'towerHint'] },
  };
  v2Raw = JSON.stringify(payload);
  rec = recordingStorage({ [V2_SAVE_KEY]: v2Raw, [LEGACY_SAVE_KEY]: 'his v1 game' });
  migrated = readSave(rec.storage)!;
  applied = applySave(migrated, payload.savedAt + 1000);
});

describe('his live v2 save (gen 3, the tower) moves into the big world', () => {
  test('the generator used here is main\'s: it equals the gen 3 world frozen from main', () => {
    const frozen = decodeRle(loadWorldFixture(3).rle);
    let mismatches = 0;
    for (let y = 0; y < V2_WORLD.y; y++) for (let z = 0; z < V2_WORLD.z; z++) for (let x = 0; x < V2_WORLD.x; x++) {
      if (pristine.get(x, y, z) !== frozen[x + V2_WORLD.x * (z + V2_WORLD.z * y)]) mismatches++;
    }
    expect(mismatches).toBe(0);
    expect(edits.length).toBeGreaterThan(40);
  });

  test('it is read from the v2 key, written once to the v3 key, and the old keys are never written', () => {
    expect(migrated.version).toBe(3);
    expect(migrated.migratedFrom).toBe(2);
    expect(migrated.gen).toBe(3);
    expect(rec.writes).toEqual([BACKUP_V2_KEY, SAVE_KEY]);
    expect(rec.removes).toEqual([]);
    expect(rec.map.get(V2_SAVE_KEY)).toBe(v2Raw);
    expect(rec.map.get(BACKUP_V2_KEY)).toBe(v2Raw);
    expect(rec.map.get(LEGACY_SAVE_KEY)).toBe('his v1 game');
    expect(rec.map.has(BACKUP_KEY)).toBe(false);
  });

  test('every edit is in the save at +48 on every axis, with the same id, none lost', () => {
    expect(migrated.edits).toEqual(edits.map(([x, y, z, id]) => [x + 48, y + 48, z + 48, id]));
  });

  test('every edit lands in the world at +48 and wins over the regenerated stamps (tower, paths, farm)', () => {
    for (const [x, y, z, id] of edits) {
      expect(applied.world.get(x + ORIGIN.x, y + ORIGIN.y, z + ORIGIN.z), `${x},${y},${z}`).toBe(id);
    }
    // The tower he changed is still the tower (its other blocks regenerate), in world coordinates.
    expect(applied.tower.rect).toEqual({ x0: tower.rect.x0 + 48, z0: tower.rect.z0 + 48, x1: tower.rect.x1 + 48, z1: tower.rect.z1 + 48 });
    expect(applied.world.get(tower.rect.x0 + 48, tower.groundY + 48 + 4, tower.rect.z0 + 2 + 48)).toBe(BlockId.Stone);
  });

  test('every old-region cell he did not touch equals the generated old region at +48', () => {
    const touched = new Set(edits.map(([x, y, z]) => `${x},${y},${z}`));
    let checked = 0;
    for (let y = 1; y < V2_WORLD.y; y++) for (let z = 0; z < V2_WORLD.z; z++) for (let x = 0; x < V2_WORLD.x; x++) {
      if (touched.has(`${x},${y},${z}`)) continue;
      const got = applied.world.get(x + 48, y + 48, z + 48);
      if (got !== pristine.get(x, y, z)) expect(got, `old (${x},${y},${z})`).toBe(pristine.get(x, y, z));
      checked++;
    }
    expect(checked).toBe(V2_WORLD.x * (V2_WORLD.y - 1) * V2_WORLD.z - touched.size);
    // D1: the old bedrock row is Stone now (he can dig on down); the real floor is bedrock at y 0.
    for (let z = 0; z < V2_WORLD.z; z++) for (let x = 0; x < V2_WORLD.x; x++) {
      expect(applied.world.get(x + 48, 48, z + 48)).toBe(BlockId.Stone);
    }
  });

  test('the rest of the world is the plain new world (nothing he did leaks outside the old box)', () => {
    const fresh = generateWorld(SEED).world;
    const a = applied.world.buffer, b = fresh.buffer;
    let differ = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++;
    const changed = edits.filter(([x, y, z, id]) => fresh.get(x + 48, y + 48, z + 48) !== id).length;
    expect(differ).toBe(changed);
  });

  test('the bag, items, flags and every wizard field come across unchanged', () => {
    expect(applied.inventory.count(BlockId.StarlightCrystal)).toBe(2);
    expect(applied.inventory.count(BlockId.MagicMirror)).toBe(1);
    expect(applied.inventory.count(ItemId.WheatSeed)).toBe(3);
    expect(applied.flags).toEqual({ ledToVillage: true, fernSeeds: true, hints: ['plantSome', 'cropReady'] });
    expect(applied.wizard).toEqual({ gift: true, met: true, led: true, solved: 11, clean: 6, bought: 3, hints: ['seeLight', 'towerHint'] });
  });

  test('the player, crops, trees and animals shift by +48 (fractions kept)', () => {
    const [dx, dy, dz] = tower.doorFront;
    expect(applied.spawn).toEqual({ x: dx + 0.5 + 48, y: dy + 48, z: dz + 0.5 + 48 });
    const c = (JSON.parse(v2Raw) as { crops: number[][] }).crops[0];
    expect(applied.farm.crops).toEqual([{ x: c[0] + 48, y: c[1] + 48, z: c[2] + 48, p: 1000 }]);
    const t = (JSON.parse(v2Raw) as { trees: number[][] }).trees[0];
    expect(applied.farm.trees).toEqual([{ x: t[0] + 48, y: t[1] + 48, z: t[2] + 48, stage: 0, p: 2500 }]);
    expect(applied.animals).toEqual([[0, 118.5, 54, 97.5, 30, 0], [3, 108.25, 54, 88.75, 0, 2]]);
    expect(BLOCKS[applied.world.get(c[0] + 48, c[1] + 48 - 1, c[2] + 48)].solid).toBe(true);
  });

  test('loading again never shifts twice; the first autosave keeps every edit and the v2 key stays byte-identical', () => {
    const again = readSave(rec.storage)!;
    expect(again).toEqual(migrated);
    const game = new Game(applied);
    game.farm.restore(applied.farm.crops, applied.farm.trees);
    expect(storeSave(rec.storage, serialise(game, SEED, applied.flags, Date.now(), applied.animals, applied.wizard))).toBe(true);
    const saved = readSave(rec.storage)!;
    const want = new Set(migrated.edits.map(e => e.join()));
    for (const e of saved.edits) want.delete(e.join());
    expect([...want]).toEqual([]);
    expect(saved.wizard).toEqual(migrated.wizard);
    expect(rec.map.get(V2_SAVE_KEY)).toBe(v2Raw);
    expect(rec.writes.filter(k => k === V2_SAVE_KEY || k === LEGACY_SAVE_KEY)).toEqual([]);
  });
});

describe('a gen 2 save (made before the tower existed) also moves in, and his edits still win', () => {
  test('a block he built where the tower now stands is kept; the tower grows round it', () => {
    const frozen = loadWorldFixture(2);
    const g2 = decodeRle(frozen.rle);
    const at = (x: number, y: number, z: number): number => g2[x + 96 * (z + 96 * y)];
    // His gen 2 meadow at the tower's footprint: a block on the old grass there.
    const x = tower.interior.x0 + 1, z = tower.interior.z0 + 1;
    let top = 19;
    while (top > 0 && !BLOCKS[at(x, top, z) as BlockId].solid) top--;
    const mine: Edit[] = [[x, top + 1, z, BlockId.WoolRed], [x, top, z, BlockId.Air], [2, 1, 2, BlockId.Glass]];
    const raw = JSON.stringify({
      version: 2, gen: 2, seed: SEED, edits: mine, inventory: { [BlockId.Wood]: 3 }, player: { x: 24.5, y: 8, z: 24.5 },
      flags: { ledToVillage: false },
    });
    const r = recordingStorage({ [V2_SAVE_KEY]: raw });
    const data = readSave(r.storage)!;
    expect(data.gen).toBe(2);
    const loaded = applySave(data);
    for (const [ex, ey, ez, id] of mine) expect(loaded.world.get(ex + 48, ey + 48, ez + 48), `${ex},${ey},${ez}`).toBe(id);
    expect(loaded.world.get(...loaded.tower.topLamp)).toBe(BlockId.Lamp);
    expect(r.map.get(V2_SAVE_KEY)).toBe(raw);
    expect(r.writes).toEqual([BACKUP_V2_KEY, SAVE_KEY]);
  });
});

describe('the frozen save written by main (v2-gen3-tower fixture)', () => {
  test('loads with every edit at +48 and the wizard intact; the v2 key is byte-identical', () => {
    const raw = saveFixtureRaw('v2-gen3-tower');
    const v2 = JSON.parse(raw) as { edits: Edit[]; wizard: object };
    const r = recordingStorage({ [V2_SAVE_KEY]: raw });
    const data = readSave(r.storage)!;
    const loaded = applySave(data);
    for (const [x, y, z, id] of v2.edits) expect(loaded.world.get(x + 48, y + 48, z + 48), `${x},${y},${z}`).toBe(id);
    expect(loaded.wizard).toEqual(v2.wizard);
    expect(loaded.inventory.count(BlockId.RainbowBlock)).toBe(4);
    expect(r.map.get(V2_SAVE_KEY)).toBe(raw);
    // His top-of-the-world edit (the tower's top lamp, at old y 19) sits at y 67, the top of the big world.
    expect(v2.edits.some(([, y]) => y === 19)).toBe(true);
    expect(loaded.world.get(...loaded.tower.topLamp)).toBe(BlockId.SunBlock);
  });
});

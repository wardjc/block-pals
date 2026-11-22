// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import {
  BACKUP_KEY, BACKUP_V2_KEY, LEGACY_SAVE_KEY, SAVE_KEY, V2_SAVE_KEY, applySave, inspectSave, readSave, serialise, storeSave,
} from '../../src/core/save';
import {
  BUNDLE_FORMAT, buildBundle, canonicalKeys, commitImport, parseBundle, preimportKeys, transferResetKeys, type Bundle, type Sha256,
} from '../../src/core/saveTransfer';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { saveFixtureRaw } from '../helpers/fixtures';

/**
 * Save a copy / load a copy across the move to the big world (save v3). A copy made by the game
 * before this build holds the v2 key; it imports into a v3 game through the SAME migration the game
 * loads with (checked in the 96 box, shifted +48 once). A copy made by this build holds the v3 key.
 * The v1 and v2 keys and their backups are never written by an import.
 */
const sha256: Sha256 = async text => {
  const d = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);

class FakeStorage implements Storage {
  data = new Map<string, string>();
  writes: string[] = [];
  removes: string[] = [];
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  key(i: number): string | null { return [...this.data.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.writes.push(k); this.data.set(k, v); }
  removeItem(k: string): void { this.removes.push(k); this.data.delete(k); }
}

const deps = (storage: Storage | null) => ({ storage, now: () => NOW, sha256, app: 'test' });
const commitDeps = (storage: Storage) => ({ storage, stopAutosave: () => {}, resumeAutosave: () => {} });

async function sealed(keys: Record<string, string>): Promise<string> {
  const b: Bundle = { format: BUNDLE_FORMAT, formatVersion: 1, createdAt: new Date(NOW).toISOString(), keys, checksum: '' };
  b.checksum = await sha256(canonicalKeys(b.keys));
  return JSON.stringify(b);
}

/** The live game's save today: version 2, gen 3, edits round the tower, the wizard's fields. */
const liveV2 = saveFixtureRaw('v2-gen3-tower');
const liveEdits = (JSON.parse(liveV2) as { edits: Array<[number, number, number, number]> }).edits;
const up = ([x, y, z, id]: [number, number, number, number]): [number, number, number, number] => [x + 48, y + 48, z + 48, id];

/** A bundle exactly as the build before this one makes it: its main key was the v2 key. */
async function oldBuildBundle(raw: string): Promise<string> {
  const device = new FakeStorage();
  device.data.set(V2_SAVE_KEY, raw);
  const r = await buildBundle({ ...deps(device), mainKey: V2_SAVE_KEY });
  if (!r.ok) throw new Error(r.reason);
  expect(Object.keys(r.bundle.keys)).toEqual([V2_SAVE_KEY]);
  return r.text;
}

describe('a copy made by the old game (the v2 key) loads into the v3 game', () => {
  test('it is checked and migrated exactly as the game loads a v2 save: every edit at +48, the wizard kept', async () => {
    const s = new FakeStorage();
    const r = await parseBundle(await oldBuildBundle(liveV2), deps(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = inspectSave(r.raw, [3])!.data;
    expect(data).toEqual(inspectSave(liveV2)!.data); // the same migration as a v2 save read from the device
    expect(data.version).toBe(3);
    expect(data.migratedFrom).toBe(2);
    expect(data.edits).toEqual(liveEdits.map(up));
    expect(data.wizard).toEqual({ gift: true, met: true, led: true, solved: 7, clean: 4, bought: 2, hints: ['seeLight', 'towerHint'] });
    expect(r.preview.edits).toBe(liveEdits.length);
    expect(r.preview.skipped).toBe(0);
    expect(s.writes).toEqual([]); // checking writes nothing
  });

  test('loading it writes only the v3 key (and its pre-import copy); the v1 and v2 keys and backups are untouched', async () => {
    const s = new FakeStorage();
    const mine = (() => { // the game already on this device (v3)
      const game = new Game(generateWorld(2026));
      game.world.set(80, 60, 80, BlockId.Bricks);
      const m = new FakeStorage();
      storeSave(m, serialise(game, 2026, { ledToVillage: true }, 5));
      return m.data.get(SAVE_KEY)!;
    })();
    s.data.set(SAVE_KEY, mine);
    s.data.set(V2_SAVE_KEY, 'old v2 payload');
    s.data.set(LEGACY_SAVE_KEY, 'old v1 payload');
    s.data.set(BACKUP_V2_KEY, 'v2 backup');
    s.data.set(BACKUP_KEY, 'v1 backup');
    const r = await parseBundle(await oldBuildBundle(liveV2), deps(s));
    if (!r.ok) throw new Error(r.reason);
    expect(r.preview.currentEdits).toBe(1);
    expect(commitImport(r.raw, commitDeps(s))).toEqual({ ok: true });
    expect(s.writes).toEqual([preimportKeys()[0], SAVE_KEY]);
    expect(s.removes).toEqual([]);
    expect(s.data.get(preimportKeys()[0])).toBe(mine);
    expect(s.data.get(V2_SAVE_KEY)).toBe('old v2 payload');
    expect(s.data.get(LEGACY_SAVE_KEY)).toBe('old v1 payload');
    expect(s.data.get(BACKUP_V2_KEY)).toBe('v2 backup');
    expect(s.data.get(BACKUP_KEY)).toBe('v1 backup');
    // The next start reads the imported game from the v3 key, already shifted; it is never shifted again.
    const back = readSave(s)!;
    expect(back.edits).toEqual(liveEdits.map(up));
    const applied = applySave(back);
    for (const [x, y, z, id] of liveEdits) expect(applied.world.get(x + 48, y + 48, z + 48), `${x},${y},${z}`).toBe(id);
    expect(applied.wizard.solved).toBe(7);
  });

  test('a gen 2 copy (village step 2, before the tower) loads the same way', async () => {
    const raw = saveFixtureRaw('v2-extremes');
    const r = await parseBundle(await oldBuildBundle(raw), deps(new FakeStorage()));
    if (!r.ok) throw new Error(r.reason);
    const data = inspectSave(r.raw, [3])!.data;
    expect(data.gen).toBe(2);
    expect(data.edits).toEqual((JSON.parse(raw) as { edits: Array<[number, number, number, number]> }).edits.map(up));
  });

  test('a v1 payload under the v2 key (the step 1 build wrote that) is migrated too', async () => {
    const r = await parseBundle(await oldBuildBundle(saveFixtureRaw('v1-extremes')), deps(new FakeStorage()));
    if (!r.ok) throw new Error(r.reason);
    const data = inspectSave(r.raw, [3])!.data;
    expect(data.migratedFrom).toBe(1);
    expect(data.edits[0]).toEqual([48, 49, 48, BlockId.Planks]);
  });

  test('a damaged entry in an old copy is left out on its own and counted', async () => {
    const bad = JSON.parse(liveV2) as { edits: unknown[] };
    bad.edits.push([96, 1, 1, BlockId.Planks]); // outside the 96 box the copy was made in
    const r = await parseBundle(await oldBuildBundle(JSON.stringify(bad)), deps(new FakeStorage()));
    if (!r.ok) throw new Error(r.reason);
    expect(r.preview.skipped).toBe(1);
    expect(r.preview.edits).toBe(liveEdits.length);
  });
});

describe('a copy made by this build (the v3 key)', () => {
  test('round-trips byte for byte, v3 into v3', async () => {
    const game = new Game(generateWorld(2026));
    game.world.set(130, 60, 140, BlockId.MoonBlock);
    const device = new FakeStorage();
    expect(storeSave(device, serialise(game, 2026, { ledToVillage: true }, 5))).toBe(true);
    const raw = device.data.get(SAVE_KEY)!;
    const made = await buildBundle({ ...deps(device), flush: () => true });
    if (!made.ok) throw new Error(made.reason);
    expect(Object.keys(made.bundle.keys)).toEqual([SAVE_KEY]);
    const other = new FakeStorage();
    const r = await parseBundle(made.text, deps(other));
    if (!r.ok) throw new Error(r.reason);
    expect(r.raw).toBe(raw);
    expect(commitImport(r.raw, commitDeps(other))).toEqual({ ok: true });
    expect(other.data.get(SAVE_KEY)).toBe(raw);
    expect(other.writes).toEqual([SAVE_KEY]);
  });

  test('a v3 key that holds an old payload is refused (the game would not load it from there)', async () => {
    const r = await parseBundle(await sealed({ [SAVE_KEY]: liveV2 }), deps(new FakeStorage()));
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
  });

  test('a copy holding both keys uses the v3 one', async () => {
    const game = new Game(generateWorld(2026));
    const device = new FakeStorage();
    storeSave(device, serialise(game, 2026, { ledToVillage: false }, 5));
    const v3 = device.data.get(SAVE_KEY)!;
    const r = await parseBundle(await sealed({ [SAVE_KEY]: v3, [V2_SAVE_KEY]: liveV2 }), deps(new FakeStorage()));
    if (!r.ok) throw new Error(r.reason);
    expect(r.raw).toBe(v3);
  });
});

describe('export never hands out stale progress (review finding 3)', () => {
  /** The running game: his new block at (130, 60, 140) is in memory only. */
  const liveText = (): string => {
    const game = new Game(generateWorld(2026));
    game.world.set(130, 60, 140, BlockId.MoonBlock);
    return JSON.stringify(serialise(game, 2026, { ledToVillage: true }, 5));
  };

  test('when the save cannot be written (quota) and only the old v2 is stored, the copy is the live game, not the v2', async () => {
    const device = new FakeStorage();
    device.data.set(V2_SAVE_KEY, liveV2);
    const live = liveText();
    const made = await buildBundle({ ...deps(device), flush: () => false, snapshot: () => live });
    if (!made.ok) throw new Error(made.reason);
    expect(made.bundle.keys).toEqual({ [SAVE_KEY]: live });
    expect(inspectSave(made.bundle.keys[SAVE_KEY], [3])!.data.edits).toContainEqual([130, 60, 140, BlockId.MoonBlock]);
    expect(device.writes).toEqual([]);
  });

  test('when a stored v3 exists but the latest write failed, the copy is the live game', async () => {
    const device = new FakeStorage();
    const old = new Game(generateWorld(2026));
    storeSave(device, serialise(old, 2026, { ledToVillage: false }, 1));
    const live = liveText();
    const made = await buildBundle({ ...deps(device), flush: () => false, snapshot: () => live });
    if (!made.ok) throw new Error(made.reason);
    expect(made.bundle.keys[SAVE_KEY]).toBe(live);
  });

  test('with a snapshot but no flush, a stale stored v3 is never assumed fresh: the live snapshot is the copy', async () => {
    const device = new FakeStorage();
    storeSave(device, serialise(new Game(generateWorld(2026)), 2026, { ledToVillage: false }, 1)); // zero edits stored
    const live = liveText();
    let called = 0;
    const made = await buildBundle({ ...deps(device), snapshot: () => { called++; return live; } });
    if (!made.ok) throw new Error(made.reason);
    expect(called).toBe(1);
    expect(made.bundle.keys[SAVE_KEY]).toBe(live);
  });

  test('with no flush and no snapshot, a stored v3 is not assumed fresh: a gentle message instead', async () => {
    const device = new FakeStorage();
    storeSave(device, serialise(new Game(generateWorld(2026)), 2026, { ledToVillage: false }, 1));
    const r = await buildBundle(deps(device));
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
  });

  test('when the save is written first, the copy is the stored v3, byte for byte', async () => {
    const device = new FakeStorage();
    let flushed = false;
    const live = liveText();
    const made = await buildBundle({ ...deps(device), flush: () => { device.data.set(SAVE_KEY, live); flushed = true; return true; }, snapshot: () => 'never used' });
    if (!made.ok) throw new Error(made.reason);
    expect(flushed).toBe(true);
    expect(made.bundle.keys).toEqual({ [SAVE_KEY]: live });
  });

  test('with no live game to copy, a stale or missing v3 is refused with a gentle grown-ups message (never the old v2)', async () => {
    const device = new FakeStorage();
    device.data.set(V2_SAVE_KEY, liveV2);
    const r = await buildBundle(deps(device));
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    if (!r.ok) expect(r.message).toMatch(/not been saved/);
    const failing = await buildBundle({ ...deps(device), flush: () => false });
    expect(failing).toMatchObject({ ok: false, reason: 'stale' });
  });

  test('a damaged v3 save is still refused for export (never swapped for the older v2 or a fresh game)', async () => {
    const device = new FakeStorage();
    device.data.set(SAVE_KEY, '{nope');
    device.data.set(V2_SAVE_KEY, liveV2);
    expect(await buildBundle(deps(device))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await buildBundle({ ...deps(device), flush: () => false, snapshot: liveText })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  test('the current game on the device is counted from the v2 key when there is no v3 yet (import preview)', async () => {
    const device = new FakeStorage();
    device.data.set(V2_SAVE_KEY, liveV2);
    const r = await parseBundle(await oldBuildBundle(saveFixtureRaw('v2-extremes')), deps(device));
    if (!r.ok) throw new Error(r.reason);
    expect(r.preview.currentEdits).toBe(liveEdits.length);
  });
});

describe('the grown-ups\' reset', () => {
  test('clears the pre-import copies of both the v3 game and the old v2 game, and the transfer note', () => {
    const keys = transferResetKeys();
    for (const k of [...preimportKeys(SAVE_KEY), ...preimportKeys(V2_SAVE_KEY), 'blockpals.transfer.v1']) expect(keys).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(preimportKeys()[0]).toBe('blockpals.save.v3.preimport');
  });
});

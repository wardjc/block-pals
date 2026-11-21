// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ALL_SAVE_KEYS, LEGACY_SAVE_KEY, SAVE_KEY, BACKUP_KEY, BAD_V2_KEY, readSave, serialise, storeSave, type SaveData } from '../../src/core/save';
import {
  BUNDLE_FORMAT, MAX_BUNDLE_BYTES, TRANSFER_KEY, buildBundle, bundleFileName, canonicalKeys, commitImport, parseBundle, preimportKeys,
  readTransferNote, transferResetKeys, writeTransferNote, type Bundle, type Sha256,
} from '../../src/core/saveTransfer';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';

const sha256: Sha256 = async text => {
  const d = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

/** A Storage that can be told to throw on chosen operations, and records every write. */
class FakeStorage implements Storage {
  data = new Map<string, string>();
  writes: string[] = [];
  failGet: (k: string) => boolean = () => false;
  failSet: (k: string) => boolean = () => false;
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  key(i: number): string | null { return [...this.data.keys()][i] ?? null; }
  getItem(k: string): string | null { if (this.failGet(k)) throw new Error('read blocked'); return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { if (this.failSet(k)) throw new Error('quota'); this.writes.push(k); this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
}

function saveText(seed = 1234, edit = true): string {
  const game = new Game(generateWorld(seed));
  if (edit) { game.world.set(24, 1, 24, BlockId.Air); game.world.set(25, 14, 25, BlockId.Bricks); }
  game.inventory.add(BlockId.Wood, 7);
  const s = new FakeStorage();
  storeSave(s, serialise(game, seed, { ledToVillage: false }, 5));
  return s.data.get(SAVE_KEY) as string;
}
const deps = (storage: Storage | null) => ({ storage, now: () => NOW, sha256, app: 'test' });
function bundleOf(raw: string, extra: Record<string, string> = {}): Bundle {
  const keys = { [SAVE_KEY]: raw, ...extra };
  return { format: BUNDLE_FORMAT, formatVersion: 1, createdAt: new Date(NOW).toISOString(), keys, checksum: '' };
}
async function sealed(b: Bundle): Promise<string> {
  b.checksum = await sha256(canonicalKeys(b.keys));
  return JSON.stringify(b);
}

describe('export', () => {
  test('bundles ONLY the main save key, byte for byte, with a checksum and the dated file name', async () => {
    const s = new FakeStorage();
    const raw = saveText();
    s.data.set(SAVE_KEY, raw);
    for (const k of [LEGACY_SAVE_KEY, BACKUP_KEY, BAD_V2_KEY, 'blockpals.usage.v1', 'blockpals.mapping.v1', ...preimportKeys()]) s.data.set(k, 'other');
    const r = await buildBundle(deps(s));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.bundle.keys)).toEqual([SAVE_KEY]);
    expect(r.bundle.keys[SAVE_KEY]).toBe(raw);
    expect(r.bundle.format).toBe('blockpals-save-bundle');
    expect(r.bundle.formatVersion).toBe(1);
    expect(r.bundle.checksum).toBe(await sha256(canonicalKeys(r.bundle.keys)));
    expect(r.fileName).toBe(bundleFileName(NOW));
    expect(r.fileName).toMatch(/^block-pals-saved-game-\d{4}-\d{2}-\d{2}\.json$/);
    expect(s.writes).toEqual([]); // exporting writes nothing
  });

  test('refuses with no save, an unreadable storage, no storage, or a save the game cannot read', async () => {
    const empty = new FakeStorage();
    expect(await buildBundle(deps(empty))).toMatchObject({ ok: false, reason: 'nosave' });
    const blocked = new FakeStorage();
    blocked.data.set(SAVE_KEY, saveText());
    blocked.failGet = () => true;
    expect(await buildBundle(deps(blocked))).toMatchObject({ ok: false, reason: 'storage' });
    expect(await buildBundle(deps(null))).toMatchObject({ ok: false, reason: 'storage' });
    const bad = new FakeStorage();
    bad.data.set(SAVE_KEY, '{nope');
    expect(await buildBundle(deps(bad))).toMatchObject({ ok: false, reason: 'invalid' });
  });

  test('a browser without WebCrypto gives a friendly refusal, not a crash', async () => {
    const s = new FakeStorage();
    s.data.set(SAVE_KEY, saveText());
    const r = await buildBundle({ storage: s, now: () => NOW, sha256: () => Promise.reject(new Error('no')) });
    expect(r).toMatchObject({ ok: false, reason: 'crypto' });
  });

  test('transfer note round trips and survives garbage', () => {
    const s = new FakeStorage();
    expect(readTransferNote(s).lastExportAt).toBeNull();
    writeTransferNote(s, '2026-11-08T12:00:00.000Z');
    expect(readTransferNote(s).lastExportAt).toBe('2026-11-08T12:00:00.000Z');
    s.data.set(TRANSFER_KEY, 'junk');
    expect(readTransferNote(s).lastExportAt).toBeNull();
    s.failSet = () => true;
    expect(() => writeTransferNote(s, 'x')).not.toThrow();
  });
});

describe('import: reading the file (nothing is written)', () => {
  test('round trip export -> parse gives the same bytes and a preview', async () => {
    const src = new FakeStorage();
    const raw = saveText();
    src.data.set(SAVE_KEY, raw);
    const out = await buildBundle(deps(src));
    if (!out.ok) throw new Error('export failed');
    const dest = new FakeStorage();
    const p = await parseBundle(out.text, deps(dest));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.raw).toBe(raw);
    expect(p.preview.edits).toBe(2);
    expect(p.preview.items).toBe(7);
    expect(p.preview.skipped).toBe(0);
    expect(p.preview.currentEdits).toBeNull();
    expect(dest.writes).toEqual([]);
  });

  test('a changed checksum, wrong format, newer version, garbage, huge, empty are all refused', async () => {
    const raw = saveText();
    const good = JSON.parse(await sealed(bundleOf(raw))) as Bundle;
    const d = deps(new FakeStorage());
    expect(await parseBundle(JSON.stringify({ ...good, checksum: 'abc' }), d)).toMatchObject({ ok: false, reason: 'checksum' });
    const tampered = { ...good, keys: { [SAVE_KEY]: raw.replace('1234', '4321') } };
    expect(await parseBundle(JSON.stringify(tampered), d)).toMatchObject({ ok: false, reason: 'checksum' });
    expect(await parseBundle(JSON.stringify({ ...good, format: 'other' }), d)).toMatchObject({ ok: false, reason: 'format' });
    expect(await parseBundle(JSON.stringify([1, 2]), d)).toMatchObject({ ok: false, reason: 'format' });
    expect(await parseBundle(JSON.stringify({ ...good, formatVersion: 'x' }), d)).toMatchObject({ ok: false, reason: 'format' });
    const newer = await parseBundle(JSON.stringify({ ...good, formatVersion: 2 }), d);
    expect(newer).toMatchObject({ ok: false, reason: 'newer' });
    expect((newer as { message: string }).message).toContain('newer version of the game');
    expect(await parseBundle('{{{ not json', d)).toMatchObject({ ok: false, reason: 'garbage' });
    expect(await parseBundle('', d)).toMatchObject({ ok: false, reason: 'empty' });
    expect(await parseBundle('   \n', d)).toMatchObject({ ok: false, reason: 'empty' });
    expect(await parseBundle('x'.repeat(MAX_BUNDLE_BYTES + 1), d)).toMatchObject({ ok: false, reason: 'big' });
    expect(await parseBundle(JSON.stringify({ ...good, keys: { [SAVE_KEY]: 5 } }), d)).toMatchObject({ ok: false, reason: 'format' });
  });

  test('a bundle without the current main key is refused', async () => {
    const text = await sealed({ ...bundleOf(saveText()), keys: { 'blockpals.save.v0': saveText() } });
    expect(await parseBundle(text, deps(new FakeStorage()))).toMatchObject({ ok: false, reason: 'key' });
  });

  test('extra keys in the file are ignored (only the main key comes out)', async () => {
    const raw = saveText();
    const text = await sealed(bundleOf(raw, { [LEGACY_SAVE_KEY]: 'evil', 'blockpals.usage.v1': '{}' }));
    const p = await parseBundle(text, deps(new FakeStorage()));
    expect(p).toMatchObject({ ok: true, raw });
  });

  test('a save that fails the game parser is refused, even with a correct checksum', async () => {
    for (const bad of ['{"version":2}', 'null', '[]', JSON.stringify({ version: 9, gen: 1 }), '{"version":2,"gen":1,"seed":"x","edits":[],"inventory":{},"player":{},"flags":{}}']) {
      const p = await parseBundle(await sealed(bundleOf(bad)), deps(new FakeStorage()));
      expect(p, bad).toMatchObject({ ok: false, reason: 'invalid' });
    }
  });

  test('bad individual entries are tolerated like the game does, and counted as skipped', async () => {
    const o = JSON.parse(saveText()) as SaveData;
    o.edits.push([999, 999, 999, 1], [1, 1, 1, 9999]);
    const p = await parseBundle(await sealed(bundleOf(JSON.stringify(o))), deps(new FakeStorage()));
    expect(p.ok).toBe(true);
    if (p.ok) { expect(p.preview.skipped).toBe(2); expect(p.preview.edits).toBe(2); }
  });

  test('the preview says how much is on this device now', async () => {
    const dest = new FakeStorage();
    dest.data.set(SAVE_KEY, saveText(1234, true));
    const p = await parseBundle(await sealed(bundleOf(saveText(99, false))), deps(dest));
    expect(p.ok && p.preview.currentEdits).toBe(2);
    expect(p.ok && p.preview.edits).toBe(0);
  });
});

describe('import: committing', () => {
  const stops = () => ({ stopAutosave: vi.fn(), resumeAutosave: vi.fn() });

  test('into an empty device: writes the main key only, no backup needed', () => {
    const s = new FakeStorage();
    const raw = saveText();
    const d = stops();
    expect(commitImport(raw, { storage: s, ...d })).toEqual({ ok: true });
    expect(s.data.get(SAVE_KEY)).toBe(raw);
    expect(s.writes).toEqual([SAVE_KEY]);
    expect(readSave(s)).not.toBeNull();
  });

  test('autosave is stopped before the first write', () => {
    const s = new FakeStorage();
    s.data.set(SAVE_KEY, saveText(1));
    const order: string[] = [];
    const orig = s.setItem.bind(s);
    s.setItem = (k, v) => { order.push('write'); orig(k, v); };
    commitImport(saveText(2), { storage: s, stopAutosave: () => order.push('stop') });
    expect(order[0]).toBe('stop');
  });

  test('backs up the current game byte for byte, rotating three slots; the newest is never lost', () => {
    const s = new FakeStorage();
    const games = [1, 2, 3, 4, 5].map(n => saveText(n));
    s.data.set(SAVE_KEY, games[0]);
    const [k1, k2, k3] = preimportKeys();
    for (let i = 1; i <= 4; i++) commitImport(games[i], { storage: s, ...stops() });
    expect(s.data.get(SAVE_KEY)).toBe(games[4]);
    expect(s.data.get(k1)).toBe(games[3]);
    expect(s.data.get(k2)).toBe(games[2]);
    expect(s.data.get(k3)).toBe(games[1]);
    // game 0 was rotated out (oldest); every write went to the main key or a pre-import slot only
    for (const w of s.writes) expect([SAVE_KEY, k1, k2, k3]).toContain(w);
  });

  test('importing the same game again does not push older copies out', () => {
    const s = new FakeStorage();
    const [a, b] = [saveText(1), saveText(2)];
    s.data.set(SAVE_KEY, a);
    commitImport(b, { storage: s, ...stops() });
    commitImport(b, { storage: s, ...stops() });
    expect(s.data.get(preimportKeys()[0])).toBe(a);
  });

  test('never writes the v1 key, bad/backup slots, usage or mapping keys', () => {
    const s = new FakeStorage();
    s.data.set(SAVE_KEY, saveText(1));
    s.data.set(LEGACY_SAVE_KEY, 'legacy');
    commitImport(saveText(2), { storage: s, ...stops() });
    expect(s.data.get(LEGACY_SAVE_KEY)).toBe('legacy');
    expect(s.writes.some(k => k === LEGACY_SAVE_KEY || k === BACKUP_KEY || k.startsWith(BAD_V2_KEY))).toBe(false);
  });

  test.each([
    ['reading the main key', (k: string) => k === SAVE_KEY, 'get'],
    ['reading a backup slot', (k: string) => k === preimportKeys()[1], 'get'],
  ])('a throw while %s changes nothing', (_n, pred, kind) => {
    const s = new FakeStorage();
    const old = saveText(1);
    s.data.set(SAVE_KEY, old);
    if (kind === 'get') s.failGet = pred;
    const d = stops();
    const r = commitImport(saveText(2), { storage: s, ...d });
    expect(r.ok).toBe(false);
    expect(s.writes).toEqual([]);
    expect(s.data.get(SAVE_KEY)).toBe(old);
    expect(d.resumeAutosave).toHaveBeenCalled();
  });

  test.each([0, 1, 2])('a failing backup write (slot index %i) aborts with the main save untouched', idx => {
    const s = new FakeStorage();
    const old = saveText(1);
    s.data.set(SAVE_KEY, old);
    const slots = preimportKeys();
    s.data.set(slots[0], 'p1');
    s.data.set(slots[1], 'p2');
    s.failSet = k => k === slots[idx];
    const d = stops();
    const r = commitImport(saveText(2), { storage: s, ...d });
    expect(r.ok).toBe(false);
    expect(s.data.get(SAVE_KEY)).toBe(old);
    expect(d.resumeAutosave).toHaveBeenCalled();
    // the most recent previous game is still held somewhere intact
    expect([SAVE_KEY, ...slots].some(k => s.data.get(k) === old)).toBe(true);
  });

  test('a failing main write (quota) restores the old game and reports failure', () => {
    const s = new FakeStorage();
    const old = saveText(1);
    s.data.set(SAVE_KEY, old);
    s.failSet = k => k === SAVE_KEY;
    const r = commitImport(saveText(2), { storage: s, ...stops() });
    expect(r.ok).toBe(false);
    expect(s.data.get(SAVE_KEY)).toBe(old);
  });

  test('no storage at all is a friendly failure', () => {
    expect(commitImport('x', { storage: null, ...stops() }).ok).toBe(false);
  });
});

describe('reset', () => {
  test('transferResetKeys covers the pre-import slots and the transfer note, and none are in the bundle', () => {
    expect(transferResetKeys()).toEqual([...preimportKeys(), TRANSFER_KEY]);
    expect(preimportKeys()).toEqual([`${SAVE_KEY}.preimport`, `${SAVE_KEY}.preimport.2`, `${SAVE_KEY}.preimport.3`]);
    for (const k of transferResetKeys()) expect(ALL_SAVE_KEYS).not.toContain(k);
  });
});

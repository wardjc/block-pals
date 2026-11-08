// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { LEGACY_SAVE_KEY, SAVE_KEY, serialise, storeSave } from '../../src/core/save';
import { MAX_BUNDLE_BYTES, canonicalKeys, commitImport, parseBundle, preimportKeys, type Sha256 } from '../../src/core/saveTransfer';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';

const sha256: Sha256 = async text => {
  const d = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** Counts every storage operation and can make exactly one of them (the nth) throw. */
class FlakyStorage implements Storage {
  data = new Map<string, string>();
  ops = 0;
  failOp = -1;
  failSet: (k: string) => boolean = () => false;
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  key(i: number): string | null { return [...this.data.keys()][i] ?? null; }
  private tick(): void { if (this.ops++ === this.failOp) throw new Error('boom'); }
  getItem(k: string): string | null { this.tick(); return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.tick(); if (this.failSet(k)) throw new Error('quota'); this.data.set(k, v); }
  removeItem(k: string): void { this.tick(); this.data.delete(k); }
}

function saveText(seed: number): string {
  const mem = new Map<string, string>();
  const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } } as unknown as Storage;
  storeSave(s, serialise(new Game(generateWorld(seed)), seed));
  return mem.get(SAVE_KEY) as string;
}

describe('commit is transactional: any single failing operation leaves the whole storage as it was', () => {
  const scenarios: Array<[string, Record<string, string>]> = [
    ['main A with backups B/C/D', { main: 'A', s1: 'B', s2: 'C', s3: 'D' }],
    ['main A with one backup', { main: 'A', s1: 'B' }],
    ['main A and no backups', { main: 'A' }],
    ['empty device', {}],
  ];
  test.each(scenarios)('%s', (_n, init) => {
    const [k1, k2, k3] = preimportKeys();
    const map: Record<string, string> = { A: saveText(11), B: saveText(12), C: saveText(13), D: saveText(14) };
    const seed = (s: FlakyStorage): void => {
      if (init.main) s.data.set(SAVE_KEY, map[init.main]);
      if (init.s1) s.data.set(k1, map[init.s1]);
      if (init.s2) s.data.set(k2, map[init.s2]);
      if (init.s3) s.data.set(k3, map[init.s3]);
      s.data.set(LEGACY_SAVE_KEY, 'legacy');
    };
    const imported = saveText(99);
    const clean = new FlakyStorage();
    seed(clean);
    expect(commitImport(imported, { storage: clean, stopAutosave: () => {} }).ok).toBe(true);
    const total = clean.ops;
    for (let n = 0; n < total; n++) {
      const s = new FlakyStorage();
      seed(s);
      const before = [...s.data].sort();
      s.failOp = n;
      const r = commitImport(imported, { storage: s, stopAutosave: () => {}, resumeAutosave: () => {} });
      expect(r.ok, `op ${n}`).toBe(false);
      expect([...s.data].sort(), `op ${n} must leave everything as it was`).toEqual(before);
      expect((r as { message: string }).message).toContain('Nothing has been changed');
    }
  });

  test('the reported scenario: failing the newest-slot write does not turn B/C/D into B/B/C', () => {
    const [k1, k2, k3] = preimportKeys();
    const s = new FlakyStorage();
    s.data.set(SAVE_KEY, 'A'); s.data.set(k1, 'B'); s.data.set(k2, 'C'); s.data.set(k3, 'D');
    s.failSet = k => k === k1;
    const r = commitImport(saveText(2), { storage: s, stopAutosave: () => {} });
    expect(r.ok).toBe(false);
    expect([s.data.get(SAVE_KEY), s.data.get(k1), s.data.get(k2), s.data.get(k3)]).toEqual(['A', 'B', 'C', 'D']);
  });

  test('if the put-back itself cannot finish, the message does not claim nothing changed', () => {
    const [k1, k2, k3] = preimportKeys();
    const s = new FlakyStorage();
    s.data.set(SAVE_KEY, 'A'); s.data.set(k1, 'B'); s.data.set(k2, 'C'); s.data.set(k3, 'D');
    let n = 0;
    s.failSet = () => ++n >= 2; // the second write and everything after fails, including the put-back
    const r = commitImport(saveText(2), { storage: s, stopAutosave: () => {} });
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).not.toContain('Nothing has been changed');
  });
});

describe('parser hardening', () => {
  test('a __proto__ key in the bundle checksums independently of how it is built', async () => {
    const raw = saveText(5);
    const keysText = `{"__proto__":"x",${JSON.stringify(SAVE_KEY)}:${JSON.stringify(raw)}}`;
    const checksum = await sha256(keysText);
    const text = `{"format":"blockpals-save-bundle","formatVersion":1,"createdAt":"2026-11-08T12:00:00.000Z","keys":${keysText},"checksum":"${checksum}"}`;
    expect(await parseBundle(text, { storage: null, now: () => 0, sha256 })).toMatchObject({ ok: true, raw });
    expect(canonicalKeys(JSON.parse('{"__proto__":"x","b":"y"}') as Record<string, string>)).toBe('{"__proto__":"x","b":"y"}');
  });

  test('the size limit counts bytes, not characters', async () => {
    const text = 'é'.repeat(Math.floor(MAX_BUNDLE_BYTES / 2) + 10); // fewer characters than the cap, more bytes
    expect(text.length).toBeLessThan(MAX_BUNDLE_BYTES);
    expect(await parseBundle(text, { storage: null, now: () => 0, sha256 })).toMatchObject({ ok: false, reason: 'big' });
  });
});

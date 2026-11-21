import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySave, serialise } from '../../src/core/save';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { generateAsync, handleGenRequest, type GenReply, type WorkerLike } from '../../src/render/genWorker';

const hash = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** A worker that runs the real worker body in-process; the reply goes through structuredClone with transfer, as postMessage does. */
function fakeWorker(sent: { buffers: ArrayBuffer[] }, opts: { fail?: 'error' | 'reply' } = {}): WorkerLike {
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    terminate: () => {},
    postMessage: msg => {
      queueMicrotask(() => {
        if (opts.fail === 'error') { w.onerror?.({ message: 'boom' }); return; }
        if (opts.fail === 'reply') { w.onmessage?.({ data: { ok: false, error: 'out of memory' } }); return; }
        handleGenRequest(msg, (reply, transfer) => {
          const copy = structuredClone(reply, { transfer }) as GenReply;
          for (const t of transfer) sent.buffers.push(t as ArrayBuffer);
          w.onmessage?.({ data: copy });
        });
      });
    },
  };
  return w;
}

describe('generateAsync (the generation worker)', () => {
  const want = generateWorld(2026);

  it('gives the same buffer hash and layouts as generateWorld (the worker body run in-process)', async () => {
    const sent = { buffers: [] as ArrayBuffer[] };
    const got = await generateAsync(2026, { makeWorker: () => fakeWorker(sent) });
    expect(hash(got.world.buffer)).toBe(hash(want.world.buffer));
    expect([got.world.sizeX, got.world.sizeY, got.world.sizeZ]).toEqual([192, 68, 192]);
    expect(got.spawn).toEqual(want.spawn);
    expect(got.village.houses).toEqual(want.village.houses);
    expect([...got.village.routeCells]).toEqual([...want.village.routeCells]);
    expect(got.tower).toEqual(want.tower);
    expect(got.towerPad).toEqual(want.towerPad);
    expect(got.world.edits()).toEqual([]);
    expect(got.world.isDirty()).toBe(false);
  });

  it('applySave on the worker-made world equals applySave generating its own (his edits replay on top, the same way)', async () => {
    const game = { edits: [[80, 57, 80, 8], [81, 56, 80, 0], [0, 1, 0, 3]] as Array<[number, number, number, number]> };
    const data = JSON.parse(JSON.stringify({ ...serialise(new Game(generateWorld(2026)), 2026), edits: game.edits }));
    const viaWorker = applySave(data, 0, await generateAsync(2026, { makeWorker: () => fakeWorker({ buffers: [] }) }));
    const alone = applySave(data, 0);
    expect(hash(viaWorker.world.buffer)).toBe(hash(alone.world.buffer));
    expect(viaWorker.world.edits()).toEqual(alone.world.edits());
    expect(viaWorker.spawn).toEqual(alone.spawn);
    // A used world is never trusted: applySave generates afresh.
    const used = generateWorld(2026);
    used.world.set(100, 60, 100, 8);
    expect(hash(applySave(data, 0, used).world.buffer)).toBe(hash(alone.world.buffer));
  });

  it('the world buffer is transferred, not copied (the sent buffer is detached: byteLength 0)', async () => {
    const sent = { buffers: [] as ArrayBuffer[] };
    await generateAsync(7, { makeWorker: () => fakeWorker(sent) });
    expect(sent.buffers).toHaveLength(1);
    expect(sent.buffers[0].byteLength).toBe(0);
  });

  it('falls back to the main thread when Worker is undefined', async () => {
    const reasons: string[] = [];
    expect(typeof Worker).toBe('undefined'); // Node: no Worker global
    const got = await generateAsync(2026, { onFallback: r => reasons.push(r) });
    expect(hash(got.world.buffer)).toBe(hash(want.world.buffer));
    expect(reasons).toEqual(['Worker is not available']);
  });

  it('a worker error, a failed reply or a throwing constructor falls back with a clear reason and still loads the world', async () => {
    for (const fail of ['error', 'reply'] as const) {
      const reasons: string[] = [];
      const got = await generateAsync(2026, { makeWorker: () => fakeWorker({ buffers: [] }, { fail }), onFallback: r => reasons.push(r) });
      expect(hash(got.world.buffer)).toBe(hash(want.world.buffer));
      expect(reasons[0]).toMatch(fail === 'error' ? /worker error: boom/ : /world generation failed in the worker: out of memory/);
    }
    const reasons: string[] = [];
    const got = await generateAsync(2026, { makeWorker: () => { throw new Error('blocked'); }, onFallback: r => reasons.push(r) });
    expect(got.world.sizeY).toBe(68);
    expect(reasons[0]).toMatch(/no worker: blocked/);
  });

  it('the worker is a module worker that Vite bundles (works offline: no URL outside the app)', () => {
    const src = readFileSync('src/render/genWorker.ts', 'utf8');
    expect(src).toMatch(/new Worker\(new URL\('\.\/genWorker\.ts', import\.meta\.url\), \{ type: 'module' \}\)/);
    expect(src).not.toMatch(/https?:\/\//);
  });
});

describe('the loading screen stays bright', () => {
  it('no dark background in index.html or styles.css (no #000 or black backgrounds)', () => {
    for (const file of ['index.html', 'src/ui/styles.css']) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/background(?:-color)?\s*:\s*([^;}"]+)/g)) {
        const v = m[1].trim().toLowerCase();
        expect(v, `${file}: ${m[0]}`).not.toMatch(/(^|[^0-9a-f])#000(000)?\b|\bblack\b|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(,\s*(1|0?\.[5-9]\d*)\s*)?\)/);
      }
    }
  });

  it('index.html has the loading picture: a sky-blue page, a spinning block and Pip, with no words', () => {
    const html = readFileSync('index.html', 'utf8');
    const loading = html.match(/<div id="loading"[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? '';
    expect(loading).toContain('class="load-block"');
    expect(loading).toContain('class="load-pip"');
    expect(loading.replace(/<[^>]*>/g, '').trim()).toBe(''); // pictures only
    expect(html).toMatch(/#loading\s*\{[^}]*background:\s*#78c6ff/);
    expect(html).toMatch(/@keyframes load-spin/);
  });
});

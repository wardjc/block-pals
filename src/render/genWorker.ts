import { World } from '../core/world';
import { generateWorld, type GeneratedWorld } from '../core/worldgen';

/**
 * The world is generated off the main thread (the plan's Task 11): a module worker runs the same pure
 * generateWorld the tests call and posts back the cell buffer (transferred, not copied) and the
 * layouts. Vite builds this file into its own chunk, which the PWA precaches, so it works offline.
 * Without Worker support, or if the worker fails, the same function runs on the main thread.
 */
export interface GenRequest { seed: number }
export type GenReply =
  | { ok: true; buffer: ArrayBuffer; size: [number, number, number]; layout: Omit<GeneratedWorld, 'world'>; ms: number }
  | { ok: false; error: string };

/** The worker's whole job, exposed so a test can run it in-process with a fake postMessage. */
export function handleGenRequest(req: GenRequest, post: (reply: GenReply, transfer: Transferable[]) => void, now: () => number = () => performance.now()): void {
  try {
    const t0 = now();
    const { world, ...layout } = generateWorld(req.seed);
    const cells = world.buffer;
    // The buffer is exactly the world (World allocates its own), so the whole ArrayBuffer can move.
    const buffer = cells.byteOffset === 0 && cells.byteLength === cells.buffer.byteLength
      ? cells.buffer as ArrayBuffer : cells.slice().buffer as ArrayBuffer;
    post({ ok: true, buffer, size: [world.sizeX, world.sizeY, world.sizeZ], layout, ms: now() - t0 }, [buffer]);
  } catch (e) {
    post({ ok: false, error: e instanceof Error ? e.message : String(e) }, []);
  }
}

/** Turns a worker reply back into the generated world (the buffer becomes the world's cells, no copy). */
export function worldFromReply(reply: GenReply): GeneratedWorld {
  if (!reply.ok) throw new Error(`world generation failed in the worker: ${reply.error}`);
  const [sx, sy, sz] = reply.size;
  const world = World.fromBuffer(sx, sy, sz, new Uint8Array(reply.buffer));
  return { world, ...reply.layout };
}

/** The minimum of a Worker this needs (so tests can pass a fake). */
export interface WorkerLike {
  postMessage(msg: GenRequest): void;
  terminate(): void;
  onmessage: ((e: { data: GenReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface GenerateOptions {
  /** Makes the worker; default a real module worker of this file. Return null to use the main thread. */
  makeWorker?: () => WorkerLike | null;
  /** Called when the worker could not be used, with the reason (the main thread then generates). */
  onFallback?: (reason: string) => void;
}

const defaultWorker = (): WorkerLike | null => {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./genWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
};

/**
 * The generated world, made in a worker when one can run, else on the main thread. A worker error
 * (or a failed reply) falls back to the main thread too, so the world always loads.
 */
export function generateAsync(seed: number, opts: GenerateOptions = {}): Promise<GeneratedWorld> {
  const fallback = (reason: string): GeneratedWorld => {
    opts.onFallback?.(reason);
    return generateWorld(seed);
  };
  let worker: WorkerLike | null;
  try {
    worker = (opts.makeWorker ?? defaultWorker)();
  } catch (e) {
    return Promise.resolve(fallback(`no worker: ${e instanceof Error ? e.message : String(e)}`));
  }
  if (!worker) return Promise.resolve(fallback('Worker is not available'));
  const w = worker;
  return new Promise<GeneratedWorld>(resolve => {
    let done = false;
    const finish = (value: () => GeneratedWorld): void => {
      if (done) return;
      done = true;
      try { w.terminate(); } catch { /* already gone */ }
      resolve(value());
    };
    w.onmessage = e => {
      finish(() => {
        try { return worldFromReply(e.data); } catch (err) { return fallback(err instanceof Error ? err.message : String(err)); }
      });
    };
    w.onerror = err => finish(() => fallback(`worker error: ${String((err as { message?: string })?.message ?? err)}`));
    w.postMessage({ seed });
  });
}

// Inside the worker: answer one request. (In the page this file is only imported for generateAsync.)
declare const WorkerGlobalScope: { new (): unknown } | undefined;
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
  const scope = self as unknown as { onmessage: ((e: MessageEvent<GenRequest>) => void) | null; postMessage(m: GenReply, t: Transferable[]): void };
  scope.onmessage = e => handleGenRequest(e.data, (reply, transfer) => scope.postMessage(reply, transfer));
}

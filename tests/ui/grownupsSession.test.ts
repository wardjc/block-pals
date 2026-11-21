// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SAVE_KEY, serialise, storeSave } from '../../src/core/save';
import { BUNDLE_FORMAT, canonicalKeys } from '../../src/core/saveTransfer';
import { UsageTracker } from '../../src/core/usage';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { DEFAULT_MAPPING } from '../../src/input/mapping';
import { GrownUps } from '../../src/ui/grownups';

let t = 0;
const sha256 = async (text: string): Promise<string> => {
  const d = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};

async function bundleText(): Promise<string> {
  const mem = new Map<string, string>();
  const s = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } } as unknown as Storage;
  storeSave(s, serialise(new Game(generateWorld(77)), 77));
  const keys = { [SAVE_KEY]: mem.get(SAVE_KEY) as string };
  return JSON.stringify({ format: BUNDLE_FORMAT, formatVersion: 1, createdAt: new Date(0).toISOString(), keys, checksum: await sha256(canonicalKeys(keys)) });
}

function arrange(reload: () => void) {
  const mem = new Map<string, string>();
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } } as unknown as Storage;
  const root = document.createElement('div');
  document.body.appendChild(root);
  const gu = new GrownUps(root, {
    usage: new UsageTracker(null), storage, reload, sha256,
    captureButton: () => new Promise(() => {}), cancelCapture: () => {}, getMapping: () => ({ ...DEFAULT_MAPPING }),
    onMappingSaved: () => {}, stopAutosave: () => {}, onOpenChange: () => {}, now: () => t,
  });
  return { root, gu, mem };
}
function openGate(gu: GrownUps): void { gu.holdStart(1); t += 3100; vi.advanceTimersToNextFrame(); }
function answer(root: HTMLElement): void {
  const [a, b] = root.querySelector('[data-testid="gate-sum"]')!.textContent!.match(/\d+/g)!.map(Number);
  const keys = [...root.querySelectorAll<HTMLButtonElement>('.gu-key')];
  for (const d of String(a + b)) keys.find(k => k.textContent === d)!.click();
  keys.find(k => k.textContent === 'OK')!.click();
}
function delayedFile(text: string): { file: File; release: () => void } {
  let release = (): void => {};
  const gate = new Promise<void>(r => { release = r; });
  const file = new File([text], 'copy.json');
  Object.defineProperty(file, 'text', { value: () => gate.then(() => text) });
  return { file, release };
}
function choose(root: HTMLElement, file: File): void {
  const input = root.querySelector<HTMLInputElement>('[data-testid="transfer-file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}
/** Lets promises and the real WebCrypto finish while fake timers are installed. */
const settle = async (): Promise<void> => { vi.useRealTimers(); await new Promise(r => setTimeout(r, 40)); vi.useFakeTimers(); };

beforeEach(() => { vi.useFakeTimers(); t = 0; });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('load a copy cannot outlive the grown-up session', () => {
  test('a file read that finishes after the panel was closed and the gate reopened shows nothing', async () => {
    const { root, gu, mem } = arrange(vi.fn());
    const text = await bundleText();
    openGate(gu); answer(root);
    const { file, release } = delayedFile(text);
    choose(root, file);
    gu.close();
    openGate(gu); // the sum gate is up again and unanswered
    release();
    await settle();
    expect(root.querySelector('.gu-import')).toBeNull();
    expect(root.querySelector('[data-testid="gate-sum"]')).not.toBeNull();
    expect(mem.size).toBe(0);
  });

  test('a confirmation left over from an earlier session cannot replace anything', async () => {
    const reload = vi.fn();
    const { root, gu, mem } = arrange(reload);
    const text = await bundleText();
    openGate(gu); answer(root);
    const { file, release } = delayedFile(text);
    release();
    choose(root, file);
    await settle();
    const replace = root.querySelector<HTMLButtonElement>('.gu-replace')!;
    expect(replace).not.toBeNull();
    gu.close();
    openGate(gu);
    replace.click(); // a stale button (as if kept by a script or a late click)
    expect(mem.size).toBe(0);
    expect(reload).not.toHaveBeenCalled();
  });

  test('the reset confirmation says what is deleted and what is kept', () => {
    const { root, gu } = arrange(vi.fn());
    openGate(gu); answer(root);
    expect(root.textContent).toContain("This deletes this device's game and all safety copies kept in this browser. Files you saved elsewhere and usage history are kept. Are you sure?");
  });
});

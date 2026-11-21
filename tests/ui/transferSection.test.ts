// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { SAVE_KEY, serialise, storeSave } from '../../src/core/save';
import { TRANSFER_KEY, preimportKeys, type Sha256 } from '../../src/core/saveTransfer';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { createTransferSection, type TransferHost } from '../../src/ui/transferSection';

const sha256: Sha256 = async text => {
  const d = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
};
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);
const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0)); };

function save(seed: number): string {
  const g = new Game(generateWorld(seed));
  g.world.set(24, 1, 24, BlockId.Air);
  const m = new Map<string, string>();
  const s = { setItem: (k: string, v: string) => { m.set(k, v); }, getItem: (k: string) => m.get(k) ?? null } as unknown as Storage;
  storeSave(s, serialise(g, seed));
  return m.get(SAVE_KEY) as string;
}

function setup(opts: { canShare?: boolean; share?: (f: File) => Promise<void> } = {}) {
  localStorage.clear();
  const presented: HTMLElement[] = [];
  const backs: Array<string | undefined> = [];
  const host: TransferHost = { present: c => presented.push(c), back: m => backs.push(m) };
  const downloads: Array<{ name: string; text: string }> = [];
  const d = {
    storage: localStorage, now: () => NOW, host, sha256,
    stopAutosave: vi.fn(), resumeAutosave: vi.fn(), reload: vi.fn(),
    download: (name: string, text: string) => { downloads.push({ name, text }); },
    canShareFiles: () => opts.canShare ?? false, shareFile: opts.share,
  };
  const box = createTransferSection(d);
  document.body.replaceChildren(box);
  const btn = (cls: string) => box.querySelector<HTMLButtonElement>(cls)!;
  const status = () => box.querySelector('[data-testid="transfer-status"]')!.textContent;
  const pick = async (text: string) => {
    const input = box.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [new File([text], 'x.json')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush();
  };
  return { box, d, presented, backs, downloads, btn, status, pick };
}

beforeEach(() => localStorage.clear());

describe('transfer section', () => {
  test('shows plain adult wording, last copy "never" and the hint', () => {
    const t = setup();
    expect(t.btn('.gu-save').textContent).toBe('Save a copy of his game');
    expect(t.btn('.gu-load').textContent).toBe('Load a saved copy');
    expect(t.box.querySelector('[data-testid="transfer-last"]')!.textContent).toBe('Last copy saved: never');
    expect(t.box.textContent).toContain('email, a cloud drive or a USB stick');
    expect(t.btn('.gu-share').hidden).toBe(true);
  });

  test('saving with no game gives a friendly message and downloads nothing', async () => {
    const t = setup();
    t.btn('.gu-save').click();
    await flush();
    expect(t.downloads).toEqual([]);
    expect(t.status()).toContain('no saved game');
    expect(localStorage.getItem(TRANSFER_KEY)).toBeNull();
  });

  test('saving downloads the dated file and remembers the date', async () => {
    const t = setup();
    localStorage.setItem(SAVE_KEY, save(5));
    t.btn('.gu-save').click();
    await flush();
    expect(t.downloads).toHaveLength(1);
    expect(t.downloads[0].name).toMatch(/^block-pals-saved-game-2026-11-0[78]\.json$/);
    expect(t.status()).toContain('Saved as');
    expect(t.box.querySelector('[data-testid="transfer-last"]')!.textContent).toMatch(/[78] November 2026/);
    expect(localStorage.getItem(TRANSFER_KEY)).toContain('2026-11-08');
  });

  test('Share appears when the browser can share files; a cancelled share changes nothing, a failed one downloads', async () => {
    const cancel = setup({ canShare: true, share: () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) });
    localStorage.setItem(SAVE_KEY, save(5));
    expect(cancel.btn('.gu-share').hidden).toBe(false);
    cancel.btn('.gu-share').click();
    await flush();
    expect(cancel.downloads).toEqual([]);
    expect(cancel.status()).toContain('cancelled');
    const broken = setup({ canShare: true, share: () => Promise.reject(new Error('nope')) });
    localStorage.setItem(SAVE_KEY, save(5));
    broken.btn('.gu-share').click();
    await flush();
    expect(broken.downloads).toHaveLength(1);
  });

  test('export then import: confirmation screen with summary, warning and the big replace button', async () => {
    const a = setup();
    const raw = save(5);
    localStorage.setItem(SAVE_KEY, raw);
    a.btn('.gu-save').click();
    await flush();
    const file = a.downloads[0].text;
    localStorage.clear();
    const b = setup();
    await b.pick(file);
    expect(b.presented).toHaveLength(1);
    const card = b.presented[0];
    expect(card.querySelector('[data-testid="import-summary"]')!.textContent).toContain('Blocks he changed: 1');
    expect(card.querySelector('[data-testid="import-warning"]')!.textContent).toBeTruthy();
    const yes = card.querySelector<HTMLButtonElement>('.gu-replace')!;
    expect(yes.textContent).toBe("Replace this device's game");
    expect(localStorage.getItem(SAVE_KEY)).toBeNull(); // nothing yet
    yes.click();
    expect(localStorage.getItem(SAVE_KEY)).toBe(raw);
    expect(b.d.stopAutosave).toHaveBeenCalled();
    expect(b.d.reload).toHaveBeenCalled();
  });

  test('cancel goes back and writes nothing', async () => {
    const a = setup();
    localStorage.setItem(SAVE_KEY, save(5));
    a.btn('.gu-save').click();
    await flush();
    const file = a.downloads[0].text;
    const b = setup();
    localStorage.setItem(SAVE_KEY, save(6));
    const before = localStorage.getItem(SAVE_KEY);
    await b.pick(file);
    b.presented[0].querySelector<HTMLButtonElement>('.gu-cancel')!.click();
    expect(b.backs).toEqual([undefined]);
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(b.d.reload).not.toHaveBeenCalled();
    expect(b.d.stopAutosave).not.toHaveBeenCalled();
  });

  test('a corrupted file shows a friendly message and the existing game is unchanged', async () => {
    const t = setup();
    const mine = save(7);
    localStorage.setItem(SAVE_KEY, mine);
    await t.pick('{ this is not a save');
    expect(t.presented).toHaveLength(0);
    expect(t.status()).toContain('not a Block Pals saved game');
    expect(localStorage.getItem(SAVE_KEY)).toBe(mine);
    expect(preimportKeys().every(k => localStorage.getItem(k) === null)).toBe(true);
  });

  test('a failed backup on confirm goes back with a message and keeps the game', async () => {
    const a = setup();
    localStorage.setItem(SAVE_KEY, save(5));
    a.btn('.gu-save').click();
    await flush();
    const file = a.downloads[0].text;
    const b = setup();
    const mine = save(6);
    localStorage.setItem(SAVE_KEY, mine);
    await b.pick(file);
    const orig = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.includes('.preimport')) throw new Error('quota');
      orig.call(this, k, v);
    });
    b.presented[0].querySelector<HTMLButtonElement>('.gu-replace')!.click();
    vi.restoreAllMocks();
    expect(b.backs[0]).toContain('Nothing has been changed');
    expect(localStorage.getItem(SAVE_KEY)).toBe(mine);
    expect(b.d.resumeAutosave).toHaveBeenCalled();
    expect(b.d.reload).not.toHaveBeenCalled();
  });
});

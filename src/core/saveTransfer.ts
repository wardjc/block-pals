import { applySave, inspectSave, SAVE_KEY } from './save';

/**
 * "Save a copy / load a copy": moves his saved game between devices as a plain file.
 * Pure and injectable (storage, clock, hashing) and VERSION-AGNOSTIC: it only ever uses the
 * game's current main save key (SAVE_KEY) and the game's own hardened parser (inspectSave).
 * It never touches the legacy v1 key, the .bad / .backup slots, or the usage and controller keys.
 */

export const BUNDLE_FORMAT = 'blockpals-save-bundle';
export const BUNDLE_VERSION = 1;
export const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
/** Small non-save key: when the last copy was made. Never part of a bundle. */
export const TRANSFER_KEY = 'blockpals.transfer.v1';
const PREIMPORT_SLOTS = 3;

/** The previous games kept before an import replaced them: newest first. */
export const preimportKeys = (mainKey: string = SAVE_KEY): string[] =>
  Array.from({ length: PREIMPORT_SLOTS }, (_, i) => (i === 0 ? `${mainKey}.preimport` : `${mainKey}.preimport.${i + 1}`));

/** Extra keys the grown-ups' reset must clear (the pre-import slots and the transfer note). */
export const transferResetKeys = (mainKey: string = SAVE_KEY): string[] => [...preimportKeys(mainKey), TRANSFER_KEY];

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  createdAt: string;
  app?: string;
  keys: Record<string, string>;
  checksum: string;
}

export type Sha256 = (text: string) => Promise<string>;

export const webCryptoSha256: Sha256 = async text => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('no WebCrypto');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** The text the checksum covers: keys in sorted order, so the same content always gives the same sum. */
export function canonicalKeys(keys: Record<string, string>): string {
  // fromEntries defines own properties, so a key called __proto__ is kept like any other.
  return JSON.stringify(Object.fromEntries(Object.keys(keys).sort().map(k => [k, keys[k]])));
}

export interface TransferDeps {
  storage: Storage | null;
  now: () => number;
  sha256?: Sha256;
  app?: string;
  mainKey?: string;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
export const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
export const bundleFileName = (ms: number): string => `block-pals-saved-game-${localDate(ms)}.json`;

export type Failure = { ok: false; reason: string; message: string };
const fail = (reason: string, message: string): Failure => ({ ok: false, reason, message });

export type ExportResult = { ok: true; bundle: Bundle; text: string; fileName: string } | Failure;

export async function buildBundle(deps: TransferDeps): Promise<ExportResult> {
  const mainKey = deps.mainKey ?? SAVE_KEY;
  if (!deps.storage) return fail('storage', 'This browser is not letting the game keep anything, so there is nothing to copy.');
  let raw: string | null;
  try { raw = deps.storage.getItem(mainKey); } catch {
    return fail('storage', 'The saved game could not be read just now, so no copy was made. Nothing has been changed.');
  }
  if (raw === null) return fail('nosave', 'There is no saved game on this device yet. Play for a little while first, then try again.');
  if (!inspectSave(raw)) return fail('invalid', 'The saved game on this device could not be read, so it was not copied. Nothing has been changed.');
  try {
    const keys = { [mainKey]: raw };
    const checksum = await (deps.sha256 ?? webCryptoSha256)(canonicalKeys(keys));
    const createdAt = new Date(deps.now()).toISOString();
    const bundle: Bundle = { format: BUNDLE_FORMAT, formatVersion: BUNDLE_VERSION, createdAt, ...(deps.app ? { app: deps.app } : {}), keys, checksum };
    return { ok: true, bundle, text: JSON.stringify(bundle), fileName: bundleFileName(deps.now()) };
  } catch {
    return fail('crypto', 'This browser cannot make the safety check for the file (it needs a secure https address). No copy was made.');
  }
}

export function readTransferNote(storage: Storage | null): { lastExportAt: string | null } {
  try {
    const raw = storage?.getItem(TRANSFER_KEY);
    if (!raw) return { lastExportAt: null };
    const v = JSON.parse(raw) as { lastExportAt?: unknown };
    return { lastExportAt: typeof v.lastExportAt === 'string' && !Number.isNaN(Date.parse(v.lastExportAt)) ? v.lastExportAt : null };
  } catch { return { lastExportAt: null }; }
}

export function writeTransferNote(storage: Storage | null, lastExportAt: string): void {
  try { storage?.setItem(TRANSFER_KEY, JSON.stringify({ lastExportAt })); } catch { /* a missing note is harmless */ }
}

export interface Preview {
  /** When the copy was made (ISO). */
  createdAt: string;
  /** Blocks he changed (dug or placed) in the copy. */
  edits: number;
  /** Things in his bag in the copy (blocks and items, counted by quantity). */
  items: number;
  /** Individual damaged entries the game will leave out. */
  skipped: number;
  /** Blocks changed in the game currently on this device, or null when there is none. */
  currentEdits: number | null;
}

export type ParseResult = { ok: true; raw: string; preview: Preview } | Failure;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sumCounts = (r: unknown): number =>
  isRecord(r) ? Object.values(r).reduce<number>((a, n) => a + (typeof n === 'number' && n > 0 ? n : 0), 0) : 0;

/** Checks a chosen file's text completely, without writing anything. */
export async function parseBundle(text: string, deps: TransferDeps): Promise<ParseResult> {
  const mainKey = deps.mainKey ?? SAVE_KEY;
  if (text.length > MAX_BUNDLE_BYTES || new TextEncoder().encode(text).length > MAX_BUNDLE_BYTES) return fail('big', 'That file is much too big to be a saved game. Nothing has been changed.');
  if (text.trim() === '') return fail('empty', 'That file is empty. Nothing has been changed.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return fail('garbage', 'That file is not a Block Pals saved game. Nothing has been changed.'); }
  if (!isRecord(parsed) || parsed.format !== BUNDLE_FORMAT) return fail('format', 'That file is not a Block Pals saved game. Nothing has been changed.');
  const v = parsed.formatVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return fail('format', 'That file is not a Block Pals saved game. Nothing has been changed.');
  if (v > BUNDLE_VERSION) return fail('newer', 'This copy was made by a newer version of the game. Open the game on the other device, update it, and try again. Nothing has been changed.');
  const keys = parsed.keys;
  if (!isRecord(keys) || typeof parsed.checksum !== 'string') return fail('format', 'That file is not a complete saved game. Nothing has been changed.');
  if (!Object.values(keys).every(x => typeof x === 'string')) return fail('format', 'That file is not a complete saved game. Nothing has been changed.');
  let sum: string;
  try { sum = await (deps.sha256 ?? webCryptoSha256)(canonicalKeys(keys as Record<string, string>)); } catch {
    return fail('crypto', 'This browser cannot do the safety check on the file (it needs a secure https address). Nothing has been changed.');
  }
  if (sum !== parsed.checksum) return fail('checksum', 'That file looks damaged or has been edited, so it was not used. Nothing has been changed.');
  const raw = keys[mainKey];
  if (typeof raw !== 'string') return fail('key', 'That copy was made by a different version of the game, so it cannot be loaded here. Nothing has been changed.');
  const checked = inspectSave(raw); // the SAME hardened parser the game loads with
  if (!checked) return fail('invalid', 'The saved game inside that file could not be read, so it was not used. Nothing has been changed.');
  try { applySave(checked.data, 0); } catch { // dry run: the world has to build
    return fail('invalid', 'The saved game inside that file could not be built into a world, so it was not used. Nothing has been changed.');
  }
  let currentEdits: number | null = null;
  try {
    const cur = deps.storage ? inspectSave(deps.storage.getItem(mainKey)) : null;
    currentEdits = cur ? cur.data.edits.length : null;
  } catch { currentEdits = null; }
  const d = checked.data as unknown as { edits: unknown[]; inventory?: unknown; items?: unknown };
  return {
    ok: true,
    raw,
    preview: {
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
      edits: d.edits.length,
      items: sumCounts(d.inventory) + sumCounts(d.items),
      skipped: checked.skipped,
      currentEdits,
    },
  };
}

export interface CommitDeps {
  storage: Storage | null;
  mainKey?: string;
  /** Stops autosave and any pending write so the running game cannot overwrite the import. */
  stopAutosave: () => void;
  /** Called when the import is abandoned, so the game keeps saving. */
  resumeAutosave?: () => void;
}

export type CommitResult = { ok: true } | Failure;

/**
 * All or nothing. Order: stop autosave, read everything first, rotate the pre-import copies
 * (oldest first, so the most recent previous game is never lost), then one write to the main key.
 * Every write is read back; on any failure every key touched is put back as it was (and checked),
 * so the whole storage ends as it started. Never writes anything else.
 */
export function commitImport(raw: string, deps: CommitDeps): CommitResult {
  const mainKey = deps.mainKey ?? SAVE_KEY;
  const storage = deps.storage;
  const abandon = (message: string): CommitResult => {
    try { deps.resumeAutosave?.(); } catch { /* nothing more to do */ }
    return fail('storage', message);
  };
  if (!storage) return abandon('This browser is not letting the game keep anything. Nothing has been changed.');
  deps.stopAutosave();
  const slots = preimportKeys(mainKey);
  const originals = new Map<string, string | null>();
  let current: string | null;
  try {
    current = storage.getItem(mainKey);
    originals.set(mainKey, current);
    for (const k of slots) originals.set(k, storage.getItem(k));
  } catch {
    return abandon('The current game could not be read. Nothing has been changed.');
  }
  // The complete list of writes, decided up front: oldest copy first, the new main save last.
  const steps: Array<[string, string]> = [];
  if (current !== null && current !== raw && current !== originals.get(slots[0])) {
    for (let i = slots.length - 1; i >= 1; i--) {
      const older = originals.get(slots[i - 1]);
      if (older !== null && older !== undefined) steps.push([slots[i], older]);
    }
    steps.push([slots[0], current]);
  }
  steps.push([mainKey, raw]);
  const touched: string[] = [];
  try {
    for (const [key, value] of steps) {
      touched.push(key);
      storage.setItem(key, value);
      if (storage.getItem(key) !== value) throw new Error('verify');
    }
  } catch {
    // Put every key we touched back exactly as it was, then check it really is back.
    let back = true;
    for (const key of touched) {
      const was = originals.get(key) as string | null;
      try { if (was === null) storage.removeItem(key); else storage.setItem(key, was); } catch { back = false; }
    }
    try { for (const key of touched) if (storage.getItem(key) !== originals.get(key)) back = false; } catch { back = false; }
    return back
      ? abandon('There was not enough room, or the browser refused to save, so the game was not replaced. Nothing has been changed.')
      : abandon('Something went wrong part way and the earlier games could not all be put back. Please do not load another copy; the game on this device is still playable.');
  }
  return { ok: true };
}

/** "5 March 2026" style, British English. */
export function describeDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

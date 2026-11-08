import {
  MAX_BUNDLE_BYTES, buildBundle, commitImport, describeDate, parseBundle, readTransferNote, writeTransferNote,
  type Preview, type Sha256,
} from '../core/saveTransfer';

/** The "save a copy / load a copy" part of the grown-ups' panel, and its confirmation screen. */
export interface TransferHost {
  /** Replaces the panel with this card (the confirmation screen). */
  present(card: HTMLElement): void;
  /** Goes back to the grown-ups' panel, optionally with a message under the buttons. */
  back(note?: string): void;
}

export interface TransferSectionDeps {
  storage: Storage | null;
  now: () => number;
  host: TransferHost;
  stopAutosave: () => void;
  resumeAutosave?: () => void;
  reload: () => void;
  sha256?: Sha256;
  app?: string;
  /** Test seams; the defaults use the browser. */
  download?: (fileName: string, text: string) => void;
  canShareFiles?: () => boolean;
  shareFile?: (file: File) => Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  if (tag === 'button') (e as HTMLButtonElement).type = 'button';
  return e;
}

export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const probe = (): File => new File(['{}'], 'probe.json', { type: 'application/json' });
const defaultCanShare = (): boolean => {
  try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe()] }); } catch { return false; }
};
const defaultShare = (file: File): Promise<void> => navigator.share({ files: [file], title: 'Block Pals saved game' });

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function describeLast(iso: string | null): string {
  return iso ? describeDate(iso) : 'never';
}

export function createTransferSection(d: TransferSectionDeps, initialNote = ''): HTMLElement {
  const box = el('div', 'gu-transfer');
  box.appendChild(el('h3', 'gu-sub', 'Save a copy of his game'));
  const last = el('p', 'gu-last', `Last copy saved: ${describeLast(readTransferNote(d.storage).lastExportAt)}`);
  last.dataset.testid = 'transfer-last';
  const hint = el('p', 'gu-hint', 'Send the file to the other device by email, a cloud drive or a USB stick, then open the game there and choose Load.');
  const status = el('p', 'gu-status gu-transfer-status', initialNote);
  status.dataset.testid = 'transfer-status';
  status.setAttribute('role', 'status');
  const say = (msg: string): void => { status.textContent = msg; };

  const saveBtn = el('button', 'gu-action gu-save', 'Save a copy of his game');
  const shareBtn = el('button', 'gu-action gu-share', 'Share…');
  const loadBtn = el('button', 'gu-action gu-load', 'Load a saved copy');
  shareBtn.hidden = !(d.canShareFiles ?? defaultCanShare)();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.hidden = true;
  input.dataset.testid = 'transfer-file';

  const make = async () => buildBundle({ storage: d.storage, now: d.now, sha256: d.sha256, app: d.app });
  const done = (): void => {
    const iso = new Date(d.now()).toISOString();
    writeTransferNote(d.storage, iso);
    last.textContent = `Last copy saved: ${describeLast(iso)}`;
  };

  saveBtn.addEventListener('click', async () => {
    say('Making the copy…');
    const r = await make();
    if (!r.ok) { say(r.message); return; }
    try { (d.download ?? downloadText)(r.fileName, r.text); } catch { say('The file could not be saved by this browser. Nothing has been changed.'); return; }
    done();
    say(`Saved as ${r.fileName}. Look in your Downloads folder.`);
  });

  shareBtn.addEventListener('click', async () => {
    say('Making the copy…');
    const r = await make();
    if (!r.ok) { say(r.message); return; }
    const file = new File([r.text], r.fileName, { type: 'application/json' });
    try {
      await (d.shareFile ?? defaultShare)(file);
      done();
      say('Shared. Open the game on the other device and choose Load a saved copy.');
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') { say('Sharing was cancelled. Nothing has been changed.'); return; }
      try { (d.download ?? downloadText)(r.fileName, r.text); done(); say(`Sharing did not work, so the file was saved instead as ${r.fileName}.`); } catch { say('The file could not be shared or saved. Nothing has been changed.'); }
    }
  });

  loadBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_BUNDLE_BYTES) { say('That file is much too big to be a saved game. Nothing has been changed.'); return; }
    say('Checking the file…');
    let text: string;
    try { text = await readText(file); } catch { say('That file could not be read. Nothing has been changed.'); return; }
    const r = await parseBundle(text, { storage: d.storage, now: d.now, sha256: d.sha256 });
    if (!r.ok) { say(r.message); return; }
    say('');
    d.host.present(confirmCard(d, r.raw, r.preview));
  });

  box.append(last, saveBtn, shareBtn, loadBtn, input, hint, status);
  return box;
}

function confirmCard(d: TransferSectionDeps, raw: string, p: Preview): HTMLElement {
  const card = el('div', 'gu-card gu-panel gu-import');
  card.appendChild(el('h2', 'gu-title', 'Load this saved game?'));
  const lines = el('ul', 'gu-summary');
  lines.dataset.testid = 'import-summary';
  const li = (t: string): void => { lines.appendChild(el('li', '', t)); };
  if (p.createdAt) li(`Saved on: ${describeDate(p.createdAt)}`);
  li(`Blocks he changed: ${p.edits}`);
  li(`Things in his bag: ${p.items}`);
  if (p.skipped > 0) li(`${p.skipped} damaged ${p.skipped === 1 ? 'entry' : 'entries'} will be left out`);
  card.appendChild(lines);
  const warn = el('p', 'gu-warn gu-warn-big',
    p.currentEdits === null
      ? 'This will put this saved game on this device.'
      : `Warning: this replaces the game on this device (${p.currentEdits} blocks changed). A safety copy of the current game is kept first.`);
  warn.dataset.testid = 'import-warning';
  card.appendChild(warn);
  const status = el('p', 'gu-status');
  const yes = el('button', 'gu-action gu-danger gu-replace', "Replace this device's game");
  const no = el('button', 'gu-action gu-cancel', 'Cancel');
  no.addEventListener('click', () => d.host.back());
  let busy = false;
  yes.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    const r = commitImport(raw, { storage: d.storage, stopAutosave: d.stopAutosave, resumeAutosave: d.resumeAutosave });
    if (!r.ok) { busy = false; d.host.back(r.message); return; }
    status.textContent = 'Done. Starting his new game…';
    d.reload();
  });
  card.append(yes, no, status);
  return card;
}

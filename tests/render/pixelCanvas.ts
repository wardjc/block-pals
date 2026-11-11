/**
 * A tiny software 2D canvas for tests (no browser, no native canvas): enough of
 * CanvasRenderingContext2D for the atlas painters (fillRect, clearRect, translate, save/restore,
 * rect + clip, source-over blending of #hex, rgb() and rgba() colours).
 */

export type RGBA = [number, number, number, number]; // 0..255 each, alpha 0..1

export function parseColour(s: string): RGBA {
  const t = s.trim();
  if (t.startsWith('#')) {
    const h = t.slice(1);
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full.slice(0, 6), 16);
    const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(t);
  if (!m) throw new Error(`unknown colour ${s}`);
  const parts = m[1].split(',').map(p => Number(p.trim()));
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

interface State { tx: number; ty: number; clip: [number, number, number, number] | null }

export class PixelCanvas {
  readonly data: Float64Array; // r, g, b, a (a 0..1)
  fillStyle: string | CanvasGradient | CanvasPattern = '#000000';
  imageSmoothingEnabled = false;
  fillRects = 0;
  clears = 0;
  private state: State = { tx: 0, ty: 0, clip: null };
  private stack: State[] = [];
  private path: [number, number, number, number] | null = null;

  constructor(readonly width: number, readonly height: number) {
    this.data = new Float64Array(width * height * 4);
  }

  save(): void { this.stack.push({ ...this.state }); }
  restore(): void { this.state = this.stack.pop() ?? { tx: 0, ty: 0, clip: null }; }
  translate(x: number, y: number): void { this.state.tx += x; this.state.ty += y; }
  beginPath(): void { this.path = null; }
  rect(x: number, y: number, w: number, h: number): void { this.path = [x + this.state.tx, y + this.state.ty, w, h]; }
  clip(): void { if (this.path) this.state.clip = this.path; }
  drawImage(): void { /* icons: not needed for pixel checks */ }

  private each(x: number, y: number, w: number, h: number, f: (i: number) => void): void {
    let x0 = Math.round(x + this.state.tx), y0 = Math.round(y + this.state.ty);
    let x1 = x0 + Math.round(w), y1 = y0 + Math.round(h);
    const c = this.state.clip;
    if (c) { x0 = Math.max(x0, c[0]); y0 = Math.max(y0, c[1]); x1 = Math.min(x1, c[0] + c[2]); y1 = Math.min(y1, c[1] + c[3]); }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(this.width, x1); y1 = Math.min(this.height, y1);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) f((yy * this.width + xx) * 4);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRects++;
    const [r, g, b, a] = parseColour(String(this.fillStyle));
    this.each(x, y, w, h, i => {
      const d = this.data;
      const da = d[i + 3];
      const oa = a + da * (1 - a);
      if (oa <= 0) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; return; }
      d[i] = (r * a + d[i] * da * (1 - a)) / oa;
      d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa;
      d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa;
      d[i + 3] = oa;
    });
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    this.clears++;
    this.each(x, y, w, h, i => { this.data[i] = this.data[i + 1] = this.data[i + 2] = this.data[i + 3] = 0; });
  }

  /** The 16×16 pixels of a cell as [r,g,b,a] (rounded), for comparisons. */
  cell(col: number, row: number, size = 16): RGBA[] {
    const out: RGBA[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = ((row * size + y) * this.width + col * size + x) * 4;
        out.push([Math.round(this.data[i]), Math.round(this.data[i + 1]), Math.round(this.data[i + 2]), Math.round(this.data[i + 3] * 1000) / 1000]);
      }
    }
    return out;
  }
}

/** sRGB luma (Rec. 709 weights on the stored values), 0..1. */
export const luma = ([r, g, b]: RGBA): number => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const toLinear = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const toSrgb = (v: number): number => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/**
 * The pixel as the renderer shows it on a face lit by `factor` of full light: the texture is
 * sRGB, so lighting multiplies the linear colour and the result is shown in sRGB again.
 */
export function shaded([r, g, b, a]: RGBA, factor: number): RGBA {
  return [toSrgb(toLinear(r) * factor), toSrgb(toLinear(g) * factor), toSrgb(toLinear(b) * factor), a];
}

/** A stand-in for an HTMLCanvasElement whose 2D context is a PixelCanvas. */
export class FakeCanvasElement {
  width = 300;
  height = 150;
  ctx: PixelCanvas | null = null;
  getContext(): PixelCanvas {
    this.ctx ??= new PixelCanvas(this.width, this.height);
    return this.ctx;
  }
  toDataURL(): string {
    return 'data:image/png;base64,ZmFrZQ==';
  }
}

/** Installs a global `document` whose canvases are FakeCanvasElements (node test environment). */
export function installFakeDocument(): { canvases: FakeCanvasElement[]; restore: () => void } {
  const g = globalThis as { document?: unknown };
  const before = g.document;
  const canvases: FakeCanvasElement[] = [];
  g.document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`fake document: ${tag}`);
      const c = new FakeCanvasElement();
      canvases.push(c);
      return c;
    },
  };
  return { canvases, restore: () => { g.document = before; } };
}

export function hsl([r, g, b]: RGBA): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return { h, s, l };
}

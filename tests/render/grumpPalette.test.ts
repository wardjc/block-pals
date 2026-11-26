import { describe, expect, it } from 'vitest';
import { BLUSH, FRIEND_PALETTE, GRUMP_PALETTE, INK, grumpParts, type GrumpLook } from '../../src/render/grumps';

const hex = (s: string): number => parseInt(s.replace('#', ''), 16);
/** HSL lightness, HSV saturation (the pastel test: a bright, soft body colour), hue in degrees, from the sRGB bytes. */
function measure(colour: number): { l: number; s: number; h: number } {
  const r = ((colour >> 16) & 255) / 255, g = ((colour >> 8) & 255) / 255, b = (colour & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { l: (max + min) / 2, s: max === 0 ? 0 : d / max, h };
}
const LOOKS: GrumpLook[] = [];
for (const kind of ['jelly', 'cloud'] as const) {
  for (const mood of [0, 1] as const) for (let v = 0; v < 4; v++) LOOKS.push({ kind, mood, variant: v });
  for (let v = 0; v < 5; v++) LOOKS.push({ kind, mood: 'friend', variant: v });
}
const bodyColours = new Set([...GRUMP_PALETTE, ...FRIEND_PALETTE].map(hex));

describe('grump palette (never red, never dark, always soft)', () => {
  it('the palettes are the plan\'s soft colours', () => {
    expect(GRUMP_PALETTE).toEqual(['#c9b8ec', '#b7e4cf', '#f5cfa8', '#b8d8f2']);
    expect(FRIEND_PALETTE).toEqual(['#ffe27a', '#ffb6c9', '#8fe3e0', '#c6ec8a', '#ffc27a']);
    expect(INK).toBe('#4a3f63');
    expect(BLUSH).toBe('#ffb3b3');
  });

  it('every body colour has lightness at least 0.62 and saturation at most 0.8', () => {
    for (const c of bodyColours) {
      const m = measure(c);
      expect(m.l, c.toString(16)).toBeGreaterThanOrEqual(0.62);
      expect(m.s, c.toString(16)).toBeLessThanOrEqual(0.8);
    }
  });

  it('no colour in any model is red-ish (hue 345 to 15) except the cheek blush at lightness 0.8 or more', () => {
    for (const look of LOOKS) for (const { part, role } of grumpParts(look)) {
      const c = part[6];
      const m = measure(c);
      const redish = (m.h >= 345 || m.h <= 15) && m.s > 0.12;
      if (redish) {
        expect(role, `${look.kind} ${look.mood}`).toBe('blush');
        expect(m.l).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it('eyes are white and pupils are ink, nothing else', () => {
    for (const look of LOOKS) for (const { part, role } of grumpParts(look)) {
      if (role === 'eye') expect(part[6]).toBe(0xffffff);
      if (role === 'pupil') expect(part[6]).toBe(hex(INK));
    }
  });

  it('every vertex colour in every model is in the palettes, white, ink or blush', () => {
    const allowed = new Set([...bodyColours, 0xffffff, hex(INK), hex(BLUSH)]);
    for (const look of LOOKS) for (const { part } of grumpParts(look)) expect(allowed.has(part[6]), `${look.kind} ${look.mood} ${part[6].toString(16)}`).toBe(true);
  });

  it('no model has more than 2 dark boxes (lightness under 0.3), and only pupils and the mouth may be dark', () => {
    for (const look of LOOKS) {
      const dark = grumpParts(look).filter(({ part }) => measure(part[6]).l < 0.3);
      expect(dark.length).toBeLessThanOrEqual(2);
      for (const d of dark) expect(['pupil', 'mouth', 'smile']).toContain(d.role);
    }
    // The ink is dark plum, never black.
    expect(measure(hex(INK)).l).toBeGreaterThan(0.25);
  });

  it('a friend body is always one of the five bright friend colours, a grump one of the four soft ones', () => {
    for (const look of LOOKS) {
      const body = grumpParts(look).filter(p => p.role === 'body').map(p => p.part[6]);
      const palette = look.mood === 'friend' ? FRIEND_PALETTE : GRUMP_PALETTE;
      for (const c of body) expect(palette.map(hex)).toContain(c);
    }
  });
});

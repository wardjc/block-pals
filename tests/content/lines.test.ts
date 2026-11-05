import { describe, it, expect } from 'vitest';
import { LINES, LINE_ICONS, type LineKey } from '../../src/content/lines';

const keys = Object.keys(LINES) as LineKey[];

describe('lines', () => {
  it('every LineKey has at least one line', () => {
    expect(keys).toHaveLength(13);
    for (const k of keys) {
      expect(LINES[k].length).toBeGreaterThanOrEqual(1);
      expect(LINES[k].length).toBeLessThanOrEqual(3);
    }
  });
  it('lines use British spelling', () => {
    for (const k of keys)
      for (const l of LINES[k]) expect(l).not.toMatch(/\b(color|favorite|gray|mom|math|center|theater|realize)\b/i);
  });
  it('lines are short', () => {
    for (const k of keys) for (const l of LINES[k]) expect(l.split(/\s+/).length).toBeLessThanOrEqual(12);
  });
  it('first variants are fixed', () => {
    expect(LINES.hello[0]).toBe("Hiya! I'm Pip. Let's go exploring!");
    expect(LINES.letsFindWood[0]).toBe("Let's find some wood. Look for a tree!");
    expect(LINES.crafted[0]).toBe('Brilliant! You made it!');
    expect(LINES.full[0]).toBe('Your bag is full of those!');
    expect(LINES.noPath[0]).toBe("Hmm, I can't get there. Let's try another way!");
    expect(LINES.breakTime[0]).toBe("Let's have a stretch! Wiggle your arms!");
    expect(LINES.welcomeBack[0]).toBe("You're back! I missed you!");
  });
  it('every LineKey has an icon', () => {
    for (const k of keys) expect(LINE_ICONS[k]).toBeTruthy();
  });
});

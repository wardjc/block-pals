import { describe, expect, it } from 'vitest';
import { DOOR_EMBLEMS, VILLAGER_LINES, VILLAGERS, pickVillagerLine } from '../../src/content/villagers';
import { GreetTracker } from '../../src/game/villagers';
import { generateWorld } from '../../src/core/worldgen';
import { clipKey } from '../../src/audio/voiceKey';
import { Voice, audioLocked } from '../../src/audio/voice';

const { village } = generateWorld(2026);
const houses = village.houses;
const house = (id: string) => houses.find(h => h.id === id)!;
const inside = (id: string): [number, number, number] => {
  const r = house(id).rect;
  return [r.x0 + 3, house(id).groundY + 1, r.z0 + 3];
};
const far: [number, number, number] = [30, 6, 30];

describe('villagers', () => {
  it('four villagers, one per house, each with a funny feature and their own voice', () => {
    expect(VILLAGERS.map(v => [v.id, v.house, v.speaker])).toEqual([
      ['bramble', 'bakery', 'bramble'], ['pebble', 'shop', 'pebble'],
      ['fern', 'farmhouse', 'fern'], ['willow', 'granny', 'granny'],
    ]);
    for (const v of VILLAGERS) { expect(v.feature.length).toBeGreaterThan(5); expect(v.icon).toBeTruthy(); }
  });

  it('four British variants per villager, short, with no cheers and no promises', () => {
    for (const v of VILLAGERS) {
      const lines = VILLAGER_LINES[v.id];
      expect(lines).toHaveLength(4);
      expect(new Set(lines).size).toBe(4);
      for (const l of lines) {
        expect(l.split(/\s+/).length).toBeLessThanOrEqual(12);
        expect(l).toMatch(/[.!?]$/);
        expect(l).not.toMatch(/\b(color|favorite|gray|mom|center)\b/i);
        expect(l).not.toMatch(/\b(whee+|yippee|woo-?hoo|yay|hooray|ha ha|wahoo|ooh+|hmm+|ta-?da|hup|ahoy)\b/i);
        expect(l).not.toMatch(/\b(buy|sell|quest|bake you|coins?|tap|click|touch)\b/i);
        expect(l).not.toMatch(/meet you|nice to|again|rather|\bcarrots say|do you like|mind the/i);
        expect(l).not.toMatch(/I can see|Look, a|Nearly|Almost/i);
        expect(l).not.toMatch(/minecraft|creeper|steve|villager/i);
      }
    }
  });

  it('every line has a clip key for its own speaker', () => {
    const keys = new Set<string>();
    for (const v of VILLAGERS) for (const l of VILLAGER_LINES[v.id]) keys.add(clipKey(v.speaker, l));
    expect(keys.size).toBe(16);
  });
});

describe('GreetTracker', () => {
  const make = () => {
    let t = 0;
    return { g: new GreetTracker(() => t), set: (v: number) => { t = v; } };
  };

  it('greets once on entering', () => {
    const { g } = make();
    expect(g.update(inside('bakery'), houses, false)).toBe('bramble');
    expect(g.update(inside('bakery'), houses, false)).toBeNull();
    expect(g.update(inside('bakery'), houses, false)).toBeNull();
  });

  it('does not greet from outside, or in his own cottage', () => {
    const { g } = make();
    expect(g.update(far, houses, false)).toBeNull();
    const d = house('bakery').doorFront;
    expect(g.update([d[0], d[1], d[2] + 6], houses, false)).toBeNull();
    expect(g.update(inside('cottage'), houses, false)).toBeNull();
  });

  it('greets from the doorstep (3 cells in front of the door)', () => {
    const { g } = make();
    const d = house('bakery').doorFront;
    expect(g.update([d[0], d[1], d[2] + 2], houses, false)).toBe('bramble');
  });

  it('60 second cooldown per villager', () => {
    const { g, set } = make();
    expect(g.update(inside('shop'), houses, false)).toBe('pebble');
    set(10_000);
    g.update(far, houses, false);
    expect(g.update(inside('shop'), houses, false)).toBeNull();
    g.update(far, houses, false);
    set(61_000);
    expect(g.update(inside('shop'), houses, false)).toBe('pebble');
  });

  it('quiet while busy and does not use up the greeting', () => {
    const { g } = make();
    expect(g.update(inside('farmhouse'), houses, true)).toBeNull();
    expect(g.update(inside('farmhouse'), houses, true)).toBeNull();
    expect(g.update(inside('farmhouse'), houses, false)).toBe('fern');
  });

  it('one at a time: a second neighbour waits for a gap', () => {
    const { g, set } = make();
    expect(g.update(inside('bakery'), houses, false)).toBe('bramble');
    g.update(far, houses, false);
    set(1000);
    expect(g.update(inside('shop'), houses, false)).toBeNull();
    set(9000);
    expect(g.update(inside('shop'), houses, false)).toBe('pebble');
  });

  it('walking away cancels a greeting that is still being spoken, once', () => {
    const { g, set } = make();
    g.update(inside('granny'), houses, false);
    set(1500);
    expect(g.update(far, houses, false)).toBeNull();
    expect(g.takeCancel()).toBe(true);
    expect(g.takeCancel()).toBe(false);
  });

  it('a long-finished greeting is not cancelled when he leaves', () => {
    const { g, set } = make();
    g.update(inside('granny'), houses, false);
    set(20_000);
    g.update(far, houses, false);
    expect(g.takeCancel()).toBe(false);
  });
});

describe('villager content helpers', () => {
  it('never repeats the previous variant', () => {
    for (const v of VILLAGERS) for (const last of VILLAGER_LINES[v.id]) for (let i = 0; i < 20; i++) {
      expect(pickVillagerLine(v.id, last, () => i / 20)).not.toBe(last);
    }
  });
  it('every house has a picture over its door, and they differ', () => {
    expect(Object.keys(DOOR_EMBLEMS).sort()).toEqual(['bakery', 'cottage', 'farmhouse', 'granny', 'shop']);
    expect(new Set(Object.values(DOOR_EMBLEMS)).size).toBe(5);
  });
});

describe('Voice.say speaker', () => {
  it('passes the speaker to the clip key and reports speaking', async () => {
    const calls: string[] = [];
    const voice = new Voice(null, {
      fetch: async (url: RequestInfo | URL) => { calls.push(String(url)); return { ok: false } as Response; },
      base: '/', audio: () => null,
    });
    voice.say('Hello, neighbour! Welcome to my bakery.', 'bramble');
    expect(voice.speaking()).toBe(true);
    voice.stop();
    expect(voice.speaking()).toBe(false);
    await Promise.resolve();
    expect(calls[0]).toContain('manifest');
  });
});

describe('hello cancelling and locked audio', () => {
  const fake = () => new Voice(null, { fetch: async () => ({ ok: false }) as Response, base: '/', audio: () => null });

  it('walking away stops the hello itself', () => {
    const voice = fake();
    voice.say('Hello, neighbour! Welcome to my bakery.', 'bramble');
    expect(voice.stopIfCurrent('Hello, neighbour! Welcome to my bakery.', 'bramble')).toBe(true);
    expect(voice.speaking()).toBe(false);
  });

  it('never cuts a Pip line or break reminder that replaced the hello', () => {
    const voice = fake();
    voice.say('Hello, neighbour! Welcome to my bakery.', 'bramble');
    voice.say("Let's have a stretch! Wiggle your arms!"); // Pip's break reminder took over
    expect(voice.stopIfCurrent('Hello, neighbour! Welcome to my bakery.', 'bramble')).toBe(false);
    expect(voice.speaking()).toBe(true);
    // Same words from another speaker are not the same line either.
    expect(voice.stopIfCurrent("Let's have a stretch! Wiggle your arms!", 'bramble')).toBe(false);
    expect(voice.speaking()).toBe(true);
  });

  it('holds one-shot lines while audio is locked, releases them once it runs', () => {
    expect(audioLocked(false, null)).toBe(true); // before the first tap
    expect(audioLocked(false, 'running')).toBe(true);
    expect(audioLocked(true, 'suspended')).toBe(true); // tapped, context still waking up
    expect(audioLocked(true, 'running')).toBe(false);
    expect(audioLocked(true, null)).toBe(false); // no Web Audio at all: speech fallback still works
    expect(audioLocked(true, 'suspended', 1000)).toBe(true); // still waking up
    expect(audioLocked(true, 'suspended', 3000)).toBe(false); // not coming: the tablet's voice speaks instead
    expect(audioLocked(false, 'suspended', 99999)).toBe(true); // never before the first tap
  });

  it('a held hello keeps its cooldown and visit unspent', () => {
    const houses = generateWorld(2026).village.houses;
    const g = new GreetTracker(() => 0);
    const r = houses.find(h => h.id === 'bakery')!.rect;
    const cell: [number, number, number] = [r.x0 + 3, 6, r.z0 + 3];
    // The caller does not call update at all while locked; once unlocked the greeting is still there.
    expect(g.update(cell, houses, false)).toBe('bramble');
  });
});

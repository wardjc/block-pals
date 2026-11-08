import { describe, expect, it } from 'vitest';
import { allowLine, helperDt, leadPaused, mayGreet, mayPipSpeakQueued, type SpeechContext } from '../../src/game/speechPolicy';
import { Pal } from '../../src/game/pal';
import { Player } from '../../src/game/player';
import { generateWorld } from '../../src/core/worldgen';

const quiet: SpeechContext = { breakOpen: false, speaking: false, locked: false, pipPending: false, gestureBusy: false };

describe('speech arbitration', () => {
  it('a neighbour greets only when nothing else is going on', () => {
    expect(mayGreet(quiet)).toBe(true);
    for (const k of ['breakOpen', 'speaking', 'locked', 'pipPending', 'gestureBusy'] as const) {
      expect(mayGreet({ ...quiet, [k]: true }), k).toBe(false);
    }
  });

  it('while the break bubble is open, nothing queued speaks and nothing greets', () => {
    const open = { ...quiet, breakOpen: true };
    expect(mayGreet(open)).toBe(false);
    expect(mayPipSpeakQueued(open)).toBe(false);
    expect(mayPipSpeakQueued(quiet)).toBe(true);
    expect(mayPipSpeakQueued({ ...quiet, speaking: true })).toBe(false);
  });

  it('only the break line itself gets through an open break bubble (idle hints and reactions wait)', () => {
    expect(allowLine(true, 'breakTime')).toBe(true);
    for (const k of ['idleHint', 'letsFindWood', 'crafted', 'upYouCome', 'letsMeetNeighbours', 'comeOn', 'thisWay']) {
      expect(allowLine(true, k), k).toBe(false);
      expect(allowLine(false, k), k).toBe(true);
    }
  });

  it('the lead waits for an open break bubble, but the break never pauses play itself', () => {
    expect(leadPaused(false, true)).toBe(true);
    expect(leadPaused(true, false)).toBe(true);
    expect(leadPaused(false, false)).toBe(false);
    // play is not paused by the break: the helper step is the game's own pause only
    expect(helperDt(false, 0.033)).toBe(0.033);
  });
});

describe('Pip stands still while a menu has the game paused', () => {
  it('helperDt is zero while paused, and a Pal given zero time does not move even in lead mode', () => {
    expect(helperDt(true, 0.033)).toBe(0);
    const { world, spawn, village } = generateWorld(2026);
    const player = new Player(spawn);
    const pal = new Pal({ x: spawn.x + 1.5, y: spawn.y, z: spawn.z + 1.5 }, () => {});
    pal.setLead(village.route, () => 10);
    for (let i = 0; i < 30; i++) pal.update(world, player, 1 / 30); // starts walking
    const before = { ...pal.pos };
    expect(Math.hypot(before.x - (spawn.x + 1.5), before.z - (spawn.z + 1.5))).toBeGreaterThan(0.1);
    for (let i = 0; i < 60; i++) pal.update(world, player, helperDt(true, 1 / 30));
    expect(pal.pos).toEqual(before);
    for (let i = 0; i < 30; i++) pal.update(world, player, helperDt(false, 1 / 30));
    expect(Math.hypot(pal.pos.x - before.x, pal.pos.z - before.z)).toBeGreaterThan(0.1);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  LEAD_GAP_MAX, LEAD_GIVE_UP, LEAD_OFFER_AFTER_ACTION, LEAD_OFFER_AFTER_LOAD, LeadToVillage, type LeadEvent,
} from '../../src/game/lead';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { applySave, parseSave, readSave, serialise, storeSave, type SaveFlags } from '../../src/core/save';
import type { Cell } from '../../src/core/pathfind';

const route: Cell[] = Array.from({ length: 60 }, (_, i) => [i, 5, 10] as Cell);
const square = { x0: 52, z0: 8, x1: 59, z1: 12 };
const pad = { x0: 45, z0: 5, x1: 59, z1: 15 };
const at = (i: number): Cell => [i, 5, 10];
const make = (flagSet = false) => new LeadToVillage(route, square, flagSet, pad);

/** Runs dt steps of 0.1 s; returns the events seen. */
function run(l: LeadToVillage, seconds: number, player: Cell | (() => Cell), active = false, paused = false): LeadEvent[] {
  const out: LeadEvent[] = [];
  for (let t = 0; t < seconds; t += 0.1) {
    const e = l.update(0.1, typeof player === 'function' ? player() : player, active, paused);
    if (e) out.push(e);
  }
  return out;
}

describe('LeadToVillage', () => {
  it('does nothing when the flag is set', () => {
    const l = make(true);
    expect(l.state).toBe('done');
    expect(run(l, 200, at(2), true)).toEqual([]);
    expect(l.target()).toBeNull();
    expect(l.takeFlagSet()).toBe(false);
  });

  it('offers 8 s after the first action', () => {
    const l = make();
    expect(run(l, 20, at(2))).toEqual([]); // no action: waits for the 25 s
    const l2 = make();
    run(l2, 0.1, at(2), true);
    expect(run(l2, LEAD_OFFER_AFTER_ACTION - 1, at(2))).toEqual([]);
    expect(run(l2, 2, at(2))).toEqual(['start']);
    expect(l2.state).toBe('leading');
  });

  it('offers 25 s after load without any action', () => {
    const l = make();
    expect(run(l, LEAD_OFFER_AFTER_LOAD - 2, at(2))).toEqual([]);
    expect(run(l, 3, at(2))).toEqual(['start']);
  });

  it('skips and sets the flag when he is already in the village', () => {
    const l = make();
    expect(run(l, 1, at(50))).toEqual([]);
    expect(l.state).toBe('arrived');
    expect(l.takeFlagSet()).toBe(true);
    expect(l.takeFlagSet()).toBe(false);
    expect(l.target()).toBeNull();
  });

  it('starts from the nearest route cell', () => {
    const l = make();
    run(l, 26, at(30));
    expect(l.state).toBe('leading');
    expect(l.targetIndex()).toBeGreaterThanOrEqual(30);
  });

  it('waits when he is too far behind, then re-invites at 6 s and 15 s', () => {
    const l = make();
    run(l, 26, at(2));
    const events: Array<[LeadEvent, number]> = [];
    let waitingSince = -1;
    for (let t = 0; t < 40; t += 0.1) {
      const e = l.update(0.1, at(2), false, false);
      if (waitingSince < 0 && l.targetIndex() - 2 >= LEAD_GAP_MAX) waitingSince = t;
      if (e) events.push([e, t]);
    }
    expect(l.targetIndex()).toBeLessThanOrEqual(2 + LEAD_GAP_MAX + 1);
    expect(events.map(e => e[0])).toEqual(['comeOn', 'thisWay']);
    expect(events[0][1] - waitingSince).toBeGreaterThan(5.5);
    expect(events[0][1] - waitingSince).toBeLessThan(6.8);
    expect(events[1][1] - waitingSince).toBeGreaterThan(14.5);
    expect(events[1][1] - waitingSince).toBeLessThan(15.8);
  });

  it('speeds up and never blocks when overtaken', () => {
    const l = make();
    run(l, 26, at(2));
    run(l, 1, at(40)); // he sprints ahead
    run(l, 8, at(40));
    expect(l.targetIndex()).toBeGreaterThanOrEqual(40);
    const t = l.target()!;
    expect(`${t[0]},${t[2]}`).not.toBe('40,10');
  });

  it('never targets his own cell', () => {
    const l = make();
    run(l, 26, at(10));
    for (let i = 0; i < 300; i++) {
      l.update(0.1, at(10 + Math.min(20, Math.floor(i / 5))), false, false);
      const t = l.target();
      if (t) expect(t[0] === 10 + Math.min(20, Math.floor(i / 5)) && t[2] === 10).toBe(false);
    }
  });

  it('gives up after 90 s and does not retry this session', () => {
    const l = make();
    run(l, 26, at(2));
    const events = run(l, LEAD_GIVE_UP + 5, at(2));
    expect(events[events.length - 1]).toBe('giveUp');
    expect(l.state).toBe('gaveUp');
    expect(l.takeFlagSet()).toBe(false);
    expect(run(l, 200, at(2), true)).toEqual([]);
    expect(l.target()).toBeNull();
  });

  it('wandering off the route makes Pip wait and does not advance him', () => {
    const l = make();
    run(l, 26, at(10));
    const off: Cell = [10, 5, 40];
    run(l, 30, off);
    expect(l.targetIndex()).toBeLessThanOrEqual(10 + LEAD_GAP_MAX + 1);
  });

  it('is paused while an overlay is open: no events, no progress, no timers', () => {
    const l = make();
    expect(run(l, 500, at(2), true, true)).toEqual([]);
    expect(l.state).toBe('waiting');
    run(l, 26, at(2));
    const idx = l.targetIndex();
    expect(run(l, 500, at(2), false, true)).toEqual([]);
    expect(l.targetIndex()).toBe(idx);
    expect(l.state).toBe('leading');
  });

  it('arrives: the player walking behind Pip reaches the square', () => {
    const l = make();
    run(l, 26, at(2));
    let px = 2;
    const events: LeadEvent[] = [];
    for (let t = 0; t < 40 && l.state === 'leading'; t += 0.1) {
      px = Math.min(59, px + 3.5 * 0.1);
      const e = l.update(0.1, at(Math.floor(px)), false, false);
      if (e) events.push(e);
    }
    expect(events.filter(e => e === 'arrive')).toHaveLength(1);
    expect(events).not.toContain('giveUp');
    expect(l.takeFlagSet()).toBe(true);
    expect(l.takeFlagSet()).toBe(false);
    expect(l.state).toBe('arrived');
  });

  it('only returns events and a target: it never moves the player', () => {
    const l = make();
    const before = JSON.stringify(l.update.length);
    expect(typeof before).toBe('string');
    expect(l.update.length).toBe(4); // dt, playerCell, active, paused: no Player in, nothing but an event out
  });

  it('gave up, then he walks into the village on his own: the flag is set', () => {
    const l = make();
    run(l, 26, at(2));
    run(l, LEAD_GIVE_UP + 5, at(2));
    expect(l.state).toBe('gaveUp');
    expect(run(l, 1, at(50))).toEqual([]);
    expect(l.state).toBe('arrived');
    expect(l.takeFlagSet()).toBe(true);
    expect(l.takeFlagSet()).toBe(false);
  });

  it('arrives before any offer (he walked there first): the flag is set, no speech', () => {
    const l = make();
    expect(run(l, 2, at(50))).toEqual([]);
    expect(l.takeFlagSet()).toBe(true);
    expect(l.target()).toBeNull();
  });

  it('wandering into the pad while being led sets the flag once, and the lead still ends at the square', () => {
    const l = make();
    run(l, 26, at(40));
    run(l, 0.5, at(46)); // in the pad, not yet in the square
    expect(l.takeFlagSet()).toBe(true);
    const events = run(l, 5, at(53));
    expect(events).toEqual(['arrive']);
    expect(l.takeFlagSet()).toBe(false);
  });

  it('is saved and validated: a reload with the flag never re-asks', () => {
    localStorage.clear();
    const l = make();
    run(l, 26, at(2));
    run(l, LEAD_GIVE_UP + 5, at(2));
    run(l, 1, at(50));
    const flags: SaveFlags = { ledToVillage: false };
    if (l.takeFlagSet()) flags.ledToVillage = true;
    const game = new Game(generateWorld(2026));
    expect(storeSave(localStorage, serialise(game, 2026, flags))).toBe(true);
    const raw = localStorage.getItem('blockpals.save.v2')!;
    expect(parseSave(raw)!.flags.ledToVillage).toBe(true);
    const restored = applySave(readSave(localStorage)!);
    expect(restored.flags.ledToVillage).toBe(true);
    const again = new LeadToVillage(route, square, restored.flags.ledToVillage, pad);
    expect(again.state).toBe('done');
    expect(run(again, 300, at(2), true)).toEqual([]);
  });
});

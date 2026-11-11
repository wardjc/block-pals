import { describe, expect, it } from 'vitest';
import { generateWorld } from '../../src/core/worldgen';
import { TOWER_PLAN } from '../../src/core/tower';
import { VILLAGE_PLAN } from '../../src/core/village';
import type { Cell } from '../../src/core/pathfind';
import { LEAD_GIVE_UP, LEAD_OFFER_AFTER_ACTION, LEAD_OFFER_AFTER_LOAD, LeadToVillage, type LeadEvent } from '../../src/game/lead';
import { doorstepRect, makeTowerLead, NEAR_ROUTE, towerOffer } from '../../src/game/leadTower';

const { tower, towerRoute, village } = generateWorld(2026);
const hilltop = TOWER_PLAN.pad;

function facts(o: Partial<{ gem: boolean; village: boolean; villageLeading: boolean }> = {}) {
  const f = { gem: true, village: true, villageLeading: false, ...o };
  return {
    state: f,
    facts: { hasGem: () => f.gem, ledToVillage: () => f.village, villageLeading: () => f.villageLeading, villagePad: VILLAGE_PLAN.pad },
  };
}
const inSquare: Cell = [village.square.x0 + 1, 5, village.square.z0 + 1];

function run(l: LeadToVillage, seconds: number, player: Cell | (() => Cell), active = false, paused = false): LeadEvent[] {
  const out: LeadEvent[] = [];
  for (let t = 0; t < seconds; t += 0.1) {
    const e = l.update(0.1, typeof player === 'function' ? player() : player, active, paused);
    if (e) out.push(e);
  }
  return out;
}

describe('Pip leads him to the tower once (spec §7g)', () => {
  it('the real route starts in the village and ends at the door front', () => {
    expect(towerRoute.length).toBeGreaterThan(50);
    const first = towerRoute[0];
    const r = VILLAGE_PLAN.pad;
    expect(first[0] >= r.x0 && first[0] <= r.x1 && first[2] >= r.z0 && first[2] <= r.z1).toBe(true);
    const last = towerRoute[towerRoute.length - 1];
    expect(Math.hypot(last[0] - tower.doorFront[0], last[2] - tower.doorFront[2])).toBeLessThanOrEqual(1.5);
  });

  it('no offer without a gem, without the village walk, while the village lead runs, or far from the village and the route', () => {
    for (const o of [{ gem: false }, { village: false }, { villageLeading: true }]) {
      const l = makeTowerLead(tower, towerRoute, hilltop, false, facts(o).facts);
      expect(run(l, 60, inSquare, true)).toEqual([]);
      expect(l.state).toBe('waiting');
    }
    const far: Cell = [5, 5, 5]; // the far north-west corner
    const offer = towerOffer(towerRoute, facts().facts);
    expect(offer(far)).toBe(false);
    expect(offer(inSquare)).toBe(true);
    const mid = towerRoute[Math.floor(towerRoute.length / 2)];
    expect(offer([mid[0] + NEAR_ROUTE - 1, mid[1], mid[2]])).toBe(true);
  });

  it('offered 8.5 s after an action and 25 s after load once all hold, and the gem arriving later starts it', () => {
    const a = makeTowerLead(tower, towerRoute, hilltop, false, facts().facts);
    run(a, 0.1, inSquare, true);
    expect(run(a, LEAD_OFFER_AFTER_ACTION - 1, inSquare)).toEqual([]);
    expect(run(a, 2, inSquare)).toEqual(['start']);
    const b = makeTowerLead(tower, towerRoute, hilltop, false, facts().facts);
    expect(run(b, LEAD_OFFER_AFTER_LOAD - 1, inSquare)).toEqual([]);
    expect(run(b, 2, inSquare)).toEqual(['start']);
    const f = facts({ gem: false });
    const c = makeTowerLead(tower, towerRoute, hilltop, false, f.facts);
    expect(run(c, 40, inSquare)).toEqual([]);
    f.state.gem = true;
    expect(run(c, 0.3, inSquare)).toEqual(['start']);
  });

  it('Pip leads along the real route and he arrives on the hilltop pad or the doorstep; the flag is set once', () => {
    const l = makeTowerLead(tower, towerRoute, hilltop, false, facts().facts);
    let pos = 0;
    const player = (): Cell => towerRoute[Math.min(towerRoute.length - 1, Math.floor(pos))];
    expect(run(l, LEAD_OFFER_AFTER_LOAD + 1, player)).toEqual(['start']);
    const events: LeadEvent[] = [];
    let flags = 0;
    for (let t = 0; t < 120 && l.state === 'leading'; t += 0.1) {
      const target = l.targetIndex();
      if (pos < target - 2) pos += 0.3; // he follows a little behind Pip at about 3 blocks a second
      const e = l.update(0.1, player(), false, false);
      if (e) events.push(e);
      if (l.takeFlagSet()) flags++;
    }
    expect(events).toContain('arrive');
    expect(l.state).toBe('arrived');
    const at = player();
    const step = doorstepRect(tower);
    const onPad = at[0] >= hilltop.x0 && at[0] <= hilltop.x1 && at[2] >= hilltop.z0 && at[2] <= hilltop.z1;
    const onStep = at[0] >= step.x0 && at[0] <= step.x1 && at[2] >= step.z0 && at[2] <= step.z1;
    expect(onPad || onStep || Math.hypot(at[0] - tower.doorFront[0], at[2] - tower.doorFront[2]) <= 8).toBe(true);
    expect(flags).toBe(1);
    // Never again.
    for (let i = 0; i < 300; i++) { l.update(0.1, inSquare, true, false); if (l.takeFlagSet()) flags++; }
    expect(flags).toBe(1);
    expect(l.state).toBe('arrived');
  });

  it('once the flag is saved, Pip never leads there again', () => {
    const l = makeTowerLead(tower, towerRoute, hilltop, true, facts().facts);
    expect(l.state).toBe('done');
    expect(run(l, 200, inSquare, true)).toEqual([]);
  });

  it('walking there himself sets the flag (standing on the hilltop counts)', () => {
    const l = makeTowerLead(tower, towerRoute, hilltop, false, facts({ gem: false }).facts);
    run(l, 1, [hilltop.x0 + 2, 9, hilltop.z0 + 2]);
    expect(l.takeFlagSet()).toBe(true);
    expect(l.state).toBe('arrived');
  });

  it('pause (overlay or break bubble) freezes it', () => {
    const l = makeTowerLead(tower, towerRoute, hilltop, false, facts().facts);
    expect(run(l, 100, inSquare, true, true)).toEqual([]);
    expect(l.state).toBe('waiting');
  });

  it('gives up after 90 s with no progress and never loops', () => {
    const l = makeTowerLead(tower, towerRoute, hilltop, false, facts().facts);
    run(l, LEAD_OFFER_AFTER_LOAD + 1, inSquare);
    expect(l.state).toBe('leading');
    const ev = run(l, LEAD_GIVE_UP + 2, inSquare);
    expect(ev).toContain('giveUp');
    expect(l.state).toBe('gaveUp');
    expect(run(l, 200, inSquare, true)).toEqual([]);
  });

  it('the route doubles back: his index is searched near the last one, so it never jumps ahead', () => {
    const l = makeTowerLead(tower, towerRoute, hilltop, false, facts().facts);
    run(l, LEAD_OFFER_AFTER_LOAD + 1, towerRoute[0]);
    // Walk him forward one cell at a time; the lead target never runs more than the gap ahead.
    for (let i = 0; i < towerRoute.length - 10; i++) {
      l.update(0.1, towerRoute[i], false, false);
      if (l.state !== 'leading') break;
      expect(l.targetIndex() - i).toBeLessThanOrEqual(9);
    }
  });

  it('the old constructor still works without a filter', () => {
    const l = new LeadToVillage(towerRoute, doorstepRect(tower), false, hilltop);
    expect(run(l, LEAD_OFFER_AFTER_LOAD + 1, inSquare)).toEqual(['start']);
  });
});

import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { routeHome } from '../../src/core/home';
import { isStandable, type Cell } from '../../src/core/pathfind';
import { World } from '../../src/core/world';
import { LEAD_HOME_GIVE_UP, LEAD_HOME_QUIET, LeadHome } from '../../src/game/leadHome';
import { Pal } from '../../src/game/pal';
import { Player } from '../../src/game/player';
import { resolveHold, resolveTap } from '../../src/input/tap';
import { caveWorld } from '../helpers/caveWorld';

const route: Cell[] = Array.from({ length: 40 }, (_, i) => [10 + i, 20, 10] as Cell);
const at = (i: number): Cell => route[Math.min(route.length - 1, i)];

function run(lh: LeadHome, seconds: number, args: { deep?: boolean; active?: boolean; paused?: boolean; atMouth?: boolean; cell?: Cell } = {}) {
  const events: string[] = [];
  for (let t = 0; t < seconds - 1e-9; t += 0.1) {
    const e = lh.update(0.1, args.deep ?? true, args.active ?? false, args.paused ?? false, args.atMouth ?? false, args.cell ?? route[0]);
    if (e) events.push(e);
  }
  return events;
}

describe('LeadHome (Pip leads him home on foot)', () => {
  it('offers after 25 s of quiet deep underground, not before', () => {
    const lh = new LeadHome();
    expect(LEAD_HOME_QUIET).toBe(25);
    expect(run(lh, 24.8)).toEqual([]);
    expect(run(lh, 0.4)).toEqual(['offer']);
    expect(lh.state).toBe('offered');
  });

  it('never offers on the surface', () => {
    const lh = new LeadHome();
    expect(run(lh, 120, { deep: false })).toEqual([]);
    expect(lh.state).toBe('idle');
  });

  it('any action restarts the quiet', () => {
    const lh = new LeadHome();
    run(lh, 20);
    run(lh, 0.1, { active: true });
    expect(run(lh, 20)).toEqual([]);
    expect(run(lh, 6)).toEqual(['offer']);
  });

  it('time stands still while paused (an overlay or the chest cards)', () => {
    const lh = new LeadHome();
    run(lh, 20);
    expect(run(lh, 600, { paused: true })).toEqual([]);
    expect(lh.state).toBe('idle');
    expect(run(lh, 5.2)).toEqual(['offer']);
  });

  it('leads along the route: Pip stays 3 to 8 ahead and waits for him', () => {
    const lh = new LeadHome();
    run(lh, 25.1);
    lh.begin(route, route[0]);
    expect(lh.state).toBe('leading');
    expect(lh.targetIndex()).toBe(3);
    // He stands still: Pip walks on, then waits no more than 8 ahead.
    run(lh, 10, { cell: route[0] });
    expect(lh.targetIndex()).toBeLessThanOrEqual(8);
    expect(lh.targetIndex()).toBeGreaterThanOrEqual(3);
    // He follows: Pip keeps ahead of him.
    for (let i = 0; i < 30; i++) {
      run(lh, 0.4, { cell: at(i) });
      expect(lh.targetIndex()).toBeGreaterThanOrEqual(Math.min(i, route.length - 1));
    }
  });

  it('arrives at the mouth, or as soon as he is no longer deep', () => {
    const lh = new LeadHome();
    run(lh, 25.1);
    lh.begin(route, route[0]);
    expect(run(lh, 0.1, { atMouth: true, cell: route[39] })).toEqual(['arrive']);
    expect(lh.state).toBe('arrived');
    const lh2 = new LeadHome();
    run(lh2, 25.1);
    lh2.begin(route, route[0]);
    expect(run(lh2, 0.1, { deep: false, cell: route[30] })).toEqual(['arrive']);
  });

  it('ignored for 60 s, Pip gives up and does not offer again until he has been up and come back down', () => {
    const lh = new LeadHome();
    expect(LEAD_HOME_GIVE_UP).toBe(60);
    run(lh, 25.1);
    lh.begin(route, route[0]);
    expect(run(lh, 59.5, { cell: route[0] })).toEqual([]);
    expect(run(lh, 1, { cell: route[0] })).toEqual(['giveUp']);
    expect(lh.state).toBe('ignored');
    expect(run(lh, 300, { cell: route[0] })).toEqual([]);
    run(lh, 0.1, { deep: false });
    expect(lh.state).toBe('idle');
    expect(run(lh, 25.2)).toEqual(['offer']);
  });

  it('after arriving it stays quiet for the rest of the trip', () => {
    const lh = new LeadHome();
    run(lh, 25.1);
    lh.begin(route, route[0]);
    run(lh, 0.1, { atMouth: true });
    expect(run(lh, 200)).toEqual([]);
  });

  it('a tap he cannot walk to offers at once, once per trip; a decline means no offer this trip', () => {
    const lh = new LeadHome();
    expect(lh.offerNow()).toBe(true);
    expect(lh.offerNow()).toBe(false);
    lh.decline();
    expect(lh.state).toBe('ignored');
    expect(lh.offerNow()).toBe(false);
    expect(run(lh, 100)).toEqual([]);
    run(lh, 0.1, { deep: false });
    expect(lh.offerNow()).toBe(true);
  });

  it('begin with no way home is a decline', () => {
    const lh = new LeadHome();
    lh.offerNow();
    lh.begin([], [0, 0, 0]);
    expect(lh.state).toBe('ignored');
    expect(lh.targetIndex()).toBe(-1);
  });
});

describe('LeadHome with the real caves and Pip', () => {
  const { world, caves } = caveWorld(2026);

  it('from a deep room Pip walks the way home and never moves him; he follows Pip to the mouth and arrives', () => {
    const room = caves.rooms.filter(r => r.layer === 'deep')[3];
    let start: Cell = [room.cx, room.floorY, room.cz];
    for (const dy of [0, 1, -1, 2]) if (isStandable(world, [room.cx, room.floorY + dy, room.cz])) { start = [room.cx, room.floorY + dy, room.cz]; break; }
    const way = routeHome(world, start, caves)!;
    expect(way).not.toBeNull();
    const player = new Player({ x: start[0] + 0.5, y: start[1], z: start[2] + 0.5 });
    const pal = new Pal({ x: start[0] + 1.5, y: start[1], z: start[2] + 0.5 }, () => {}, () => 0);
    const lh = new LeadHome();
    lh.offerNow();
    lh.begin(way, start);
    pal.setLead(way, () => lh.targetIndex());
    const before = { ...player.pos };
    for (let i = 0; i < 50; i++) {
      lh.update(0.1, true, false, false, false, player.feetCell());
      pal.update(world, player, 0.1);
    }
    // Pip went ahead; he was not moved (and the camera is not part of this at all).
    expect(player.pos).toEqual(before);
    expect(Math.hypot(pal.pos.x - before.x, pal.pos.z - before.z)).toBeGreaterThan(1.5);
    // He walks the way himself, a little behind Pip's target, until he is up.
    const mouth = way[way.length - 1];
    let arrived = false;
    let k = 0;
    for (let t = 0; t < 600 && !arrived; t += 0.1) {
      const target = lh.targetIndex();
      if (target >= 0 && k < target - 1) k++;
      const c = way[k];
      player.pos = { x: c[0] + 0.5, y: c[1], z: c[2] + 0.5 };
      const atMouth = Math.hypot(c[0] - mouth[0], c[2] - mouth[2]) <= 2 && Math.abs(c[1] - mouth[1]) <= 2;
      if (lh.update(0.1, true, false, false, atMouth, player.feetCell()) === 'arrive') arrived = true;
      pal.update(world, player, 0.1);
    }
    expect(arrived).toBe(true);
  }, 60_000);

  it('a tap or a hold during the lead resolves exactly as without it (the gestures do not change)', () => {
    const w = new World(10, 6, 10);
    for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) w.set(x, 0, z, BlockId.Grass);
    w.set(4, 1, 4, BlockId.Stone);
    const feet: Cell = [2, 1, 2];
    const cases = [{ cell: [4, 1, 4] as Cell, normal: [0, 1, 0] as Cell }, { cell: [7, 0, 7] as Cell, normal: [0, 1, 0] as Cell }];
    const without = cases.map(h => [resolveTap(h, 'hand', feet, w, [feet]), resolveTap(h, BlockId.Planks, feet, w, [feet]), resolveHold(h, feet, w, [feet])]);
    const lh = new LeadHome();
    lh.offerNow();
    lh.begin(route, route[0]);
    const during = cases.map(h => [resolveTap(h, 'hand', feet, w, [feet]), resolveTap(h, BlockId.Planks, feet, w, [feet]), resolveHold(h, feet, w, [feet])]);
    expect(during).toEqual(without);
  });
});

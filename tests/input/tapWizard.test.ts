import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { Inventory } from '../../src/core/inventory';
import { ItemId } from '../../src/core/items';
import type { Cell } from '../../src/core/pathfind';
import { canPlace } from '../../src/core/placement';
import { World } from '../../src/core/world';
import { Game, type GameEvent } from '../../src/game/game';
import { PICK_RADIUS, pickEntity, pickEntityAlongRay, type EntityBox } from '../../src/input/entityPick';
import { WIZARD_KEEP_AWAY, WIZARD_REACH, besideWizard, resolveHold, resolveTap } from '../../src/input/tap';

function flatWorld(): World {
  const world = new World(16, 8, 16);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.set(x, 0, z, BlockId.Grass);
  world.markClean();
  return world;
}

const up: Cell = [0, 1, 0];
const feet: Cell = [2, 1, 2];
const wizardCell: Cell = [8, 1, 8];
const wizardCells: Cell[] = [wizardCell, [8, 2, 8]];
const occupied: Cell[] = [feet, [2, 2, 2], ...wizardCells];
const SELECTIONS = ['hand', BlockId.Planks, BlockId.StarlightCrystal, ItemId.WheatSeed, ItemId.Apple] as const;

describe('a quick tap on the wizard (spec §7g, §7a unchanged)', () => {
  it.each(SELECTIONS)('in reach talks, whatever is selected (%s)', sel => {
    const w = flatWorld();
    const hit = { cell: [8, 0, 8] as Cell, normal: up };
    expect(resolveTap(hit, sel, [6, 1, 8], w, occupied, { wizardHit: { dist: 2, cell: wizardCell } })).toEqual({ kind: 'talk' });
    expect(resolveTap(null, sel, [6, 1, 8], w, occupied, { wizardHit: { dist: WIZARD_REACH, cell: wizardCell } })).toEqual({ kind: 'talk' });
  });

  it('out of reach walks beside him, never closer than 1.5', () => {
    const w = flatWorld();
    const r = resolveTap({ cell: [8, 0, 8], normal: up }, 'hand', feet, w, occupied, { wizardHit: { dist: 8.5, cell: wizardCell } });
    expect(r.kind).toBe('walk');
    if (r.kind !== 'walk') return;
    expect(Math.hypot(r.to[0] - 8, r.to[2] - 8)).toBeGreaterThanOrEqual(WIZARD_KEEP_AWAY);
    expect(Math.hypot(r.to[0] - 8, r.to[2] - 8)).toBeLessThanOrEqual(2.01);
    expect(r.to[1]).toBe(1);
    // Ties go to the side nearer him.
    expect(Math.hypot(r.to[0] - 2, r.to[2] - 2)).toBeLessThan(Math.hypot(8 + 2 - 2, 8 - 2));
  });

  it('besideWizard skips cells he cannot stand on', () => {
    const w = flatWorld();
    w.set(6, 1, 8, BlockId.Stone); w.set(6, 2, 8, BlockId.Stone);
    w.set(8, 1, 6, BlockId.Stone); w.set(8, 2, 6, BlockId.Stone);
    const c = besideWizard(w, wizardCell, [2, 1, 8]);
    expect(c).not.toEqual([6, 1, 8]);
    expect(Math.hypot(c[0] - 8, c[2] - 8)).toBeGreaterThanOrEqual(WIZARD_KEEP_AWAY);
  });

  it('a talk never places a block, plants or feeds', () => {
    const w = flatWorld();
    for (const sel of SELECTIONS) {
      const r = resolveTap({ cell: [7, 0, 8], normal: up }, sel, [6, 1, 8], w, occupied, {
        wizardHit: { dist: 2, cell: wizardCell }, animalHit: { id: 3, dist: 1 },
      });
      expect(r).toEqual({ kind: 'talk' });
    }
  });

  it('hold on the wizard gives none and never digs the floor behind him', () => {
    const w = flatWorld();
    expect(resolveHold({ cell: [9, 0, 8], normal: up }, [7, 1, 8], w, occupied, true)).toEqual({ kind: 'none' });
  });

  it('hold on the block under his feet gives none', () => {
    const w = flatWorld();
    expect(resolveHold({ cell: [8, 0, 8], normal: up }, [7, 1, 8], w, occupied)).toEqual({ kind: 'none' });
  });

  it('placing into his cells is refused', () => {
    const w = flatWorld();
    for (const c of wizardCells) expect(canPlace(w, c, occupied, BlockId.Planks)).toBe(false);
    // A tap with a block on the floor in front of him would place into him: it walks instead.
    expect(resolveTap({ cell: [8, 0, 8], normal: up }, BlockId.Planks, [7, 1, 8], w, occupied).kind).not.toBe('place');
  });

  it('the unchanged rules: a hand tap elsewhere walks, a block tap in reach builds, a tap never digs', () => {
    const w = flatWorld();
    expect(resolveTap({ cell: [3, 0, 3], normal: up }, 'hand', feet, w, occupied)).toEqual({ kind: 'walk', to: [3, 1, 3] });
    expect(resolveTap({ cell: [3, 0, 3], normal: up }, BlockId.Planks, feet, w, occupied)).toEqual({ kind: 'place', cell: [3, 1, 3] });
    expect(resolveHold({ cell: [3, 0, 3], normal: up }, feet, w, occupied)).toEqual({ kind: 'dig', cell: [3, 0, 3] });
  });
});

describe('pickEntity and pickEntityAlongRay', () => {
  const e = (type: 'animal' | 'wizard', id: number, sx: number, sy: number, sz = 0.5) => ({ type, id, sx, sy, sz });
  it('nearest within its radius wins; the wizard has 72 px, animals 56', () => {
    expect(PICK_RADIUS).toEqual({ animal: 56, wizard: 72 });
    expect(pickEntity({ x: 0, y: 0 }, [e('wizard', -1, 70, 0)])).toEqual({ type: 'wizard', id: -1 });
    expect(pickEntity({ x: 0, y: 0 }, [e('animal', 1, 70, 0)])).toBeNull();
    expect(pickEntity({ x: 0, y: 0 }, [e('wizard', -1, 30, 0), e('animal', 2, 10, 0)])).toEqual({ type: 'animal', id: 2 });
    expect(pickEntity({ x: 0, y: 0 }, [])).toBeNull();
  });
  it('a tie goes to the one nearer the camera', () => {
    expect(pickEntity({ x: 0, y: 0 }, [e('wizard', -1, 10, 0, 0.9), e('animal', 4, 0, 10, 0.3)])).toEqual({ type: 'animal', id: 4 });
    expect(pickEntity({ x: 0, y: 0 }, [e('animal', 4, 0, 10, 0.9), e('wizard', -1, 10, 0, 0.3)])).toEqual({ type: 'wizard', id: -1 });
  });
  it('along the ray: the wizard behind an animal loses to the nearer one, and nobody behind a block is picked', () => {
    const boxes: EntityBox[] = [
      { type: 'wizard', id: -1, min: [9.6, 0, -0.4], max: [10.4, 2.5, 0.4] },
      { type: 'animal', id: 5, min: [4.6, 0, -0.4], max: [5.4, 1, 0.4] },
    ];
    const o = { x: 0, y: 0.5, z: 0 }, d = { x: 1, y: 0, z: 0 };
    expect(pickEntityAlongRay(o, d, boxes, null)).toEqual({ type: 'animal', id: 5 });
    expect(pickEntityAlongRay(o, d, [boxes[0]], null)).toEqual({ type: 'wizard', id: -1 });
    expect(pickEntityAlongRay(o, d, [boxes[0]], 7)).toBeNull();
  });
});

describe('Game: talk', () => {
  function setup() {
    const world = flatWorld();
    const game = new Game({ world, spawn: { x: 5.5, y: 1, z: 5.5 }, inventory: new Inventory() });
    const events: GameEvent[] = [];
    game.on(ev => events.push(ev));
    return { world, game, events };
  }
  it('a talk intent emits one talk event and costs nothing', () => {
    const { game, events } = setup();
    game.inventory.add(BlockId.Planks, 3);
    game.selected = BlockId.Planks;
    const edits = game.world.edits().length;
    game.applyIntent({ kind: 'talk' });
    expect(events.filter(x => x.type === 'talk')).toHaveLength(1);
    expect(game.inventory.count(BlockId.Planks)).toBe(3);
    expect(game.world.edits().length).toBe(edits);
    expect(game.selected).toBe(BlockId.Planks); // the selection is unchanged
  });
  it('a paused game ignores talk', () => {
    const { game, events } = setup();
    game.paused = true;
    game.applyIntent({ kind: 'talk' });
    expect(events.some(x => x.type === 'talk')).toBe(false);
  });
  it('the pad place button talks when the wizard is right in front, and places nothing', () => {
    const { game, events } = setup();
    game.inventory.add(BlockId.Planks, 3);
    game.selected = BlockId.Planks;
    game.wizardInFront = () => true;
    game.padAction('place');
    expect(events.filter(x => x.type === 'talk')).toHaveLength(1);
    expect(game.inventory.count(BlockId.Planks)).toBe(3);
  });
});

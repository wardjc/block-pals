import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { MAX_STACK } from '../../src/core/inventory';
import { ItemId, type StackId } from '../../src/core/items';
import { MYTHICAL, PRICE, isMythical } from '../../src/core/mythical';
import type { Cell } from '../../src/core/pathfind';
import { THINGS, levelFor, makePuzzle, type Puzzle } from '../../src/core/puzzles';
import { mulberry32 } from '../../src/core/rng';
import { applySave, readSave, serialise, storeSave, type SaveData, type SaveFlags } from '../../src/core/save';
import type { TowerInfo } from '../../src/core/tower';
import { generateWorld } from '../../src/core/worldgen';
import { Game } from '../../src/game/game';
import { PuzzleSession } from '../../src/game/puzzleSession';
import {
  buy, claimGift, newWizardState, puzzleReward, recordSolve, WIZARD_STOCK, type Bag, type WizardState, type WizardStock,
} from '../../src/game/wizardTrade';
import { WizardVisit } from '../../src/game/wizardVisit';
import { ATLAS_COLS, createAtlas, MYTHICAL_TILES, TILE_NAMES, tileFor } from '../../src/render/atlas';
import type { Face } from '../../src/render/mesher';
import { hsl, installFakeDocument, luma, shaded } from '../render/pixelCanvas';

/**
 * Task 20: the wizard can never make him fail, never lose him anything and never scare him.
 * Tests only, over the pure layers (puzzles, session, trades, save, visit) and the real generated
 * world; there is no wizard screen yet, so the stream below plays the screen's rules itself.
 */

vi.setConfig({ testTimeout: 120_000 });

const SEED = 2026;
const WEEK = 7 * 24 * 3600_000;
const FACES: Face[] = ['top', 'bottom', 'north', 'south', 'east', 'west'];

/**
 * The Gem item arrives with the grumps step (`ItemId.Gem = 123`, not in this build yet). Until then
 * a real item that the bag and the save already carry stands in for it, so gems go through every
 * reload exactly as the real ones will.
 */
const GEM = ItemId.Wool;
const STOCK: WizardStock = { ...WIZARD_STOCK, gem: GEM };

/** A localStorage stand-in (node environment). */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, String(v)); }
  removeItem(k: string): void { this.map.delete(k); }
  clear(): void { this.map.clear(); }
}

const bagOf = (game: Game): Bag => ({
  count: id => game.inventory.count(id as StackId),
  add: (id, n) => game.inventory.add(id as StackId, n),
  remove: (id, n) => game.inventory.remove(id as StackId, n),
});

const stacks = (game: Game): Map<number, number> => new Map(game.inventory.slots().map(id => [id as number, game.inventory.count(id)]));

/** Every mythical block standing in the tower and on its hill (where the stream places them). */
function mythicalInWorld(game: Game, tower: TowerInfo): number {
  let n = 0;
  const r = tower.greetRect;
  for (let x = r.x0 - 2; x <= r.x1 + 2; x++) {
    for (let z = r.z0 - 2; z <= r.z1 + 2; z++) {
      for (let y = 0; y < game.world.sizeY; y++) if (isMythical(game.world.get(x, y, z))) n++;
    }
  }
  return n;
}
const mythicalInBag = (game: Game): number => MYTHICAL.reduce((sum, id) => sum + game.inventory.count(id), 0);

/** The save minus what a reload is allowed to change (his spot may fall back to the spawn; the time). */
const comparable = (d: SaveData): Omit<SaveData, 'player' | 'savedAt'> => {
  const { player: _p, savedAt: _s, ...rest } = d;
  return rest;
};

/** If he kept playing (or just waited), would this puzzle finish? It always must. */
function wouldFinish(session: PuzzleSession): boolean {
  for (let t = 0; t < 60 && !session.solved; t++) session.update(1);
  return session.solved;
}

interface StreamResult { solved: number; helped: number; gifts: number; buys: number; reloads: number; topLevel: number }

function stream(seed: number, steps: number): StreamResult {
  const rand = mulberry32(seed);
  const puzzleRng = mulberry32(seed ^ 0x5eed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
  const storage = new MemoryStorage() as unknown as Storage;
  const flags: SaveFlags = { ledToVillage: true };
  let now = 1_800_000_000_000;
  let clock = 0;
  const visit = new WizardVisit(() => clock);

  const applied = generateWorld(SEED);
  let game = new Game(applied);
  const tower = applied.tower;
  let w: WizardState = newWizardState();
  game.inventory.add(BlockId.Planks, 30);
  game.inventory.add(ItemId.Apple, 5);
  game.inventory.add(GEM, 3);

  // The stacks no wizard action may ever touch (everything except his gems and the mythical blocks).
  const others = (): Map<number, number> => new Map([...stacks(game)].filter(([id]) => id !== GEM && !isMythical(id)));
  const othersAtStart = others();

  let expectedMythical = mythicalInWorld(game, tower) + mythicalInBag(game);
  let open = false;
  let tab: 'trade' | 'puzzle' = 'trade';
  let session = null as PuzzleSession | null;
  let last: Puzzle | undefined;
  let beforeLast: Puzzle | undefined;
  let stale: SaveData | null = null;
  const out: StreamResult = { solved: 0, helped: 0, gifts: 0, buys: 0, reloads: 0, topLevel: 0 };

  const floorCells = tower.floors.flatMap(f => f.cells);
  const stand = (c: Cell): void => {
    game.player.pos = { x: c[0] + 0.5, y: c[1], z: c[2] + 0.5 };
    game.player.setPath(null);
  };
  const newPuzzle = (): void => {
    const p = makePuzzle(levelFor(w.clean), puzzleRng, last, beforeLast);
    beforeLast = last;
    last = p;
    session = new PuzzleSession(p);
  };
  const drop = (): void => {
    // Closing or switching away drops the puzzle; nothing was at stake, and it could still have been finished.
    if (session && !session.solved) expect(wouldFinish(session)).toBe(true);
    session = null;
  };
  const settle = (): void => {
    if (!session?.solved) return;
    recordSolve(w, session);
    out.solved++;
    if (session.helped) out.helped++;
    if (puzzleReward(bagOf(game), STOCK)) expectedMythical++;
    newPuzzle(); // a new puzzle as soon as one is solved
  };
  const reload = (data: SaveData): void => {
    const next = applySave(data, now);
    game = new Game(next);
    w = next.wizard;
    open = false;
    session = null;
  };

  for (let step = 0; step < steps; step++) {
    const before = stacks(game);
    const wBefore = { ...w, hints: [...w.hints] };
    const levelBefore = levelFor(w.clean);
    let placed: number | null = null;
    let bought: { kind: number; spent: number } | null = null;
    let gemsAdded = 0;
    const r = rand();

    if (r < 0.06) {
      // Walk anywhere around the tower and its hill.
      const target = rand() < 0.5 ? pick(floorCells) : [tower.doorFront[0] + Math.floor(rand() * 9) - 4, tower.groundY + 1, tower.doorFront[2] - Math.floor(rand() * 6)] as Cell;
      game.applyIntent({ kind: 'walk', to: target });
      for (let i = 0; i < 5; i++) game.update(0.2);
    } else if (r < 0.1) {
      // Talk to the wizard: the screen opens on trade (on puzzle when he has had his gift and has no gem).
      if (!open) {
        open = true;
        tab = w.gift && (game.inventory.count(GEM) === 0 || rand() < 0.75) ? 'puzzle' : 'trade';
        if (tab === 'puzzle') newPuzzle();
      }
      if (rand() < 0.3 && !w.met) w.met = true;
    } else if (r < 0.15) {
      if (open) {
        if (tab === 'trade') { tab = 'puzzle'; newPuzzle(); } else { drop(); tab = 'trade'; }
      }
    } else if (r < 0.22) {
      // A grump or a cave gave some gems.
      gemsAdded = game.inventory.add(GEM, Math.floor(rand() * 4));
    } else if (r < 0.32) {
      if (open && tab === 'trade') {
        const kind = rand() < 0.9 ? pick(MYTHICAL) : pick([BlockId.Stone, BlockId.Lamp, 999, -1, 40.5]);
        if (!w.gift) {
          const res = claimGift(bagOf(game), kind, w, STOCK);
          if (res.ok) { out.gifts++; expectedMythical += 1; }
        } else {
          const res = buy(bagOf(game), kind, w, STOCK);
          expect(claimGift(bagOf(game), kind, w, STOCK).ok).toBe(false); // the gift is once only
          if (res.ok) {
            expect(res.got).toBe(STOCK.bundle);
            bought = { kind, spent: res.spent };
            out.buys++;
            expectedMythical += res.got;
          }
        }
      }
    } else if (r < 0.45) {
      const s = session;
      if (s && s.puzzle.kind !== 'count') {
        if (rand() < 0.3) {
          // Spam one wrong card.
          const wrong = (s.puzzle.answer + 1) % s.puzzle.options.length;
          const times = 1 + Math.floor(rand() * 12);
          for (let i = 0; i < times; i++) s.pick(wrong);
        } else {
          s.pick(Math.floor(rand() * (s.puzzle.options.length + 1)) - (rand() < 0.05 ? 3 : 0));
        }
      } else if (s) {
        const thing = pick(THINGS);
        if (rand() < 0.65) s.add(thing); else s.take(thing);
      }
      settle();
    } else if (r < 0.55) {
      // Wait: no time at all, a moment, or a whole minute (the puzzle carries on in steps like frames).
      const wait = pick([0, 0.2, 1, 5, 13, 30, 60]);
      for (let t = 0; t < wait; t += 0.5) session?.update(Math.min(0.5, wait - t));
      clock += wait * 1000;
      settle();
    } else if (r < 0.57) {
      // Close the screen, maybe mid-puzzle.
      drop();
      open = false;
    } else if (r < 0.7) {
      // Place a mythical block in the tower.
      const held = MYTHICAL.filter(id => game.inventory.count(id) > 0);
      if (held.length > 0) {
        const floor = pick(tower.floors);
        const from = pick(floor.cells.filter(c => game.world.get(...c) === BlockId.Air));
        const to = pick(floor.cells);
        if (from && to && (from[0] !== to[0] || from[2] !== to[2])) {
          stand(from);
          const kind = pick(held);
          game.selected = kind;
          const n = game.inventory.count(kind);
          game.applyIntent({ kind: 'place', cell: to });
          if (game.inventory.count(kind) !== n) placed = kind;
        }
      }
    } else if (r < 0.8) {
      // Dig a mythical block in the tower.
      const blocks = tower.floors.flatMap(f => f.cells.flatMap(c => [c, [c[0], c[1] + 1, c[2]] as Cell]))
        .filter(c => isMythical(game.world.get(...c)));
      if (blocks.length > 0) {
        const target = pick(blocks);
        const floor = tower.floors.find(f => f.y === target[1] || f.y === target[1] - 1)!;
        const from = pick(floor.cells.filter(c => game.world.get(...c) === BlockId.Air && game.world.get(c[0], c[1] + 1, c[2]) === BlockId.Air));
        if (from) {
          stand(from);
          game.applyIntent({ kind: 'dig', cell: target });
        }
      }
    } else if (r < 0.84) {
      // The clock jumps backwards, or forwards by a week.
      now += pick([-1000, -60_000, -WEEK, WEEK, 3_600_000]);
      clock += pick([-60_000, -1, 0, 120_000, WEEK]);
    } else if (r < 0.87) {
      // Pip's tower-light line and the lead set the other wizard fields.
      if (!w.hints.includes('seeLight')) w.hints.push('seeLight');
      w.led = true;
    } else if (r < 0.9) {
      // Save and reload at any point: the gift flag, the level counters and every mythical block are kept.
      const data = serialise(game, SEED, flags, now, undefined, w);
      expect(storeSave(storage, data)).toBe(true);
      const read = readSave(storage)!;
      expect(read.wizard ?? {}).toEqual(JSON.parse(JSON.stringify(data.wizard ?? {})));
      drop();
      reload(read);
      expect(w).toEqual(wBefore);
      expect(comparable(serialise(game, SEED, flags, now, undefined, w))).toEqual(comparable(data));
      if (stale === null || rand() < 0.3) stale = data;
      out.reloads++;
    } else if (r < 0.92 && stale) {
      // A stale tab writes an older save over his: the level and the flags never go back.
      expect(storeSave(storage, serialise(game, SEED, flags, now, undefined, w))).toBe(true);
      expect(storeSave(storage, stale)).toBe(true);
      const back = applySave(readSave(storage)!, now).wizard;
      expect(back).toEqual(w);
      expect(levelFor(back.clean)).toBe(levelFor(w.clean));
      // The live tab saves again straight after.
      expect(storeSave(storage, serialise(game, SEED, flags, now, undefined, w))).toBe(true);
    } else {
      // The hello, with a clock that may run backwards: never throws, only near the tower.
      const hello = visit.update(game.player.feetCell(), tower, rand() < 0.3);
      if (hello) {
        const [x, , z] = game.player.feetCell();
        const g = tower.greetRect;
        expect(x >= g.x0 && x <= g.x1 && z >= g.z0 && z <= g.z1).toBe(true);
      }
    }

    // ---- nothing is ever lost ----
    const after = stacks(game);
    for (const [id, n] of after) {
      expect(n, `stack ${id}`).toBeGreaterThanOrEqual(0);
      expect(n, `stack ${id}`).toBeLessThanOrEqual(MAX_STACK);
    }
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const was = before.get(id) ?? 0;
      const now_ = after.get(id) ?? 0;
      if (now_ >= was) continue;
      if (id === placed) expect(was - now_, `placed ${id}`).toBe(1);
      else if (id === GEM && bought) {
        expect(was + gemsAdded - now_).toBe(bought.spent);
        expect(bought.spent).toBe(PRICE[bought.kind as keyof typeof PRICE]);
        expect((after.get(bought.kind) ?? 0) - (before.get(bought.kind) ?? 0)).toBe(4);
      } else throw new Error(`step ${step}: stack ${id} dropped from ${was} to ${now_}`);
    }
    expect(others()).toEqual(othersAtStart);
    expect(mythicalInWorld(game, tower) + mythicalInBag(game), `step ${step} blocks`).toBe(expectedMythical);
    expect(out.gifts).toBeLessThanOrEqual(1);

    // ---- the level never goes down, and nothing the wizard saved is ever undone ----
    expect(w.clean).toBeGreaterThanOrEqual(wBefore.clean);
    expect(w.solved).toBeGreaterThanOrEqual(wBefore.solved);
    expect(w.bought).toBeGreaterThanOrEqual(wBefore.bought);
    expect(w.clean).toBeLessThanOrEqual(w.solved);
    for (const f of ['gift', 'met', 'led'] as const) if (wBefore[f]) expect(w[f]).toBe(true);
    expect(levelFor(w.clean)).toBeGreaterThanOrEqual(levelBefore);
    out.topLevel = Math.max(out.topLevel, levelFor(w.clean));
  }

  // ---- he can never fail: whatever is open at the end still finishes if he keeps playing ----
  if (session) expect(wouldFinish(session)).toBe(true);
  return out;
}

describe('the wizard never fails him and never loses him anything', () => {
  test.each([1, 2, 3])('a random stream of 2,000 actions (seed %i)', seed => {
    const r = stream(seed, 2000);
    // The stream really exercised the rules.
    expect(r.solved).toBeGreaterThanOrEqual(10);
    expect(r.topLevel).toBeGreaterThanOrEqual(1);
    expect(r.helped).toBeGreaterThan(0);
    expect(r.gifts).toBe(1);
    expect(r.buys).toBeGreaterThan(5);
    expect(r.reloads).toBeGreaterThan(20);
  });

  test('a patient waiter and a random clicker finish every puzzle at every level', () => {
    const rand = mulberry32(77);
    for (let level = 0; level <= 9; level++) {
      let last: Puzzle | undefined;
      for (let i = 0; i < 100; i++) {
        const p = makePuzzle(level, rand, last);
        last = p;
        const waiter = new PuzzleSession(p);
        expect(wouldFinish(waiter)).toBe(true);
        const clicker = new PuzzleSession(p);
        for (let a = 0; a < 200 && !clicker.solved; a++) {
          if (p.kind === 'count') { if (rand() < 0.6) clicker.add(THINGS[Math.floor(rand() * 5)]!); else clicker.take(THINGS[Math.floor(rand() * 5)]!); } else clicker.pick(Math.floor(rand() * p.options.length));
          clicker.update(rand() * 2);
        }
        expect(clicker.solved || wouldFinish(clicker)).toBe(true);
      }
    }
  });

  test('the level comes only from clean solves and never goes down, whatever the counter holds', () => {
    let prev = 0;
    for (let clean = 0; clean <= 40; clean++) {
      expect(levelFor(clean)).toBeGreaterThanOrEqual(prev);
      prev = levelFor(clean);
    }
    expect(levelFor(1e9)).toBe(9);
  });
});

describe('nothing in the wizard code can scare him', () => {
  const ROOT = resolve(__dirname, '../..');
  const NEW_FILES = [
    'src/core/mythical.ts', 'src/core/puzzles.ts', 'src/core/tower.ts', 'src/game/puzzleSession.ts',
    'src/game/wizardTrade.ts', 'src/game/wizardVisit.ts', 'src/render/mythicalTiles.ts',
  ];
  const SCARY = /\b(scary|monster|dark|night|blood|kill|die|dead|hurt|fight|enemy|attack|explode|scream|growl|chase)\b/i;
  /** Comments may say what the art is NOT ("never dark"); only the code and its strings are scanned. */
  const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test.each(NEW_FILES)('%s has no scary word in its code or strings', file => {
    const text = code(readFileSync(resolve(ROOT, file), 'utf8'));
    const hit = text.split('\n').find(line => SCARY.test(line));
    expect(hit, file).toBeUndefined();
  });

  test('no timer, lives, score or fail state in the puzzle code', () => {
    for (const file of ['src/core/puzzles.ts', 'src/game/puzzleSession.ts']) {
      expect(code(readFileSync(resolve(ROOT, file), 'utf8'))).not.toMatch(/fail|lose|lost|lives|score|gameover|timeout|penalt/i);
    }
  });
});

describe('never dark: the tower and every tile in it', () => {
  let fake: ReturnType<typeof installFakeDocument>;
  let sheet: ReturnType<typeof installFakeDocument>['canvases'][number];
  beforeAll(() => {
    fake = installFakeDocument();
    createAtlas();
    sheet = fake.canvases[0]!;
  });
  afterAll(() => fake.restore());

  const tile = (name: string) => {
    const i = TILE_NAMES.indexOf(name as never);
    return sheet.ctx!.cell(i % ATLAS_COLS, Math.floor(i / ATLAS_COLS));
  };

  const { world, tower } = generateWorld(SEED);
  const towerBlocks = (): Set<BlockId> => {
    const ids = new Set<BlockId>();
    const r = tower.rect;
    for (let x = r.x0; x <= r.x1; x++) for (let z = r.z0; z <= r.z1; z++) for (let y = tower.groundY; y < world.sizeY; y++) ids.add(world.get(x, y, z));
    ids.delete(BlockId.Air);
    return ids;
  };

  test('no tile used by the tower or by a mythical block has a near-black pixel', () => {
    const names = new Set<string>(MYTHICAL_TILES);
    for (const id of towerBlocks()) for (const face of FACES) names.add(tileFor(id, face));
    expect(names.size).toBeGreaterThan(8);
    for (const name of names) {
      for (const p of tile(name)) {
        if (p[3] < 0.5) continue; // see-through glass shows the bright world behind it
        expect(hsl(p).l, `${name} ${p}`).toBeGreaterThanOrEqual(0.1);
        expect(luma(p), `${name} ${p}`).toBeGreaterThanOrEqual(0.08);
      }
    }
  });

  test('both rooms have lamps above them, the very top block is a lamp, and the lamp tile stays bright in shade', () => {
    expect(world.get(...tower.topLamp)).toBe(BlockId.Lamp);
    for (const c of tower.lampCells) expect(world.get(...c)).toBe(BlockId.Lamp);
    for (const floor of tower.floors) {
      const above = tower.lampCells.filter(([x, y, z]) => y === floor.ceilingY && floor.cells.some(c => c[0] === x && c[2] === z));
      expect(above.length, `floor ${floor.y}`).toBeGreaterThanOrEqual(2);
    }
    const ls = tile('lamp').map(p => luma(shaded(p, 0.5)));
    expect(ls.reduce((a, b) => a + b, 0) / ls.length).toBeGreaterThanOrEqual(0.5);
  });

  test('the windows are glass and the mythical lights are marked as lights', () => {
    expect(tower.windowCells.length).toBeGreaterThan(0);
    for (const c of tower.windowCells) expect(world.get(...c)).toBe(BlockId.Glass);
    expect(MYTHICAL.filter(id => BLOCKS[id].light)).toEqual([BlockId.StarlightCrystal, BlockId.MoonBlock, BlockId.SunBlock]);
  });
});

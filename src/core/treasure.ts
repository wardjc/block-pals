import { BlockId } from './blocks';
import { caveStream, clash, EDGE_KEEP, TUNNEL, type CaveField, type CaveLayout, type Reserved, type Room } from './caves';
import { MAX_STACK, type Inventory } from './inventory';
import { ItemId, type StackId } from './items';
import type { Cell } from './pathfind';
import type { Rect } from './village';
import type { World } from './world';

/**
 * The three hidden treasure rooms and the chests (spec 7h, plan Task 16). Pure and seeded.
 * Each room is 7 x 7 inside and 5 high, off a main cave room by a short lit side tunnel (3 wide,
 * 5 high) through a DoorFrame archway with a Lamp each side: found by the glow, never behind a
 * wall. A Planks table under the chest and two glowing blocks inside.
 *
 * Chests open by a tap: the whole reward goes into the bag or nothing does (a bag that cannot take
 * it all leaves the chest closed, so nothing is ever lost and he can come back). Opening turns
 * the block into ChestOpen, an ordinary world edit, so it is saved and can never pay twice.
 */

export interface RewardEntry { id: StackId; n: number }

/**
 * What each chest holds (a fixed table, so every save agrees). No mythical block (those stay the
 * wizard's); the deepest chest, the Old Hideout's, holds the cave-only Ruin crystal, the most gems
 * and the most seeds, plus planks and bricks to fix the hideout up.
 */
export const CHEST_REWARDS: Readonly<Record<'T0' | 'T1' | 'T2' | 'R', readonly RewardEntry[]>> = Object.freeze({
  // The seed nook (shallow).
  T0: Object.freeze([
    { id: ItemId.WheatSeed, n: 3 }, { id: ItemId.CarrotSeed, n: 3 }, { id: ItemId.PotatoSeed, n: 3 }, { id: ItemId.AppleSapling, n: 1 },
  ]),
  // The gem gallery (shallow).
  T1: Object.freeze([{ id: ItemId.Gem, n: 3 }, { id: BlockId.Lamp, n: 4 }]),
  // The crystal vault (deep).
  T2: Object.freeze([
    { id: ItemId.Gem, n: 4 }, { id: BlockId.CrystalBlue, n: 4 }, { id: BlockId.CrystalPink, n: 4 }, { id: BlockId.CrystalGreen, n: 4 },
  ]),
  // The Old Hideout's chest, the deepest of all.
  R: Object.freeze([
    { id: BlockId.RuinCrystal, n: 6 }, { id: ItemId.Gem, n: 10 },
    { id: ItemId.WheatSeed, n: 5 }, { id: ItemId.CarrotSeed, n: 5 }, { id: ItemId.PotatoSeed, n: 5 }, { id: ItemId.AppleSapling, n: 2 },
    { id: BlockId.Planks, n: 10 }, { id: BlockId.Bricks, n: 10 },
  ]),
}) as Readonly<Record<'T0' | 'T1' | 'T2' | 'R', readonly RewardEntry[]>>;

/** A chest the table does not know (one he could never have found) is never empty. */
export const STRAY_REWARD: readonly RewardEntry[] = Object.freeze([{ id: ItemId.Gem, n: 2 }]);

export const TREASURE_ROOM = { size: 7, height: 5, tunnelWidth: 3, tunnelMin: 4, tunnelMax: 12 } as const;

export interface TreasureRoom {
  id: 'T0' | 'T1' | 'T2';
  layer: 'shallow' | 'deep';
  /** The 7 x 7 interior (world columns). */
  rect: Rect;
  /** Feet y of the floor. */
  floorY: number;
  chest: Cell;
  /** The archway's middle cell (feet). */
  entrance: Cell;
  reward: readonly RewardEntry[];
  /** The main room it hangs off. */
  host: number;
  /** Unit step from the host room towards the treasure room. */
  dir: [number, number];
  /** Every block the stamp placed (table, chest, glow blocks, archway, lamps). */
  furnishings: Cell[];
  /** The side tunnel's first cell inside the host room and its length (for the stamp). */
  start: number;
  tunnel: number;
}

const TREASURE_IDS: ReadonlyArray<{ id: TreasureRoom['id']; layer: 'shallow' | 'deep' }> = [
  { id: 'T0', layer: 'shallow' }, { id: 'T1', layer: 'shallow' }, { id: 'T2', layer: 'deep' },
];

/** World column at `a` cells along `dir` from the host's centre and `l` cells to its left. */
const at = (h: Room, dir: [number, number], a: number, l: number): [number, number] =>
  [h.cx + dir[0] * a - dir[1] * l, h.cz + dir[1] * a + dir[0] * l];

/**
 * Chooses the three rooms: T0 and T1 off shallow rooms, T2 off a deep one, each off a different
 * main room, at least 20 from every mouth and from each other, the whole room and side tunnel in
 * untouched rock (2 cells clear of every other cave all round), clear of the reserved ramps and
 * stairs, inside the world's margins. Adds their air to the layer fields.
 */
export function placeTreasureRooms(
  seed: number, rooms: readonly Room[], fields: { shallow: CaveField; deep: CaveField }, reserved: Reserved,
  mouths: ReadonlyArray<{ cell: Cell }>, thin: Uint8Array,
): TreasureRoom[] {
  const rng = caveStream(seed, 6);
  const out: TreasureRoom[] = [];
  const used = new Set<number>();
  const S = TREASURE_ROOM.size;
  for (const spec of TREASURE_IDS) {
    const field = spec.layer === 'shallow' ? fields.shallow : fields.deep;
    const hosts = rooms.filter(r => r.layer === spec.layer && !used.has(r.id));
    // A seeded shuffle of hosts and directions.
    const order = hosts.map(h => ({ h, k: rng() })).sort((a, b) => a.k - b.k).map(o => o.h);
    let placed: TreasureRoom | null = null;
    for (const h of order) {
      if (placed) break;
      const dirs: Array<[number, number]> = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>)
        .map(d => ({ d, k: rng() })).sort((a, b) => a.k - b.k).map(o => o.d);
      for (const dir of dirs) {
        if (placed) break;
        const e = dir[0] !== 0 ? h.rx : h.rz;
        for (let L = TREASURE_ROOM.tunnelMin; L <= TREASURE_ROOM.tunnelMax && !placed; L++) {
          const wall = e + L; // the archway's wall plane
          const far = wall + S; // the back row inside
          const cA = wall + 4; // the room's middle row
          const [mx, mz] = at(h, dir, cA, 0);
          if (mouths.some(m => Math.hypot(m.cell[0] - mx, m.cell[2] - mz) < 20)) continue;
          if (out.some(t => Math.hypot((t.rect.x0 + t.rect.x1) / 2 - mx, (t.rect.z0 + t.rect.z1) / 2 - mz) < 20)) continue;
          // Everything from 2 past the host's edge to 2 past the back wall, 2 cells either side, is untouched rock.
          let ok = true;
          for (let a = e + 2; a <= far + 3 && ok; a++) {
            const half = a <= wall ? 4 : 6;
            for (let l = -half; l <= half && ok; l++) {
              const [x, z] = at(h, dir, a, l);
              if (x < EDGE_KEEP || z < EDGE_KEEP || x >= field.sizeX - EDGE_KEEP || z >= field.sizeZ - EDGE_KEEP) { ok = false; break; }
              if (field.has(x, z)) ok = false;
              if (spec.layer === 'shallow' && thin[x + field.sizeX * z]) ok = false;
              for (const s of reserved.near(x + 0.5, z + 0.5, 2)) {
                if (clash(h.floorY, h.floorY + TUNNEL.height - 1, s.y0, s.y1)) ok = false;
              }
            }
          }
          if (!ok) continue;
          const f = h.floorY;
          // Side tunnel (from 1 inside the host) and the opening, 3 wide; the room, 7 x 7.
          for (let a = e - 1; a <= wall; a++) for (let l = -1; l <= 1; l++) {
            const [x, z] = at(h, dir, a, l);
            field.add(x, z, f, f + TUNNEL.height - 1);
          }
          for (let a = wall + 1; a <= far; a++) for (let l = -3; l <= 3; l++) {
            const [x, z] = at(h, dir, a, l);
            field.add(x, z, f, f + TREASURE_ROOM.height - 1);
          }
          const c1 = at(h, dir, wall + 1, -3), c2 = at(h, dir, far, 3);
          const rect: Rect = { x0: Math.min(c1[0], c2[0]), z0: Math.min(c1[1], c2[1]), x1: Math.max(c1[0], c2[0]), z1: Math.max(c1[1], c2[1]) };
          const [chx, chz] = at(h, dir, far, 0);
          const [ex, ez] = at(h, dir, wall, 0);
          placed = {
            id: spec.id, layer: spec.layer, rect, floorY: f, chest: [chx, f + 1, chz], entrance: [ex, f, ez],
            reward: CHEST_REWARDS[spec.id], host: h.id, dir, furnishings: [], start: e - 1, tunnel: L,
          };
        }
      }
    }
    if (placed) { out.push(placed); used.add(placed.host); }
  }
  return out;
}

/**
 * Furnishes a carved treasure room: a DoorFrame archway (two jambs and a lintel), a Lamp in the
 * tunnel wall either side of it, a Planks table under the chest against the back wall, and two
 * glowing blocks in the back corners (mushrooms in the shallow layer, crystals in the deep one).
 */
export function stampTreasure(world: World, rooms: readonly Room[], t: TreasureRoom): void {
  const h = rooms[t.host];
  const f = t.floorY;
  const wall = (t.dir[0] !== 0 ? h.rx : h.rz) + t.tunnel;
  const far = wall + TREASURE_ROOM.size;
  const put = (a: number, l: number, y: number, id: BlockId): void => {
    const [x, z] = at(h, t.dir, a, l);
    world.set(x, y, z, id);
    t.furnishings.push([x, y, z]);
  };
  for (const l of [-2, 2]) for (let y = f; y <= f + 3; y++) put(wall, l, y, BlockId.DoorFrame);
  for (let l = -2; l <= 2; l++) put(wall, l, f + 4, BlockId.DoorFrame);
  for (const l of [-2, 2]) put(wall - 1, l, f + 2, BlockId.Lamp);
  put(far, 0, f, BlockId.Planks);
  put(far, 0, f + 1, BlockId.Chest);
  const glow = t.layer === 'shallow' ? [BlockId.GlowMushroom, BlockId.GlowMushroom] : [BlockId.CrystalBlue, BlockId.CrystalPink];
  put(far, -3, f, glow[0]);
  put(far, 3, f, glow[1]);
}

/** What a chest cell pays: its treasure room's or the Old Hideout's reward, else the stray reward. */
export function chestReward(layout: Pick<CaveLayout, 'treasure' | 'ruin'>, chest: Cell): readonly RewardEntry[] {
  const same = (c: Cell): boolean => c[0] === chest[0] && c[1] === chest[1] && c[2] === chest[2];
  const t = layout.treasure.find(r => same(r.chest));
  if (t) return t.reward;
  if (layout.ruin && same(layout.ruin.chest)) return CHEST_REWARDS.R;
  return STRAY_REWARD;
}

/** Every entry fits under 99 (all or nothing). */
export function canOpen(inv: Pick<Inventory, 'count'>, reward: readonly RewardEntry[]): boolean {
  return reward.every(e => inv.count(e.id) + e.n <= MAX_STACK);
}

/**
 * Opens a closed chest: if the cell holds a closed Chest and the whole reward fits, every entry
 * goes into the bag and the cell becomes ChestOpen (one ordinary edit). Otherwise nothing changes.
 */
export function openChest(world: World, inv: Inventory, layout: Pick<CaveLayout, 'treasure' | 'ruin'>, chest: Cell): { ok: boolean; reward: readonly RewardEntry[] } {
  const reward = chestReward(layout, chest);
  if (world.get(chest[0], chest[1], chest[2]) !== BlockId.Chest || !canOpen(inv, reward)) return { ok: false, reward };
  for (const e of reward) inv.add(e.id, e.n);
  world.set(chest[0], chest[1], chest[2], BlockId.ChestOpen);
  return { ok: true, reward };
}


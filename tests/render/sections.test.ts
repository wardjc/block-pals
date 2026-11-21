import { describe, expect, it } from 'vitest';
import { BLOCKS, BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import {
  buildChunkGeometry, buildSectionGeometry, CHUNK_SIZE, SECTION_HEIGHT, sectionsPerColumn, type Face, type MeshArrays, type UvFor,
} from '../../src/render/mesher';
import { decodeRle, loadWorldFixture } from '../helpers/fixtures';

/** A uvFor that tells faces and ids apart, so quads compare by texture too. */
const uvFor: UvFor = (id: BlockId, face: Face) => {
  const f = ['top', 'bottom', 'north', 'south', 'east', 'west'].indexOf(face);
  return [id / 256, f / 8, id / 256 + 0.001, f / 8 + 0.001];
};

/** The step 2 chunk mesher, verbatim (world.get for every neighbour, faces on the outside walls). */
const FACES: Array<{ face: Face; normal: [number, number, number]; corners: [number, number, number][] }> = [
  { face: 'top', normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { face: 'bottom', normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { face: 'south', normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { face: 'north', normal: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { face: 'east', normal: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { face: 'west', normal: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
];
function oldQuads(world: World, cx: number, cz: number): { solid: string[]; trans: string[] } {
  const solid: string[] = [];
  const trans: string[] = [];
  const x0 = cx * 16, z0 = cz * 16;
  for (let y = 0; y < world.sizeY; y++) for (let z = z0; z < Math.min(z0 + 16, world.sizeZ); z++) for (let x = x0; x < Math.min(x0 + 16, world.sizeX); x++) {
    const id = world.get(x, y, z);
    if (id === BlockId.Air) continue;
    if (BLOCKS[id].shape === 'cross') { trans.push(`cross ${x},${y},${z} ${uvFor(id, 'south').join(',')}`); continue; }
    const out = BLOCKS[id].transparent ? trans : solid;
    for (const def of FACES) {
      const nid = world.get(x + def.normal[0], y + def.normal[1], z + def.normal[2]);
      if (nid === BlockId.Air || (BLOCKS[nid].transparent && nid !== id)) {
        out.push(`${def.face} ${x},${y},${z} ${uvFor(id, def.face).join(',')}`);
      }
    }
  }
  return { solid, trans };
}

/** Reads quads back out of mesh arrays: one key per quad (its face, its cell and its uv). */
function quadsOf(a: MeshArrays): string[] {
  const out: string[] = [];
  const verts = a.positions.length / 3;
  for (let q = 0; q * 4 < verts; q++) {
    const v = q * 4;
    const p = (k: number) => [a.positions[(v + k) * 3], a.positions[(v + k) * 3 + 1], a.positions[(v + k) * 3 + 2]];
    const nrm = [a.normals[v * 3], a.normals[v * 3 + 1], a.normals[v * 3 + 2]];
    const uv = [a.uvs[v * 2], a.uvs[v * 2 + 1], a.uvs[(v + 2) * 2], a.uvs[(v + 2) * 2 + 1]].map(n => Math.fround(n));
    const all = [0, 1, 2, 3].map(p);
    const def = FACES.find(f => f.normal.every((n, i) => n === nrm[i]))!;
    const face = def.face;
    const flat = all.every(c => c[1] === all[0][1]) || all.every(c => c[0] === all[0][0]) || all.every(c => c[2] === all[0][2]);
    // The block's cell: a face on the +x, +y or +z side sits one block past the cell's corner.
    const cell = [0, 1, 2].map(i => Math.min(...all.map(c => c[i])) - (flat && def.normal[i] === 1 ? 1 : 0));
    out.push(`${face} ${cell.join(',')} ${uv.join(',')} ${flat ? '' : 'x'}`);
  }
  return out;
}
const asUv = (s: string): string => {
  // Old keys carry float64 uvs; mesh arrays are float32.
  const [face, cell, uv] = s.split(' ');
  return `${face} ${cell} ${uv.split(',').map(n => Math.fround(Number(n))).join(',')}`;
};

describe('mesh sections', () => {
  it('a 68-high world has 5 sections per column; SECTION_HEIGHT is 16', () => {
    expect(SECTION_HEIGHT).toBe(16);
    expect(sectionsPerColumn(68)).toBe(5);
    expect(sectionsPerColumn(20)).toBe(2);
    expect(sectionsPerColumn(16)).toBe(1);
  });

  it('the union of the section meshes of a column equals the old chunk mesh on the step 2 fixture world, apart from outside-wall faces', () => {
    const fx = loadWorldFixture(2);
    const world = World.fromBuffer(fx.sizeX, fx.sizeY, fx.sizeZ, decodeRle(fx.rle));
    const outsideWall = (key: string): boolean => {
      const [face, cell] = key.split(' ');
      const [x, , z] = cell.split(',').map(Number);
      return (face === 'west' && x === 0) || (face === 'east' && x === world.sizeX - 1)
        || (face === 'north' && z === 0) || (face === 'south' && z === world.sizeZ - 1);
    };
    let dropped = 0;
    for (let cz = 0; cz < 6; cz++) for (let cx = 0; cx < 6; cx++) {
      const want = oldQuads(world, cx, cz);
      const solid: string[] = [];
      const trans: string[] = [];
      for (let sy = 0; sy < sectionsPerColumn(world.sizeY); sy++) {
        const g = buildSectionGeometry(world, cx, sy, cz, uvFor);
        solid.push(...quadsOf(g));
        trans.push(...quadsOf(g.transparent));
      }
      const wantSolid = want.solid.filter(k => !outsideWall(k));
      dropped += want.solid.length - wantSolid.length;
      expect(solid.map(s => s.trim()).sort(), `chunk ${cx},${cz}`).toEqual(wantSolid.map(asUv).sort());
      // Transparent cube faces compare exactly; a cross plant is 4 quads at its cell.
      const cubeTrans = want.trans.filter(k => !k.startsWith('cross') && !outsideWall(k)).map(asUv).sort();
      expect(trans.filter(k => !k.endsWith('x')).map(s => s.trim()).sort()).toEqual(cubeTrans);
      const wantCross = want.trans.filter(k => k.startsWith('cross')).flatMap(k => Array(4).fill(k.split(' ')[1])).sort();
      expect(trans.filter(k => k.endsWith('x')).map(k => k.split(' ')[1]).sort()).toEqual(wantCross);
    }
    expect(dropped).toBeGreaterThan(0); // the old mesher did draw the outside walls
  });

  it('a section on the world edge emits no outside-wall faces; one cell inside the edge does', () => {
    const w = new World(32, 16, 32);
    w.set(0, 5, 10, BlockId.Stone);
    w.set(31, 5, 10, BlockId.Stone);
    w.set(10, 5, 0, BlockId.Stone);
    w.set(10, 5, 31, BlockId.Stone);
    const edge = [buildSectionGeometry(w, 0, 0, 0, uvFor), buildSectionGeometry(w, 1, 0, 0, uvFor), buildSectionGeometry(w, 0, 0, 1, uvFor)];
    const faces = edge.reduce((n, g) => n + g.indices.length / 6, 0);
    expect(faces).toBe(4 * 5); // each edge block loses its outside face
    const inner = new World(32, 16, 32);
    inner.set(1, 5, 10, BlockId.Stone);
    expect(buildSectionGeometry(inner, 0, 0, 0, uvFor).indices.length / 6).toBe(6);
  });

  it('an all-Stone section surrounded by Stone emits nothing', () => {
    const w = new World(48, 48, 48);
    for (let y = 0; y < 48; y++) w.fillLayer(y, BlockId.Stone);
    const g = buildSectionGeometry(w, 1, 1, 1, uvFor);
    expect(g.indices.length).toBe(0);
    expect(g.transparent.indices.length).toBe(0);
  });

  it('a cave floor cell in a lower section emits its top face into its own section, and the ceiling face into the one above', () => {
    const w = new World(32, 48, 32);
    for (let y = 0; y < 48; y++) w.fillLayer(y, BlockId.Stone);
    w.set(5, 16, 5, BlockId.Air); // a one-cell hole at the bottom of section 1: the floor is y 15 (section 0)
    const lower = buildSectionGeometry(w, 0, 0, 0, uvFor);
    const upper = buildSectionGeometry(w, 0, 1, 0, uvFor);
    const lowerQuads = quadsOf(lower);
    expect(lowerQuads).toHaveLength(1);
    expect(lowerQuads[0]).toMatch(/^top 5,15,5/);
    // The four walls round the hole and its ceiling belong to section 1.
    expect(quadsOf(upper)).toHaveLength(5);
  });

  it('cross-shaped plants and transparent blocks still go to the transparent mesh', () => {
    const w = new World(16, 32, 16);
    w.set(5, 20, 5, BlockId.Wheat2);
    w.set(7, 20, 5, BlockId.Glass);
    w.set(9, 20, 5, BlockId.Water);
    const g = buildSectionGeometry(w, 0, 1, 0, uvFor);
    expect(g.indices.length).toBe(0);
    expect(g.transparent.indices.length / 3).toBe(8 + 12 + 12);
  });

  it('existing mesher behaviour: buildChunkGeometry is the sections of the column joined', () => {
    const w = new World(16, 40, 16);
    w.set(5, 5, 5, BlockId.Stone);
    w.set(5, 20, 5, BlockId.Stone);
    w.set(5, 39, 5, BlockId.Lamp);
    w.set(6, 25, 6, BlockId.Carrot1);
    const g = buildChunkGeometry(w, 0, 0, uvFor);
    expect(g.indices.length / 6).toBe(18);
    expect(g.transparent.indices.length / 3).toBe(8);
    // Indices point at the right vertices after joining (every index is in range).
    const verts = g.positions.length / 3;
    expect(Math.max(...g.indices)).toBe(verts - 1);
  });

  it('CHUNK_SIZE stays 16 (columns are 16 x 16)', () => {
    expect(CHUNK_SIZE).toBe(16);
  });
});

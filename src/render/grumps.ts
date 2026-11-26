import * as THREE from 'three';
import type { Friend, Grump, GrumpKind, GrumpMood, GrumpSystem } from '../game/grumps';

// Grumps and friends are small, round, bright and funny: ONE merged mesh each (vertex colours, feet
// at y = 0, facing +z), like the animals and the people. Soft pastel bodies, big white eyes with
// plum pupils, blush cheeks. A sulky one has droopy lids, pupils looking down and a flat mouth; an
// unsure one has its lids lifted; a friend has pupils looking up and a big smile. No teeth, no
// spikes, nothing red or dark, nothing bigger than a block.

/** x, y, z of the centre, then w, h, d, then the colour. */
type Part = [number, number, number, number, number, number, number];
export type PartRole = 'body' | 'eye' | 'pupil' | 'lid' | 'mouth' | 'smile' | 'blush' | 'drop';
export interface GrumpLook { kind: GrumpKind; mood: GrumpMood | 'friend'; variant: number }

export const GRUMP_PALETTE: readonly string[] = ['#c9b8ec', '#b7e4cf', '#f5cfa8', '#b8d8f2'];
export const FRIEND_PALETTE: readonly string[] = ['#ffe27a', '#ffb6c9', '#8fe3e0', '#c6ec8a', '#ffc27a'];
/** Dark plum for pupils and mouths: never black, never red. */
export const INK = '#4a3f63';
export const BLUSH = '#ffb3b3';
const WHITE = 0xffffff;
const num = (h: string): number => parseInt(h.slice(1), 16);

/** Grumps and friends further from the camera than this are hidden (the fog hides them anyway). */
export const GRUMP_VIEW_RANGE = 44;
export const GRUMP_MAX_TRIANGLES = 130;
/** No part of any model is wider or taller than this. */
export const GRUMP_MAX_SIZE = 1.1;
/** How high a cloud hovers above the ground. */
export const CLOUD_HOVER = 0.6;

const box = (role: PartRole, x: number, y: number, z: number, w: number, h: number, d: number, colour: number): { role: PartRole; part: Part } =>
  ({ role, part: [x, y, z, w, h, d, colour] });

/** The boxes of a model, with what each one is for (the palette and shape tests read this). */
export function grumpParts(look: GrumpLook): Array<{ role: PartRole; part: Part }> {
  const friend = look.mood === 'friend';
  const palette = friend ? FRIEND_PALETTE : GRUMP_PALETTE;
  const body = num(palette[((Math.floor(look.variant) % palette.length) + palette.length) % palette.length]);
  const ink = num(INK), blush = num(BLUSH);
  const sulky = look.mood === 0;
  const parts: Array<{ role: PartRole; part: Part }> = [];
  // The face: where the front of the body is, the eye height and how far apart the eyes sit.
  let front: number, eyeY: number, eyeX: number, eyeW: number, mouthY: number;
  if (look.kind === 'jelly') {
    parts.push(box('body', 0, 0.2, 0, 0.86, 0.4, 0.8, body));
    parts.push(box('body', 0, 0.62, 0, 0.9, 0.44, 0.84, body));
    parts.push(box('body', 0, 0.9, 0, 0.5, 0.12, 0.5, body));
    front = 0.42; eyeY = 0.62; eyeX = 0.2; eyeW = 0.2; mouthY = 0.47;
  } else {
    parts.push(box('body', 0, 0.5, 0, 0.7, 0.34, 0.62, body));
    parts.push(box('body', -0.34, 0.45, 0, 0.34, 0.3, 0.5, body));
    parts.push(box('body', 0.34, 0.45, 0, 0.34, 0.3, 0.5, body));
    parts.push(box('body', 0, 0.78, 0, 0.5, 0.26, 0.5, body));
    parts.push(box('drop', 0, 0.1, 0, 0.1, 0.16, 0.1, num(GRUMP_PALETTE[3])));
    front = 0.31; eyeY = 0.53; eyeX = 0.15; eyeW = 0.16; mouthY = 0.4;
  }
  const faceZ = front + 0.015;
  const eyeH = 0.24;
  for (const s of [-1, 1]) parts.push(box('eye', s * eyeX, eyeY, faceZ, eyeW, eyeH, 0.03, WHITE));
  // Pupils: down when sulky, level when unsure, up for a friend.
  const pupilY = eyeY + (sulky ? -0.06 : friend ? 0.05 : 0);
  for (const s of [-1, 1]) parts.push(box('pupil', s * eyeX, pupilY, faceZ + 0.015, eyeW * 0.5, eyeH * 0.42, 0.02, ink));
  if (!friend) {
    // Droopy lids: a pastel box over the upper half of each eye; lifted (thin) when unsure.
    const lidH = sulky ? eyeH * 0.5 : eyeH * 0.22;
    for (const s of [-1, 1]) parts.push(box('lid', s * eyeX, eyeY + eyeH / 2 - lidH / 2 + 0.005, faceZ + 0.03, eyeW + 0.02, lidH, 0.02, body));
  }
  if (friend) {
    parts.push(box('mouth', 0, mouthY, faceZ, 0.2, 0.04, 0.03, ink));
    for (const s of [-1, 1]) parts.push(box('smile', s * 0.12, mouthY + 0.035, faceZ, 0.04, 0.05, 0.03, ink));
  } else {
    parts.push(box('mouth', 0, mouthY, faceZ, sulky ? 0.14 : 0.2, 0.04, 0.03, ink));
  }
  if (look.kind === 'jelly') for (const s of [-1, 1]) parts.push(box('blush', s * 0.36, mouthY + 0.02, faceZ - 0.005, 0.1, 0.07, 0.03, blush));
  return parts;
}

const material = new THREE.MeshLambertMaterial({ vertexColors: true });
const geometries = new Map<string, THREE.BufferGeometry>();
const c = new THREE.Color();

const FACES: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
];

function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const positions = new Float32Array(parts.length * 5 * 4 * 3);
  const normals = new Float32Array(positions.length);
  const colours = new Float32Array(positions.length);
  const indices = new Uint16Array(parts.length * 5 * 6);
  let v = 0;
  let i = 0;
  for (const [cx, cy, cz, w, h, d, colour] of parts) {
    c.set(colour);
    for (const f of FACES) {
      const base = v / 3;
      for (const [sx, sy, sz] of f.v) {
        positions[v] = cx + (sx * w) / 2; positions[v + 1] = cy + (sy * h) / 2; positions[v + 2] = cz + (sz * d) / 2;
        normals[v] = f.n[0]; normals[v + 1] = f.n[1]; normals[v + 2] = f.n[2];
        colours[v] = c.r; colours[v + 1] = c.g; colours[v + 2] = c.b;
        v += 3;
      }
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i);
      i += 6;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function geometryFor(look: GrumpLook): THREE.BufferGeometry {
  const palette = look.mood === 'friend' ? FRIEND_PALETTE : GRUMP_PALETTE;
  const variant = ((Math.floor(look.variant) % palette.length) + palette.length) % palette.length;
  const key = `${look.kind}:${look.mood}:${variant}`;
  let g = geometries.get(key);
  if (!g) { g = mergeParts(grumpParts({ ...look, variant }).map(p => p.part)); geometries.set(key, g); }
  return g;
}

/** One merged mesh inside a group; the group is what moves and turns. Geometry is cached and shared. */
export function makeGrumpModel(kind: GrumpKind, mood: GrumpMood | 'friend', variant: number): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geometryFor({ kind, mood, variant }), material));
  return g;
}

/** Frees the shared geometries (tests, hot reload). The models are rebuilt on demand. */
export function disposeGrumpGeometry(): void {
  for (const g of geometries.values()) g.dispose();
  geometries.clear();
}

// ---------------------------------------------------------------- motion (render rate only)

/** 0.2 growing to 1 over the first second: a small friendly "plip", never a pop or a flash. */
export function spawnScale(spawnT: number): number {
  const u = Math.min(1, Math.max(0, spawnT));
  return 0.2 + 0.8 * (u * u * (3 - 2 * u));
}

export interface Wobble { sx: number; sy: number; sz: number; lift: number; sway: number }

/**
 * A jelly squashes and stretches (sulky: slower and flatter), a cloud bobs and drifts slowly (sway
 * 0.05 block), a friend bounces. Everything stays between 0.9 and 1.06 times its size.
 */
export function wobble(kind: GrumpKind, mood: GrumpMood | 'friend', id: number, t: number): Wobble {
  const s = Math.sin(t * (mood === 'friend' ? 3.2 : mood === 1 ? 2.2 : 1.2) + id * 1.9);
  if (kind === 'cloud') {
    const sy = 1 + s * 0.02;
    return { sx: 1 / Math.sqrt(sy), sy, sz: 1 / Math.sqrt(sy), lift: 0.05 + Math.sin(t * 0.9 + id) * 0.04 + (mood === 'friend' ? Math.abs(s) * 0.03 : 0), sway: Math.sin(t * 0.6 + id * 2.3) * 0.05 };
  }
  const sy = mood === 'friend' ? 0.98 + 0.08 * s : mood === 1 ? 0.99 + 0.06 * s : 0.955 + 0.04 * s;
  return { sx: 1 / Math.sqrt(sy), sy, sz: 1 / Math.sqrt(sy), lift: mood === 'friend' ? Math.abs(s) * 0.06 : 0, sway: 0 };
}

// ---------------------------------------------------------------- the view

type Seen = { type: 'grump' | 'friend'; id: number };

/** Draws grumps and friends: one group per body, created on first sight and moved every frame. */
export class GrumpView {
  private readonly groups = new Map<string, { group: THREE.Group; look: string; type: Seen['type']; id: number }>();
  private readonly v = new THREE.Vector3();
  private readonly out: Array<{ type: 'grump' | 'friend'; id: number; sx: number; sy: number; sz: number }> = [];

  constructor(private readonly scene: THREE.Scene) {}

  get drawCalls(): number {
    let n = 0;
    for (const e of this.groups.values()) if (e.group.visible) n++;
    return n;
  }

  /** `showMood(id)` says how to draw each one (a grump's mood, or 'friend'); `visible` is the range check. */
  sync(sys: GrumpSystem, visible: (x: number, z: number) => boolean, timeSeconds: number, showMood: (id: number) => GrumpMood | 'friend'): void {
    const alive = new Set<string>();
    const draw = (e: Grump | Friend, type: Seen['type'], spawnT: number): void => {
      const key = `${type}:${e.id}`;
      alive.add(key);
      const mood = type === 'friend' ? 'friend' : showMood(e.id);
      const lookKey = `${e.kind}:${mood}:${e.variant}`;
      let entry = this.groups.get(key);
      if (!entry) {
        const group = makeGrumpModel(e.kind, mood, e.variant);
        entry = { group, look: lookKey, type, id: e.id };
        this.groups.set(key, entry);
        this.scene.add(group);
      } else if (entry.look !== lookKey) {
        (entry.group.children[0] as THREE.Mesh).geometry = geometryFor({ kind: e.kind, mood, variant: e.variant });
        entry.look = lookKey;
      }
      const show = visible(e.x, e.z);
      entry.group.visible = show;
      if (!show) return;
      const w = wobble(e.kind, mood, e.id, timeSeconds);
      const grow = spawnScale(spawnT);
      const hover = e.kind === 'cloud' ? CLOUD_HOVER : 0;
      entry.group.position.set(e.x + w.sway, e.y + hover + w.lift, e.z);
      entry.group.rotation.y = e.heading;
      entry.group.scale.set(w.sx * grow, w.sy * grow, w.sz * grow);
    };
    for (const g of sys.grumps) draw(g, 'grump', g.spawnT);
    for (const f of sys.friends) draw(f, 'friend', 1);
    for (const [key, entry] of this.groups) {
      if (alive.has(key)) continue;
      this.scene.remove(entry.group);
      this.groups.delete(key);
    }
  }

  /** Where each shown body is on screen (CSS px inside `rect`) and how deep, for tap picking. */
  screenPositions(
    camera: THREE.Camera, rect: { left: number; top: number; width: number; height: number },
  ): Array<{ type: 'grump' | 'friend'; id: number; sx: number; sy: number; sz: number }> {
    this.out.length = 0;
    camera.updateMatrixWorld();
    for (const e of this.groups.values()) {
      if (!e.group.visible) continue;
      this.v.set(e.group.position.x, e.group.position.y + 0.45 * e.group.scale.y, e.group.position.z).project(camera);
      if (this.v.z < -1 || this.v.z > 1) continue;
      this.out.push({
        type: e.type, id: e.id,
        sx: rect.left + ((this.v.x + 1) / 2) * rect.width,
        sy: rect.top + ((1 - this.v.y) / 2) * rect.height,
        sz: this.v.z,
      });
    }
    return this.out;
  }

  dispose(): void {
    for (const e of this.groups.values()) this.scene.remove(e.group);
    this.groups.clear();
  }
}

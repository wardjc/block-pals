import * as THREE from 'three';
import type { WeaponKind } from '../core/items';
import { FRIEND_PALETTE, GRUMP_PALETTE } from './grumps';

export type SparkleKind = 'water' | 'sun' | 'both' | 'heart' | 'crumb' | 'bubble' | 'star' | 'drop' | 'confetti';

/** Every particle lives this long (seconds). */
export const SPARKLE_LIFE = 0.8;

const PALETTE: Record<SparkleKind, number[]> = {
  water: [0x4aa8ff, 0x8fd0ff],
  sun: [0xffd23f, 0xfff08a],
  both: [0x4aa8ff, 0xffd23f],
  heart: [0xff6f91, 0xffa3b8],
  crumb: [0xd9a85b, 0xf0cf8a],
  // The grumps step: soft weapon bursts, and confetti from the grump and friend colours only (never red-heavy).
  bubble: [0xb8e4ff, 0xdff3ff],
  star: [0xffe27a, 0xfff3b0],
  drop: [0x7fc4ff, 0xaedcff],
  confetti: [...GRUMP_PALETTE, ...FRIEND_PALETTE].map(h => parseInt(h.slice(1), 16)),
};
const FAR_AWAY = -1000;

function dotTexture(): THREE.Texture | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(canvas);
  } catch {
    return null;
  }
}

/**
 * One pooled `THREE.Points` for every effect (water drops, sun, hearts, crumbs): one draw call, a
 * fixed number of particles, nothing allocated after the constructor. A burst when the pool is full
 * reuses the oldest particles. Normal blending with a per-particle alpha, so pink stays pink on a bright field.
 */
export class Sparkles {
  readonly points: THREE.Points;
  /** Particles alive right now. */
  live = 0;

  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly base: Float32Array;
  private readonly age: Float32Array;
  private head = 0;
  private readonly tmp = new THREE.Color();

  constructor(scene: THREE.Scene, readonly capacity = 96, private readonly rand: () => number = Math.random) {
    this.pos = new Float32Array(capacity * 3).fill(FAR_AWAY);
    this.col = new Float32Array(capacity * 4);
    this.vel = new Float32Array(capacity * 3);
    this.base = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(Infinity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4)); // r, g, b, alpha
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6); // never culled
    const map = dotTexture();
    const mat = new THREE.PointsMaterial({
      size: 0.28, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false,
      fog: false, ...(map ? { map } : {}),
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  burst(at: { x: number; y: number; z: number }, kind: SparkleKind, n = 12): void {
    const palette = PALETTE[kind];
    const count = Math.min(Math.max(0, Math.floor(n)), this.capacity);
    for (let k = 0; k < count; k++) {
      const i = this.head;
      this.head = (this.head + 1) % this.capacity;
      if (!(this.age[i] < SPARKLE_LIFE)) this.live++;
      const a = this.rand() * Math.PI * 2;
      const spread = kind === 'heart' ? 0.35 : 0.8;
      this.vel[i * 3] = Math.cos(a) * spread * this.rand();
      this.vel[i * 3 + 2] = Math.sin(a) * spread * this.rand();
      // Water falls, hearts and sun rise, crumbs hop and drop.
      const falls = kind === 'water' || kind === 'drop';
      this.vel[i * 3 + 1] = falls ? -0.4 + this.rand() * 0.5
        : kind === 'crumb' ? 0.8 + this.rand() * 0.6 : kind === 'bubble' ? 0.3 + this.rand() * 0.4 : 0.6 + this.rand() * 0.8;
      const startY = falls ? at.y + 0.9 + this.rand() * 0.3 : at.y;
      this.base[i * 3] = at.x; this.base[i * 3 + 1] = startY; this.base[i * 3 + 2] = at.z;
      this.pos[i * 3] = at.x; this.pos[i * 3 + 1] = startY; this.pos[i * 3 + 2] = at.z;
      this.tmp.set(palette[k % palette.length]);
      this.col[i * 4] = this.tmp.r;
      this.col[i * 4 + 1] = this.tmp.g;
      this.col[i * 4 + 2] = this.tmp.b;
      this.col[i * 4 + 3] = 1;
      this.age[i] = 0;
    }
    this.mark();
  }

  update(dt: number): void {
    if (this.live === 0) return;
    for (let i = 0; i < this.capacity; i++) {
      if (!(this.age[i] < SPARKLE_LIFE)) continue;
      this.age[i] += dt;
      if (this.age[i] >= SPARKLE_LIFE) {
        this.live--;
        this.age[i] = Infinity;
        this.pos[i * 3 + 1] = FAR_AWAY;
        this.col[i * 4 + 3] = 0;
        continue;
      }
      const t = this.age[i];
      this.pos[i * 3] = this.base[i * 3] + this.vel[i * 3] * t;
      this.pos[i * 3 + 1] = this.base[i * 3 + 1] + this.vel[i * 3 + 1] * t - 0.5 * (this.vel[i * 3 + 1] > 0.5 ? 1.2 : 0) * t * t;
      this.pos[i * 3 + 2] = this.base[i * 3 + 2] + this.vel[i * 3 + 2] * t;
      const fade = 1 - t / SPARKLE_LIFE;
      this.col[i * 4 + 3] = Math.min(1, fade * 1.6);
    }
    this.mark();
  }

  private mark(): void {
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    const mat = this.points.material as THREE.PointsMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}

/** Most paused plants that show a sad mark at once. */
export const SAD_MARK_CAPACITY = 24;

function sadTexture(): THREE.Texture | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // A pale blue bubble with two dots for eyes and a small down-turned mouth. Soft, never dark.
    ctx.fillStyle = 'rgba(184,216,242,0.95)';
    ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a3f63';
    ctx.beginPath(); ctx.arc(11, 13, 2, 0, Math.PI * 2); ctx.arc(21, 13, 2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4a3f63'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(12, 23); ctx.quadraticCurveTo(16, 19, 20, 23); ctx.stroke();
    return new THREE.CanvasTexture(canvas);
  } catch {
    return null;
  }
}

/**
 * Little sad bubbles that float and bob above each plant a sulky grump is pausing. One pooled
 * `THREE.Points` (one draw call, fixed size). It only draws: the plants and the world are never touched.
 */
export class SadMarks {
  readonly points: THREE.Points;
  /** Marks showing right now. */
  shown = 0;
  private readonly pos: Float32Array;

  constructor(scene: THREE.Scene, readonly capacity = SAD_MARK_CAPACITY) {
    this.pos = new Float32Array(capacity * 3).fill(FAR_AWAY);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
    const map = sadTexture();
    const mat = new THREE.PointsMaterial({
      size: 0.55, sizeAttenuation: true, transparent: true, depthWrite: false, fog: false,
      ...(map ? { map } : { color: 0xb8d8f2 }),
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  /** One mark above each cell (the plant's own cell), the first `capacity` of them. */
  set(cells: ReadonlyArray<readonly [number, number, number]>, timeSeconds: number): void {
    const n = Math.min(cells.length, this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      if (i < n) {
        const c = cells[i];
        this.pos[i * 3] = c[0] + 0.5;
        this.pos[i * 3 + 1] = c[1] + 1.4 + Math.sin(timeSeconds * 1.4 + i * 1.3) * 0.12;
        this.pos[i * 3 + 2] = c[2] + 0.5;
      } else {
        this.pos[i * 3 + 1] = FAR_AWAY;
      }
    }
    this.shown = n;
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    const mat = this.points.material as THREE.PointsMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}

/** Seconds a friendly shot takes to arrive (the logic is immediate; this is only the picture). */
export const PROJECTILE_SECONDS = 0.3;

const octa = (r: number, sx = 1, sy = 1, sz = 1, ox = 0): THREE.BufferGeometry => {
  const g = new THREE.OctahedronGeometry(r, 0);
  g.scale(sx, sy, sz);
  g.translate(ox, 0, 0);
  return g;
};
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g of parts) {
    const flat = g.index ? g.toNonIndexed() : g;
    pos.push(...(flat.getAttribute('position').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  out.computeVertexNormals();
  return out;
}

const PROJECTILE_LOOK: Record<WeaponKind, { geometry: () => THREE.BufferGeometry; colour: number; opacity: number }> = {
  // A translucent pale-blue bubble (8 triangles).
  bubble: { geometry: () => octa(0.16), colour: 0xb8e4ff, opacity: 0.6 },
  // A small yellow four-point star: a flat octahedron, long across and thin front to back.
  wand: { geometry: () => octa(0.2, 1.3, 1.3, 0.35), colour: 0xffe27a, opacity: 1 },
  // A short stream of three small blue drops in a line.
  water: { geometry: () => merge([octa(0.07, 1, 1.3, 1, -0.16), octa(0.08, 1, 1.3, 1, 0), octa(0.07, 1, 1.3, 1, 0.16)]), colour: 0x7fc4ff, opacity: 0.9 },
};

/**
 * One mesh, one draw call: the soft friendly shot that flies from him to a grump in 0.3 s on a low
 * arc. The mesh is reused for all three weapons (only its shape and colour change). It stops when
 * the game is paused because it only moves by the dt it is given.
 */
export class Projectile {
  readonly mesh: THREE.Mesh;
  private readonly material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, fog: false });
  private readonly shapes = new Map<WeaponKind, THREE.BufferGeometry>();
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();
  private t = 0;
  private flying = false;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  get active(): boolean {
    return this.flying;
  }

  launch(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, weapon: WeaponKind): void {
    let shape = this.shapes.get(weapon);
    if (!shape) { shape = PROJECTILE_LOOK[weapon].geometry(); this.shapes.set(weapon, shape); }
    this.mesh.geometry = shape;
    this.material.color.setHex(PROJECTILE_LOOK[weapon].colour);
    this.material.opacity = PROJECTILE_LOOK[weapon].opacity;
    this.from.set(from.x, from.y, from.z);
    this.to.set(to.x, to.y, to.z);
    this.t = 0;
    this.flying = true;
    this.place(0);
    this.mesh.visible = true;
  }

  private place(u: number): void {
    this.mesh.position.lerpVectors(this.from, this.to, u);
    this.mesh.position.y += Math.sin(u * Math.PI) * 0.6;
    this.mesh.rotation.z = u * 6;
  }

  /** True on the one frame it arrives. */
  update(dt: number): boolean {
    if (!this.flying || !(dt > 0)) return false;
    this.t += dt;
    if (this.t >= PROJECTILE_SECONDS - 1e-9) {
      this.flying = false;
      this.mesh.visible = false;
      return true;
    }
    this.place(this.t / PROJECTILE_SECONDS);
    return false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    for (const g of this.shapes.values()) g.dispose();
    this.shapes.clear();
    this.material.dispose();
  }
}

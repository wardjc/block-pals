import * as THREE from 'three';

export type SparkleKind = 'water' | 'sun' | 'both' | 'heart' | 'crumb';

/** Every particle lives this long (seconds). */
export const SPARKLE_LIFE = 0.8;

const PALETTE: Record<SparkleKind, number[]> = {
  water: [0x4aa8ff, 0x8fd0ff],
  sun: [0xffd23f, 0xfff08a],
  both: [0x4aa8ff, 0xffd23f],
  heart: [0xff6f91, 0xffa3b8],
  crumb: [0xd9a85b, 0xf0cf8a],
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
 * reuses the oldest particles. Additive blending, so a fading particle just dims to nothing.
 */
export class Sparkles {
  readonly points: THREE.Points;
  /** Particles alive right now. */
  live = 0;

  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly base: Float32Array;
  private readonly tint: Float32Array;
  private readonly age: Float32Array;
  private head = 0;
  private readonly tmp = new THREE.Color();

  constructor(scene: THREE.Scene, readonly capacity = 64, private readonly rand: () => number = Math.random) {
    this.pos = new Float32Array(capacity * 3).fill(FAR_AWAY);
    this.col = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.base = new Float32Array(capacity * 3);
    this.tint = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(Infinity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6); // never culled
    const map = dotTexture();
    const mat = new THREE.PointsMaterial({
      size: 0.28, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, ...(map ? { map } : {}),
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
      this.vel[i * 3 + 1] = kind === 'water' ? -0.4 + this.rand() * 0.5
        : kind === 'crumb' ? 0.8 + this.rand() * 0.6 : 0.6 + this.rand() * 0.8;
      const startY = kind === 'water' ? at.y + 0.9 + this.rand() * 0.3 : at.y;
      this.base[i * 3] = at.x; this.base[i * 3 + 1] = startY; this.base[i * 3 + 2] = at.z;
      this.pos[i * 3] = at.x; this.pos[i * 3 + 1] = startY; this.pos[i * 3 + 2] = at.z;
      this.tmp.set(palette[k % palette.length]);
      this.tint[i * 3] = this.col[i * 3] = this.tmp.r;
      this.tint[i * 3 + 1] = this.col[i * 3 + 1] = this.tmp.g;
      this.tint[i * 3 + 2] = this.col[i * 3 + 2] = this.tmp.b;
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
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      const t = this.age[i];
      this.pos[i * 3] = this.base[i * 3] + this.vel[i * 3] * t;
      this.pos[i * 3 + 1] = this.base[i * 3 + 1] + this.vel[i * 3 + 1] * t - 0.5 * (this.vel[i * 3 + 1] > 0.5 ? 1.2 : 0) * t * t;
      this.pos[i * 3 + 2] = this.base[i * 3 + 2] + this.vel[i * 3 + 2] * t;
      const fade = 1 - t / SPARKLE_LIFE;
      const k = fade * fade;
      this.col[i * 3] = this.tint[i * 3] * k;
      this.col[i * 3 + 1] = this.tint[i * 3 + 1] * k;
      this.col[i * 3 + 2] = this.tint[i * 3 + 2] * k;
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
    (this.points.material as THREE.Material).dispose();
  }
}

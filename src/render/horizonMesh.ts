import * as THREE from 'three';
import type { World } from '../core/world';
import {
  HORIZON_FADE_S, HORIZON_HAZE_END, HORIZON_MAX_HAZE, INDICES_PER_CELL, HorizonField, VERTS_PER_CELL, fillCell, fillIndices, visibleIndices,
} from './horizon';

/** Cells sampled a frame at most, and the most time a frame may spend on it (it builds in idle slivers). */
export const HORIZON_CELLS_PER_FRAME = 24;
export const HORIZON_MS_PER_FRAME = 1.2;
export const HORIZON_FILLS_PER_FRAME = 120;
/** Changed cells reach the GPU at most this often (an edit far away is not urgent). */
export const HORIZON_UPLOAD_S = 1.5;
/** The horizon camera reaches past the farthest corner of the world. */
const HORIZON_CAM_NEAR = 10;
const HORIZON_CAM_FAR = 520;
const VERT = /* glsl */ `
  attribute vec3 color;
  varying vec3 vColour;
  varying float vDepth;
  void main() {
    vColour = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z; // planar view depth: the same number the land's fog (vFogDepth) uses
    gl_Position = projectionMatrix * mv;
  }
`;

/** horizonHaze() in horizon.ts, with its constants taken from the same place. */
const FRAG = /* glsl */ `
  uniform vec3 uFogColour;
  uniform float uNear;
  uniform float uFar;
  uniform float uHaze;
  uniform float uFade;
  varying vec3 vColour;
  varying float vDepth;
  const float MAX_K = ${HORIZON_MAX_HAZE.toFixed(4)};
  const float END = ${HORIZON_HAZE_END.toFixed(1)};
  void main() {
    float base = uHaze * smoothstep(uNear, uFar, vDepth);
    float k = base + (max(base, MAX_K) - base) * smoothstep(uFar, END, vDepth);
    k = 1.0 + (k - 1.0) * uFade;
    gl_FragColor = vec4(mix(vColour, uFogColour, k), 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * The far-terrain layer: one merged mesh (one draw call) of the whole world in 4 x 4 block columns,
 * drawn by GameScene in its own pass behind the detailed land, with a camera that reaches the world's
 * far corner. Built in idle slivers and kept up to date lazily. The shared uniforms give the detailed
 * land's own haze at the seam and a fade into the sky beyond it.
 */
export class Horizon {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, HORIZON_CAM_NEAR, HORIZON_CAM_FAR);
  readonly field: HorizonField;
  /** Haze scale for the detailed land too (see landHaze): GameScene patches it into the land's fog. */
  readonly hazeUniform = { value: 1 };
  /** 0 to 1 over HORIZON_FADE_S once the horizon is ready and drawn. */
  fade = 0;
  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly baseIndices: Uint16Array | Uint32Array;
  private readonly indexAttr: THREE.BufferAttribute;
  private readonly refill = new Set<number>();
  /** Cells whose vertices changed since the last upload (only these ranges go to the GPU). */
  private readonly toUpload = new Set<number>();
  private cut = { x: NaN, z: NaN, start: NaN };
  private sinceUpload = 0;
  private uploadDue = false;
  /** The first full build is done and uploaded; latched, so a later edit never hides the horizon. */
  private settled = false;
  private uploads = 0;
  private busyMs = 0;
  private maxSliceMs = 0;

  constructor(world: World) {
    this.field = new HorizonField(world);
    const cells = this.field.cells;
    this.positions = new Float32Array(cells * VERTS_PER_CELL * 3);
    this.colours = new Float32Array(cells * VERTS_PER_CELL * 3);
    const wide = cells * VERTS_PER_CELL > 65535;
    this.baseIndices = wide ? new Uint32Array(cells * INDICES_PER_CELL) : new Uint16Array(cells * INDICES_PER_CELL);
    fillIndices(cells, this.baseIndices);
    // The drawn indices are the base ones minus the cells wholly under the land (a geometry cut-out, no discard).
    const indices = wide ? new Uint32Array(cells * INDICES_PER_CELL) : new Uint16Array(cells * INDICES_PER_CELL);
    indices.set(this.baseIndices);
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colours, 3).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.indexAttr = new THREE.BufferAttribute(indices, 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setIndex(this.indexAttr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        uFogColour: { value: new THREE.Color(0x78c6ff) },
        uNear: { value: 20 },
        uFar: { value: 40 },
        uHaze: this.hazeUniform,
        uFade: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.mesh.visible = false;
  }

  /** The whole world has been sampled and uploaded once: only then is the horizon drawn. */
  get ready(): boolean {
    return this.settled && this.uploads > 0;
  }

  /** A changed block: its cell is sampled again later. */
  markDirty(x: number, z: number): void {
    this.field.markDirty(x, z);
  }

  /** Samples a sliver of waiting cells and refreshes the buffers; call once a frame, outdoors or not. */
  update(dt: number): void {
    const t0 = performance.now();
    if (this.field.pending > 0) {
      const changed = this.field.step(HORIZON_CELLS_PER_FRAME, HORIZON_MS_PER_FRAME);
      const { cx, cz } = this.field;
      for (const i of changed) {
        const x = i % cx, z = Math.floor(i / cx);
        this.refill.add(i);
        if (x > 0) this.refill.add(i - 1);
        if (x < cx - 1) this.refill.add(i + 1);
        if (z > 0) this.refill.add(i - cx);
        if (z < cz - 1) this.refill.add(i + cx);
      }
    }
    if (this.refill.size > 0) {
      // A cell refilled before its neighbour settles is refilled again when the neighbour changes (it is re-added then).
      let n = 0;
      for (const i of this.refill) {
        this.refill.delete(i);
        fillCell(this.field, i, this.positions, this.colours);
        this.toUpload.add(i);
        if (++n >= HORIZON_FILLS_PER_FRAME || performance.now() - t0 > HORIZON_MS_PER_FRAME) break;
      }
      this.uploadDue = true;
    }
    if (!this.settled && this.field.ready && this.field.pending === 0 && this.refill.size === 0) this.settled = true;
    this.sinceUpload += dt;
    if (this.uploadDue && ((this.uploads === 0 && this.settled) || (this.uploads > 0 && this.sinceUpload >= HORIZON_UPLOAD_S))) {
      this.uploadRanges();
      this.uploadDue = false;
      this.sinceUpload = 0;
      this.uploads++;
    }
    const ms = performance.now() - t0;
    this.busyMs += ms;
    if (ms > this.maxSliceMs) this.maxSliceMs = ms;
  }

  /** Sends only the changed cells' vertex ranges to the GPU (everything the first time). */
  private uploadRanges(): void {
    for (const a of [this.posAttr, this.colAttr]) {
      a.clearUpdateRanges();
      if (this.uploads > 0) {
        const cells = [...this.toUpload].sort((x, y) => x - y);
        const per = VERTS_PER_CELL * 3;
        let from = -1, to = -1;
        for (const c of cells) {
          if (from >= 0 && c - to <= 8) { to = c; continue; } // close cells share one range
          if (from >= 0) a.addUpdateRange(from * per, (to - from + 1) * per);
          from = to = c;
        }
        if (from >= 0) a.addUpdateRange(from * per, (to - from + 1) * per);
      }
      a.needsUpdate = true;
    }
    this.toUpload.clear();
  }

  /**
   * Sets the look for this frame and lines the horizon camera up with the main one. `start` is where
   * the detailed land's reach ends (cells wholly nearer are left out); `haze` is the land's haze scale
   * (landHaze); the horizon fades in over HORIZON_FADE_S.
   */
  prepare(main: THREE.PerspectiveCamera, fogColour: THREE.Color, near: number, far: number, haze: number, start: number, dt: number): void {
    const u = this.material.uniforms;
    (u.uFogColour.value as THREE.Color).copy(fogColour);
    u.uNear.value = near;
    u.uFar.value = far;
    u.uHaze.value = haze;
    this.fade = Math.min(1, this.fade + Math.max(0, dt) / HORIZON_FADE_S);
    u.uFade.value = this.fade;
    // The cut-out moves in whole cells (quantised), so a walking camera re-uploads the index list only now and then.
    const q = this.field.cell;
    const cx = Math.round(main.position.x / q) * q, cz = Math.round(main.position.z / q) * q, st = Math.round(start / q) * q;
    if (cx !== this.cut.x || cz !== this.cut.z || st !== this.cut.start) {
      this.cut = { x: cx, z: cz, start: st };
      const n = visibleIndices(this.field, this.baseIndices, this.indexAttr.array as Uint16Array, cx, cz, st);
      this.geometry.setDrawRange(0, n);
      this.indexAttr.clearUpdateRanges();
      this.indexAttr.addUpdateRange(0, n);
      this.indexAttr.needsUpdate = true;
    }
    const c = this.camera;
    c.position.copy(main.position);
    c.quaternion.copy(main.quaternion);
    if (c.fov !== main.fov || c.aspect !== main.aspect) {
      c.fov = main.fov;
      c.aspect = main.aspect;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
  }

  /** The horizon is not drawn this frame (hidden, off or in a cave): it fades in afresh next time. */
  rest(): void {
    this.fade = 0;
  }

  /** Frees the GPU buffers and the shader. */
  dispose(): void {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }

  /** Numbers for the debug panel and the budget checks. */
  stats(): { ready: boolean; cells: number; pending: number; uploads: number; busyMs: number; maxSliceMs: number; bytes: number; triangles: number } {
    const idx = this.geometry.index!.count;
    return {
      ready: this.ready, cells: this.field.cells, pending: this.field.pending, uploads: this.uploads,
      busyMs: this.busyMs, maxSliceMs: this.maxSliceMs,
      bytes: this.positions.byteLength + this.colours.byteLength + this.geometry.index!.array.byteLength,
      triangles: idx / 3,
    };
  }
}

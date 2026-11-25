import * as THREE from 'three';
import type { World } from '../core/world';
import { HorizonField, VERTS_PER_CELL, fillCell, fillIndices } from './horizon';

/** Cells sampled a frame at most, and the most time a frame may spend on it (it builds in idle slivers). */
export const HORIZON_CELLS_PER_FRAME = 24;
export const HORIZON_MS_PER_FRAME = 1.2;
export const HORIZON_FILLS_PER_FRAME = 120;
/** Changed cells reach the GPU at most this often (an edit far away is not urgent). */
export const HORIZON_UPLOAD_S = 1.5;
/** The horizon camera reaches past the farthest corner of the world. */
const HORIZON_CAM_NEAR = 10;
const HORIZON_CAM_FAR = 520;
/** The haze never quite hides the far land; it reaches this at HORIZON_HAZE_END blocks. */
export const HORIZON_MAX_HAZE = 0.86;
export const HORIZON_HAZE_END = 300;
/** Outdoors the detailed land is hazed this much at its fog end (the rest shows through), so far hills are not lost to the fog. */
export const OUTDOOR_HAZE = 0.7;

const VERT = /* glsl */ `
  attribute vec3 color;
  varying vec3 vColour;
  varying vec2 vWorldXZ;
  void main() {
    vColour = color;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorldXZ = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uFogColour;
  uniform vec2 uEye;
  uniform float uNear;
  uniform float uFar;
  uniform float uHaze;
  uniform float uMaxK;
  uniform float uEnd;
  uniform float uStart;
  varying vec3 vColour;
  varying vec2 vWorldXZ;
  void main() {
    float d = length(vWorldXZ - uEye);
    if (d < uStart) discard;
    float base = uHaze * smoothstep(uNear, uFar, d);
    float k = base + (max(base, uMaxK) - base) * smoothstep(uFar, uEnd, d);
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
  /** Haze scale for the detailed land too (OUTDOOR_HAZE outdoors, 1 in caves): GameScene patches it into the land's fog. */
  readonly hazeUniform = { value: OUTDOOR_HAZE };
  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly colAttr: THREE.BufferAttribute;
  private readonly refill = new Set<number>();
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
    const indices = cells * VERTS_PER_CELL > 65535 ? new Uint32Array(cells * 30) : new Uint16Array(cells * 30);
    fillIndices(cells, indices);
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colours, 3).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      uniforms: {
        uFogColour: { value: new THREE.Color(0x78c6ff) },
        uEye: { value: new THREE.Vector2() },
        uNear: { value: 20 },
        uFar: { value: 40 },
        uHaze: this.hazeUniform,
        uMaxK: { value: HORIZON_MAX_HAZE },
        uEnd: { value: HORIZON_HAZE_END },
        uStart: { value: 36 },
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
        if (++n >= HORIZON_FILLS_PER_FRAME || performance.now() - t0 > HORIZON_MS_PER_FRAME) break;
      }
      this.uploadDue = true;
    }
    if (!this.settled && this.field.ready && this.field.pending === 0 && this.refill.size === 0) this.settled = true;
    this.sinceUpload += dt;
    if (this.uploadDue && ((this.uploads === 0 && this.settled) || (this.uploads > 0 && this.sinceUpload >= HORIZON_UPLOAD_S))) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.uploadDue = false;
      this.sinceUpload = 0;
      this.uploads++;
    }
    const ms = performance.now() - t0;
    this.busyMs += ms;
    if (ms > this.maxSliceMs) this.maxSliceMs = ms;
  }

  /**
   * Sets the look for this frame and lines the horizon camera up with the main one. `start` is where
   * the detailed land's reach ends (nothing nearer is drawn); `haze` is 0.75 outdoors .. 1 deep.
   */
  prepare(main: THREE.PerspectiveCamera, fogColour: THREE.Color, near: number, far: number, haze: number, start: number): void {
    const u = this.material.uniforms;
    (u.uFogColour.value as THREE.Color).copy(fogColour);
    (u.uEye.value as THREE.Vector2).set(main.position.x, main.position.z);
    u.uNear.value = near;
    u.uFar.value = far;
    this.hazeUniform.value = haze;
    u.uStart.value = start;
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

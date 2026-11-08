import * as THREE from 'three';
import type { World } from '../core/world';
import { createAtlas } from './atlas';
import { CameraRig } from './cameraRig';
import { castVoxelRay, type VoxelHit } from './voxelRay';
import { DirtyChunks } from './chunkDirty';
import { ChunkCuller, FOG_FAR } from './chunkCull';
import { buildChunkGeometry, CHUNK_SIZE, type MeshArrays } from './mesher';

const FOLLOW_K = 4; // exponential smoothing rate, per second
/** The camera orbits his head: feet + EYE_HEIGHT (spec §7c). */
export const EYE_HEIGHT = 1.6;
const PICK_RANGE = 40;
const MARKER_SECONDS = 0.9;
// Three r155+ no longer pre-multiplies light intensity by PI, so scale to get the classic bright look.
const LIGHT_SCALE = Math.PI;

interface ChunkMeshes {
  /** null when the chunk has nothing of that kind (no empty draw calls). */
  solid: THREE.Mesh | null;
  trans: THREE.Mesh | null;
}

function toGeometry(a: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(a.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(a.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Marked chunks rebuilt per frame, nearest first (a dig or build is next to him, so it is always in this frame). */
const DIRTY_PER_FRAME = 4;

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly atlas = createAtlas();

  private readonly chunks = new Map<string, ChunkMeshes>();
  private readonly dirty: DirtyChunks;
  private readonly solidMat: THREE.MeshLambertMaterial;
  private readonly transMat: THREE.MeshLambertMaterial;
  /** Yaw, pitch and the wall-aware distance of the camera (spec §7c). */
  readonly rig = new CameraRig();
  private readonly smoothEye = new THREE.Vector3();
  private readonly realEye = new THREE.Vector3();
  private readonly lookPoint = new THREE.Vector3();
  private readonly hit: VoxelHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0 };
  private readonly ndc = new THREE.Vector2();
  private followed = false;
  private readonly culler: ChunkCuller;
  private shown: Set<string> | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private markerAge = Infinity;
  private readonly outline = new THREE.Group();

  constructor(private readonly host: HTMLElement, private readonly world: World) {
    this.dirty = new DirtyChunks(world.sizeX, world.sizeZ);
    this.culler = new ChunkCuller(world.sizeX, world.sizeY, world.sizeZ);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x78c6ff);
    this.scene.fog = new THREE.Fog(0x78c6ff, 20, FOG_FAR);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.0 * LIGHT_SCALE));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6 * LIGHT_SCALE);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);

    // A close near plane: in a tunnel the camera can sit CAMERA_CLEARANCE from a wall.
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 64);

    this.solidMat = new THREE.MeshLambertMaterial({ map: this.atlas.texture });
    this.transMat = new THREE.MeshLambertMaterial({
      map: this.atlas.texture,
      transparent: true,
      alphaTest: 0.05,
    });

    // A soft ring on the ground where a walk tap is heading.
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 2;
    this.marker.visible = false;
    this.scene.add(this.marker);

    // A white box around the block being dug (press and hold), drawn over everything.
    const box = new THREE.BoxGeometry(1.04, 1.04, 1.04);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
    );
    const glow = new THREE.Mesh(
      box,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, depthTest: false }),
    );
    edges.renderOrder = glow.renderOrder = 3;
    this.outline.add(glow, edges);
    this.outline.visible = false;
    this.scene.add(this.outline);

    const cxs = Math.ceil(world.sizeX / CHUNK_SIZE);
    const czs = Math.ceil(world.sizeZ / CHUNK_SIZE);
    for (let cz = 0; cz < czs; cz++) for (let cx = 0; cx < cxs; cx++) this.rebuildChunk(cx, cz);

    this.resize();
    window.addEventListener('resize', this.resize);
    new ResizeObserver(this.resize).observe(host);
  }

  private readonly resize = (): void => {
    const w = Math.max(1, this.host.clientWidth || window.innerWidth);
    const h = Math.max(1, this.host.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private rebuildChunk(cx: number, cz: number): void {
    if (cx < 0 || cz < 0 || cx * CHUNK_SIZE >= this.world.sizeX || cz * CHUNK_SIZE >= this.world.sizeZ) return;
    const key = `${cx},${cz}`;
    const old = this.chunks.get(key);
    if (old) {
      for (const m of [old.solid, old.trans]) {
        if (!m) continue;
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    const geo = buildChunkGeometry(this.world, cx, cz, this.atlas.uvFor);
    const solid = geo.indices.length > 0 ? new THREE.Mesh(toGeometry(geo), this.solidMat) : null;
    const trans = geo.transparent.indices.length > 0 ? new THREE.Mesh(toGeometry(geo.transparent), this.transMat) : null;
    if (trans) trans.renderOrder = 1;
    const shown = this.shown === null || this.shown.has(key);
    for (const m of [solid, trans]) {
      if (!m) continue;
      m.visible = shown;
      this.scene.add(m);
    }
    this.chunks.set(key, { solid, trans });
  }

  /** Hides chunks whose nearest corner is deeper than the fog along the view direction (nothing visible changes). */
  private cullFar(c: { x: number; y: number; z: number }, f: { x: number; y: number; z: number }, px: number, pz: number): void {
    const set = this.culler.update(c.x, c.y, c.z, f.x, f.y, f.z, px, pz);
    if (set === this.shown) return;
    this.shown = set;
    for (const [k, c] of this.chunks) {
      const v = set.has(k);
      if (c.solid) c.solid.visible = v;
      if (c.trans) c.trans.visible = v;
    }
  }

  /** Chunk and draw numbers for the debug panel and the budget checks. */
  stats(): { chunks: number; visible: number; triangles: number; drawCalls: number } {
    let visible = 0;
    for (const c of this.chunks.values()) if (c.solid?.visible || c.trans?.visible) visible++;
    return { chunks: this.chunks.size, visible, triangles: this.renderer.info.render.triangles, drawCalls: this.renderer.info.render.calls };
  }

  /**
   * Marks the chunk containing the cell (and the neighbour on a chunk edge) for rebuilding. The
   * rebuild happens once per chunk in `render` (a few per frame, nearest first), or at once with `flush`.
   */
  rebuildChunkAt(x: number, z: number): void {
    this.dirty.mark(x, z);
  }

  /** Rebuilds every marked chunk now. */
  flush(): void {
    for (const [cx, cz] of this.dirty.take(Infinity, 0, 0)) this.rebuildChunk(cx, cz);
  }

  triangleCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) {
      n += (c.solid?.geometry.index?.count ?? 0) / 3 + (c.trans?.geometry.index?.count ?? 0) / 3;
    }
    return n;
  }

  /**
   * Follows his position (not his heading: the camera stays where he turned it) and keeps the
   * camera out of the terrain. The smoothed eye lags a little; if a block ever comes between it
   * and his real head, it snaps to his head so the camera never orbits a point inside the ground.
   */
  followTarget(pos: THREE.Vector3, dt: number): void {
    const real = this.realEye.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
    if (!this.followed) {
      this.smoothEye.copy(real);
      this.followed = true;
    } else {
      this.smoothEye.lerp(real, 1 - Math.exp(-FOLLOW_K * dt));
      const dx = this.smoothEye.x - real.x, dy = this.smoothEye.y - real.y, dz = this.smoothEye.z - real.z;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6 && castVoxelRay(this.world, real.x, real.y, real.z, dx / len, dy / len, dz / len, len, false, this.hit, true)) {
        this.smoothEye.copy(real);
      }
    }
    this.rig.update(this.world, this.smoothEye, dt);
    const c = this.rig.position;
    const f = this.rig.forward;
    this.camera.position.set(c.x, c.y, c.z);
    this.camera.lookAt(this.lookPoint.set(c.x + f.x, c.y + f.y, c.z + f.z));
    this.cullFar(c, f, pos.x, pos.z);
  }

  /**
   * The camera ray through a screen point, and the first block it enters (null when none) with the
   * distance to it, so animals can be compared with blocks along the same ray.
   */
  pickRay(clientX: number, clientY: number): {
    origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number };
    block: { cell: [number, number, number]; normal: [number, number, number] } | null; t: number | null;
  } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    const h = this.hit;
    const origin = { x: o.x, y: o.y, z: o.z };
    const dir = { x: d.x, y: d.y, z: d.z };
    // The start cell is skipped: only a block entered through a face can be picked.
    if (!castVoxelRay(this.world, o.x, o.y, o.z, d.x, d.y, d.z, PICK_RANGE, true, h)) return { origin, dir, block: null, t: null };
    return { origin, dir, block: { cell: [h.x, h.y, h.z], normal: [h.nx, h.ny, h.nz] }, t: h.t };
  }

  pick(clientX: number, clientY: number): { cell: [number, number, number]; normal: [number, number, number] } | null {
    return this.pickRay(clientX, clientY).block;
  }

  /** Shows the walk marker on the floor of a feet cell; it fades out by itself. */
  showMarker([x, y, z]: [number, number, number]): void {
    this.marker.position.set(x + 0.5, y + 0.03, z + 0.5);
    this.markerAge = 0;
    this.marker.visible = true;
  }

  updateMarker(dt: number): void {
    if (!this.marker.visible) return;
    this.markerAge += dt;
    const t = this.markerAge / MARKER_SECONDS;
    if (t >= 1) {
      this.marker.visible = false;
      return;
    }
    this.marker.material.opacity = 0.95 * (1 - t * t);
    this.marker.scale.setScalar(0.8 + 0.4 * t);
  }

  /** Outlines a block cell in white (the block a hold will dig); null hides it. */
  showOutline(cell: [number, number, number] | null): void {
    this.outline.visible = cell !== null;
    if (cell) this.outline.position.set(cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5);
  }

  get outlineVisible(): boolean {
    return this.outline.visible;
  }

  /** Client (CSS px) position of a world point, for tests and debug tools. */
  screenOf(x: number, y: number, z: number): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  add(obj: THREE.Object3D): void {
    this.scene.add(obj);
  }

  render(): void {
    if (this.dirty.size > 0) {
      const p = this.smoothEye;
      for (const [cx, cz] of this.dirty.take(DIRTY_PER_FRAME, p.x, p.z)) this.rebuildChunk(cx, cz);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

import * as THREE from 'three';
import type { World } from '../core/world';
import { createAtlas } from './atlas';
import { CameraRig, clearance } from './cameraRig';
import { castVoxelRay, type VoxelHit } from './voxelRay';
import { DirtySections, sectionKey } from './chunkDirty';
import { cameraZone, FOG_FAR, radialFactor, SectionQueue, visibleSections, type CameraZone } from './chunkCull';
import { CAMERA_FAR, NEAR_MAX, cameraNear, easeNear } from './depthPolicy';
import { buildSectionGeometry, CHUNK_SIZE, SECTION_HEIGHT, sectionsPerColumn, type MeshArrays } from './mesher';

const FOLLOW_K = 4; // exponential smoothing rate, per second
/** The camera orbits his head: feet + EYE_HEIGHT (spec §7c). */
export const EYE_HEIGHT = 1.6;
/** How far the pick ray looks for blocks (anything picked farther than this could be behind an unseen wall). */
export const PICK_RANGE = 40;
const MARKER_SECONDS = 0.9;
// Three r155+ no longer pre-multiplies light intensity by PI, so scale to get the classic bright look.
const LIGHT_SCALE = Math.PI;
const FOV = 60;

interface SectionMeshes {
  /** null when the section has nothing of that kind (no empty draw calls). */
  solid: THREE.Mesh | null;
  trans: THREE.Mesh | null;
  cx: number;
  sy: number;
  cz: number;
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

/** Marked sections rebuilt per frame, nearest first (a dig or build is next to him, so it is always in this frame). */
export const DIRTY_PER_FRAME = 4;
/** First builds of sections coming into view: at most this many a frame, and no more once LAZY_MS of the frame are used. */
export const LAZY_PER_FRAME = 2;
export const LAZY_MS = 6;
/** A section more than this far off the view direction builds after the ones he looks at (priority + OFF_VIEW_PENALTY). */
const OFF_VIEW_DEG = 70;
const OFF_VIEW_PENALTY = 20;

const parseKey = (key: string): [number, number, number] => {
  const [a, b, c] = key.split(',');
  return [Number(a), Number(b), Number(c)];
};

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly atlas = createAtlas();

  /** Built section meshes, keyed "cx,sy,cz" (an entry with two nulls is a built, empty section). */
  private readonly chunks = new Map<string, SectionMeshes>();
  private readonly dirty: DirtySections;
  private readonly queue = new SectionQueue(LAZY_PER_FRAME);
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
  /** The sections the draw rule keeps (null until the camera is first placed: everything built is drawn). */
  private shown: Set<string> | null = null;
  private zone: CameraZone = 'outdoors';
  private mouths: ReadonlyArray<readonly [number, number, number]> = [];
  /** The fog end the draw rule uses (FOG_FAR until the view distance is wired in). */
  private fogEnd = FOG_FAR;
  /** Camera pose of the last cull, so a still camera does not recompute the set. */
  private readonly lastCull = { x: NaN, y: NaN, z: NaN, fx: NaN, fy: NaN, fz: NaN, fog: NaN, zone: '', floors: -1, keep: '' };
  /** Highest solid y per world column, and per 16 x 16 column its lowest ground top (for the outdoor floor rule). */
  private readonly tops: Int16Array;
  private readonly columnMinTop: Int16Array;
  private floorsVersion = 0;
  private readonly cxs: number;
  private readonly czs: number;
  private readonly raycaster = new THREE.Raycaster();
  private readonly marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private markerAge = Infinity;
  private readonly outline = new THREE.Group();
  /** Counters for the debug panel and the budgets: atlas repaints and section mesh builds. */
  private shimmerRepaints = 0;
  private chunkBuilds = 0;
  /** Keys of sections holding a shimmer block, kept up to date only when one is (re)built (empty: zero cost a frame). */
  private readonly shimmerChunks = new Set<string>();
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();

  constructor(private readonly host: HTMLElement, private readonly world: World) {
    this.dirty = new DirtySections(world.sizeX, world.sizeY, world.sizeZ);
    this.cxs = Math.ceil(world.sizeX / CHUNK_SIZE);
    this.czs = Math.ceil(world.sizeZ / CHUNK_SIZE);
    this.tops = new Int16Array(world.sizeX * world.sizeZ);
    for (let z = 0; z < world.sizeZ; z++) for (let x = 0; x < world.sizeX; x++) this.tops[x + world.sizeX * z] = world.topSolidY(x, z);
    this.columnMinTop = new Int16Array(this.cxs * this.czs);
    for (let cz = 0; cz < this.czs; cz++) for (let cx = 0; cx < this.cxs; cx++) this.refreshColumnTop(cx, cz);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x78c6ff);
    this.scene.fog = new THREE.Fog(0x78c6ff, 20, FOG_FAR);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.0 * LIGHT_SCALE));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6 * LIGHT_SCALE);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);

    // Near plane is far out in the open (depth precision) and shrinks only beside walls; see depthPolicy.ts.
    this.camera = new THREE.PerspectiveCamera(FOV, 1, NEAR_MAX, CAMERA_FAR);

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

    // No section is built here: the first followTarget builds what the camera can see, the rest follow lazily.
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

  /** Cave mouths (world cells): within MOUTH_NEAR of one the underground layers are drawn too. */
  setMouths(mouths: ReadonlyArray<readonly [number, number, number]>): void {
    this.mouths = mouths;
  }

  private refreshColumnTop(cx: number, cz: number): void {
    const sx = this.world.sizeX;
    let min = Infinity;
    for (let z = cz * CHUNK_SIZE; z < Math.min(this.world.sizeZ, (cz + 1) * CHUNK_SIZE); z++) {
      for (let x = cx * CHUNK_SIZE; x < Math.min(sx, (cx + 1) * CHUNK_SIZE); x++) min = Math.min(min, this.tops[x + sx * z]);
    }
    const value = Number.isFinite(min) ? Math.max(0, min) : 0;
    if (this.columnMinTop[cx + this.cxs * cz] !== value) {
      this.columnMinTop[cx + this.cxs * cz] = value;
      this.floorsVersion++;
    }
  }

  /**
   * Outdoors, the lowest section drawn in a column: the section of the lowest ground top in it and its
   * eight neighbours (a shaft's walls can belong to the next column). The untouched world gives 3 (y 48).
   */
  private readonly floorSection = (cx: number, cz: number): number => {
    let min = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx, z = cz + dz;
      if (x < 0 || z < 0 || x >= this.cxs || z >= this.czs) continue;
      min = Math.min(min, this.columnMinTop[x + this.cxs * z]);
    }
    return Math.floor(min / SECTION_HEIGHT);
  };

  private rebuildSection(cx: number, sy: number, cz: number): void {
    if (cx < 0 || cz < 0 || sy < 0 || cx >= this.cxs || cz >= this.czs || sy >= sectionsPerColumn(this.world.sizeY)) return;
    const key = sectionKey(cx, sy, cz);
    this.disposeSection(key);
    const geo = buildSectionGeometry(this.world, cx, sy, cz, this.atlas.uvFor);
    this.chunkBuilds++;
    const solid = geo.indices.length > 0 ? new THREE.Mesh(toGeometry(geo), this.solidMat) : null;
    const trans = geo.transparent.indices.length > 0 ? new THREE.Mesh(toGeometry(geo.transparent), this.transMat) : null;
    if (trans) trans.renderOrder = 1;
    const shown = this.shown === null || this.shown.has(key);
    for (const m of [solid, trans]) {
      if (!m) continue;
      m.visible = shown;
      m.matrixAutoUpdate = false; // geometry is in world coordinates: the identity matrix never changes
      this.scene.add(m);
    }
    this.chunks.set(key, { solid, trans, cx, sy, cz });
    this.queue.markBuilt(key);
    if (geo.hasShimmer) this.shimmerChunks.add(key);
    else this.shimmerChunks.delete(key);
  }

  private disposeSection(key: string): void {
    const old = this.chunks.get(key);
    if (!old) return;
    for (const m of [old.solid, old.trans]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.chunks.delete(key);
    this.shimmerChunks.delete(key);
  }

  /** Build order: horizontal distance to the section's centre, plus a penalty when it is well off to the side or behind. */
  private priority(cx: number, sy: number, cz: number, c: { x: number; y: number; z: number }, f: { x: number; z: number }): number {
    const dx = (cx + 0.5) * CHUNK_SIZE - c.x;
    const dz = (cz + 0.5) * CHUNK_SIZE - c.z;
    const dist = Math.hypot(dx, dz);
    const fl = Math.hypot(f.x, f.z);
    const off = dist > 1e-6 && fl > 1e-6 ? Math.acos(Math.max(-1, Math.min(1, (dx * f.x + dz * f.z) / (dist * fl)))) * 180 / Math.PI : 0;
    const dy = Math.abs((sy + 0.5) * SECTION_HEIGHT - c.y);
    return dist + (off > OFF_VIEW_DEG ? OFF_VIEW_PENALTY : 0) + dy * 0.01;
  }

  /**
   * The draw rule (visibleSections) for the camera's pose: shows built sections in the set, hides the
   * rest, and queues the unbuilt ones nearest first. Recomputed only when the camera moved or turned,
   * the zone or fog end changed, or the ground dipped somewhere.
   */
  private cullSections(c: { x: number; y: number; z: number }, f: { x: number; y: number; z: number }, px: number, pz: number): void {
    const zone = cameraZone(this.world, c.x, c.y, c.z, this.mouths);
    const L = this.lastCull;
    const keep = `${Math.floor(px / CHUNK_SIZE)},${Math.floor(pz / CHUNK_SIZE)}`;
    const moved = !(Math.abs(c.x - L.x) < 0.25 && Math.abs(c.y - L.y) < 0.25 && Math.abs(c.z - L.z) < 0.25)
      || !(f.x * L.fx + f.y * L.fy + f.z * L.fz > 0.9995);
    if (!moved && zone === L.zone && this.fogEnd === L.fog && this.floorsVersion === L.floors && keep === L.keep) return;
    Object.assign(L, { x: c.x, y: c.y, z: c.z, fx: f.x, fy: f.y, fz: f.z, fog: this.fogEnd, zone, floors: this.floorsVersion, keep });
    this.zone = zone;
    const set = visibleSections(
      this.world.sizeX, this.world.sizeY, this.world.sizeZ, c.x, c.y, c.z, f.x, f.y, f.z, zone, px, pz, this.fogEnd,
      { floorSection: this.floorSection, radialFactor: radialFactor(FOV, this.camera.aspect) },
    );
    this.shown = set;
    for (const [key, s] of this.chunks) {
      const v = set.has(key);
      if (s.solid) s.solid.visible = v;
      if (s.trans) s.trans.visible = v;
    }
    this.queue.retain(set);
    for (const key of set) {
      if (this.chunks.has(key)) continue;
      const [cx, sy, cz] = parseKey(key);
      this.queue.enqueue(key, this.priority(cx, sy, cz, c, f));
    }
  }

  /** Builds every section in the set that the camera's frustum can see (the first frame). */
  private buildInFrustum(): void {
    if (!this.shown) return;
    this.camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    const box = new THREE.Box3();
    for (const key of this.shown) {
      if (this.chunks.has(key)) continue;
      const [cx, sy, cz] = parseKey(key);
      box.min.set(cx * CHUNK_SIZE, sy * SECTION_HEIGHT, cz * CHUNK_SIZE);
      box.max.set((cx + 1) * CHUNK_SIZE, (sy + 1) * SECTION_HEIGHT, (cz + 1) * CHUNK_SIZE);
      if (this.frustum.intersectsBox(box)) this.rebuildSection(cx, sy, cz);
    }
  }

  private isShown(key: string): boolean {
    return this.chunks.has(key) && (this.shown === null || this.shown.has(key));
  }

  /** Section, draw and queue numbers for the debug panel and the budget checks. */
  stats(): {
    chunks: number; visible: number; frustumVisible: number; triangles: number; drawCalls: number;
    shimmerRepaints: number; chunkBuilds: number; queued: number; dirty: number; zone: CameraZone; fogEnd: number;
  } {
    let visible = 0;
    let frustumVisible = 0;
    this.camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const c of this.chunks.values()) {
      const meshes = [c.solid, c.trans].filter((m): m is THREE.Mesh => !!m && m.visible);
      if (meshes.length === 0) continue;
      visible++;
      if (meshes.some(m => this.frustum.intersectsObject(m))) frustumVisible++;
    }
    return {
      chunks: this.chunks.size, visible, frustumVisible, triangles: this.renderer.info.render.triangles, drawCalls: this.renderer.info.render.calls,
      shimmerRepaints: this.shimmerRepaints, chunkBuilds: this.chunkBuilds, queued: this.queue.size, dirty: this.dirty.size,
      zone: this.zone, fogEnd: this.fogEnd,
    };
  }

  /** Sections still waiting for their first build (the view-distance controller waits for this to be 0). */
  get backlog(): number {
    return this.queue.size;
  }

  /**
   * Whether a section the draw rule keeps holds a shimmer block. Walks only the (usually empty)
   * set of shimmer sections, never the section list, and allocates nothing.
   */
  anyVisibleShimmer(): boolean {
    if (this.shimmerChunks.size === 0) return false;
    if (this.shown === null) return true;
    let any = false;
    this.shimmerChunks.forEach(key => { if (!any && this.isShown(key)) any = true; });
    return any;
  }

  /**
   * A changed cell: marks the section containing it (and any neighbour across a shared border) for
   * rebuilding, and keeps the ground-height map up to date. Built sections are rebuilt in `render`
   * (DIRTY_PER_FRAME per frame, nearest first) or at once with `flush`; unbuilt ones are simply built later.
   */
  markSectionDirty(x: number, y: number, z: number): void {
    this.dirty.mark(x, y, z);
    if (!this.world.inBounds(x, 0, z)) return;
    const i = x + this.world.sizeX * z;
    const top = this.world.topSolidY(x, z);
    if (this.tops[i] !== top) {
      this.tops[i] = top;
      this.refreshColumnTop(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    }
  }

  /** Rebuilds every marked section and builds every queued one now (tests and tools). */
  flush(): void {
    for (const [cx, sy, cz] of this.dirty.take(Infinity, 0, 0, 0)) {
      if (this.chunks.has(sectionKey(cx, sy, cz))) this.rebuildSection(cx, sy, cz);
    }
    for (let key = this.queue.next(); key !== null; key = this.queue.next()) this.rebuildSection(...parseKey(key));
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
    const first = !this.followed;
    if (first) {
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
    this.cullSections(c, f, pos.x, pos.z);
    if (first) this.buildInFrustum();
    const near = easeNear(this.camera.near, cameraNear(clearance(this.world, c.x, c.y, c.z)), dt);
    if (Math.abs(near - this.camera.near) > 1e-3) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
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

  /**
   * Per frame: rebuilds dug or built sections first (DIRTY_PER_FRAME, nearest first), then at most
   * LAZY_PER_FRAME first builds within LAZY_MS, then draws. `timeSeconds` drives the tile shimmer
   * (a texture repaint only: no section is ever rebuilt for it).
   */
  render(timeSeconds = performance.now() / 1000): void {
    const p = this.smoothEye;
    if (this.dirty.size > 0) {
      for (const [cx, sy, cz] of this.dirty.take(DIRTY_PER_FRAME, p.x, p.y, p.z)) {
        // An unbuilt section is simply built from the current world when its turn comes.
        if (this.chunks.has(sectionKey(cx, sy, cz))) this.rebuildSection(cx, sy, cz);
      }
    }
    if (this.queue.size > 0) {
      const t0 = performance.now();
      for (let i = 0; i < LAZY_PER_FRAME; i++) {
        if (i > 0 && performance.now() - t0 > LAZY_MS) break;
        const key = this.queue.next();
        if (key === null) break;
        this.rebuildSection(...parseKey(key));
      }
    }
    if (this.anyVisibleShimmer() && this.atlas.shimmer(timeSeconds)) this.shimmerRepaints++;
    this.renderer.render(this.scene, this.camera);
  }
}

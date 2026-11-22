import * as THREE from 'three';
import type { World } from '../core/world';
import { createAtlas } from './atlas';
import { CameraRig, clearance } from './cameraRig';
import { castVoxelRay, type VoxelHit } from './voxelRay';
import { DirtySections, sectionKey } from './chunkDirty';
import { cameraZone, CULL_MARGIN, FOG_FAR, radialFactor, SectionQueue, visibleSections, type CameraZone } from './chunkCull';
import { CAMERA_FAR, NEAR_MAX, cameraFar, cameraNear, easeNear, nearMaxFor, setCurrentCameraFar } from './depthPolicy';
import { viewFog } from './viewDistance';
import { caveLook, luminance, OUTDOOR_LOOK, type CaveLook } from './caveLook';

/** The cave look takes about this long to ease in or out as the camera's zone changes. */
const CAVE_EASE_S = 1;
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
/** A new view distance eases the fog and the draw radius over this long (the haze edge slides, never jumps). */
export const VIEW_EASE_S = 1.5;
/** No frame moves the fog end by more than this. */
const VIEW_EASE_MAX_STEP = 8;
/**
 * Memory: a built section farther than the draw reach plus DISPOSE_SLACK is freed after DISPOSE_GRACE_S
 * (a quick regrow does not rebuild), at most DISPOSE_PER_FRAME a frame, farthest first. Over
 * MAX_BUILT_SECTIONS (sections holding geometry) the farthest ones outside the draw set go first.
 * (The plan said "distance + 32"; at Far the draw reach is wider than that, so the slack is added to the reach.)
 */
export const DISPOSE_SLACK = 32;
export const DISPOSE_GRACE_S = 20;
export const DISPOSE_PER_FRAME = 4;
export const MAX_BUILT_SECTIONS = 160;

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
  /** The fog end the draw rule uses: the larger of the eased fog and the target, so new land is built ahead of the haze. */
  private fogEnd = FOG_FAR;
  /** The view distance asked for (Task 10b), and the fog end as it eases toward it. */
  private viewTarget = FOG_FAR;
  private viewEased = FOG_FAR;
  private easeFrom = FOG_FAR;
  private easeT = VIEW_EASE_S;
  /** Fog values the view gives (the cave look and the water override start from these). */
  private readonly viewFogNow = { near: 20, far: FOG_FAR };
  private clock = 0;
  private readonly hemi: THREE.HemisphereLight;
  /** 0 outdoors .. 1 deep: eases toward the camera's zone; drives caveLook. */
  private caveDepth = 0;
  private look: CaveLook = OUTDOOR_LOOK;
  private lookColour = OUTDOOR_LOOK.fogColor;
  /** When each built section was first seen beyond the dispose reach (scene seconds). */
  private readonly farSince = new Map<string, number>();
  private meshed = 0;
  /** Camera pose of the last cull, so a still camera does not recompute the set. */
  private readonly lastCull = { x: NaN, y: NaN, z: NaN, fx: NaN, fy: NaN, fz: NaN, fog: NaN, zone: '', floors: -1, keep: '', shape: '' };
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
    this.hemi = new THREE.HemisphereLight(0xffffff, OUTDOOR_LOOK.groundColor, OUTDOOR_LOOK.hemiIntensity * LIGHT_SCALE);
    this.scene.add(this.hemi);
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
    if (solid || trans) this.meshed++;
    this.queue.markBuilt(key);
    if (geo.hasShimmer) this.shimmerChunks.add(key);
    else this.shimmerChunks.delete(key);
  }

  private disposeSection(key: string): void {
    const old = this.chunks.get(key);
    if (!old) return;
    if (old.solid || old.trans) this.meshed--;
    for (const m of [old.solid, old.trans]) {
      if (!m) continue;
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.chunks.delete(key);
    this.shimmerChunks.delete(key);
    this.farSince.delete(key);
  }

  /** Frees a built section for good (memory); it is built again lazily if the view comes back. */
  private freeSection(key: string): void {
    this.disposeSection(key);
    this.queue.requeue(key);
    if (this.shown?.has(key)) {
      const [cx, sy, cz] = parseKey(key);
      this.queue.enqueue(key, this.priority(cx, sy, cz, this.rig.position, this.rig.forward));
    }
  }

  /**
   * The view distance (fog end in blocks, 40..96) from the controller. The fog and the draw radius ease
   * to it over VIEW_EASE_S; the far plane moves at once to cover the larger of the two.
   */
  setViewDistance(distance: number): void {
    if (!Number.isFinite(distance)) return;
    const d = Math.max(FOG_FAR, Math.min(96, distance));
    if (d === this.viewTarget) return;
    this.viewTarget = d;
    this.easeFrom = this.viewEased;
    this.easeT = 0;
  }

  /** The view distance asked for, the fog end now, and the far plane. */
  view(): { target: number; fogEnd: number; fogNear: number; cameraFar: number; drawFogEnd: number } {
    return { target: this.viewTarget, fogEnd: this.viewEased, fogNear: this.viewFogNow.near, cameraFar: this.camera.far, drawFogEnd: this.fogEnd };
  }

  /** The look now (debug and the brightness checks): fog colour and its luminance, depth factor, fog range. */
  lookNow(): { fogColor: number; luminance: number; depthFactor: number; fogNear: number; fogFar: number; hemiIntensity: number; zone: CameraZone } {
    const l = this.look;
    return {
      fogColor: l.fogColor, luminance: luminance(l.fogColor), depthFactor: this.caveDepth,
      fogNear: l.fogNear, fogFar: l.fogFar, hemiIntensity: l.hemiIntensity, zone: this.zone,
    };
  }

  /** The fog the view distance gives right now (before any cave or water look is laid over it). */
  get viewFogValues(): { near: number; far: number } {
    return this.viewFogNow;
  }

  private updateView(dt: number): void {
    if (this.easeT < VIEW_EASE_S) {
      this.easeT = Math.min(VIEW_EASE_S, this.easeT + Math.max(0, Math.min(0.1, dt)));
      const want = this.easeFrom + (this.viewTarget - this.easeFrom) * (this.easeT / VIEW_EASE_S);
      const step = Math.max(-VIEW_EASE_MAX_STEP, Math.min(VIEW_EASE_MAX_STEP, want - this.viewEased));
      this.viewEased = this.easeT >= VIEW_EASE_S ? this.viewTarget : this.viewEased + step;
    }
    // viewFog's rule (near is half the far), unrounded while it eases so the haze slides smoothly.
    this.viewFogNow.near = this.easeT >= VIEW_EASE_S ? viewFog(this.viewEased).near : this.viewEased / 2;
    this.viewFogNow.far = this.viewEased;
    // The cave look eases in over about a second underground and back out again; it never darkens.
    const want = this.zone === 'underground' ? 1 : 0;
    const step = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)) / CAVE_EASE_S;
    this.caveDepth = want > this.caveDepth ? Math.min(want, this.caveDepth + step) : Math.max(want, this.caveDepth - step);
    const look = caveLook(this.caveDepth, this.viewFogNow);
    this.look = look;
    const f = this.scene.fog as THREE.Fog;
    f.near = look.fogNear;
    f.far = look.fogFar;
    if (this.lookColour !== look.fogColor) {
      this.lookColour = look.fogColor;
      f.color.setHex(look.fogColor);
      (this.scene.background as THREE.Color).setHex(look.background);
      this.hemi.groundColor.setHex(look.groundColor);
      this.hemi.intensity = look.hemiIntensity * LIGHT_SCALE;
    }
    // The draw rule's fog end: outdoors the larger of the view and its target (new land is built before
    // the haze reaches it); underground the cave haze actually drawn (14..36 when deep), so a cave
    // never builds or draws sections hidden in its close bright haze.
    this.fogEnd = this.zone === 'underground' ? look.fogFar : Math.max(this.viewEased, this.viewTarget);
    // The far plane covers the whole ease in one move (to the larger end), not a change every frame.
    const easing = this.easeT < VIEW_EASE_S;
    const far = cameraFar(Math.max(this.viewTarget, easing ? Math.max(this.easeFrom, this.viewEased) : this.viewTarget));
    if (this.camera.far !== far) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
      setCurrentCameraFar(far);
    }
  }

  /** Frees built sections that are far outside the draw reach (after a grace), and keeps the built count under the cap. */
  private disposeFar(): void {
    const c = this.rig.position;
    const reach = (this.fogEnd + CULL_MARGIN) * radialFactor(this.camera.fov, this.camera.aspect) + DISPOSE_SLACK;
    const due: Array<{ key: string; d: number }> = [];
    const outside: Array<{ key: string; d: number }> = [];
    for (const [key, s] of this.chunks) {
      const hx = Math.max(s.cx * CHUNK_SIZE - c.x, 0, c.x - (s.cx + 1) * CHUNK_SIZE);
      const hz = Math.max(s.cz * CHUNK_SIZE - c.z, 0, c.z - (s.cz + 1) * CHUNK_SIZE);
      const d = Math.hypot(hx, hz);
      if (d > reach) {
        const since = this.farSince.get(key);
        if (since === undefined) this.farSince.set(key, this.clock);
        else if (this.clock - since >= DISPOSE_GRACE_S) due.push({ key, d });
      } else {
        this.farSince.delete(key);
      }
      if (this.meshed > MAX_BUILT_SECTIONS && (s.solid || s.trans) && !this.shown?.has(key)) outside.push({ key, d });
    }
    let budget = DISPOSE_PER_FRAME;
    due.sort((a, b) => b.d - a.d);
    for (const { key } of due) {
      if (budget-- <= 0) return;
      this.freeSection(key);
    }
    outside.sort((a, b) => b.d - a.d);
    for (const { key } of outside) {
      if (budget-- <= 0 || this.meshed <= MAX_BUILT_SECTIONS) return;
      if (this.chunks.has(key)) this.freeSection(key);
    }
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
    // The frustum's shape matters too: a resize (portrait to landscape) widens what can be on screen.
    const shape = `${this.camera.aspect},${this.camera.fov}`;
    if (!moved && zone === L.zone && this.fogEnd === L.fog && this.floorsVersion === L.floors && keep === L.keep && shape === L.shape) return;
    Object.assign(L, { x: c.x, y: c.y, z: c.z, fx: f.x, fy: f.y, fz: f.z, fog: this.fogEnd, zone, floors: this.floorsVersion, keep, shape });
    this.zone = zone;
    const set = visibleSections(
      this.world.sizeX, this.world.sizeY, this.world.sizeZ, c.x, c.y, c.z, f.x, f.y, f.z, zone, px, pz, this.fogEnd,
      { floorSection: this.floorSection, radialFactor: radialFactor(this.camera.fov, this.camera.aspect) },
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
    shimmerRepaints: number; chunkBuilds: number; queued: number; dirty: number; zone: CameraZone; fogEnd: number; meshed: number;
  } {
    let visible = 0;
    for (const c of this.chunks.values()) if (c.solid?.visible || c.trans?.visible) visible++;
    const frustumVisible = this.frustumSections();
    return {
      chunks: this.chunks.size, visible, frustumVisible, triangles: this.renderer.info.render.triangles, drawCalls: this.renderer.info.render.calls,
      shimmerRepaints: this.shimmerRepaints, chunkBuilds: this.chunkBuilds, queued: this.queue.size, dirty: this.dirty.size,
      zone: this.zone, fogEnd: this.viewEased, meshed: this.meshed,
    };
  }

  /** Drawn sections (holding geometry) that the camera's frustum sees: the number every section budget counts. */
  frustumSections(): number {
    this.camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    let n = 0;
    for (const c of this.chunks.values()) {
      if ((c.solid?.visible && this.frustum.intersectsObject(c.solid)) || (c.trans?.visible && this.frustum.intersectsObject(c.trans))) n++;
    }
    return n;
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
    if (Number.isFinite(dt) && dt > 0) this.clock += Math.min(dt, 1);
    this.updateView(dt);
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
    if (first) {
      this.buildInFrustum();
      Object.assign(this.disposePose, { x: c.x, z: c.z, fog: this.fogEnd }); // nothing built yet can be far
    }
    const near = easeNear(this.camera.near, cameraNear(clearance(this.world, c.x, c.y, c.z), nearMaxFor(this.viewEased)), dt);
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
    // Only when something can have become far: he moved, the view shrank, a grace is running, or over the cap.
    const dp = this.disposePose, c = this.rig.position;
    const wanted = Math.hypot(c.x - dp.x, c.z - dp.z) > 4 || this.fogEnd < dp.fog || this.farSince.size > 0 || this.meshed > MAX_BUILT_SECTIONS;
    if (this.followed && wanted && this.clock - this.lastDisposeCheck >= 0.25) {
      this.lastDisposeCheck = this.clock;
      dp.x = c.x; dp.z = c.z; dp.fog = this.fogEnd;
      this.disposeFar();
    }
    if (this.anyVisibleShimmer() && this.atlas.shimmer(timeSeconds)) this.shimmerRepaints++;
    this.renderer.render(this.scene, this.camera);
  }

  private lastDisposeCheck = -Infinity;
  /** Where the camera was, and the draw fog end, at the last dispose check (set at the first frame). */
  private readonly disposePose = { x: NaN, z: NaN, fog: -Infinity };
}

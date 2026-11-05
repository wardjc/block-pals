import * as THREE from 'three';
import { BlockId } from '../core/blocks';
import type { World } from '../core/world';
import { createAtlas } from './atlas';
import { buildChunkGeometry, CHUNK_SIZE, type MeshArrays } from './mesher';

const FOLLOW_K = 4; // exponential smoothing rate, per second
const BACK = 6;
const UP = 4.5;
const PICK_RANGE = 40;
const MARKER_SECONDS = 0.9;
// Three r155+ no longer pre-multiplies light intensity by PI, so scale to get the classic bright look.
const LIGHT_SCALE = Math.PI;

interface ChunkMeshes {
  solid: THREE.Mesh;
  trans: THREE.Mesh;
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

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly atlas = createAtlas();

  private readonly chunks = new Map<string, ChunkMeshes>();
  private readonly solidMat: THREE.MeshLambertMaterial;
  private readonly transMat: THREE.MeshLambertMaterial;
  private readonly smoothPos = new THREE.Vector3();
  private smoothHeading = 0;
  private followed = false;
  private readonly raycaster = new THREE.Raycaster();
  private readonly marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private markerAge = Infinity;

  constructor(private readonly host: HTMLElement, private readonly world: World) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x78c6ff);
    this.scene.fog = new THREE.Fog(0x78c6ff, 20, 40);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.0 * LIGHT_SCALE));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6 * LIGHT_SCALE);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 80);

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
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    const geo = buildChunkGeometry(this.world, cx, cz, this.atlas.uvFor);
    const solid = new THREE.Mesh(toGeometry(geo), this.solidMat);
    const trans = new THREE.Mesh(toGeometry(geo.transparent), this.transMat);
    trans.renderOrder = 1;
    this.scene.add(solid, trans);
    this.chunks.set(key, { solid, trans });
  }

  /** Rebuilds the chunk containing the cell, plus the neighbour if the cell is on a chunk edge. */
  rebuildChunkAt(x: number, z: number): void {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    const xs = [cx];
    const zs = [cz];
    if (lx === 0) xs.push(cx - 1);
    if (lx === CHUNK_SIZE - 1) xs.push(cx + 1);
    if (lz === 0) zs.push(cz - 1);
    if (lz === CHUNK_SIZE - 1) zs.push(cz + 1);
    for (const a of xs) for (const b of zs) this.rebuildChunk(a, b);
  }

  triangleCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) {
      n += (c.solid.geometry.index?.count ?? 0) / 3 + (c.trans.geometry.index?.count ?? 0) / 3;
    }
    return n;
  }

  followTarget(pos: THREE.Vector3, heading: number, dt: number): void {
    if (!this.followed) {
      this.smoothPos.copy(pos);
      this.smoothHeading = heading;
      this.followed = true;
    } else {
      const a = 1 - Math.exp(-FOLLOW_K * dt);
      this.smoothPos.lerp(pos, a);
      let d = heading - this.smoothHeading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.smoothHeading += d * a;
    }
    const h = this.smoothHeading;
    this.camera.position.set(
      this.smoothPos.x - Math.sin(h) * BACK,
      this.smoothPos.y + UP,
      this.smoothPos.z - Math.cos(h) * BACK,
    );
    this.camera.lookAt(this.smoothPos.x, this.smoothPos.y + 1, this.smoothPos.z);
  }

  pick(clientX: number, clientY: number): { cell: [number, number, number]; normal: [number, number, number] } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    const w = this.world;

    let x = Math.floor(o.x);
    let y = Math.floor(o.y);
    let z = Math.floor(o.z);
    const stepX = d.x > 0 ? 1 : -1;
    const stepY = d.y > 0 ? 1 : -1;
    const stepZ = d.z > 0 ? 1 : -1;
    const tDeltaX = d.x === 0 ? Infinity : Math.abs(1 / d.x);
    const tDeltaY = d.y === 0 ? Infinity : Math.abs(1 / d.y);
    const tDeltaZ = d.z === 0 ? Infinity : Math.abs(1 / d.z);
    let tMaxX = d.x === 0 ? Infinity : (d.x > 0 ? x + 1 - o.x : o.x - x) * tDeltaX;
    let tMaxY = d.y === 0 ? Infinity : (d.y > 0 ? y + 1 - o.y : o.y - y) * tDeltaY;
    let tMaxZ = d.z === 0 ? Infinity : (d.z > 0 ? z + 1 - o.z : o.z - z) * tDeltaZ;
    let normal: [number, number, number] = [0, 0, 0];

    for (let i = 0; i < PICK_RANGE * 3; i++) {
      if (w.inBounds(x, y, z)) {
        const id = w.get(x, y, z);
        if (id !== BlockId.Air && id !== BlockId.Water && (normal[0] || normal[1] || normal[2])) {
          return { cell: [x, y, z], normal };
        }
      }
      let t: number;
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX; x += stepX; tMaxX += tDeltaX; normal = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        t = tMaxY; y += stepY; tMaxY += tDeltaY; normal = [0, -stepY, 0];
      } else {
        t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; normal = [0, 0, -stepZ];
      }
      if (t > PICK_RANGE) break;
    }
    return null;
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

  add(obj: THREE.Object3D): void {
    this.scene.add(obj);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

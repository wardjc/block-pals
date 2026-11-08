import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VillagerId } from '../content/villagers';
import type { HouseInfo } from '../core/houses';
import { EMBLEM_SIZE, emblemPlacement } from './emblem';

// Both models stand with their feet at y = 0 and face +z (heading 0).

// One unit box and one material per colour, shared by every character (scale instead of new geometry).
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map<number, THREE.MeshLambertMaterial>();
function material(colour: number): THREE.MeshLambertMaterial {
  let m = materials.get(colour);
  if (!m) { m = new THREE.MeshLambertMaterial({ color: colour }); materials.set(colour, m); }
  return m;
}

function box(
  w: number, h: number, d: number, colour: number,
  x: number, y: number, z: number, parent: THREE.Object3D,
): THREE.Mesh {
  const m = new THREE.Mesh(UNIT_BOX, material(colour));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** A blocky child in bright clothes: teal top, navy trousers, brown hair. */
export function makePlayerModel(): THREE.Group {
  const g = new THREE.Group();
  const skin = 0xf2c9a0;
  // No two boxes may share a flat face (the GPU flickers between them): shoes poke out past the leg on every side
  // and the leg stops 0.05 short of the floor, inside the shoe. test: tests/render/zfight.test.ts
  // legs (pivot groups at the hips: they swing when he walks)
  const legL = new THREE.Group();
  legL.position.set(-0.13, 0.5, 0);
  box(0.24, 0.45, 0.26, 0x1f2f6b, 0, -0.225, 0, legL);
  box(0.26, 0.1, 0.32, 0xffffff, 0, -0.45, 0.025, legL);
  const legR = legL.clone();
  legR.position.x = 0.13;
  g.add(legL, legR);
  // torso
  box(0.54, 0.6, 0.3, 0x14b8a6, 0, 0.8, 0, g);
  box(0.56, 0.08, 0.31, 0xffd23f, 0, 0.55, 0, g); // yellow belt stripe
  box(0.26, 0.36, 0.26, skin, 0, 1.27, 0, g); // neck (1.09..1.45: overlaps shirt top 1.10 and head base 1.4)
  // arms: pivot groups at the shoulders; hands are a hair wider than the sleeves; arms sink 0.01 into the torso
  const armL = new THREE.Group();
  armL.position.set(-0.36, 1.05, 0);
  box(0.2, 0.55, 0.22, 0x14b8a6, 0, -0.18, 0, armL);
  box(0.22, 0.16, 0.24, skin, 0, -0.5, 0, armL);
  const armR = armL.clone();
  armR.position.x = 0.36;
  g.add(armL, armR);
  // head
  const head = new THREE.Group();
  head.position.set(0, 1.4, 0);
  box(0.5, 0.5, 0.5, skin, 0, 0.25, 0, head);
  box(0.54, 0.14, 0.54, 0x5a3a1e, 0, 0.53, -0.01, head); // hair top
  box(0.54, 0.38, 0.12, 0x5a3a1e, 0, 0.29, -0.22, head); // hair back
  box(0.1, 0.14, 0.04, 0x222222, -0.12, 0.28, 0.26, head); // eyes
  box(0.1, 0.14, 0.04, 0x222222, 0.12, 0.28, 0.26, head);
  box(0.16, 0.04, 0.04, 0xd9534f, 0, 0.11, 0.26, head); // smile
  g.add(head);
  g.userData = { legL, legR, armL, armR, head };
  return g;
}

// ---------------------------------------------------------------------------------------------
// Walking. Limbs swing on their pivots; the cycle advances with DISTANCE walked, so the steps match the ground.
// ---------------------------------------------------------------------------------------------

/** Player ground speed (blocks per second); at this speed he takes 2 steps per second (one full cycle per second). */
export const WALK_SPEED = 3.5;
const WALK_CYCLE_BLOCKS = WALK_SPEED; // distance for one full cycle (two steps)
const LEG_SWING = 0.55;
const ARM_SWING = 0.5;
const BODY_BOB = 0.03;
/** Time constant of the ease in/out: about 95 % of the way after 0.15 s. */
const WALK_EASE_RATE = 20;
/** More than this many times the walking speed in one frame is a teleport, not a walk. */
const TELEPORT_FACTOR = 3;

export interface WalkPose { armL: number; armR: number; legL: number; legR: number; bob: number }
export interface WalkState { phase: number; amp: number }
export const makeWalkState = (): WalkState => ({ phase: 0, amp: 0 });

/**
 * Limb angles (radians about x) for a gait phase (radians, one full cycle = 2 pi) at speed01 (0..1).
 * Left arm swings with the right leg. The body bobs up on each step (feet never sink into the floor), <= 0.03.
 * Writes into `out` (no allocation).
 */
export function walkPose(phase: number, speed01: number, out: WalkPose): WalkPose {
  const s = Math.min(1, Math.max(0, speed01));
  const sw = Math.sin(phase) * s;
  out.legL = sw * LEG_SWING + 0;
  out.legR = 0 - sw * LEG_SWING;
  out.armL = 0 - sw * ARM_SWING; // the same direction as the RIGHT leg
  out.armR = sw * ARM_SWING + 0;
  out.bob = s * BODY_BOB * (1 - Math.cos(2 * phase)) / 2;
  return out;
}

const POSE: WalkPose = { armL: 0, armR: 0, legL: 0, legR: 0, bob: 0 };

/** Advances the gait by the distance walked and eases the swing in and out. Returns false while fully at rest. */
function advance(st: WalkState, dt: number, dist: number, cycleBlocks: number, refSpeed: number): void {
  if (!(dt > 0)) return;
  const speed = dist / dt;
  const moving = speed > 0.05 && speed < refSpeed * TELEPORT_FACTOR;
  if (moving) st.phase = (st.phase + (dist / cycleBlocks) * Math.PI * 2) % (Math.PI * 2);
  const target = moving ? Math.min(1, speed / refSpeed) : 0;
  st.amp += (target - st.amp) * (1 - Math.exp(-dt * WALK_EASE_RATE));
  if (st.amp < 1e-3 && target === 0) st.amp = 0;
}

/**
 * Swings the player's pivots for this frame. `dist` is the horizontal distance he actually moved this frame
 * (0 when stopped, blocked or paused). Call after the model's position is set: the bob is added to position.y.
 */
export function animatePlayerWalk(model: THREE.Group, st: WalkState, dt: number, dist: number): void {
  advance(st, dt, dist, WALK_CYCLE_BLOCKS, WALK_SPEED);
  const u = model.userData as { legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D };
  const p = walkPose(st.phase, st.amp, POSE);
  u.legL.rotation.x = p.legL; u.legR.rotation.x = p.legR;
  u.armL.rotation.x = p.armL; u.armR.rotation.x = p.armR;
  model.position.y += p.bob;
}

const PAL_SPEED = 4.5;
const PAL_SWING = 0.45;
/** Pip's quicker, subtler trot: a diagonal pair at a time (front-left with back-right). Legs are model.userData.legs. */
export function animatePalTrot(model: THREE.Group, st: WalkState, dt: number, dist: number): void {
  advance(st, dt, dist, 1.6, PAL_SPEED);
  const legs = model.userData.legs as THREE.Object3D[];
  const sw = Math.sin(st.phase) * st.amp * PAL_SWING;
  // order: back-left, front-left, back-right, front-right
  legs[0].rotation.x = -sw; legs[1].rotation.x = sw; legs[2].rotation.x = sw; legs[3].rotation.x = -sw;
}

/** Pip: a blocky orange fox with a white chest, big friendly eyes, pointy ears and a bushy white-tipped tail. */
export function makePalModel(): THREE.Group {
  const g = new THREE.Group();
  const orange = 0xf27a1a;
  const white = 0xfff6ea;
  const dark = 0x3a2a20;
  // body
  box(0.5, 0.42, 0.8, orange, 0, 0.45, 0, g);
  box(0.36, 0.3, 0.06, white, 0, 0.45, 0.4, g); // white chest
  // legs with dark socks, each on a pivot at the hip (inside the body) so the four can trot
  const legs: THREE.Group[] = [];
  for (const sx of [-0.15, 0.15]) {
    for (const sz of [-0.28, 0.28]) {
      const leg = new THREE.Group();
      leg.position.set(sx, 0.34, sz);
      box(0.16, 0.24, 0.16, orange, 0, -0.14, 0, leg);
      box(0.17, 0.1, 0.17, dark, 0, -0.29, 0, leg);
      g.add(leg);
      legs.push(leg);
    }
  }
  // head
  const head = new THREE.Group();
  head.position.set(0, 0.75, 0.42);
  box(0.58, 0.5, 0.5, orange, 0, 0.1, 0.1, head);
  box(0.32, 0.2, 0.16, white, 0, -0.02, 0.4, head); // muzzle
  box(0.1, 0.08, 0.06, dark, 0, 0.06, 0.49, head); // nose
  // big eyes
  for (const sx of [-0.15, 0.15]) {
    box(0.17, 0.2, 0.04, 0xffffff, sx, 0.2, 0.36, head);
    box(0.09, 0.12, 0.05, dark, sx, 0.19, 0.38, head);
    box(0.03, 0.04, 0.05, 0xffffff, sx + 0.02, 0.24, 0.4, head);
  }
  // pointy ears
  for (const sx of [-0.2, 0.2]) {
    const ear = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.32, 4),
      new THREE.MeshLambertMaterial({ color: orange }),
    );
    ear.position.set(sx, 0.5, 0.06);
    ear.rotation.y = Math.PI / 4;
    head.add(ear);
    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.2, 4),
      new THREE.MeshLambertMaterial({ color: 0xffc9a0 }),
    );
    inner.position.set(sx, 0.47, 0.12);
    inner.rotation.y = Math.PI / 4;
    head.add(inner);
  }
  g.add(head);
  // bushy tail with a white tip
  const tail = new THREE.Group();
  tail.position.set(0, 0.6, -0.4);
  tail.rotation.x = 0.7;
  box(0.28, 0.28, 0.5, orange, 0, 0, -0.25, tail);
  box(0.3, 0.3, 0.2, white, 0, 0, -0.58, tail);
  g.add(tail);
  g.userData = { head, tail, legs };
  return g;
}

// ---------------------------------------------------------------------------------------------
// Villagers: original blocky neighbours, one funny feature each. Same box style as the player.
// Big friendly eyes and a smile on every face; nothing pointy, nothing dark.
// ---------------------------------------------------------------------------------------------

interface PersonLook {
  skin: number; shirt: number; trousers: number; shoes: number;
  /** Torso width: Bramble and Pebble are broader. */
  width: number;
  /** Long skirt instead of legs (Granny). */
  skirt?: number;
}

/** Legs, torso, arms and a smiling face; returns the group and its head (origin at the neck, y 1.4). */
function person(look: PersonLook): { g: THREE.Group; head: THREE.Group; armR: THREE.Group } {
  const g = new THREE.Group();
  const w = look.width;
  if (look.skirt !== undefined) {
    box(w + 0.1, 0.55, 0.42, look.skirt, 0, 0.3, 0, g);
    box(w + 0.16, 0.08, 0.46, 0xffffff, 0, 0.04, 0, g); // frilly hem
  } else {
    for (const sx of [-0.13, 0.13]) {
      box(0.24, 0.48, 0.26, look.trousers, sx, 0.28, 0, g); // stops short of the floor, inside the shoe
      box(0.26, 0.1, 0.33, look.shoes, sx, 0.05, 0.025, g);
    }
  }
  box(w, 0.62, 0.34, look.shirt, 0, 0.82, 0, g);
  box(0.26, 0.3, 0.26, look.skin, 0, 1.27, 0, g); // neck: joins the head to the shoulders
  const armL = new THREE.Group();
  armL.position.set(-(w / 2 + 0.1), 1.08, 0);
  box(0.2, 0.55, 0.22, look.shirt, 0, -0.18, 0, armL);
  box(0.22, 0.16, 0.24, look.skin, 0, -0.5, 0, armL);
  const armR = armL.clone();
  armR.position.x = w / 2 + 0.1;
  g.add(armL, armR);
  const head = new THREE.Group();
  head.position.set(0, 1.4, 0);
  box(0.52, 0.5, 0.5, look.skin, 0, 0.25, 0, head);
  for (const sx of [-0.12, 0.12]) { // big friendly eyes
    box(0.13, 0.15, 0.04, 0xffffff, sx, 0.3, 0.26, head);
    box(0.07, 0.1, 0.05, 0x2a2a2a, sx, 0.29, 0.28, head);
  }
  box(0.2, 0.05, 0.04, 0xd9534f, 0, 0.1, 0.26, head); // smile
  box(0.08, 0.06, 0.04, 0xe8a07a, 0, 0.2, 0.27, head); // nose
  for (const sx of [-0.15, 0.15]) box(0.1, 0.06, 0.03, 0xf4a0a0, sx, 0.15, 0.26, head); // rosy cheeks
  g.add(head);
  return { g, head, armR };
}

function bramble(): THREE.Group {
  const { g, head } = person({ skin: 0xf0b890, shirt: 0xffffff, trousers: 0xc9a27a, shoes: 0x8a5a3a, width: 0.72 });
  box(0.74, 0.46, 0.38, 0xff9fb8, 0, 0.7, 0.01, g); // pink apron
  box(0.5, 0.07, 0.42, 0xff6f91, 0, 0.94, 0.02, g); // apron tie
  box(0.12, 0.1, 0.04, 0xffffff, 0, 0.19, 0.28, head); // flour puff on the nose
  box(0.07, 0.07, 0.04, 0xffffff, 0.1, 0.24, 0.27, head);
  // The tall floury hat sits on a pivot so it can wobble.
  const hat = new THREE.Group();
  hat.position.set(0, 0.5, 0);
  box(0.56, 0.14, 0.56, 0xffffff, 0, 0.07, 0, hat);
  box(0.46, 0.52, 0.46, 0xfdfdfd, 0, 0.4, 0, hat);
  box(0.6, 0.2, 0.6, 0xffffff, 0, 0.75, 0, hat);
  box(0.12, 0.08, 0.04, 0xe8e8e8, -0.14, 0.78, 0.31, hat); // flour smudge
  head.add(hat);
  g.userData = { head, hat };
  return g;
}

function pebble(): THREE.Group {
  const { g, head, armR } = person({ skin: 0xe9b48c, shirt: 0x4a80d4, trousers: 0x6b4f33, shoes: 0x3a2a20, width: 0.78 });
  box(0.8, 0.1, 0.36, 0xf5c542, 0, 0.57, 0, g); // wide yellow belt
  box(0.14, 0.12, 0.04, 0xfff08a, 0, 0.55, 0.19, g); // buckle
  // Orange helmet with a lamp on the front.
  box(0.6, 0.2, 0.6, 0xff8a1f, 0, 0.58, 0, head);
  box(0.66, 0.06, 0.66, 0xf37a10, 0, 0.5, 0, head);
  box(0.16, 0.12, 0.08, 0xfff08a, 0, 0.6, 0.33, head);
  // A moustache wider than his head, with curled ends.
  box(1.0, 0.14, 0.08, 0xcfcfcf, 0, 0.14, 0.3, head);
  box(0.16, 0.2, 0.08, 0xcfcfcf, -0.52, 0.2, 0.3, head);
  box(0.16, 0.2, 0.08, 0xcfcfcf, 0.52, 0.2, 0.3, head);
  box(0.4, 0.07, 0.07, 0xb8b8b8, 0, 0.08, 0.31, head);
  // A tiny pickaxe in his right hand.
  const pick = new THREE.Group();
  pick.position.set(0, -0.5, 0.18);
  box(0.05, 0.4, 0.05, 0x8a5a2b, 0, 0.1, 0, pick);
  box(0.3, 0.07, 0.07, 0x9aa6b2, 0, 0.3, 0, pick);
  box(0.07, 0.12, 0.09, 0x7f8c99, 0.17, 0.26, 0, pick);
  box(0.07, 0.12, 0.09, 0x7f8c99, -0.17, 0.26, 0, pick);
  armR.add(pick);
  g.userData = { head };
  return g;
}

function fern(): THREE.Group {
  const { g, head } = person({ skin: 0xf2c9a0, shirt: 0xffe27a, trousers: 0x3fae5a, shoes: 0x6b4423, width: 0.56 });
  box(0.5, 0.36, 0.38, 0x3fae5a, 0, 0.8, 0.01, g); // overalls bib
  for (const sx of [-0.18, 0.18]) box(0.08, 0.3, 0.38, 0x3fae5a, sx, 1.0, 0.01, g); // straps
  box(0.1, 0.1, 0.04, 0xffd23f, 0, 0.8, 0.2, g); // pocket button
  for (const sx of [-0.3, 0.3]) { // plaits
    box(0.1, 0.34, 0.1, 0xc2661a, sx, 0.1, -0.05, head);
    box(0.12, 0.08, 0.12, 0xff6f91, sx, -0.1, -0.05, head);
  }
  box(0.54, 0.34, 0.12, 0xc2661a, 0, 0.35, -0.22, head); // hair at the back
  // Sunhat with a carrot tucked in the band.
  box(0.98, 0.06, 0.98, 0xf0d37a, 0, 0.54, 0, head);
  box(0.54, 0.22, 0.54, 0xf0d37a, 0, 0.66, 0, head);
  box(0.56, 0.07, 0.56, 0xe5484d, 0, 0.58, 0, head);
  const carrot = new THREE.Group();
  carrot.position.set(0.24, 0.62, 0.3);
  carrot.rotation.z = -0.5;
  box(0.16, 0.4, 0.16, 0xff8a1f, 0, 0.12, 0, carrot);
  box(0.09, 0.2, 0.09, 0xff8a1f, 0, -0.18, 0, carrot);
  box(0.16, 0.16, 0.1, 0x3fae5a, -0.05, 0.42, 0, carrot);
  box(0.12, 0.18, 0.08, 0x56c46f, 0.07, 0.44, 0, carrot);
  head.add(carrot);
  g.userData = { head };
  return g;
}

const RIM_GEOMETRY = new THREE.TorusGeometry(0.11, 0.02, 6, 14);

function willow(): THREE.Group {
  const { g, head } = person({ skin: 0xf0c4a0, shirt: 0xb48be0, trousers: 0xb48be0, shoes: 0x8a5a3a, width: 0.6, skirt: 0x8f6bc7 });
  box(0.76, 0.14, 0.46, 0xcdb4f0, 0, 1.08, 0, g); // lilac shawl over the shoulders
  box(0.5, 0.14, 0.4, 0xcdb4f0, 0, 0.98, 0.05, g);
  // Grey hair in a bun.
  box(0.56, 0.12, 0.56, 0xe3e3ea, 0, 0.55, -0.01, head);
  box(0.56, 0.34, 0.12, 0xe3e3ea, 0, 0.31, -0.22, head);
  box(0.26, 0.22, 0.26, 0xe3e3ea, 0, 0.7, -0.08, head);
  // Round glasses.
  const rim = material(0xd2569a);
  for (const sx of [-0.12, 0.12]) {
    const ring = new THREE.Mesh(RIM_GEOMETRY, rim);
    ring.position.set(sx, 0.3, 0.29);
    head.add(ring);
  }
  box(0.1, 0.025, 0.03, 0xd2569a, 0, 0.32, 0.29, head);
  // The very long knitted scarf: round the neck, then trailing down and along the floor.
  const stripe = [0xe5484d, 0xffd23f];
  const hang = new THREE.Group();
  box(0.62, 0.16, 0.42, stripe[0], 0, 1.35, 0, hang);
  // Hanging down her front, hugging the skirt and shawl (z 0.17..0.33 overlaps the body), then along the floor.
  for (let i = 0; i < 5; i++) box(0.17, 0.24, 0.16, stripe[i % 2], 0.16, 1.18 - i * 0.24, 0.25, hang);
  box(0.17, 0.08, 0.4, stripe[1], 0.16, 0.06, 0.45, hang); // lies on the floor, joined to the lowest hanging piece
  box(0.17, 0.08, 0.3, stripe[0], 0.16, 0.06, 0.8, hang);
  box(0.2, 0.08, 0.12, 0xffffff, 0.16, 0.06, 1.01, hang); // fringe
  g.add(hang);
  g.userData = { head, hang };
  return g;
}

/** One shared material for every merged villager part: each box's colour is baked into the vertices. */
const VERTEX_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true });

/**
 * Merges everything under `root` into ONE mesh (one draw call), except the subtrees in `pivots`,
 * which stay separate so they can still animate (they are merged on their own). Box colours are
 * baked into vertex colours so the whole villager shares a single material.
 */
function mergeStatic(root: THREE.Object3D, pivots: THREE.Object3D[]): void {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: THREE.BufferGeometry[] = [];
  const meshes: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D): void => {
    for (const child of o.children) {
      if (pivots.includes(child)) continue;
      if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh);
      visit(child);
    }
  };
  visit(root);
  for (const m of meshes) {
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, m.matrixWorld));
    const c = (m.material as THREE.MeshLambertMaterial).color;
    const n = g.attributes.position.count;
    const colours = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { colours[i * 3] = c.r; colours[i * 3 + 1] = c.g; colours[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    parts.push(g);
    m.removeFromParent();
  }
  if (parts.length === 0) return;
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (merged) root.add(new THREE.Mesh(merged, VERTEX_MATERIAL));
}

/** A villager as separate boxes, before merging (kept for tests that check the parts fit together). */
export function makeVillagerParts(id: VillagerId): THREE.Group {
  return { bramble, pebble, fern, willow }[id]();
}

/** A neighbour: feet at y = 0, faces +z, about 1.9 blocks tall like the player. Boxes only, bright colours. */
export function makeVillagerModel(id: VillagerId): THREE.Group {
  const g = makeVillagerParts(id);
  // Static boxes become one mesh per animatable part (body, head, and Bramble's hat): about 3 draw calls, not ~40.
  const head = g.userData.head as THREE.Object3D;
  const hat = g.userData.hat as THREE.Object3D | undefined;
  mergeStatic(g, [head]);
  mergeStatic(head, hat ? [hat] : []);
  if (hat) mergeStatic(hat, []);
  g.userData.phase = ({ bramble: 0, pebble: 1.7, fern: 3.1, willow: 4.6 })[id];
  return g;
}

/** Gentle idle: a slow breathing bob, a head tilt and (Bramble) the wobbling hat. Render loop only. */
export function idleVillager(g: THREE.Group, seconds: number): void {
  const phase = (g.userData.phase as number) ?? 0;
  const t = seconds + phase;
  g.scale.y = 1 + Math.sin(t * 2) * 0.012;
  const head = g.userData.head as THREE.Object3D | undefined;
  if (head) head.rotation.z = Math.sin(t * 1.1) * 0.05;
  const hat = g.userData.hat as THREE.Object3D | undefined;
  if (hat) hat.rotation.z = Math.sin(t * 2.6) * 0.16;
}

const EMBLEM_QUAD = new THREE.PlaneGeometry(1, 1);

/**
 * A picture sign: an emoji on a soft white disc, a flat square fixed to the wall over each door (see
 * render/emblem.ts for where). It faces straight out of the wall, depth-tested and depth-written with a cut-out
 * edge so it never z-fights or shows through the wall.
 */
export function makeEmblem(emoji: string): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d');
  if (c) {
    c.fillStyle = 'rgba(255,255,255,0.97)';
    c.beginPath();
    c.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = '#ffd23f';
    c.stroke();
    c.font = '80px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(emoji, size / 2, size / 2 + 6);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(EMBLEM_QUAD, new THREE.MeshBasicMaterial({
    map, alphaTest: 0.4, depthTest: true, depthWrite: true, toneMapped: false,
  }));
  mesh.scale.set(EMBLEM_SIZE, EMBLEM_SIZE, 1);
  return mesh;
}

/** Puts a sign where emblemPlacement says, facing out of the door wall. */
export function placeEmblem(sign: THREE.Object3D, house: HouseInfo): void {
  const p = emblemPlacement(house);
  sign.position.set(p.x, p.y, p.z);
  sign.rotation.y = Math.atan2(p.nx, p.nz);
}

/** Frees an emblem's own texture and material (its geometry is the shared quad). */
export function disposeEmblem(sign: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>): void {
  sign.material.map?.dispose();
  sign.material.dispose();
  sign.removeFromParent();
}

/** Frees a villager's own merged geometries; the shared unit box, rim and materials stay for the next one. */
export function disposeVillager(g: THREE.Object3D): void {
  g.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === VERTEX_MATERIAL) m.geometry.dispose();
  });
  g.removeFromParent();
}

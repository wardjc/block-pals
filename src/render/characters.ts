import * as THREE from 'three';
import type { VillagerId } from '../content/villagers';

// Both models stand with their feet at y = 0 and face +z (heading 0).

function box(
  w: number, h: number, d: number, colour: number,
  x: number, y: number, z: number, parent: THREE.Object3D,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: colour }));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** A blocky child in bright clothes: teal top, navy trousers, brown hair. */
export function makePlayerModel(): THREE.Group {
  const g = new THREE.Group();
  const skin = 0xf2c9a0;
  // legs (pivot groups so they can swing later)
  const legL = new THREE.Group();
  legL.position.set(-0.13, 0.5, 0);
  box(0.24, 0.5, 0.26, 0x1f2f6b, 0, -0.25, 0, legL);
  box(0.26, 0.1, 0.3, 0xffffff, 0, -0.45, 0.02, legL);
  const legR = legL.clone();
  legR.position.x = 0.13;
  g.add(legL, legR);
  // torso
  box(0.54, 0.6, 0.3, 0x14b8a6, 0, 0.8, 0, g);
  box(0.54, 0.08, 0.31, 0xffd23f, 0, 0.55, 0, g); // yellow belt stripe
  // arms
  const armL = new THREE.Group();
  armL.position.set(-0.4, 1.05, 0);
  box(0.2, 0.55, 0.22, 0x14b8a6, 0, -0.18, 0, armL);
  box(0.2, 0.16, 0.22, skin, 0, -0.5, 0, armL);
  const armR = armL.clone();
  armR.position.x = 0.4;
  g.add(armL, armR);
  // head
  const head = new THREE.Group();
  head.position.set(0, 1.4, 0);
  box(0.5, 0.5, 0.5, skin, 0, 0.25, 0, head);
  box(0.54, 0.14, 0.54, 0x5a3a1e, 0, 0.53, -0.01, head); // hair top
  box(0.54, 0.4, 0.12, 0x5a3a1e, 0, 0.3, -0.22, head); // hair back
  box(0.1, 0.14, 0.04, 0x222222, -0.12, 0.28, 0.26, head); // eyes
  box(0.1, 0.14, 0.04, 0x222222, 0.12, 0.28, 0.26, head);
  box(0.16, 0.04, 0.04, 0xd9534f, 0, 0.11, 0.26, head); // smile
  g.add(head);
  g.userData = { legL, legR, armL, armR, head };
  return g;
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
  // legs with dark socks
  for (const sx of [-0.15, 0.15]) {
    for (const sz of [-0.28, 0.28]) {
      box(0.16, 0.24, 0.16, orange, sx, 0.2, sz, g);
      box(0.17, 0.1, 0.17, dark, sx, 0.05, sz, g);
    }
  }
  // head
  const head = new THREE.Group();
  head.position.set(0, 0.75, 0.42);
  box(0.58, 0.5, 0.5, orange, 0, 0.1, 0.1, head);
  box(0.32, 0.2, 0.16, white, 0, -0.02, 0.4, head); // muzzle
  box(0.1, 0.08, 0.06, dark, 0, 0.04, 0.49, head); // nose
  // big eyes
  for (const sx of [-0.15, 0.15]) {
    box(0.17, 0.2, 0.04, 0xffffff, sx, 0.2, 0.36, head);
    box(0.09, 0.12, 0.05, dark, sx, 0.19, 0.38, head);
    box(0.03, 0.04, 0.05, 0xffffff, sx + 0.02, 0.23, 0.4, head);
  }
  // pointy ears
  for (const sx of [-0.2, 0.2]) {
    const ear = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.32, 4),
      new THREE.MeshLambertMaterial({ color: orange }),
    );
    ear.position.set(sx, 0.52, 0.06);
    ear.rotation.y = Math.PI / 4;
    head.add(ear);
    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.06, 0.2, 4),
      new THREE.MeshLambertMaterial({ color: 0xffc9a0 }),
    );
    inner.position.set(sx, 0.48, 0.12);
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
  g.userData = { head, tail };
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
      box(0.24, 0.5, 0.26, look.trousers, sx, 0.25, 0, g);
      box(0.26, 0.1, 0.32, look.shoes, sx, 0.05, 0.03, g);
    }
  }
  box(w, 0.62, 0.34, look.shirt, 0, 0.82, 0, g);
  const armL = new THREE.Group();
  armL.position.set(-(w / 2 + 0.1), 1.08, 0);
  box(0.2, 0.55, 0.22, look.shirt, 0, -0.18, 0, armL);
  box(0.2, 0.16, 0.22, look.skin, 0, -0.5, 0, armL);
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
  box(0.74, 0.46, 0.36, 0xff9fb8, 0, 0.7, 0.01, g); // pink apron
  box(0.5, 0.07, 0.38, 0xff6f91, 0, 0.94, 0.02, g); // apron tie
  box(0.12, 0.1, 0.04, 0xffffff, 0, 0.19, 0.28, head); // flour puff on the nose
  box(0.07, 0.07, 0.04, 0xffffff, 0.1, 0.24, 0.27, head);
  // The tall floury hat sits on a pivot so it can wobble.
  const hat = new THREE.Group();
  hat.position.set(0, 0.5, 0);
  box(0.56, 0.14, 0.56, 0xffffff, 0, 0.07, 0, hat);
  box(0.46, 0.5, 0.46, 0xfdfdfd, 0, 0.4, 0, hat);
  box(0.6, 0.2, 0.6, 0xffffff, 0, 0.75, 0, hat);
  box(0.12, 0.08, 0.04, 0xe8e8e8, -0.14, 0.78, 0.31, hat); // flour smudge
  head.add(hat);
  g.userData = { head, hat };
  return g;
}

function pebble(): THREE.Group {
  const { g, head, armR } = person({ skin: 0xe9b48c, shirt: 0x4a80d4, trousers: 0x6b4f33, shoes: 0x3a2a20, width: 0.78 });
  box(0.8, 0.1, 0.36, 0xf5c542, 0, 0.55, 0, g); // wide yellow belt
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
  box(0.07, 0.12, 0.07, 0x7f8c99, 0.17, 0.26, 0, pick);
  box(0.07, 0.12, 0.07, 0x7f8c99, -0.17, 0.26, 0, pick);
  armR.add(pick);
  g.userData = { head };
  return g;
}

function fern(): THREE.Group {
  const { g, head } = person({ skin: 0xf2c9a0, shirt: 0xffe27a, trousers: 0x3fae5a, shoes: 0x6b4423, width: 0.56 });
  box(0.5, 0.36, 0.36, 0x3fae5a, 0, 0.8, 0.01, g); // overalls bib
  for (const sx of [-0.18, 0.18]) box(0.08, 0.3, 0.36, 0x3fae5a, sx, 1.0, 0.01, g); // straps
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

function willow(): THREE.Group {
  const { g, head } = person({ skin: 0xf0c4a0, shirt: 0xb48be0, trousers: 0xb48be0, shoes: 0x8a5a3a, width: 0.6, skirt: 0x8f6bc7 });
  box(0.76, 0.14, 0.46, 0xcdb4f0, 0, 1.08, 0, g); // lilac shawl over the shoulders
  box(0.5, 0.14, 0.4, 0xcdb4f0, 0, 0.98, 0.05, g);
  // Grey hair in a bun.
  box(0.56, 0.12, 0.56, 0xe3e3ea, 0, 0.55, -0.01, head);
  box(0.56, 0.36, 0.12, 0xe3e3ea, 0, 0.32, -0.22, head);
  box(0.26, 0.22, 0.26, 0xe3e3ea, 0, 0.7, -0.08, head);
  // Round glasses.
  const rim = new THREE.MeshLambertMaterial({ color: 0xd2569a });
  for (const sx of [-0.12, 0.12]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 6, 14), rim);
    ring.position.set(sx, 0.3, 0.29);
    head.add(ring);
  }
  box(0.1, 0.025, 0.03, 0xd2569a, 0, 0.32, 0.29, head);
  // The very long knitted scarf: round the neck, then trailing down and along the floor.
  const stripe = [0xe5484d, 0xffd23f];
  box(0.62, 0.16, 0.42, stripe[0], 0, 1.34, 0, g);
  const hang = new THREE.Group();
  for (let i = 0; i < 5; i++) box(0.17, 0.2, 0.1, stripe[i % 2], 0.16, 1.2 - i * 0.2, 0.24, hang);
  box(0.17, 0.08, 0.3, stripe[1], 0.16, 0.06, 0.4, hang);
  box(0.17, 0.08, 0.3, stripe[0], 0.16, 0.06, 0.7, hang);
  box(0.2, 0.08, 0.12, 0xffffff, 0.16, 0.06, 0.9, hang); // fringe
  g.add(hang);
  g.userData = { head, hang };
  return g;
}

/** A neighbour: feet at y = 0, faces +z, about 1.9 blocks tall like the player. Boxes only, bright colours. */
export function makeVillagerModel(id: VillagerId): THREE.Group {
  const g = { bramble, pebble, fern, willow }[id]();
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

/** A picture sign: an emoji on a soft white disc, always facing the camera. Over each door, so nobody has to read. */
export function makeEmblem(emoji: string): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d');
  if (c) {
    c.fillStyle = 'rgba(255,255,255,0.92)';
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: true, depthWrite: false }));
  sprite.scale.set(1.5, 1.5, 1);
  return sprite;
}

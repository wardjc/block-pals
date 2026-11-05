import * as THREE from 'three';

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

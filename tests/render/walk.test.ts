// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  animatePlayerWalk, animatePalTrot, makePalModel, makePlayerModel, makeWalkState, walkPose, WALK_SPEED,
  type WalkPose,
} from '../../src/render/characters';

const pose = (phase: number, s: number): WalkPose => ({ ...walkPose(phase, s, { armL: 0, armR: 0, legL: 0, legR: 0, bob: 0 }) });

describe('walkPose', () => {
  it('is neutral when standing still, whatever the phase', () => {
    for (const ph of [0, 1, 2.5, 5]) expect(pose(ph, 0)).toEqual({ armL: 0, armR: 0, legL: 0, legR: 0, bob: 0 });
  });
  it('swings arms against legs and left against right', () => {
    const p = pose(Math.PI / 2, 1);
    expect(p.legL).toBeCloseTo(-p.legR);
    expect(p.armL).toBeCloseTo(-p.armR);
    expect(Math.sign(p.armL)).toBe(-Math.sign(p.legL)); // left arm with right leg
    expect(Math.abs(p.legL)).toBeGreaterThan(0.3);
  });
  it('amplitude scales with speed, stays within 0.8 rad, bob <= 0.04', () => {
    expect(Math.abs(pose(Math.PI / 2, 0.5).legL)).toBeLessThan(Math.abs(pose(Math.PI / 2, 1).legL));
    for (let ph = 0; ph < 7; ph += 0.1) {
      const p = pose(ph, 1);
      for (const a of [p.armL, p.armR, p.legL, p.legR]) expect(Math.abs(a)).toBeLessThanOrEqual(0.8);
      expect(p.bob).toBeGreaterThanOrEqual(0);
      expect(p.bob).toBeLessThanOrEqual(0.04);
    }
  });
});

describe('animatePlayerWalk', () => {
  const rot = (m: THREE.Group): number[] => ['legL', 'legR', 'armL', 'armR'].map(k => (m.userData[k] as THREE.Object3D).rotation.x);
  it('two steps per second at full speed: one cycle in 1 s of walking', () => {
    const m = makePlayerModel(); const st = makeWalkState();
    for (let i = 0; i < 60; i++) animatePlayerWalk(m, st, 1 / 60, WALK_SPEED / 60);
    expect(st.phase).toBeCloseTo(2 * Math.PI, 1);
  });
  it('phase follows distance, not time (half the speed, half the phase)', () => {
    const a = makePlayerModel(); const b = makePlayerModel(); const sa = makeWalkState(); const sb = makeWalkState();
    for (let i = 0; i < 60; i++) { animatePlayerWalk(a, sa, 1 / 60, WALK_SPEED / 60); animatePlayerWalk(b, sb, 1 / 60, WALK_SPEED / 120); }
    expect(sb.phase).toBeCloseTo(sa.phase / 2, 1);
  });
  it('limbs move while walking and ease back to neutral within ~0.3 s of stopping, without snapping', () => {
    const m = makePlayerModel(); const st = makeWalkState();
    for (let i = 0; i < 40; i++) animatePlayerWalk(m, st, 1 / 60, WALK_SPEED / 60);
    const walking = rot(m);
    expect(Math.max(...walking.map(Math.abs))).toBeGreaterThan(0.2);
    let prev = walking; let maxJump = 0;
    for (let i = 0; i < 60; i++) {
      m.position.y = 0; // main.ts re-places the model every frame
      animatePlayerWalk(m, st, 1 / 60, 0);
      const now = rot(m);
      maxJump = Math.max(maxJump, ...now.map((v, k) => Math.abs(v - prev[k])));
      prev = now;
      if (i === 17) expect(Math.max(...now.map(Math.abs))).toBeLessThan(0.1); // ~0.3 s
    }
    expect(maxJump).toBeLessThan(0.25); // no frame jumps
    expect(rot(m).every(v => Math.abs(v) < 1e-3)).toBe(true);
    expect(m.position.y).toBe(0);
  });
  it('a teleport (huge displacement in one frame) does not swing the limbs', () => {
    const m = makePlayerModel(); const st = makeWalkState();
    animatePlayerWalk(m, st, 1 / 60, 40);
    expect(st.phase).toBe(0);
  });
  it('idle pose is the model as built', () => {
    const m = makePlayerModel(); const st = makeWalkState();
    animatePlayerWalk(m, st, 1 / 60, 0);
    expect(rot(m)).toEqual([0, 0, 0, 0]);
  });
});

describe('parts stay joined through the joints at every sample angle', () => {
  const EPS = 0.001;
  const boxes = (root: THREE.Object3D): THREE.Box3[] => {
    root.updateMatrixWorld(true);
    const out: THREE.Box3[] = [];
    root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(new THREE.Box3().setFromObject(o).expandByScalar(EPS)); });
    return out;
  };
  const connected = (bs: THREE.Box3[]): boolean => {
    const seen = new Set([0]); const q = [0];
    while (q.length) { const i = q.pop()!; bs.forEach((b, j) => { if (!seen.has(j) && bs[i].intersectsBox(b)) { seen.add(j); q.push(j); } }); }
    return seen.size === bs.length;
  };
  it('player at limb angles -0.8..0.8 and along the gait', () => {
    for (const a of [-0.8, -0.4, 0, 0.4, 0.8]) {
      const m = makePlayerModel();
      m.userData.legL.rotation.x = a; m.userData.legR.rotation.x = -a;
      m.userData.armL.rotation.x = -a; m.userData.armR.rotation.x = a;
      expect(connected(boxes(m)), `angle ${a}`).toBe(true);
    }
    for (let ph = 0; ph < 6.4; ph += 0.4) {
      const m = makePlayerModel(); const st = makeWalkState();
      st.phase = ph; st.amp = 1;
      animatePlayerWalk(m, st, 1 / 60, WALK_SPEED / 60);
      expect(connected(boxes(m)), `phase ${ph}`).toBe(true);
    }
  });
  it('Pip trots and stays in one piece', () => {
    for (let ph = 0; ph < 6.4; ph += 0.4) {
      const m = makePalModel(); const st = makeWalkState();
      st.phase = ph; st.amp = 1;
      animatePalTrot(m, st, 1 / 60, 4.5 / 60);
      expect(connected(boxes(m)), `phase ${ph}`).toBe(true);
    }
  });
  it('Pip legs swing in diagonal pairs and rest when still', () => {
    const m = makePalModel(); const st = makeWalkState();
    for (let i = 0; i < 20; i++) animatePalTrot(m, st, 1 / 60, 4.5 / 60);
    const l = (m.userData.legs as THREE.Group[]).map(g => g.rotation.x);
    expect(Math.abs(l[1])).toBeGreaterThan(0.1);
    expect(l[1]).toBeCloseTo(l[2]); expect(l[0]).toBeCloseTo(l[3]); expect(l[0]).toBeCloseTo(-l[1]);
    for (let i = 0; i < 60; i++) animatePalTrot(m, st, 1 / 60, 0);
    expect((m.userData.legs as THREE.Group[]).every(g => Math.abs(g.rotation.x) < 1e-3)).toBe(true);
  });
});

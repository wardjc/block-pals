import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BREATH, GLIM_RADIUS, HOP_HEIGHT, ORB_MAX_TRIANGLES, WIZARD_COLOURS, WIZARD_HEIGHT, WIZARD_MAX_TRIANGLES, WIZARD_PALETTE,
  WIZARD_PARTS, WIZARD_TURN_RATE, WizardView, angleTo, glimColour, makeWizardModel, turnTowards,
} from '../../src/render/wizard';
import { generateWorld } from '../../src/core/worldgen';
import { BLOCKS } from '../../src/core/blocks';

const tris = (m: THREE.Mesh): number => (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
const hsl = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);

describe('Orlo the wizard: model', () => {
  it('the body is one mesh with at most 280 triangles and Glim at most 24: 2 draw calls', () => {
    const m = makeWizardModel();
    let meshes = 0;
    m.group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBe(2);
    expect(tris(m.body)).toBeLessThanOrEqual(WIZARD_MAX_TRIANGLES);
    expect(tris(m.body)).toBeGreaterThan(150);
    expect(tris(m.orb)).toBeLessThanOrEqual(ORB_MAX_TRIANGLES);
    expect(m.body.geometry.getAttribute('color')).toBeDefined();
    expect(m.orb.material).toBeInstanceOf(THREE.MeshBasicMaterial);
  });

  it('feet at y = 0, faces +z (face details at the front) and fits a 3-high room', () => {
    const { body } = makeWizardModel();
    const bb = body.geometry.boundingBox!;
    expect(bb.min.y).toBeCloseTo(0, 5);
    expect(bb.max.y).toBeLessThanOrEqual(WIZARD_HEIGHT);
    expect(WIZARD_HEIGHT).toBeLessThan(3);
    const nose = WIZARD_PARTS.find(p => p[6] === WIZARD_COLOURS.nose)!;
    expect(nose[2]).toBeGreaterThan(0.2);
  });

  it('builds and disposes without leaking geometry or materials', () => {
    const scene = new THREE.Scene();
    const v = new WizardView(scene, { x: 34, y: 10, z: 82 });
    const disposed: string[] = [];
    v.body.geometry.addEventListener('dispose', () => disposed.push('bodyGeo'));
    v.orb.geometry.addEventListener('dispose', () => disposed.push('orbGeo'));
    (v.body.material as THREE.Material).addEventListener('dispose', () => disposed.push('bodyMat'));
    (v.orb.material as THREE.Material).addEventListener('dispose', () => disposed.push('orbMat'));
    expect(scene.children).toContain(v.group);
    v.dispose();
    expect(scene.children).not.toContain(v.group);
    expect(disposed.sort()).toEqual(['bodyGeo', 'bodyMat', 'orbGeo', 'orbMat']);
  });

  it('nothing dark: every colour has lightness at least 0.40, the eyes (0.28 floor) are under 4% of the surface', () => {
    for (const c of WIZARD_PALETTE) {
      const { l } = hsl(c);
      if (c === WIZARD_COLOURS.eye) expect(l).toBeGreaterThanOrEqual(0.28);
      else expect(l, c).toBeGreaterThanOrEqual(0.4);
    }
    const area = (p: (typeof WIZARD_PARTS)[number]) => 2 * (p[3] * p[4] + p[4] * p[5] + p[3] * p[5]);
    const total = WIZARD_PARTS.reduce((s, p) => s + area(p), 0);
    const eyes = WIZARD_PARTS.filter(p => p[6] === WIZARD_COLOURS.eye).reduce((s, p) => s + area(p), 0);
    expect(eyes / total).toBeLessThan(0.04);
  });

  it('no harsh red: no red-ish colour with saturation above 0.8', () => {
    for (const c of WIZARD_PALETTE) {
      const { h, s } = hsl(c);
      const reddish = h < 0.05 || h > 0.95;
      if (reddish) expect(s, c).toBeLessThanOrEqual(0.8);
    }
  });
});

describe('Orlo the wizard: idle', () => {
  const spot = { x: 34, y: 10, z: 82 };
  const door = { x: 36.5, z: 77.5 };

  it('rests facing the door and turns towards the player at most 90 degrees a second, never past him', () => {
    const v = new WizardView(new THREE.Scene(), spot, door);
    const rest = v.yaw;
    expect(rest).toBeCloseTo(Math.atan2(door.x - 34.5, door.z - 82.5), 6);
    const player = { x: 34.5 - 3, z: 82.5 }; // west of him, inside 6 blocks
    const want = Math.atan2(-3, 0);
    let prev = v.yaw;
    for (let i = 0; i < 200; i++) {
      v.update(1 / 60, i / 60, player, false);
      expect(Math.abs(angleTo(prev, v.yaw))).toBeLessThanOrEqual(WIZARD_TURN_RATE / 60 + 1e-9);
      prev = v.yaw;
    }
    expect(Math.abs(angleTo(v.yaw, want))).toBeLessThan(1e-6);
    // Far away: back to the door.
    for (let i = 0; i < 300; i++) v.update(1 / 60, i / 60, { x: 0, z: 0 }, false);
    expect(Math.abs(angleTo(v.yaw, rest))).toBeLessThan(1e-6);
  });

  it('turnTowards never overshoots and takes the short way', () => {
    expect(turnTowards(0, 0.1, Math.PI / 2, 1)).toBeCloseTo(0.1);
    expect(turnTowards(3, -3, 1, 0.1)).toBeGreaterThan(3); // across ±π, the short way
    expect(turnTowards(0, 1, 1, 0)).toBe(0);
  });

  it('breathing stays within ±1.5%', () => {
    const v = new WizardView(new THREE.Scene(), spot);
    for (let t = 0; t < 20; t += 0.05) {
      v.update(0.05, t, null, false);
      expect(Math.abs(v.body.scale.y - 1)).toBeLessThanOrEqual(0.015);
    }
    expect(BREATH).toBeLessThanOrEqual(0.015);
  });

  it('Glim stays within 1 block of him and stays pastel (lightness at least 0.7)', () => {
    const v = new WizardView(new THREE.Scene(), spot);
    for (let t = 0; t < 30; t += 0.1) {
      v.update(0.1, t, null, t > 15);
      const p = v.orb.position;
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y - 1.5)).toBeLessThan(1);
      const c = (v.orb.material as THREE.MeshBasicMaterial).color.getHSL({ h: 0, s: 0, l: 0 });
      expect(c.l).toBeGreaterThanOrEqual(0.7);
    }
    expect(GLIM_RADIUS).toBe(0.5);
    expect(glimColour(NaN, false).l).toBeGreaterThanOrEqual(0.7);
    expect(glimColour(5, true).l).toBeGreaterThan(glimColour(5, false).l);
  });

  it('celebrate hops at most 0.4 blocks and returns to rest', () => {
    const v = new WizardView(new THREE.Scene(), spot);
    v.celebrate();
    let top = 0;
    for (let i = 0; i < 60; i++) {
      v.update(1 / 60, i / 60, null, false);
      top = Math.max(top, v.group.position.y - spot.y);
    }
    expect(top).toBeGreaterThan(0.1);
    expect(top).toBeLessThanOrEqual(0.4);
    expect(HOP_HEIGHT).toBeLessThanOrEqual(0.4);
    expect(v.group.position.y).toBe(spot.y);
  });

  it('cells returns his feet cell and the one above; his pick box covers him', () => {
    const v = new WizardView(new THREE.Scene(), spot);
    expect(v.cells()).toEqual([[34, 10, 82], [34, 11, 82]]);
    const b = v.box();
    expect(b.min[1]).toBe(10);
    expect(b.max[1]).toBeGreaterThan(12);
  });

  it('hidden beyond 44 blocks of the camera', () => {
    const v = new WizardView(new THREE.Scene(), spot);
    v.update(0.016, 0, null, false, { x: 34.5, z: 82.5 - 30 });
    expect(v.group.visible).toBe(true);
    v.update(0.016, 0, null, false, { x: 34.5, z: 82.5 - 45 });
    expect(v.group.visible).toBe(false);
  });

  it('stands at the real tower spot: the spot is a floor cell of the ground room with room above for his hat', () => {
    const { world, tower } = generateWorld(2026);
    const [x, y, z] = tower.wizardSpot;
    expect(BLOCKS[world.get(x, y - 1, z)].solid).toBe(true);
    for (let k = 0; k < Math.ceil(WIZARD_HEIGHT); k++) expect(BLOCKS[world.get(x, y + k, z)].solid).toBe(false);
  });
});

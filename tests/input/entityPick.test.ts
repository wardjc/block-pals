import { describe, expect, it } from 'vitest';
import { pickAnimal } from '../../src/input/entityPick';

const a = (id: number, sx: number, sy: number, sz = 10) => ({ id, sx, sy, sz });

describe('pickAnimal', () => {
  it('picks the nearest animal within 56 px', () => {
    expect(pickAnimal({ x: 100, y: 100 }, [a(1, 140, 100), a(2, 110, 100), a(3, 400, 400)])).toBe(2);
  });
  it('gives null outside the radius and for an empty list', () => {
    expect(pickAnimal({ x: 0, y: 0 }, [a(1, 57, 0)])).toBeNull();
    expect(pickAnimal({ x: 0, y: 0 }, [a(1, 56, 0)])).toBe(1);
    expect(pickAnimal({ x: 0, y: 0 }, [])).toBeNull();
  });
  it('a tie goes to the one closer to the camera', () => {
    expect(pickAnimal({ x: 0, y: 0 }, [a(1, 30, 0, 20), a(2, -30, 0, 5)])).toBe(2);
    expect(pickAnimal({ x: 0, y: 0 }, [a(2, -30, 0, 5), a(1, 30, 0, 20)])).toBe(2);
  });
  it('the radius can be changed', () => {
    expect(pickAnimal({ x: 0, y: 0 }, [a(1, 30, 0)], 20)).toBeNull();
  });
});

// ---- picking by ray (review round: the screen disc let a hold dig the wall behind an animal) ----
import * as THREE from 'three';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import type { Animal } from '../../src/game/animals';
import { pickAnimalAlongRay, rayBoxDistance } from '../../src/input/entityPick';
import { resolveHold, resolveTap } from '../../src/input/tap';
import { AnimalView } from '../../src/render/animals';
import { castVoxelRay, type VoxelHit } from '../../src/render/voxelRay';

describe('rayBoxDistance', () => {
  it('gives the entry distance, null for a miss or a box behind', () => {
    expect(rayBoxDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, [-1, -1, 3], [1, 1, 4])).toBeCloseTo(3);
    expect(rayBoxDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, [2, -1, 3], [3, 1, 4])).toBeNull();
    expect(rayBoxDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, [-1, -1, -4], [1, 1, -3])).toBeNull();
    expect(rayBoxDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, [-1, -1, -1], [1, 1, 1])).toBe(0); // inside
  });
});

/** The real chain from main.ts: camera ray, voxel ray, animal boxes, then the tap and hold resolvers. */
function scene(setup: (w: World) => void, cows: Array<[number, number]>) {
  const world = new World(40, 12, 40);
  for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) world.set(x, 0, z, BlockId.Grass);
  setup(world);
  const three = new THREE.Scene();
  const view = new AnimalView(three);
  const animals = cows.map(([x, z], i) => ({ id: i, kind: 'cow', variant: 0, x, y: 1, z, heading: 0, state: 'idle', stateT: 0, giftIn: 0, noiseIn: 9, stuckFor: 0 }) as unknown as Animal);
  view.sync(animals, () => true, 0);
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.05, 64);
  cam.position.set(10.5, 3.2, 10.5);
  cam.lookAt(10.5, 1.2, 16.5);
  cam.updateMatrixWorld();
  const rc = new THREE.Raycaster();
  const hit: VoxelHit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, t: 0 };
  const aim = (sx: number, sy: number) => {
    rc.setFromCamera(new THREE.Vector2(sx, sy), cam);
    const o = rc.ray.origin, d = rc.ray.direction;
    const found = castVoxelRay(world, o.x, o.y, o.z, d.x, d.y, d.z, 40, true, hit);
    const block = found ? { cell: [hit.x, hit.y, hit.z] as [number, number, number], normal: [hit.nx, hit.ny, hit.nz] as [number, number, number] } : null;
    const animal = pickAnimalAlongRay(o, d, view.boxes(), found ? hit.t : null);
    return { block, animal };
  };
  /** Screen point (ndc) of a world point. */
  const ndc = (x: number, y: number, z: number): [number, number] => { const v = new THREE.Vector3(x, y, z).project(cam); return [v.x, v.y]; };
  return { world, aim, ndc, animals };
}

describe('picking animals by ray', () => {
  const feet: [number, number, number] = [10, 1, 10];
  it('holding a clearly visible cow never digs the wall behind it (the cow edge, 1.4 blocks off its centre)', () => {
    const s = scene(w => { for (let x = 6; x < 16; x++) for (let y = 1; y < 4; y++) w.set(x, y, 19, BlockId.Planks); }, [[10.5, 15.5]]);
    // The cow is about 0.7 wide; aim 0.55 blocks from its centre line: inside the padded box, outside the model.
    for (const dx of [0, 0.4, -0.55, 0.55]) {
      const [sx, sy] = s.ndc(10.5 + dx, 1.0, 15.5);
      const { block, animal } = s.aim(sx, sy);
      expect(animal, `dx ${dx}`).toBe(0);
      expect(resolveHold(block, feet, s.world, [], animal !== null)).toEqual({ kind: 'none' });
      expect(s.world.get(10, 1, 19)).toBe(BlockId.Planks);
    }
  });
  it('a tap on a visible animal feeds or pets; further than reach it walks beside it', () => {
    const s = scene(() => {}, [[10.5, 13.5]]);
    const [sx, sy] = s.ndc(10.5, 1.0, 13.5);
    const { block, animal } = s.aim(sx, sy);
    expect(animal).toBe(0);
    expect(resolveTap(block, 'hand', feet, s.world, [], { animalHit: { id: 0, dist: 3.5, cell: [10, 1, 13] } })).toEqual({ kind: 'walk', to: [10, 1, 13] });
    expect(resolveTap(block, 'hand', feet, s.world, [], { animalHit: { id: 0, dist: 2.5 } })).toEqual({ kind: 'pet', animal: 0 });
  });
  it('a cow hidden behind a wall is not picked: the wall is dug, and a tap there does not feed it', () => {
    const s = scene(w => { for (let x = 6; x < 16; x++) for (let y = 1; y < 4; y++) w.set(x, y, 13, BlockId.Planks); }, [[10.5, 16.5]]);
    const [sx, sy] = s.ndc(10.5, 1.2, 13.0);
    const { block, animal } = s.aim(sx, sy);
    expect(animal).toBeNull();
    expect(block?.cell[2]).toBe(13);
    expect(resolveHold(block, feet, s.world, [], false)).toMatchObject({ kind: 'dig' });
  });
  it('the nearest of animal and block along the ray wins, both ways round', () => {
    const near = scene(w => w.set(10, 1, 20, BlockId.Planks), [[10.5, 14.5]]);
    let [sx, sy] = near.ndc(10.5, 1.0, 14.5);
    expect(near.aim(sx, sy).animal).toBe(0);
    const far = scene(w => w.set(10, 1, 12, BlockId.Planks), [[10.5, 14.5]]);
    [sx, sy] = far.ndc(10.5, 1.2, 12.0);
    expect(far.aim(sx, sy).animal).toBeNull();
  });
  it('the nearest of two animals on the ray is picked, and a miss is null', () => {
    const s = scene(() => {}, [[10.5, 18.5], [10.5, 14.5]]);
    const [sx, sy] = s.ndc(10.5, 1.0, 14.5);
    expect(s.aim(sx, sy).animal).toBe(1);
    expect(pickAnimalAlongRay({ x: 0, y: 5, z: 0 }, { x: 0, y: 1, z: 0 }, s.animals.length ? [] : [], null)).toBeNull();
    const [mx, my] = s.ndc(3.5, 1.0, 14.5);
    expect(s.aim(mx, my).animal).toBeNull();
  });
});

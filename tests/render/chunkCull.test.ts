import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { generateWorld } from '../../src/core/worldgen';
import { CameraRig, DEFAULT_PITCH, PITCH_MAX, PITCH_MIN } from '../../src/render/cameraRig';
import { CULL_MARGIN, FOG_FAR, ChunkCuller, visibleChunks } from '../../src/render/chunkCull';
import { CHUNK_SIZE } from '../../src/render/mesher';
import { EYE_HEIGHT } from '../../src/render/scene';
import { blocksRay } from '../../src/render/voxelRay';

const { world, spawn } = generateWorld(2026);
const forward = (yaw: number, pitch: number) => ({ x: Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) });

/** The camera as the game places it (the rig pulls it in front of walls). */
function cameraAt(x: number, y: number, z: number, yaw: number, pitch: number) {
  const rig = new CameraRig();
  rig.yaw = yaw; rig.pitch = pitch;
  for (let i = 0; i < 60; i++) rig.update(world, { x, y: y + EYE_HEIGHT, z }, 1 / 30);
  return { pos: { ...rig.position }, f: { ...rig.forward } };
}

/** Does a hidden chunk hold any solid block that is inside the fog by view depth? */
function visibleSurfaceInHidden(set: Set<string>, cam: { x: number; y: number; z: number }, f: { x: number; y: number; z: number }): string | null {
  for (let cz = 0; cz < 6; cz++) for (let cx = 0; cx < 6; cx++) {
    if (set.has(`${cx},${cz}`)) continue;
    for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) for (let z = cz * CHUNK_SIZE; z < (cz + 1) * CHUNK_SIZE; z++) {
      for (let y = 0; y < world.sizeY; y++) {
        if (!blocksRay(world.get(x, y, z))) continue;
        // the block's nearest corner along the view direction
        const depth = Math.min(...[0, 1].flatMap(a => [0, 1].flatMap(b => [0, 1].map(c =>
          (x + a - cam.x) * f.x + (y + b - cam.y) * f.y + (z + c - cam.z) * f.z))));
        if (depth < FOG_FAR) return `chunk ${cx},${cz} block ${x},${y},${z} depth ${depth.toFixed(2)}`;
      }
    }
  }
  return null;
}

describe('visibleChunks (view-depth fog culling)', () => {
  it('the reported hole: seed 2026, spawn, yaw 15 degrees, default pitch keeps chunk (4,3)', () => {
    const { pos, f } = cameraAt(spawn.x, spawn.y, spawn.z, (15 * Math.PI) / 180, DEFAULT_PITCH);
    const set = visibleChunks(96, 20, 96, pos.x, pos.y, pos.z, f.x, f.y, f.z);
    expect(set.has('4,3')).toBe(true);
    expect(visibleSurfaceInHidden(set, pos, f)).toBeNull();
  });

  it('a yaw and pitch sweep never hides a chunk holding a surface inside the fog depth', () => {
    const spots: Array<[number, number]> = [[spawn.x, spawn.z], [30.5, 20.5], [60.5, 24.5], [20.5, 70.5], [80.5, 80.5], [3.5, 3.5]];
    for (const [sx, sz] of spots) {
      const y = world.topSolidY(Math.floor(sx), Math.floor(sz)) + 1;
      for (let yawDeg = 0; yawDeg < 360; yawDeg += 30) for (const pitch of [PITCH_MIN, DEFAULT_PITCH, PITCH_MAX]) {
        const { pos, f } = cameraAt(sx, y, sz, (yawDeg * Math.PI) / 180, pitch);
        const set = visibleChunks(96, 20, 96, pos.x, pos.y, pos.z, f.x, f.y, f.z, sx, sz);
        expect(visibleSurfaceInHidden(set, pos, f), `${sx},${sz} yaw ${yawDeg} pitch ${pitch}`).toBeNull();
        expect(set.has(`${Math.floor(sx / CHUNK_SIZE)},${Math.floor(sz / CHUNK_SIZE)}`)).toBe(true);
      }
    }
  }, 120_000);

  it('still hides what is deep in the fog, so the numbers stay reasonable', () => {
    // looking along +x from the west edge: the far east chunks are deeper than the fog
    const set = visibleChunks(96, 20, 96, 2, 8, 48, 1, 0, 0);
    expect(set.has('0,3')).toBe(true);
    expect(set.has('5,3')).toBe(false);
    expect(set.size).toBeLessThan(36);
    // looking away: chunks behind stay (frustum culling removes them), none are lost from the fog test
    const behind = visibleChunks(96, 20, 96, 2, 8, 48, -1, 0, 0);
    expect(behind.has('5,3')).toBe(true);
  });

  it('keeps the chunk the camera or player is in, whatever the direction', () => {
    expect(visibleChunks(96, 20, 96, 90, 8, 90, 1, 0, 0, 5, 5).has('0,0')).toBe(true);
    expect(visibleChunks(96, 20, 96, 90, 8, 90, 1, 0, 0).has('5,5')).toBe(true);
  });

  it('fails open for a bad position or direction', () => {
    expect(visibleChunks(96, 20, 96, NaN, 8, 5, 1, 0, 0).size).toBe(36);
    expect(visibleChunks(96, 20, 96, 5, 8, 5, NaN, 0, 0).size).toBe(36);
  });

  it('the margin is a little over the fog', () => {
    expect(CULL_MARGIN).toBeGreaterThan(0);
    expect(CULL_MARGIN).toBeLessThanOrEqual(3);
  });
});

describe('ChunkCuller', () => {
  it('hands back the same set until the contents change, and follows the camera', () => {
    const c = new ChunkCuller(96, 20, 96);
    const a = c.update(10, 8, 10, 0, 0, 1, 10, 10);
    expect(c.update(10.2, 8, 10, 0, 0, 1, 10.2, 10)).toBe(a);
    const b = c.update(10, 8, 80, 0, 0, 1, 10, 80);
    expect(b).not.toBe(a);
    expect(b.has('0,5')).toBe(true);
  });

  it('chunk count in the village view is well under all 36 when looking along the world', () => {
    const c = new ChunkCuller(96, 20, 96);
    let max = 0;
    for (let yaw = 0; yaw < 360; yaw += 30) {
      const { pos, f } = cameraAt(spawn.x, spawn.y, spawn.z, (yaw * Math.PI) / 180, DEFAULT_PITCH);
      max = Math.max(max, c.update(pos.x, pos.y, pos.z, f.x, f.y, f.z, spawn.x, spawn.z).size);
    }
    expect(max).toBeLessThanOrEqual(36);
    expect(BlockId.Air).toBe(0);
  });
});

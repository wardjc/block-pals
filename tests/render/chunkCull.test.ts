import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { ORIGIN } from '../../src/core/bounds';
import { generateWorld } from '../../src/core/worldgen';
import { CameraRig, DEFAULT_PITCH, PITCH_MAX, PITCH_MIN } from '../../src/render/cameraRig';
import { CULL_MARGIN, FOG_FAR, ChunkCuller, visibleChunks } from '../../src/render/chunkCull';
import { CHUNK_SIZE } from '../../src/render/mesher';
import { EYE_HEIGHT } from '../../src/render/scene';
import { blocksRay } from '../../src/render/voxelRay';

const { world, spawn } = generateWorld(2026);
// The real world is 192 x 68 x 192 (the old meadow is its middle, at +48).
const SX = world.sizeX, SY = world.sizeY, SZ = world.sizeZ;
const O = ORIGIN.x;
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
  const reach = FOG_FAR + 2; // a view depth is never more than the straight-line distance
  for (let cz = 0; cz < Math.ceil(SZ / CHUNK_SIZE); cz++) for (let cx = 0; cx < Math.ceil(SX / CHUNK_SIZE); cx++) {
    if (set.has(`${cx},${cz}`)) continue;
    const nx = Math.max(cx * CHUNK_SIZE - cam.x, 0, cam.x - (cx + 1) * CHUNK_SIZE);
    const nz = Math.max(cz * CHUNK_SIZE - cam.z, 0, cam.z - (cz + 1) * CHUNK_SIZE);
    if (Math.hypot(nx, nz) > reach) continue;
    for (let x = cx * CHUNK_SIZE; x < (cx + 1) * CHUNK_SIZE; x++) for (let z = cz * CHUNK_SIZE; z < (cz + 1) * CHUNK_SIZE; z++) {
      for (let y = Math.max(0, Math.floor(cam.y - reach)); y < Math.min(world.sizeY, cam.y + reach); y++) {
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
    const set = visibleChunks(SX, SY, SZ, pos.x, pos.y, pos.z, f.x, f.y, f.z);
    expect(set.has('7,6')).toBe(true); // the old chunk (4,3), moved by 48 blocks = 3 chunks
    expect(visibleSurfaceInHidden(set, pos, f)).toBeNull();
  });

  it('a yaw and pitch sweep never hides a chunk holding a surface inside the fog depth', () => {
    const spots: Array<[number, number]> = [[spawn.x, spawn.z], [O + 30.5, O + 20.5], [O + 60.5, O + 24.5], [O + 20.5, O + 70.5], [O + 80.5, O + 80.5], [O + 3.5, O + 3.5]];
    for (const [sx, sz] of spots) {
      const y = world.topSolidY(Math.floor(sx), Math.floor(sz)) + 1;
      for (let yawDeg = 0; yawDeg < 360; yawDeg += 30) for (const pitch of [PITCH_MIN, DEFAULT_PITCH, PITCH_MAX]) {
        const { pos, f } = cameraAt(sx, y, sz, (yawDeg * Math.PI) / 180, pitch);
        const set = visibleChunks(SX, SY, SZ, pos.x, pos.y, pos.z, f.x, f.y, f.z, sx, sz);
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

  it('chunk count at spawn never exceeds the 144 chunks (behind-the-camera chunks stay: frustum culling drops them; the per-view section rule is chunk B)', () => {
    const c = new ChunkCuller(SX, SY, SZ);
    let max = 0;
    for (let yaw = 0; yaw < 360; yaw += 30) {
      const { pos, f } = cameraAt(spawn.x, spawn.y, spawn.z, (yaw * Math.PI) / 180, DEFAULT_PITCH);
      max = Math.max(max, c.update(pos.x, pos.y, pos.z, f.x, f.y, f.z, spawn.x, spawn.z).size);
    }
    console.log(`most chunks kept at spawn: ${max} of 144`);
    expect(max).toBeLessThanOrEqual(144);
    expect(BlockId.Air).toBe(0);
  });
});

/** A repeatable stream of numbers in [0, 1), using a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smoothly interpolate seeded lattice values, independent of sampling order. */
export function valueNoise2D(seed: number): (x: number, z: number) => number {
  const lattice = (x: number, z: number): number => {
    let hash = (seed >>> 0) ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495);
    hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
    hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  return (x, z) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const tx = smooth(x - ix);
    const tz = smooth(z - iz);
    return lerp(
      lerp(lattice(ix, iz), lattice(ix + 1, iz), tx),
      lerp(lattice(ix, iz + 1), lattice(ix + 1, iz + 1), tx),
      tz,
    );
  };
}

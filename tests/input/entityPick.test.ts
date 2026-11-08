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

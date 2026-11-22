import { describe, expect, it } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { World } from '../../src/core/world';
import { Game } from '../../src/game/game';
import { GamepadInput, HOME_BUTTONS } from '../../src/input/gamepad';
import { DEFAULT_MAPPING } from '../../src/input/mapping';

function pad(down: number[] = []): Gamepad {
  return {
    id: 'test-pad', index: 0, connected: true, mapping: '', timestamp: 0, axes: [0, 0], hapticActuators: [],
    vibrationActuator: { playEffect: async () => 'complete', reset: async () => 'complete', pulse: async () => true },
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: down.includes(index), touched: down.includes(index), value: down.includes(index) ? 1 : 0 })),
  } as unknown as Gamepad;
}

describe('the Home lift on a pad (7h)', () => {
  it('Y (3) or Back (8) asks for home, edge-triggered', () => {
    expect(HOME_BUTTONS).toEqual([3, 8]);
    let current = pad([3]);
    const input = new GamepadInput(DEFAULT_MAPPING, () => [current]);
    expect(input.poll(0).pressed).toEqual(['home']);
    expect(input.poll(300).pressed).toEqual([]);
    current = pad();
    input.poll(400);
    current = pad([8]);
    expect(input.poll(600).pressed).toEqual(['home']);
  });

  it('a button the grown-ups mapped to another action never means home', () => {
    const input = new GamepadInput({ ...DEFAULT_MAPPING, place: 3 }, () => [pad([3])]);
    expect(input.poll(0).pressed).toEqual(['place']);
  });

  it('the game asks for the lift only while he is deep, and never while paused', () => {
    const world = new World(30, 30, 30);
    for (let x = 0; x < 30; x++) for (let z = 0; z < 30; z++) for (let y = 0; y < 20; y++) world.set(x, y, z, BlockId.Stone);
    // A room 12 below the ground.
    for (let x = 10; x < 20; x++) for (let z = 10; z < 20; z++) for (let y = 8; y < 11; y++) world.set(x, y, z, BlockId.Air);
    const game = new Game({ world, spawn: { x: 15.5, y: 8, z: 15.5 } });
    let asked = 0;
    game.onHomeRequest = () => { asked++; };
    game.update(0.016);
    expect(game.isDeep()).toBe(true);
    game.paused = true;
    game.padAction('home');
    expect(asked).toBe(0);
    game.paused = false;
    game.padAction('home');
    expect(asked).toBe(1);
    const top = new Game({ world, spawn: { x: 2.5, y: 20, z: 2.5 } });
    top.onHomeRequest = () => { asked++; };
    top.padAction('home');
    expect(asked).toBe(1);
  });
});

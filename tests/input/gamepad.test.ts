import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamepadInput } from '../../src/input/gamepad';
import { DEFAULT_MAPPING, loadMapping, saveMapping, type ButtonMapping } from '../../src/input/mapping';

function pad(down: number[] = [], axes: number[] = [0, 0]): Gamepad {
  return {
    id: 'test-pad', index: 0, connected: true, mapping: '', timestamp: 0, axes,
    hapticActuators: [],
    vibrationActuator: {
      playEffect: async () => 'complete',
      reset: async () => 'complete',
      pulse: async () => true,
    },
    buttons: Array.from({ length: 16 }, (_, index) => ({
      pressed: down.includes(index), touched: down.includes(index), value: down.includes(index) ? 1 : 0,
    })),
  };
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('GamepadInput', () => {
  it('gamepad presses are edge-triggered', () => {
    let current = pad([0, 1, 5]);
    const input = new GamepadInput(DEFAULT_MAPPING, () => [current]);
    expect(input.poll(0).pressed).toEqual(['collect', 'place', 'nextSlot']);
    expect(input.poll(200).pressed).toEqual([]);
    current = pad();
    expect(input.poll(250).pressed).toEqual([]);
    current = pad([0, 1, 5]);
    expect(input.poll(300).pressed).toEqual(['collect', 'place', 'nextSlot']);
  });

  it('debounces rapid presses per action without delaying a suppressed edge', () => {
    let current = pad([0]);
    const input = new GamepadInput(DEFAULT_MAPPING, () => [current]);
    expect(input.poll(0).pressed).toEqual(['collect']);
    current = pad();
    input.poll(25);
    current = pad([0, 5]);
    expect(input.poll(100).pressed).toEqual(['nextSlot']);
    expect(input.poll(150).pressed).toEqual([]);
    current = pad();
    input.poll(175);
    current = pad([0]);
    expect(input.poll(200).pressed).toEqual(['collect']);
  });

  it('dead-zone ignores small stick drift', () => {
    let current = pad([], [0.2, -0.24]);
    const input = new GamepadInput(DEFAULT_MAPPING, () => [current]);
    expect(input.poll(0).stick).toEqual([0, 0]);
    current = pad([], [0.5, -0.75]);
    expect(input.poll(1).stick).toEqual([0.5, -0.75]);
  });

  it.each([[12, [0, -1]], [13, [0, 1]], [14, [-1, 0]], [15, [1, 0]]] as const)(
    'd-pad button %s moves when axes absent', (button, stick) => {
      const input = new GamepadInput(DEFAULT_MAPPING, () => [pad([button], [])]);
      expect(input.poll(0).stick).toEqual(stick);
    },
  );

  it('combines d-pad directions and cancels opposing directions', () => {
    let current = pad([12, 15], []);
    const input = new GamepadInput(DEFAULT_MAPPING, () => [current]);
    expect(input.poll(0).stick).toEqual([1, -1]);
    current = pad([12, 13, 14, 15], []);
    expect(input.poll(1).stick).toEqual([0, 0]);
  });

  it('holding place 1s emits craft once and rearms after release', () => {
    let current = pad([1]);
    const input = new GamepadInput(DEFAULT_MAPPING, () => [current]);
    expect(input.poll(0).pressed).toEqual(['place']);
    expect(input.poll(999).pressed).toEqual([]);
    expect(input.poll(1000).pressed).toEqual(['craft']);
    expect(input.poll(2000).pressed).toEqual([]);
    current = pad();
    input.poll(2100);
    current = pad([1]);
    expect(input.poll(2200).pressed).toEqual(['place']);
    expect(input.poll(3200).pressed).toEqual(['craft']);
  });

  it('releasing place early cancels the hold timer', () => {
    let current = pad([1]);
    const input = new GamepadInput(DEFAULT_MAPPING, () => [current]);
    input.poll(0);
    current = pad();
    expect(input.poll(900).pressed).toEqual([]);
    current = pad([1]);
    expect(input.poll(1000).pressed).toEqual(['place']);
    expect(input.poll(1100).pressed).toEqual([]);
    expect(input.poll(2000).pressed).toEqual(['craft']);
  });

  it('uses mapped button indices and mapped inverted axes', () => {
    const mapping = { collect: 2, place: 3, nextSlot: 4, axisX: 2, axisY: 3, invertY: true };
    let current = pad([0, 1, 5], [1, 1, 0.5, -0.75]);
    const input = new GamepadInput(mapping, () => [current]);
    expect(input.poll(0)).toEqual({ stick: [0.5, 0.75], pressed: [] });
    current = pad([2, 3, 4]);
    expect(input.poll(200).pressed).toEqual(['collect', 'place', 'nextSlot']);
    expect(input.poll(1200).pressed).toEqual(['craft']);
  });

  it('handles missing pads, sparse slots and disconnects without stale holds', () => {
    let pads: (Gamepad | null)[] = [];
    const input = new GamepadInput(DEFAULT_MAPPING, () => pads);
    expect(input.poll(0)).toEqual({ stick: [0, 0], pressed: [] });
    pads = [null, pad([1])];
    expect(input.poll(10).pressed).toEqual(['place']);
    pads = [{ ...pad([1]), connected: false }];
    expect(input.poll(500)).toEqual({ stick: [0, 0], pressed: [] });
    pads = [null, pad([1])];
    expect(input.poll(1100).pressed).toEqual(['place']);
    expect(input.poll(2100).pressed).toEqual(['craft']);
  });

  it('does not carry a hold across different controllers', () => {
    let current = pad([1]);
    const input = new GamepadInput(DEFAULT_MAPPING, () => [current]);
    input.poll(0);
    current = { ...pad([1]), id: 'other-pad', index: 1 };
    expect(input.poll(1000).pressed).toEqual(['place']);
    expect(input.poll(2000).pressed).toEqual(['craft']);
  });

  it('captures the next new button without triggering gameplay', async () => {
    let current = pad([0]);
    const input = new GamepadInput(DEFAULT_MAPPING, () => [current]);
    input.poll(0);
    const captured = input.captureNextButton();
    expect(input.poll(200).pressed).toEqual([]);
    current = pad([0, 1], [1, 1]);
    expect(input.poll(300)).toEqual({ stick: [0, 0], pressed: [] });
    await expect(captured).resolves.toBe(1);
    expect(input.poll(1400).pressed).toEqual([]);
    current = pad();
    input.poll(1500);
    current = pad([1]);
    expect(input.poll(1600).pressed).toEqual(['place']);
  });

  it('captures unmapped buttons after a pad connects', async () => {
    let pads: (Gamepad | null)[] = [];
    const input = new GamepadInput(DEFAULT_MAPPING, () => pads);
    const captured = input.captureNextButton();
    input.poll(0);
    pads = [pad([8])];
    expect(input.poll(200).pressed).toEqual([]);
    await expect(captured).resolves.toBe(8);
  });

  it('reads browser pads by default and tolerates unavailable or blocked APIs', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [pad([0])] });
    expect(new GamepadInput(DEFAULT_MAPPING).poll(0).pressed).toEqual(['collect']);
    for (const navigator of [undefined, {}, { getGamepads: () => { throw new Error('Blocked'); } }]) {
      vi.stubGlobal('navigator', navigator);
      expect(new GamepadInput(DEFAULT_MAPPING).poll(0)).toEqual({ stick: [0, 0], pressed: [] });
    }
  });
});

describe('mapping storage', () => {
  const custom: ButtonMapping = { collect: 2, place: 3, nextSlot: 4, axisX: 2, axisY: 3, invertY: true };

  it('loadMapping with null storage returns defaults', () => {
    expect(DEFAULT_MAPPING).toEqual({ collect: 0, place: 1, nextSlot: 5, axisX: 0, axisY: 1, invertY: false });
    expect(loadMapping(null)).toEqual(DEFAULT_MAPPING);
    expect(loadMapping(memoryStorage())).toEqual(DEFAULT_MAPPING);
    expect(() => saveMapping(null, custom)).not.toThrow();
    const mapping = loadMapping(null);
    mapping.collect = 9;
    expect(loadMapping(null).collect).toBe(0);
  });

  it('round-trips a custom mapping', () => {
    const storage = memoryStorage();
    saveMapping(storage, custom);
    expect(loadMapping(storage)).toEqual(custom);
  });

  it.each(['{', 'null', '[]', '{}', JSON.stringify({ ...custom, place: -1 }),
    JSON.stringify({ ...custom, axisX: 0.5 }), JSON.stringify({ ...custom, collect: '2' }),
    JSON.stringify({ ...custom, invertY: 'true' })])('ignores corrupt or invalid mapping %s', (raw) => {
    const storage = memoryStorage();
    saveMapping(storage, custom);
    storage.setItem(storage.key(0)!, raw);
    expect(loadMapping(storage)).toEqual(DEFAULT_MAPPING);
  });

  it('tolerates blocked reads and full storage', () => {
    const storage = memoryStorage();
    storage.getItem = () => { throw new Error('Blocked'); };
    storage.setItem = () => { throw new Error('Full'); };
    expect(loadMapping(storage)).toEqual(DEFAULT_MAPPING);
    expect(() => saveMapping(storage, custom)).not.toThrow();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BlockId } from '../../src/core/blocks';
import { SAVE_KEY, parseSave, serialise, startAutosave, storeSave, type SaveFlags } from '../../src/core/save';
import { generateWorld } from '../../src/core/worldgen';
import { createAutosaveControl } from '../../src/game/autosaveControl';
import { Game } from '../../src/game/game';

const controls: Array<{ stop(): void }> = [];
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { for (const c of controls.splice(0)) c.stop(); vi.useRealTimers(); });

function rig() {
  const game = new Game(generateWorld(1234));
  const flags: SaveFlags = { ledToVillage: false };
  storeSave(localStorage, serialise(game, 1234, flags));
  const write = (): boolean => storeSave(localStorage, serialise(game, 1234, flags, Date.now()));
  const control = createAutosaveControl(() => startAutosave(game, 1234, localStorage, flags), write);
  controls.push(control);
  const stored = () => parseSave(localStorage.getItem(SAVE_KEY))!;
  return { game, flags, control, stored };
}

describe('autosave control (stop for a load, resume after a failed one)', () => {
  test('after a failed load, unsaved bag and flag changes are saved straight away, like a saver that was never stopped', () => {
    const { game, flags, control, stored } = rig();
    game.inventory.add(BlockId.Wood, 7);
    flags.hints = ['plantSome'];
    control.stop();
    vi.advanceTimersByTime(30_000); // nothing is written while stopped
    expect(stored().inventory[BlockId.Wood]).toBeUndefined();
    control.resume(); // the load was abandoned
    expect(stored().inventory[BlockId.Wood]).toBe(7);
    expect(stored().flags.hints).toEqual(['plantSome']);
  });

  test('freeze probe: while stopped, nothing can write the save (the guard reverted must fail this)', () => {
    const { game, control, stored } = rig();
    control.stop();
    game.inventory.add(BlockId.Wood, 3);
    control.save();
    window.dispatchEvent(new Event('pagehide'));
    vi.advanceTimersByTime(30_000);
    expect(stored().inventory[BlockId.Wood]).toBeUndefined();
    expect(control.frozen).toBe(true);
  });

  test('after resuming, normal saving works again', () => {
    const { game, control, stored } = rig();
    control.stop();
    control.resume();
    game.inventory.add(BlockId.Stone, 2);
    vi.advanceTimersByTime(11_000);
    expect(stored().inventory[BlockId.Stone]).toBe(2);
    expect(control.frozen).toBe(false);
  });
});

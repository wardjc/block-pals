import './ui/styles.css';
import * as THREE from 'three';
import { BlockId } from './core/blocks';
import type { Cell } from './core/pathfind';
import { applySave, readSave, startAutosave } from './core/save';
import { generateWorld } from './core/worldgen';
import { Game } from './game/game';
import { GamepadInput } from './input/gamepad';
import { loadMapping } from './input/mapping';
import { createDebouncer, resolveTap } from './input/tap';
import { makePalModel, makePlayerModel } from './render/characters';
import { GameScene } from './render/scene';
import { sfx } from './audio/sfx';
import { Hud } from './ui/hud';

let storage: Storage | null = null;
try { storage = window.localStorage; } catch { /* Storage may be blocked. */ }
const saved = readSave(storage);
export const hadSave: boolean = saved !== null; // for Pip's welcome-back line (Task 10)
const seed = saved?.seed ?? 2026;
const initial = saved ? applySave(saved) : generateWorld(seed);
const { world, spawn } = initial;
const scene = new GameScene(document.getElementById('game')!, world);
const game = new Game(initial);
startAutosave(game, seed, storage);
world.onChange((x, _y, z) => scene.rebuildChunkAt(x, z));

const playerModel = makePlayerModel();
scene.add(playerModel);

// Pip is static until Task 10.
const pipCell: Cell = [Math.floor(spawn.x + 1.8), spawn.y, Math.floor(spawn.z + 1.2)];
const pip = makePalModel();
pip.position.set(pipCell[0] + 0.5, pipCell[1], pipCell[2] + 0.5);
pip.rotation.y = -0.6;
scene.add(pip);

const occupied = (): Cell[] => {
  const [x, y, z] = game.player.feetCell();
  return [[x, y, z], [x, y + 1, z], pipCell, [pipCell[0], pipCell[1] + 1, pipCell[2]]];
};
game.setOccupied(occupied);

game.on(e => {
  if (e.type === 'collected') sfx.pop();
  else if (e.type === 'placed') sfx.place();
});

function renderHud(): void {
  const hotbar = game.inventory.hotbar().map(id => ({ id, count: game.inventory.count(id) }));
  const sel = game.effectiveSelected();
  const selected = sel === 'hand' ? 0 : hotbar.findIndex(h => h.id === sel) + 1;
  hud.render({ hotbar, selected });
}

const hud = new Hud(document.getElementById('ui')!, scene.atlas.iconDataUrl, {
  onSelect: i => {
    const id = game.inventory.hotbar()[i - 1];
    game.selected = i === 0 || id === undefined ? 'hand' : id;
    sfx.tap();
    renderHud();
  },
  onCraft: () => game.onCraftRequest(),
  onGrownUps: () => {},
});

// Taps on the canvas: pick, resolve, debounce, apply.
const allowTap = createDebouncer();
scene.renderer.domElement.addEventListener('pointerup', e => {
  sfx.unlock();
  if (hud.blockingOverlayOpen || !allowTap('tap', performance.now())) return;
  const hit = scene.pick(e.clientX, e.clientY);
  game.applyIntent(resolveTap(hit, game.effectiveSelected(), game.player.feetCell(), world, occupied()));
});
window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });

const pad = new GamepadInput(loadMapping(storage));
const camDir = { x: 0, z: 1 };
const camera3 = new THREE.Vector3();

function padStick(stick: [number, number]): [number, number] {
  scene.camera.getWorldDirection(camera3);
  const len = Math.hypot(camera3.x, camera3.z) || 1;
  camDir.x = camera3.x / len;
  camDir.z = camera3.z / len;
  const fwd = -stick[1];
  const right = stick[0];
  let x = camDir.x * fwd - camDir.z * right;
  let z = camDir.z * fwd + camDir.x * right;
  const m = Math.hypot(x, z);
  if (m > 1) { x /= m; z /= m; }
  return [x, z];
}

let fpsValue = 0;
let fpsFrames = 0;
let fpsSince = performance.now();
const debugOn = import.meta.env.DEV || location.search.includes('debug');
let fpsEl: HTMLElement | null = null;
if (location.search.includes('debug')) {
  fpsEl = document.createElement('div');
  fpsEl.className = 'fps';
  document.body.appendChild(fpsEl);
}
if (debugOn) {
  (window as unknown as Record<string, unknown>).__debug = {
    playerPos: () => ({ ...game.player.pos }),
    giveItem: (id: BlockId, n: number) => { game.inventory.add(id, n); renderHud(); },
    fps: () => fpsValue,
    game,
  };
  (window as unknown as { __triangles: () => number }).__triangles = () => scene.triangleCount();
}

let lastHotbar = '';
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const { stick, pressed } = pad.poll(now);
  if (hud.blockingOverlayOpen) {
    game.player.setStick(0, 0);
  } else {
    if (stick[0] !== 0 || stick[1] !== 0) {
      const [sx, sz] = padStick(stick);
      game.player.setStick(sx, sz);
      game.noteActivity();
    } else {
      game.player.setStick(0, 0);
    }
    for (const action of pressed) game.padAction(action);
  }

  game.update(dt);
  const p = game.player.pos;
  playerModel.position.set(p.x, p.y, p.z);
  playerModel.rotation.y = game.player.heading;
  scene.followTarget(playerModel.position, 0, dt);
  scene.render();

  const key = JSON.stringify([game.inventory.toJSON(), game.effectiveSelected()]);
  if (key !== lastHotbar) { lastHotbar = key; renderHud(); }

  fpsFrames++;
  if (now - fpsSince >= 500) {
    fpsValue = Math.round((fpsFrames * 1000) / (now - fpsSince));
    fpsFrames = 0;
    fpsSince = now;
    if (fpsEl) fpsEl.textContent = `${fpsValue} fps`;
  }
  requestAnimationFrame(frame);
}
renderHud();
requestAnimationFrame(frame);

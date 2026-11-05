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
import { Voice } from './audio/voice';
import { LINES } from './content/lines';
import { CraftScreen } from './ui/craft';
import { Hud } from './ui/hud';
import { Voice } from './audio/voice';
import { LINES, LINE_ICONS, type LineKey } from './content/lines';
import { Pal } from './game/pal';

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

// Pip follows the player; Pal holds the logic, main.ts only voices and draws it.
const pip = makePalModel();
scene.add(pip);
let pipHop = 0; // seconds into the happy hop; 0 = not hopping
const BUBBLE_WORDS: Partial<Record<LineKey, string>> = { hello: 'Hi!', welcomeBack: 'Hi!', crafted: 'Yay!', collectedFirst: 'Yay!' };
let bubbleTimer = 0;
const voice = new Voice();
const sayLine = (key: LineKey): void => {
  const variants = LINES[key];
  const text = variants[Math.floor(Math.random() * variants.length)];
  voice.say(text);
  hud.showBubble(LINE_ICONS[key], BUBBLE_WORDS[key]);
  clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => hud.hideBubble(), 3000);
};
const pal = new Pal(
  { x: Math.floor(spawn.x + 1.8) + 0.5, y: spawn.y, z: Math.floor(spawn.z + 1.2) + 0.5 },
  sayLine,
);
pal.setHasWood(() => game.inventory.count(BlockId.Wood) > 0);
game.on(e => pal.handle(e));
let greeted = false;
const greetOnce = (): void => {
  if (greeted) return;
  greeted = true;
  pal.greet(hadSave);
};

const occupied = (): Cell[] => {
  const [x, y, z] = game.player.feetCell();
  const [px, py, pz] = pal.feetCell();
  return [[x, y, z], [x, y + 1, z], [px, py, pz], [px, py + 1, pz]];
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
  onCraft: () => craftScreen.open(),
  onGrownUps: () => {},
});

const craftVoice = new Voice();
const craftScreen = new CraftScreen(document.getElementById('ui')!, {
  inventory: game.inventory,
  tryCraft: id => game.tryCraft(id),
  iconFor: scene.atlas.iconDataUrl,
  say: text => craftVoice.say(text),
  sayNeedMore: () => craftVoice.say(LINES.craftNeedMore[Math.floor(Math.random() * LINES.craftNeedMore.length)]),
  sfxTap: () => sfx.tap(),
  sfxCraft: () => sfx.craft(),
  sayFull: () => craftVoice.say(LINES.full[Math.floor(Math.random() * LINES.full.length)]),
  onOpenChange: open => {
    hud.setOverlayOpen(open);
    game.paused = open;
    if (open) { game.player.setPath(null); game.player.setStick(0, 0); }
  },
});
game.onCraftRequest = () => craftScreen.open();

// Taps on the canvas: pick, resolve, debounce, apply.
const allowTap = createDebouncer();
scene.renderer.domElement.addEventListener('pointerup', e => {
  sfx.unlock();
  greetOnce();
  if (hud.blockingOverlayOpen || !allowTap('tap', performance.now())) return;
  const hit = scene.pick(e.clientX, e.clientY);
  game.applyIntent(resolveTap(hit, game.effectiveSelected(), game.player.feetCell(), world, occupied()));
});
window.addEventListener('pointerdown', () => { sfx.unlock(); greetOnce(); }, { once: true });

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
    pipPos: () => ({ ...pal.pos }),
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
  if (craftScreen.isOpen) {
    game.player.setStick(0, 0);
    craftScreen.padInput(stick, pressed);
  } else if (hud.blockingOverlayOpen) {
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
  pal.update(world, game.player, dt);
  if (pal.takeHop()) pipHop = 0.0001;
  let hopY = 0;
  if (pipHop > 0) {
    pipHop += dt;
    hopY = Math.abs(Math.sin(pipHop * 8)) * 0.6;
    if (pipHop > 0.8) pipHop = 0;
  }
  pip.position.set(pal.pos.x, pal.pos.y + hopY, pal.pos.z);
  pip.rotation.y = pal.heading;
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
// Show Pip's greeting picture straight away; the voice follows the first tap (mobile needs a gesture).
hud.showBubble(LINE_ICONS[hadSave ? 'welcomeBack' : 'hello'], 'Hi!');
requestAnimationFrame(frame);

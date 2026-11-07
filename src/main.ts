import './ui/styles.css';
import { BlockId } from './core/blocks';
import type { Cell } from './core/pathfind';
import { applySave, readSave, startAutosave } from './core/save';
import { generateWorld } from './core/worldgen';
import { Game } from './game/game';
import { GamepadInput } from './input/gamepad';
import { loadMapping } from './input/mapping';
import { GestureClassifier, type GestureEvent } from './input/gesture';
import { createDebouncer, resolveHold, resolveTap } from './input/tap';
import { makePalModel, makePlayerModel } from './render/characters';
import { GameScene } from './render/scene';
import { sfx } from './audio/sfx';
import { CraftScreen } from './ui/craft';
import { Hud } from './ui/hud';
import { Voice } from './audio/voice';
import { LINES, LINE_ICONS, type LineKey } from './content/lines';
import { Pal } from './game/pal';
import { UsageTracker } from './core/usage';
import { GrownUps } from './ui/grownups';

let storage: Storage | null = null;
try { storage = window.localStorage; } catch { /* Storage may be blocked. */ }
const saved = readSave(storage);
export const hadSave: boolean = saved !== null; // for Pip's welcome-back line (Task 10)
const seed = saved?.seed ?? 2026;
const initial = saved ? applySave(saved) : generateWorld(seed);
const { world, spawn } = initial;
const scene = new GameScene(document.getElementById('game')!, world);
const game = new Game(initial);
const stopAutosave = startAutosave(game, seed, storage);
const usage = new UsageTracker(storage);
world.onChange((x, _y, z) => scene.rebuildChunkAt(x, z));

const playerModel = makePlayerModel();
scene.add(playerModel);

// Pip follows the player; Pal holds the logic, main.ts only voices and draws it.
const pip = makePalModel();
scene.add(pip);
let pipHop = 0; // seconds into the happy hop; 0 = not hopping
const BUBBLE_WORDS: Partial<Record<LineKey, string>> = { hello: 'Hi!', welcomeBack: 'Hi!', crafted: 'Yay!', collectedFirst: 'Yay!', upYouCome: 'Up!' };
let bubbleTimer = 0;
const voice = new Voice();
const sayLine = (key: LineKey): void => {
  const variants = LINES[key];
  const text = variants[Math.floor(Math.random() * variants.length)];
  voice.say(text);
  if (key === 'breakTime') {
    hud.showBreak(() => usage.resetSessionTimer());
    return;
  }
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
  else if (e.type === 'walking') { sfx.walk(); scene.showMarker(e.to); }
});

let hudRevision = -1;
let hudSelected: BlockId | 'hand' | null = null;
function renderHud(): void {
  const hotbar = game.inventory.hotbar().map(id => ({ id, count: game.inventory.count(id) }));
  const sel = game.effectiveSelected();
  hudRevision = game.inventory.revision;
  hudSelected = sel;
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
  onCraft: openCraft,
  onGrownUps: () => {},
  onGrownUpsHold: (down, id) => (down ? grownUps.holdStart(id) : grownUps.holdEnd(id)),
});

function syncOverlays(): void {
  const open = craftScreen.isOpen || grownUps.isOpen;
  hud.setOverlayOpen(open);
  game.paused = open;
  if (open) { game.player.setPath(null); game.player.setStick(0, 0); }
}
function openCraft(): void { if (!grownUps.isOpen) craftScreen.open(); }

const craftScreen = new CraftScreen(document.getElementById('ui')!, {
  inventory: game.inventory,
  tryCraft: id => game.tryCraft(id),
  iconFor: scene.atlas.iconDataUrl,
  say: text => voice.say(text),
  sayNeedMore: () => voice.say(LINES.craftNeedMore[Math.floor(Math.random() * LINES.craftNeedMore.length)]),
  sfxTap: () => sfx.tap(),
  sfxCraft: () => sfx.craft(),
  sayFull: () => voice.say(LINES.full[Math.floor(Math.random() * LINES.full.length)]),
  onOpenChange: syncOverlays,
});
game.onCraftRequest = openCraft;

let pad = new GamepadInput(loadMapping(storage));
const grownUps = new GrownUps(document.getElementById('ui')!, {
  usage,
  storage,
  captureButton: () => pad.captureNextButton(),
  cancelCapture: () => pad.cancelCapture(),
  getMapping: () => loadMapping(storage),
  onMappingSaved: m => { pad = new GamepadInput(m); },
  stopAutosave,
  onOpenChange: syncOverlays,
});

const flushUsage = (): void => usage.flush();
setInterval(flushUsage, 15_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushUsage();
  else last = performance.now();
});
window.addEventListener('pagehide', flushUsage);

// Touches on the canvas (spec §7a, fix round 1): a release before ½ s walks or builds,
// a press and hold digs. HUD buttons stop propagation, so they never reach here.
const allowTap = createDebouncer();
const gesture = new GestureClassifier();
const canvas = scene.renderer.domElement;
type Hit = ReturnType<typeof scene.pick>;
let pressHit: Hit = null;

const holdNow = (hit: Hit) => resolveHold(hit, game.player.feetCell(), world, occupied());
function endHoldVisuals(): void {
  hud.hideDigRing();
  scene.showOutline(null);
  sfx.digStop(); // every way a hold ends (complete, lift, slide, overlay) comes through here
}
function handleGesture(events: GestureEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case 'holdStart':
      case 'holdProgress': {
        const intent = holdNow(pressHit);
        if (intent.kind !== 'dig') { endHoldVisuals(); break; }
        hud.showDigRing(ev.x, ev.y, ev.progress);
        sfx.digStart();
        scene.showOutline(intent.cell);
        break;
      }
      case 'holdComplete':
        endHoldVisuals();
        // Resolved again now: he may have walked while holding. Too far → walk beside it.
        if (allowTap('hold', performance.now())) game.applyIntent(holdNow(pressHit));
        break;
      case 'tap':
        endHoldVisuals();
        if (!allowTap('tap', performance.now())) break;
        game.applyIntent(resolveTap(scene.pick(ev.x, ev.y), game.effectiveSelected(), game.player.feetCell(), world, occupied()));
        break;
      case 'holdStop':
      case 'cancel':
        endHoldVisuals();
        break;
      case 'drag': // spec §7c: a slide turns the camera and never walks, builds or digs
        scene.rig.drag(ev.dx, ev.dy, canvas.clientWidth || window.innerWidth);
        break;
    }
  }
}
const cancelPress = (id?: number): void => handleGesture(gesture.cancel(id));

canvas.addEventListener('pointerdown', e => {
  sfx.unlock();
  greetOnce();
  if (hud.blockingOverlayOpen) return;
  handleGesture(gesture.down(e.pointerId, e.clientX, e.clientY, performance.now()));
  if (gesture.activeId !== e.pointerId) return; // a second finger: ignored
  try { canvas.setPointerCapture(e.pointerId); } catch { /* not every pointer can be captured */ }
  pressHit = scene.pick(e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', e => {
  if (hud.blockingOverlayOpen) { cancelPress(); return; }
  handleGesture(gesture.move(e.pointerId, e.clientX, e.clientY, performance.now()));
});
canvas.addEventListener('pointerup', e => {
  if (hud.blockingOverlayOpen) { cancelPress(e.pointerId); return; }
  handleGesture(gesture.up(e.pointerId, e.clientX, e.clientY, performance.now()));
});
// A lost release must never leave a press stuck (the classifier also drops presses over 2 s old).
canvas.addEventListener('pointercancel', e => cancelPress(e.pointerId));
canvas.addEventListener('lostpointercapture', e => cancelPress(e.pointerId));
window.addEventListener('blur', () => cancelPress());
// A long press must not open a menu or select anything.
canvas.addEventListener('contextmenu', e => e.preventDefault());
// Capture phase: HUD buttons stop propagation, but a first tap on them must still unlock audio and greet.
window.addEventListener('pointerdown', () => { sfx.unlock(); greetOnce(); }, { once: true, capture: true });

const camDir = { x: 0, z: 1 };

/** Left stick relative to where the camera faces (its yaw, so pitch never matters). */
function padStick(stick: [number, number]): [number, number] {
  camDir.x = Math.sin(scene.rig.yaw);
  camDir.z = Math.cos(scene.rig.yaw);
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
    screenOf: (x: number, y: number, z: number) => scene.screenOf(x, y, z),
    pick: (x: number, y: number) => scene.pick(x, y),
    outlineVisible: () => scene.outlineVisible,
    camera: () => {
      const c = scene.camera.position;
      return { position: { x: c.x, y: c.y, z: c.z }, yaw: scene.rig.yaw, pitch: scene.rig.pitch, distance: scene.rig.distance, close: scene.rig.close };
    },
    dragging: () => gesture.dragging,
    digSound: () => sfx.digState(),
    game,
    usage,
    pal,
  };
  (window as unknown as { __triangles: () => number }).__triangles = () => scene.triangleCount();
}

let usageMs = 0;
let last = performance.now();
function frame(now: number): void {
  const rawMs = now - last;
  const dt = Math.min(0.1, rawMs / 1000);
  last = now;

  const { stick, look, pressed } = pad.poll(now);
  if (grownUps.isOpen) {
    game.player.setStick(0, 0);
  } else if (craftScreen.isOpen) {
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
    if (look[0] !== 0 || look[1] !== 0) {
      scene.rig.turn(look[0], look[1], dt);
      game.noteActivity();
    }
  }

  if (hud.blockingOverlayOpen) cancelPress();
  else if (gesture.busy && !gesture.dragging) handleGesture(gesture.tick(now, holdNow(pressHit).kind === 'dig'));
  game.update(dt);
  // Usage is counted once a second, not every frame (it caps each tick at 5 s anyway).
  usageMs += rawMs;
  if (usageMs >= 1000) {
    if (usage.tick(usageMs, document.visibilityState === 'visible').remind) pal.remindBreak();
    usageMs = 0;
  }
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
  scene.followTarget(playerModel.position, dt);
  // The hysteresis flag keeps the model hidden through close-mode glides (Pip still shows).
  playerModel.visible = !scene.rig.close;
  scene.updateMarker(dt);
  scene.render();

  // Redraw the hotbar only when a count or the selection changed.
  const rev = game.inventory.revision;
  const sel = game.effectiveSelected();
  if (rev !== hudRevision || sel !== hudSelected) renderHud();

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

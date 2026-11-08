import './ui/styles.css';
import { BlockId } from './core/blocks';
import type { Cell } from './core/pathfind';
import { applySave, readSave, serialise, startAutosave, storeSave } from './core/save';
import { generateWorld } from './core/worldgen';
import { Game } from './game/game';
import { GamepadInput } from './input/gamepad';
import { loadMapping } from './input/mapping';
import { GestureClassifier, type GestureEvent } from './input/gesture';
import { createDebouncer, resolveHold, resolveTap } from './input/tap';
import { idleVillager, makeEmblem, makePalModel, makePlayerModel, makeVillagerModel } from './render/characters';
import { pipHiddenFor } from './render/cameraRig';
import { GameScene } from './render/scene';
import { sfx } from './audio/sfx';
import { CraftScreen } from './ui/craft';
import { Hud } from './ui/hud';
import { Voice, audioLocked } from './audio/voice';
import { LINES, LINE_ICONS, pickLine, type LineKey } from './content/lines';
import { Pal } from './game/pal';
import { LeadToVillage } from './game/lead';
import { GreetTracker } from './game/villagers';
import { DeferredOnce, allowLine, craftSpeech, helperDt, leadPaused, mayGreet, mayPipSpeakQueued, type SpeechContext } from './game/speechPolicy';
import { DOOR_EMBLEMS, VILLAGERS, VILLAGER_LINES, pickVillagerLine, type VillagerId } from './content/villagers';
import { isStandable } from './core/pathfind';
import { UsageTracker } from './core/usage';
import { GrownUps } from './ui/grownups';

let storage: Storage | null = null;
try { storage = window.localStorage; } catch { /* Storage may be blocked. */ }
const saved = readSave(storage);
export const hadSave: boolean = saved !== null; // for Pip's welcome-back line (Task 10)
const seed = saved?.seed ?? 2026;
const loaded = saved ? applySave(saved) : null;
const initial = loaded ?? generateWorld(seed);
const { world, spawn, village } = initial;
const scene = new GameScene(document.getElementById('game')!, world);
const game = new Game(initial);
const flags = loaded?.flags ?? { ledToVillage: false };
const stopAutosave = startAutosave(game, seed, storage, flags);
const usage = new UsageTracker(storage);
world.onChange((x, _y, z) => scene.rebuildChunkAt(x, z));

const playerModel = makePlayerModel();
scene.add(playerModel);

// Pip follows the player; Pal holds the logic, main.ts only voices and draws it.
const pip = makePalModel();
scene.add(pip);

// Neighbours stand in their houses facing the door, off the door line. They are not solid (like Pip).
const villagers: Array<{ id: VillagerId; model: ReturnType<typeof makeVillagerModel>; cell: Cell }> = [];
for (const def of VILLAGERS) {
  const house = village.houses.find(h => h.id === def.house);
  if (!house) continue;
  const [nx, ny, nz] = house.npcSpot;
  const model = makeVillagerModel(def.id);
  model.position.set(nx + 0.5, ny, nz + 0.5);
  model.rotation.y = Math.atan2(house.doorInside[0] - nx, house.doorInside[2] - nz);
  scene.add(model);
  villagers.push({ id: def.id, model, cell: house.npcSpot });
}
// A picture sign over every door (house -> emoji), floating just in front of the wall.
for (const house of village.houses) {
  const emblem = makeEmblem(DOOR_EMBLEMS[house.id]);
  const out = [house.doorFront[0] - house.doorCells[0][0], house.doorFront[2] - house.doorCells[0][2]];
  const cx = house.doorCells.reduce((a, c) => a + c[0] + 0.5, 0) / house.doorCells.length;
  const cz = house.doorCells.reduce((a, c) => a + c[2] + 0.5, 0) / house.doorCells.length;
  emblem.position.set(cx + out[0] * 0.8, house.groundY + 4.9, cz + out[1] * 0.8);
  scene.add(emblem);
}
let pipHop = 0; // seconds into the happy hop; 0 = not hopping
const BUBBLE_WORDS: Partial<Record<LineKey, string>> = { hello: 'Hi!', welcomeBack: 'Hi!', crafted: 'Yay!', collectedFirst: 'Yay!', upYouCome: 'Up!' };
let bubbleTimer = 0;
const voice = new Voice(undefined, {
  fetch: (...a) => fetch(...a),
  base: import.meta.env.BASE_URL,
  audio: () => sfx.audioOut(),
});
const lastSpoken: Partial<Record<LineKey, string>> = {};
const speakVariant = (key: LineKey): void => {
  if (!allowLine(hud.breakOpen, key)) return; // the break reminder is never cut by another line
  const text = pickLine(key, lastSpoken[key]);
  if (!text) return; // never speak '' - it would cancel current speech
  lastSpoken[key] = text;
  voice.say(text);
};
const sayLine = (key: LineKey): void => {
  // The break reminder has priority: while its bubble is up nothing else talks over it or cuts it.
  if (!allowLine(hud.breakOpen, key)) return;
  speakVariant(key);
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
// The welcome is marked delivered only when it is admitted; an open break bubble holds it until it closes.
const welcome = new DeferredOnce();
const tryWelcome = (): void => {
  if (welcome.take(hud.breakOpen)) pal.greet(hadSave);
};
const greetOnce = (): void => {
  welcome.want();
  tryWelcome();
};

const occupied = (): Cell[] => {
  const [x, y, z] = game.player.feetCell();
  const [px, py, pz] = pal.feetCell();
  const cells: Cell[] = [[x, y, z], [x, y + 1, z], [px, py, pz], [px, py + 1, pz]];
  for (const v of villagers) cells.push(v.cell, [v.cell[0], v.cell[1] + 1, v.cell[2]]);
  return cells;
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
  ...craftSpeech(() => hud.breakOpen, {
    say: text => voice.say(text),
    needMore: () => speakVariant('craftNeedMore'),
    full: () => speakVariant('full'),
  }),
  sfxTap: () => sfx.tap(),
  sfxCraft: () => sfx.craft(),
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
window.addEventListener('pointerdown', () => { sfx.unlock(); greetOnce(); tapped = true; }, { once: true, capture: true });
// Clips are fetched on first use; only the greetings are warmed once the first tap has unlocked audio.
window.addEventListener('pointerdown', () => voice.prefetch([...LINES.hello, ...LINES.welcomeBack]), { once: true, capture: true });

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

// Neighbours greet on their own when he walks near; Pip leads him there once (until he has arrived).
const greet = new GreetTracker();
const villagerById = Object.fromEntries(VILLAGERS.map(v => [v.id, v])) as Record<VillagerId, (typeof VILLAGERS)[number]>;
const lastHello: Partial<Record<VillagerId, string>> = {};
const warmed = new Set<VillagerId>();
// Neighbour lookups done once, not per frame.
const warmZones = VILLAGERS.flatMap(def => {
  const house = village.houses.find(h => h.id === def.house);
  return house ? [{ def, rect: house.greetRect }] : [];
});
let currentHello: { text: string; speaker: string } | null = null;
let tapped = false; // the first tap / button unlocks audio
const feet: Cell = [0, 0, 0]; // reused every frame
let lastGestureAt = 0; // every tap or press retries the unlock, so the grace restarts
window.addEventListener('pointerdown', () => { lastGestureAt = performance.now(); }, true);
const isAudioLocked = (): boolean => audioLocked(tapped, sfx.audioOut()?.ctx.state, performance.now() - lastGestureAt);
const lead = new LeadToVillage(village.route, village.square, flags.ledToVillage);
let acted = false;
game.on(e => { if (e.type !== 'idle') acted = true; });
let pendingPip: LineKey | null = null;
let cosySaid = false;
const cottage = village.houses.find(h => h.id === 'cottage');
const saveNow = (): void => { storeSave(storage, serialise(game, seed, flags)); };

function updateVillage(dt: number): void {
  const breakOpen = hud.breakOpen;
  tryWelcome(); // replays a welcome the break bubble held back, once the bubble has closed
  const paused = game.paused || hud.blockingOverlayOpen;
  if (breakOpen) pal.hush(1000); // Pip's own chatter waits for the break bubble
  const pp = game.player.pos;
  feet[0] = Math.floor(pp.x); feet[1] = Math.floor(pp.y); feet[2] = Math.floor(pp.z);
  const cell = feet;
  const ev = lead.update(dt, cell, acted, leadPaused(paused, breakOpen));
  acted = false;
  if (ev === 'start') { pal.setLead(village.route, () => lead.targetIndex()); pendingPip = 'letsMeetNeighbours'; }
  else if (ev === 'comeOn' || ev === 'thisWay') pendingPip = ev;
  else if (ev === 'arrive') { pal.setLead(null); pendingPip = 'weAreHere'; }
  else if (ev === 'giveUp') pal.setLead(null);
  if (lead.takeFlagSet()) {
    flags.ledToVillage = true;
    saveNow();
  }
  if (paused) return;
  // Warm the clips of a neighbour he is walking towards.
  for (const { def, rect: r } of warmZones) {
    if (warmed.has(def.id)) continue;
    if (cell[0] >= r.x0 - 12 && cell[0] <= r.x1 + 12 && cell[2] >= r.z0 - 12 && cell[2] <= r.z1 + 12) {
      warmed.add(def.id);
      voice.prefetch(VILLAGER_LINES[def.id], def.speaker);
    }
  }
  // Walking away stops the hello itself, never a Pip line or break reminder that has replaced it.
  if (greet.takeCancel() && currentHello) {
    if (voice.stopIfCurrent(currentHello.text, currentHello.speaker)) hud.hideBubble();
    currentHello = null;
  }
  // Audio still locked (before the first tap): hold hellos and Pip's queued line instead of spending them silently.
  if (isAudioLocked()) return;
  const speech: SpeechContext = {
    breakOpen, speaking: voice.speaking(), locked: false, pipPending: pendingPip !== null, gestureBusy: gesture.busy,
  };
  // Pip waits for a neighbour to finish (and the other way round): nobody talks over anybody.
  if (pendingPip && mayPipSpeakQueued(speech)) {
    sayLine(pendingPip);
    pendingPip = null;
    return;
  }
  const hello = greet.update(cell, village.houses, !mayGreet(speech));
  if (hello) {
    const def = villagerById[hello];
    const text = pickVillagerLine(hello, lastHello[hello]);
    lastHello[hello] = text;
    currentHello = { text, speaker: def.speaker };
    voice.say(text, def.speaker);
    hud.showBubble(def.icon, 'Hi!');
    clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => hud.hideBubble(), 3000);
    pal.hush(5000);
    return;
  }
  if (!cosySaid && cottage) {
    const r = cottage.rect;
    if (cell[0] >= r.x0 && cell[0] <= r.x1 && cell[2] >= r.z0 && cell[2] <= r.z1) {
      cosySaid = true;
      pendingPip = 'cosyHome';
    }
  }
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
    voiceLast: () => ({ ...voice.last }),
    voiceSpeaking: () => voice.speaking(),
    audioState: () => ({ ctx: sfx.audioOut()?.ctx.state ?? null, tapped, locked: isAudioLocked(), pending: pendingPip, busy: gesture.busy }),
    village: () => ({
      houses: village.houses.map(h => ({ id: h.id, rect: h.rect, interior: h.interior, floor: h.floor, doorCells: h.doorCells, groundY: h.groundY, doorFront: h.doorFront, doorInside: h.doorInside, npcSpot: h.npcSpot, greetRect: h.greetRect })),
      route: village.route, square: village.square, gate: village.gate,
    }),
    flags: () => ({ ...flags }),
    leadState: () => lead.state,
    drawCalls: () => scene.renderer.info.render.calls,
    stats: () => ({ ...scene.stats(), fps: fpsValue, worldTriangles: scene.triangleCount() }),
    worldSize: () => ({ x: world.sizeX, y: world.sizeY, z: world.sizeZ }),
    saveNow,
    hidePlayer: (hide: boolean) => { debugHidePlayer = hide; },
    setCamera: (yaw: number, pitch: number) => { scene.rig.yaw = yaw; scene.rig.pitch = pitch; },
    teleport: (x: number, y: number, z: number) => {
      if (!isStandable(world, [Math.floor(x), Math.floor(y), Math.floor(z)])) return false;
      game.player.pos = { x, y, z };
      game.player.setPath(null);
      return true;
    },
    game,
    usage,
    pal,
  };
  (window as unknown as { __triangles: () => number }).__triangles = () => scene.triangleCount();
}

let usageMs = 0;
let pipGone = false;
let debugHidePlayer = false; // ?debug screenshots only
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
      acted = true;
    } else {
      game.player.setStick(0, 0);
    }
    if (pressed.length > 0) { sfx.unlock(); tapped = true; lastGestureAt = performance.now(); }
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
  updateVillage(dt);
  pal.update(world, game.player, helperDt(game.paused || hud.blockingOverlayOpen, dt));
  for (const v of villagers) idleVillager(v.model, now / 1000);
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
  // Hidden with hysteresis while the camera is near his head, so a back-view never fills a small room.
  playerModel.visible = !scene.rig.modelHidden && !debugHidePlayer;
  // Pip steps out of the picture when the camera is close to him or he would cover the middle of the view.
  pipGone = pipHiddenFor(scene.rig.position, scene.rig.forward, pip.position, pipGone);
  pip.visible = !pipGone;
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

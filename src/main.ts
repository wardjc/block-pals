import './ui/styles.css';
import { BLOCKS, BlockId } from './core/blocks';
import type { Cell } from './core/pathfind';
import { applySave, readSave, serialise, startAutosave, storeSave } from './core/save';
import { generateWorld } from './core/worldgen';
import { GrowthClock } from './core/growth';
import { cropBlock, seedFor, type CropKind } from './core/crops';
import { Game } from './game/game';
import { reactionKey } from './game/eating';
import { FarmHints, type HintContext, type HintKey } from './game/hints';
import { fernGift } from './game/fern';
import { Herd } from './game/animals';
import { mulberry32 } from './core/rng';
import { AnimalView, ANIMAL_VIEW_RANGE } from './render/animals';
import { Sparkles } from './render/effects';
import { pickAnimalAlongRay } from './input/entityPick';
import { GamepadInput } from './input/gamepad';
import { loadMapping } from './input/mapping';
import { GestureClassifier, type GestureEvent } from './input/gesture';
import { createDebouncer, resolveHold, resolveTap } from './input/tap';
import { animatePalTrot, animatePlayerWalk, idleVillager, makeWalkState, makeEmblem, makePalModel, makePlayerModel, makeVillagerModel, placeEmblem, setEatPose } from './render/characters';
import { pipHiddenFor } from './render/cameraRig';
import { GameScene } from './render/scene';
import { sfx } from './audio/sfx';
import { CraftScreen } from './ui/craft';
import { BagTray } from './ui/bag';
import { FEEDS, isItemId, ItemId, ITEMS, type StackId } from './core/items';
import { Hud, hudStateFor } from './ui/hud';
import { Voice, audioLocked } from './audio/voice';
import { LINES, LINE_ICONS, pickLine, type LineKey } from './content/lines';
import { Pal } from './game/pal';
import { LeadToVillage } from './game/lead';
import { GreetTracker } from './game/villagers';
import { DeferredOnce, LockedHold, allowLine, craftSpeech, helperDt, leadPaused, mayGreet, mayPipSpeakQueued, type SpeechContext } from './game/speechPolicy';
import { DOOR_EMBLEMS, FERN_LINES, VILLAGERS, VILLAGER_LINES, pickVillagerLine, type VillagerId } from './content/villagers';
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
const game = new Game(initial);
// Plants are blocks; the farm keeps their timers. Offline growth (capped at 8 h) is applied, and any
// pending stage changes are shown, before the first mesh is built so a catch-up costs no chunk rebuilds.
if (loaded) {
  game.farm.restore(loaded.farm.crops, loaded.farm.trees);
  game.farm.advance(loaded.offlineMs);
}
game.farm.records();
// The friendly herd lives inside the pasture fence (the fence ring itself and the gate row are never used).
const pasture = village.farm.pasture;
const roam = { x0: pasture.x0 + 1, z0: pasture.z0 + 1, x1: pasture.x1 - 1, z1: pasture.z1 - 1 };
const herd = new Herd(mulberry32((seed ^ 0xa11) >>> 0));
if (loaded) herd.restore(loaded.animals, village.farm.herdSpawns, world, roam, loaded.offlineMs / 1000);
else herd.populate(village.farm.herdSpawns);
game.herd = herd;
const scene = new GameScene(document.getElementById('game')!, world);
const animalView = new AnimalView(scene.scene);
const sparkles = new Sparkles(scene.scene);
const flags = loaded?.flags ?? { ledToVillage: false };
const hints = new FarmHints(flags.hints ?? []);
const stopAutosave = startAutosave(game, seed, storage, flags, () => herd.toJSON());
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
  placeEmblem(emblem, house);
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
/** Pip's lead and idle lines: held until the audio context runs, never spoken by the tablet voice while it is locked. */
const HELD_KEYS: ReadonlySet<LineKey> = new Set<LineKey>([
  'letsMeetNeighbours', 'comeOn', 'thisWay', 'weAreHere', 'cosyHome', 'idleHint', 'letsFindWood',
  'plantSome', 'needWaterSun', 'cropReady', 'holdOutFood', 'tryMunch',
]);
const speakVariant = (key: LineKey): void => {
  if (!allowLine(hud.breakOpen, key)) return; // the break reminder is never cut by another line
  const text = pickLine(key, lastSpoken[key]);
  if (!text) return; // never speak '' - it would cancel current speech
  lastSpoken[key] = text;
  voice.say(text, 'pip', { holdForAudio: HELD_KEYS.has(key) });
};
/** True when the last sayLine really spoke (a hint is only counted as told then). */
let lineSpoken = false;
const sayLine = (key: LineKey): void => {
  lineSpoken = false;
  // The break reminder has priority: while its bubble is up nothing else talks over it or cuts it.
  if (!allowLine(hud.breakOpen, key)) return;
  if (HELD_KEYS.has(key) && isAudioLocked()) return; // an idle hint or lead line while audio is locked: dropped quietly
  lineSpoken = true;
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

/** Where people stand (him, Pip, the neighbours): the animals keep out of these. */
const peopleCells = (): Cell[] => {
  const [x, y, z] = game.player.feetCell();
  const [px, py, pz] = pal.feetCell();
  const cells: Cell[] = [[x, y, z], [x, y + 1, z], [px, py, pz], [px, py + 1, pz]];
  for (const v of villagers) cells.push(v.cell, [v.cell[0], v.cell[1] + 1, v.cell[2]]);
  return cells;
};
/** Everyone, animals too: nothing can be built into an animal and the ground under one is never dug. */
const occupied = (): Cell[] => [...peopleCells(), ...herd.occupiedCells()];
game.setOccupied(occupied);

// Real-time growth: one clock, one rule (never negative, capped). A sleeping tab sees one capped step.
const growthClock = new GrowthClock(Date.now());
const tickGrowth = (): void => game.farm.advance(growthClock.step(Date.now()));
setInterval(tickGrowth, 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tickGrowth(); });
const burstAt = (cell: Cell, kind: 'water' | 'sun' | 'both' | 'heart' | 'crumb'): void =>
  sparkles.burst({ x: cell[0] + 0.5, y: cell[1] + 0.4, z: cell[2] + 0.5 }, kind);
game.farm.onEvent(e => {
  if (e.type === 'planted') { sfx.plant(); burstAt(e.cell, 'crumb'); }
  else if (e.type === 'helped') {
    if (e.cue === 'water') sfx.water(); else sfx.sun();
    burstAt(e.cell, e.cue);
  } else if (e.type === 'harvested') { sfx.pick(); react('harvested'); }
  else if (e.type === 'ripe') sfx.chime();
});
const NOISE = { chicken: sfx.cluck, cow: sfx.moo, sheep: sfx.baa, pig: sfx.oink } as const;
game.on(e => {
  const a = 'animal' in e ? herd.animals.find(o => o.id === e.animal) : undefined;
  if (!a) return;
  const at = { x: a.x, y: a.y + 0.9, z: a.z };
  if (e.type === 'fed') {
    sfx.gift();
    sparkles.burst(at, 'heart');
    hud.showBubble(ITEMS[e.gift].icon);
    react(e.gift === ItemId.Egg ? 'gotEgg' : e.gift === ItemId.Milk ? 'gotMilk' : e.gift === ItemId.Wool ? 'gotWool' : 'fedAnimal');
  } else if (e.type === 'petted' || e.type === 'resting') {
    sfx.pet();
    sparkles.burst(at, 'heart', 6);
    react(e.type === 'resting' ? 'animalFull' : 'petAnimal');
  }
});

/** Pip's plain-word reaction: once per kind per 20 s, then the Pal's own gap, and never over the break reminder. */
function react(key: LineKey): void {
  const now = Date.now();
  if (hud.breakOpen || !hints.reactionReady(key, now)) return;
  if (pal.react(key)) hints.reactionSaid(key, now); // a line the chatter gap held back does not use up its 20 s
}
// Eating: sound at once, the pose and crumbs follow the 1.3 s munch clock, Pip speaks when it ends.
game.on(e => {
  if (e.type !== 'ate') return;
  if (e.id === ItemId.Milk) sfx.drink(); else sfx.munch();
  eatEmoji = ITEMS[e.id].icon;
});

game.on(e => {
  if (e.type === 'collected') sfx.pop();
  else if (e.type === 'placed') sfx.place();
  else if (e.type === 'walking') { sfx.walk(); scene.showMarker(e.to); }
});

let eatEmoji = '🍎';
let eatBite = 0;
let eatPosed = false;
let hudRevision = -1;
let hudSelected: StackId | 'hand' | null = null;
const bagStacks = (): Array<{ id: StackId; count: number }> =>
  game.inventory.slots().map(id => ({ id, count: game.inventory.count(id) }));
/** Blocks are atlas tiles; items draw as emoji pictures, so they have no tile url. */
const stackIcon = (id: StackId): string => (isItemId(id) ? '' : scene.atlas.iconDataUrl(id));
function renderHud(): void {
  const sel = game.effectiveSelected();
  hudRevision = game.inventory.revision;
  hudSelected = sel;
  const edible = sel !== 'hand' && isItemId(sel) && ITEMS[sel].edible;
  hud.render(hudStateFor(bagStacks(), sel, edible));
}

const hud = new Hud(document.getElementById('ui')!, stackIcon, {
  onSelect: i => {
    const id = game.inventory.slots()[i - 1];
    game.selected = i === 0 || id === undefined ? 'hand' : id;
    sfx.tap();
    renderHud();
  },
  onBag: () => { if (!craftScreen.isOpen && !grownUps.isOpen) bagTray.open(); },
  onCraft: openCraft,
  onGrownUps: () => {},
  onGrownUpsHold: (down, id) => (down ? grownUps.holdStart(id) : grownUps.holdEnd(id)),
});

hud.onMunch(() => game.applyIntent({ kind: 'eat' }));

function syncOverlays(): void {
  const open = craftScreen.isOpen || grownUps.isOpen || bagTray.isOpen;
  hud.setOverlayOpen(open);
  game.paused = open;
  if (open) { game.player.setPath(null); game.player.setStick(0, 0); }
}
function openCraft(): void { if (!grownUps.isOpen && !bagTray.isOpen) craftScreen.open(); }

const bagTray = new BagTray(document.getElementById('ui')!, {
  stacks: bagStacks,
  iconFor: stackIcon,
  current: () => game.effectiveSelected(),
  select: id => { game.selected = id; sfx.tap(); renderHud(); },
  onOpenChange: syncOverlays,
});

const craftScreen = new CraftScreen(document.getElementById('ui')!, {
  inventory: game.inventory,
  tryCraft: id => game.tryCraft(id),
  iconFor: stackIcon,
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
/** The animal under the finger when it went down: a hold on it does nothing and never digs behind it. */
let pressAnimal: number | null = null;
/**
 * The animal the finger is on: the ray through the point against the animals' padded boxes, the
 * nearest of animal and block along it wins, and an animal behind a block is never picked.
 */
const animalAt = (clientX: number, clientY: number): number | null => {
  const r = scene.pickRay(clientX, clientY);
  return pickAnimalAlongRay(r.origin, r.dir, animalView.boxes(), r.t);
};

const holdNow = (hit: Hit) => resolveHold(hit, game.player.feetCell(), world, occupied(), pressAnimal !== null);
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
        const tapped = animalAt(ev.x, ev.y);
        const animal = tapped === null ? undefined : herd.animals.find(o => o.id === tapped);
        const pf = game.player.pos;
        game.applyIntent(resolveTap(
          scene.pick(ev.x, ev.y), game.effectiveSelected(), game.player.feetCell(), world, occupied(),
          {
            plantAt: c => game.farm.isPlantCell(c),
            animalHit: animal
              ? { id: animal.id, dist: Math.hypot(animal.x - pf.x, animal.z - pf.z), cell: [Math.floor(animal.x), animal.y, Math.floor(animal.z)] }
              : null,
          },
        ));
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
  pressAnimal = animalAt(e.clientX, e.clientY);
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
const isAudioLocked = (): boolean => audioLocked(tapped, sfx.audioOut()?.ctx.state);
const lockedHold = new LockedHold();
const lead = new LeadToVillage(village.route, village.square, flags.ledToVillage);
let acted = false;
game.on(e => { if (e.type !== 'idle') acted = true; });
let pendingPip: LineKey | null = null;
let cosySaid = false;
const cottage = village.houses.find(h => h.id === 'cottage');
const saveNow = (): void => { storeSave(storage, serialise(game, seed, flags, Date.now(), herd.toJSON())); };

const HINT_ORDER: readonly HintKey[] = ['cropReady', 'tryMunch', 'plantSome', 'needWaterSun', 'holdOutFood'];
const isHintKey = (k: LineKey): k is HintKey => (HINT_ORDER as readonly string[]).includes(k);
let hintClock = 0;
let reactionsWarmed = false;
const REACTION_KEYS: readonly LineKey[] = [
  'harvested', 'ateApple', 'ateCarrot', 'atePotato', 'drankMilk', 'fedAnimal', 'animalFull', 'petAnimal', 'gotEgg', 'gotMilk', 'gotWool',
  'plantSome', 'needWaterSun', 'cropReady', 'holdOutFood', 'tryMunch',
];
const SEED_ITEMS = [ItemId.WheatSeed, ItemId.CarrotSeed, ItemId.PotatoSeed, ItemId.AppleSapling];
const within = (r: { x0: number; z0: number; x1: number; z1: number }, c: Cell, pad: number): boolean =>
  c[0] >= r.x0 - pad && c[0] <= r.x1 + pad && c[2] >= r.z0 - pad && c[2] <= r.z1 + pad;
const plotRect = {
  x0: Math.min(...village.farm.beds.map(b => b.x0)), z0: Math.min(...village.farm.beds.map(b => b.z0)),
  x1: Math.max(...village.farm.beds.map(b => b.x1)), z1: Math.max(...village.farm.beds.map(b => b.z1)),
};
function hintContext(cell: Cell): HintContext {
  const sel = game.effectiveSelected();
  return {
    hasSeeds: SEED_ITEMS.some(id => game.inventory.count(id) > 0),
    nearPlot: within(plotRect, cell, 8),
    planted: game.farm.seedsAndGrowing().growing > 0,
    ripeNearby: game.farm.nearestRipe(cell, 6) !== null,
    hasFood: FEEDS.some(id => game.inventory.count(id) > 0),
    nearPasture: within(pasture, cell, 6),
    edibleSelected: sel !== 'hand' && isItemId(sel) && ITEMS[sel].edible,
  };
}

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
  // Audio locked or suspended: hold hellos and Pip's queued line (the first tap resumes it, then they play
  // as clips). Held more than 30 s, they are dropped quietly and no cooldown is used up.
  const locked = isAudioLocked();
  if (lockedHold.update(dt, locked)) {
    pendingPip = null;
    greet.skipCurrent(cell, village.houses);
  }
  if (locked) return;
  const speech: SpeechContext = {
    breakOpen, speaking: voice.speaking(), locked: false, pipPending: pendingPip !== null, gestureBusy: gesture.busy,
  };
  // Pip waits for a neighbour to finish (and the other way round): nobody talks over anybody.
  if (pendingPip && mayPipSpeakQueued(speech)) {
    const said = pendingPip;
    pendingPip = null;
    if (isHintKey(said)) {
      // A hint goes through Pip's chatter gap like any reaction, and counts as told only once it was really said.
      // Checked again with fresh facts (he may have put the food away since it was queued).
      if (!hud.breakOpen && hints.shouldSay(said, hintContext(cell)) && pal.react(said) && lineSpoken) {
        hints.markSeen(said);
        flags.hints = hints.seen();
      }
    } else sayLine(said);
    return;
  }
  const hello = greet.update(cell, village.houses, !mayGreet(speech));
  if (hello) {
    const def = villagerById[hello];
    let text = pickVillagerLine(hello, lastHello[hello]);
    let icon = def.icon;
    let word: string | undefined = 'Hi!';
    if (hello === 'fern') {
      // Her first hello gives the starter seeds (once per save); later she tops up an empty bag. Saved at once.
      const gift = fernGift(flags, game.inventory, game.farm.seedsAndGrowing());
      if (gift) {
        const pool = gift.kind === 'seedGift' ? FERN_LINES.seedGift : FERN_LINES.moreSeeds;
        text = pool.filter(l => l !== lastHello.fern)[Math.floor(Math.random() * Math.max(1, pool.length - 1))] ?? pool[0];
        icon = '🌱';
        word = undefined;
        sfx.gift();
        renderHud();
        saveNow();
      }
    }
    lastHello[hello] = text;
    currentHello = { text, speaker: def.speaker };
    voice.say(text, def.speaker, { holdForAudio: true });
    hud.showBubble(icon, word);
    clearTimeout(bubbleTimer);
    bubbleTimer = window.setTimeout(() => hud.hideBubble(), 3000);
    pal.hush(5000);
    return;
  }
  if (!reactionsWarmed && (within(plotRect, cell, 14) || within(pasture, cell, 14))) {
    reactionsWarmed = true; // the farm's reaction lines are fetched once he is near, so the first one is not late
    voice.prefetch(REACTION_KEYS.flatMap(k => LINES[k]));
  }
  hintClock += dt;
  if (hintClock >= 1 && pendingPip === null && !hello && !game.eating.active) {
    hintClock = 0;
    const ctx = hintContext(cell);
    for (const k of HINT_ORDER) if (hints.shouldSay(k, ctx)) { pendingPip = k; break; }
  }
  if (!cosySaid && cottage) {
    const r = cottage.rect;
    if (cell[0] >= r.x0 && cell[0] <= r.x1 && cell[2] >= r.z0 && cell[2] <= r.z1) {
      cosySaid = true;
      pendingPip = 'cosyHome';
    }
  }
}

/** Animals wander, come over for food and make small happy noises (only near him, never over a voice). */
function updateHerd(dt: number, seconds: number): void {
  const events = herd.update({ world, roam, player: game.player.pos, held: game.effectiveSelected(), occupied: peopleCells(), dt });
  for (const ev of events) {
    if (ev.dist > 12 || voice.speaking() || hud.blockingOverlayOpen) continue;
    NOISE[ev.kind]();
  }
  const cam = scene.camera.position;
  animalView.sync(herd.animals, (x, z) => Math.hypot(x - cam.x, z - cam.z) < ANIMAL_VIEW_RANGE, seconds);
}

/** The munch: arms up, head dips, the little picture shrinks, crumbs on each bite, Pip speaks when it ends. */
function updateEating(): void {
  const e = game.eating;
  if (e.active) {
    setEatPose(playerModel, e.progress, e.bite, eatEmoji);
    if (e.bite > eatBite) {
      eatBite = e.bite;
      const q = game.player.pos;
      const h = game.player.heading;
      sparkles.burst({ x: q.x + Math.sin(h) * 0.35, y: q.y + 1.3, z: q.z + Math.cos(h) * 0.35 }, 'crumb', 3);
    }
    eatPosed = true;
  } else if (eatPosed) {
    setEatPose(playerModel, 0, 0);
    eatPosed = false;
    eatBite = 0;
  }
  const done = e.takeFinished();
  if (done !== null) react(reactionKey(done));
}

/** A rare, gentle sparkle over one ripe plant near him, so a ready crop catches the eye. */
let shimmerClock = 0;
function updateShimmer(dt: number): void {
  shimmerClock += dt;
  if (shimmerClock < 0.8) return;
  shimmerClock = 0;
  if (game.paused || hud.blockingOverlayOpen) return;
  const ripe = game.farm.nearestRipe(game.player.feetCell(), 10);
  if (ripe) sparkles.burst({ x: ripe[0] + 0.5, y: ripe[1] + 1.1, z: ripe[2] + 0.5 }, 'sun', 2);
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
    giveItem: (id: StackId, n: number) => { game.inventory.add(id, n); renderHud(); },
    // Only registered ids: a bad one would be autosaved and then rejected on the next load.
    setBlock: (x: number, y: number, z: number, id: BlockId) => { if (Object.hasOwn(BLOCKS, id)) game.world.set(x, y, z, id); },
    selectStack: (id: StackId | 'hand') => { game.selected = id; renderHud(); },
    openBag: () => bagTray.open(),
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
    resumeAudio: () => { sfx.unlock(); void sfx.audioOut()?.ctx.resume(); },
    audioState: () => ({ ctx: sfx.audioOut()?.ctx.state ?? null, tapped, locked: isAudioLocked(), pending: pendingPip, busy: gesture.busy }),
    village: () => ({
      houses: village.houses.map(h => ({ id: h.id, rect: h.rect, interior: h.interior, floor: h.floor, doorCells: h.doorCells, groundY: h.groundY, doorFront: h.doorFront, doorInside: h.doorInside, npcSpot: h.npcSpot, greetRect: h.greetRect })),
      route: village.route, square: village.square, gate: village.gate,
    }),
    flags: () => ({ ...flags }),
    leadState: () => lead.state,
    drawCalls: () => scene.renderer.info.render.calls,
    stats: () => ({ ...scene.stats(), fps: fpsValue, worldTriangles: scene.triangleCount(), animals: herd.animals.length, particles: sparkles.live }),
    herd: () => herd.animals.map(a => ({ id: a.id, kind: a.kind, x: a.x, y: a.y, z: a.z, state: a.state, giftIn: a.giftIn })),
    pasture: () => ({ ...pasture, roam, gate: village.farm.gate }),
    screenOfAnimal: (id: number) => {
      const p = animalView.screenPositions(scene.camera, canvas.getBoundingClientRect()).find(o => o.id === id);
      return p ? { x: p.sx, y: p.sy } : null;
    },
    burst: (kind: 'water' | 'sun' | 'both' | 'heart' | 'crumb') => { const q = game.player.pos; sparkles.burst({ x: q.x + 1.2, y: q.y + 1.6, z: q.z }, kind); },
    worldSize: () => ({ x: world.sizeX, y: world.sizeY, z: world.sizeZ }),
    saveNow,
    eating: () => ({ active: game.eating.active, progress: game.eating.progress, bite: game.eating.bite, food: game.eating.food }),
    layoutFarm: () => ({ beds: village.farm.beds, pool: village.farm.pool, irrigation: village.farm.irrigation, pasture, gate: village.farm.gate, fence: village.farm.fence, path: village.farm.path }),
    bag: () => game.inventory.slots().map(id => ({ id, count: game.inventory.count(id) })),
    farm: () => ({ ...game.farm.records(), seeds: game.farm.seedsAndGrowing() }),
    advanceFarm: (ms: number) => game.farm.advance(ms),
    plantAt: (x: number, z: number, kind: CropKind) => {
      const y = world.topSolidY(x, z) + 1;
      game.inventory.add(seedFor(kind), 1);
      renderHud();
      return game.farm.plant([x, y, z], seedFor(kind), []);
    },
    setStage: (x: number, z: number, stage: number) => {
      world.set(x, world.topSolidY(x, z) + 1, z, cropBlock('wheat', stage));
    },
    sparkles,
    limbs: () => {
      const u = playerModel.userData as Record<string, { rotation: { x: number } }>;
      const pl = (pip.userData.legs as { rotation: { x: number } }[]).map(l => l.rotation.x);
      return { legL: u.legL.rotation.x, legR: u.legR.rotation.x, armL: u.armL.rotation.x, armR: u.armR.rotation.x, bob: playerModel.position.y - game.player.pos.y, pip: pl };
    },
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
    hud,
  };
  (window as unknown as { __triangles: () => number }).__triangles = () => scene.triangleCount();
}

let usageMs = 0;
let pipGone = false;
let debugHidePlayer = false; // ?debug screenshots only
// Walk cycles advance by the distance actually moved each frame (blocked, paused or standing = 0 = ease to rest).
const playerWalk = makeWalkState();
const pipWalk = makeWalkState();
let prevPlayerX = game.player.pos.x, prevPlayerZ = game.player.pos.z;
let prevPipX = pal.pos.x, prevPipZ = pal.pos.z;
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
  } else if (bagTray.isOpen) {
    game.player.setStick(0, 0);
    bagTray.padInput(stick, pressed);
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
    if (pressed.length > 0) { sfx.unlock(); tapped = true; }
    for (const action of pressed) game.padAction(action);
    if (look[0] !== 0 || look[1] !== 0) {
      scene.rig.turn(look[0], look[1], dt);
      game.noteActivity();
    }
  }

  if (hud.blockingOverlayOpen) cancelPress();
  else if (gesture.busy && !gesture.dragging) handleGesture(gesture.tick(now, holdNow(pressHit).kind === 'dig'));
  game.update(dt);
  if (!game.paused) {
    game.farm.update(dt);
    updateHerd(dt, now / 1000);
  }
  sparkles.update(dt);
  updateShimmer(dt);
  // Usage is counted once a second, not every frame (it caps each tick at 5 s anyway).
  usageMs += rawMs;
  if (usageMs >= 1000) {
    if (usage.tick(usageMs, document.visibilityState === 'visible').remind) pal.remindBreak();
    usageMs = 0;
  }
  const p = game.player.pos;
  playerModel.position.set(p.x, p.y, p.z);
  playerModel.rotation.y = game.player.heading;
  animatePlayerWalk(playerModel, playerWalk, dt, Math.hypot(p.x - prevPlayerX, p.z - prevPlayerZ));
  prevPlayerX = p.x; prevPlayerZ = p.z;
  updateEating(); // after the walk swing: while he munches the arms belong to the munch (legs still walk)
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
  animatePalTrot(pip, pipWalk, dt, Math.hypot(pal.pos.x - prevPipX, pal.pos.z - prevPipZ));
  prevPipX = pal.pos.x; prevPipZ = pal.pos.z;
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

# Block Pals

A gentle, Minecraft-style block-building game for a five-year-old. Your child
walks around a small friendly world by tapping the ground, digs and collects
blocks, builds with them, and crafts new ones. A little pal called Pip follows along and
talks, preferring a British voice. There is no way to lose, no scary bits, no
adverts, no accounts and no tracking, and the game itself makes no network
calls once it has loaded. Progress is saved on the tablet. Pip's voice and the villagers' voices are pre-recorded with a free,
open-source voice (Kokoro), so they sound the same on every tablet and work
offline. If a recording is ever missing, the game falls back to the tablet's own
speech (it prefers a British voice), and with no voice at all it still works in
silence, with pictures. To change what Pip or the villagers say and re-record it, see
`tools/voice/README.md`. Credits are in `THIRD_PARTY_NOTICES.md`.

It is made to be played on a Galaxy Tab A8 in Chrome, installed to the home
screen, and it works in aeroplane mode.

## How to play (touch)

- **Quick tap on the ground: walk there.** A tap never digs, even a slow press
  that is lifted before half a second is up. (With a block selected, a tap
  builds instead if it is in reach and there is room, see below.)
- **Press and hold on a block for about half a second: dig it.** A ring fills
  around the finger. Lifting early counts as a tap, and sliding away turns the
  view instead. If the block is too far away, he walks up next to it. Holding digs
  whether the hand or a block is selected. Blocks under his or Pip's feet,
  water and the bottom layer cannot be dug.
- **Quick tap with a block selected: build.** The block goes on the face he
  tapped if it is in reach and there is room; otherwise he walks there.
- **Drag one finger on the world to turn the view.** Sideways turns around him;
  up and down tilts. A drag never walks, digs or builds.
- **The camera looks after itself.** It never goes inside the ground or behind
  walls. In tunnels and houses it pulls in and becomes first-person (his own
  model is hidden so you never see inside his head).
- **The bag** holds up to 99 of each kind of block. The bottom bar (the hotbar)
  shows a picture and a number for each. The first slot, the ✋ hand, means
  "no block": taps walk. Tap a block picture to select it, and taps build.
- **The 🛠️ crafting screen** is all pictures. Recipes: 1 wood makes
  2 planks; 3 sand makes 1 glass; 2 dirt and 2 stone make 1 brick; 1 wool makes
  2 coloured blocks (white, red, blue or yellow).
- **The 🎒 bag slot** appears when he holds more kinds than fit on the bar (eight). It opens a big picture
  grid of everything, each with its number and, up to 20, dots. Choose one and the grid closes.

## Playing with a controller

Pair a Bluetooth pad in Android settings first. Press a button on it if the
game does not seem to notice it.

- **Left stick (or the d-pad, which uses fixed button numbers)** walks, relative to where the camera is facing.
- **Second stick**, if the pad has one, turns the view. It only counts if the
  pad reports it as sitting in the middle when untouched; on some generic pads
  those axes rest at the edge (like triggers) and are ignored. Then use a
  finger on the screen to turn.
- **Buttons:** collect (dig), place (build), next slot. Holding place for one
  second opens the crafting screen.
- **Set up controller** (in the grown-ups area, below): the game asks you to
  press the button you want for Collect, then Place, then Next slot, and saves
  them on the tablet. Only those three can be changed; the d-pad and the
  second stick cannot be remapped, so some generic pads may lack some controls.

## The village (step 1)

The world is now four times bigger (96 by 96 blocks). Over the hill to the east is a village.

- **The path.** A wide stone path runs from where he starts to the village square. It is gentle all the way, so tapping along it always works.
- **His own cottage.** A tiny empty cottage stands next to where he starts. It is bright inside, with a lamp and windows, and he can build in it.
- **Four neighbours.** Bramble the Baker (bread sign), Captain Pebble at the block shop (pickaxe sign), Fern the Farmer (carrot sign) and Granny Willow (wool sign). Each lives in a real house made of blocks with a wide doorway. When he walks in, the neighbour says a short hello out loud, and a picture bubble shows the same. They stand still, never chase, and have nothing to buy or learn yet. He can dig or build on any house.
- **Pip leads the way.** On a new game, a few seconds after he starts playing, Pip says "Let's go and meet the neighbours!" and walks ahead along the path. He can follow, wander off, tap, dig or turn the view and nothing breaks. If he ignores Pip, Pip gives up quietly and asks again next time he plays, until he has reached the village once.
- **Inside houses.** The camera pulls in and his model fades out when it is close to him, so a small room is never blocked. Dragging to turn the view works inside houses too. Pip steps out of the picture when he would cover the middle of the view.
- **Saving.** The new version saves under a new name (`blockpals.save.v2`). If the tablet already holds his old world, it is carried over with every block and his position, and the old save (`blockpals.save.v1`) is left byte-for-byte untouched, plus a one-time backup (`blockpals.save.v1.backup`). Going back to an older version of the app still finds his old world. Only the grown-ups' reset deletes saves.
- **Speed.** Parts of the world beyond the fog are not drawn. This is checked by hand on the tablet (see below).

## Eating and the farm (step 2)

Everything here works with pictures, sounds and the voice. Nothing needs reading, nothing can be lost, and nothing can go wrong.

- **Seeds from Fern.** The first time he walks into Fern's farmhouse she says hello in her own voice and gives him seeds (wheat, carrot, potato and two apple saplings), with a 🌱 picture. This happens once for each saved game. If he ever has no seeds at all and nothing growing, her next hello gives some more. Every harvest also gives seeds back, so he can never run out.
- **Planting.** Select seeds on the bar, then a quick tap on grass, soil or dirt that is close by plants one. The soil turns dark and tilled. He can plant anywhere, so his own patch can be wherever he likes. Beside the farmhouse is a ready-made plot of three beds.
- **Growing.** A quick tap on a plant that is close by gives it water or sunshine, with a sparkle and a soft sound, and it grows one step. Three taps take a seed to ripe. Plants also grow by themselves while he plays and while the game is closed (a ripe plant about 7½ minutes after planting; up to 8 hours of being away counts). **Nothing ever wilts, dies or is lost.** A tap on a plant that is too far away just walks him there.
- **Picking.** Press and hold on a plant (the ring fills, like digging). A ripe plant gives 2 food and 2 seeds; a young one just gives its seed back. Apple trees grow from saplings, and holding on ripe apples picks them (the tree grows more).
- **Eating.** Select a food (apple, carrot, potato, or milk to drink) and a big 👄 mouth button appears. Tap it: three soft bites, a gentle crunch, and Pip says a plain word or two. It uses up one item and does nothing else. There is no hunger and nothing bad happens if he never eats. Wheat, eggs and wool have no mouth button.
- **The pasture.** South of the farm is a fenced field with four chickens, two cows, three sheep and a pig. They wander slowly, make small happy noises and are never scary or hurt. Holding out any food (apple, carrot, potato or wheat) makes them wander over. A quick tap on a close animal while holding food gives him a gift (egg, milk, wool, or a potato from the pig) and then the animal rests for 45 seconds; a tap on a resting animal uses no food. A tap with an empty hand pets. Pressing and holding on an animal does nothing, and a block cannot be placed into one. An animal that gets walled in is lifted out after a few seconds.
- **Wool** is crafted into coloured blocks in the crafting screen.
- **The bar and the bag.** Seeds and food are on the bar like blocks. See "The bag slot" above.
- **Voices.** Pip's farm lines and Fern's seed lines are pre-recorded like the rest (Pip and Fern each have their own voice).
- **His saved game.** Everything new is added to the saved game without changing what was there. The old save is still loaded and still has every block he built. The step 1 save entry is never touched.

### Things to know about step 2

- **The east hill.** The pasture levels the hill on the east side (x 58 to 90, z 45 to 61). If he has built anything there, it keeps its place but may float above the flattened ground.
- **Not tried on the tablet yet.** All the tests pass in a desktop browser, but the frame rate, the size of the touch targets, the sounds and the new voice clips have not been tried on the Galaxy Tab A8. Please use the checklist below.
- Eating, animals and farm growth have no coins, shops, hearts or quests yet (those are steps 3 and 4). Villagers have a favourite food stored but it does nothing yet. Flowing water and the bucket come later (the pool beside the plot is reserved for that).

### Step 2 checks on the Tab A8

Use `?debug` once for the frame-rate counter, then play without it.

1. Old save: open the new version on the tablet that has his world. Everything he built and his position are there. The farm, fence, pool and animals are new.
2. Fern: walk into the farmhouse. She says her seed line in her own voice, a 🌱 picture shows, and he has seeds. Walk out and back in: no second gift.
3. The bag slot: open it. Pictures with numbers and dots, big enough to hit. Choose seeds; the bar shows them selected.
4. Plant and grow: tap a bed, a sprout appears. Tap the sprout: sparkle, sound, it grows. Three taps and it is ripe. A tap a long way off just walks. Does he understand what happened without being told?
5. Pick: press and hold a ripe plant, the ring fills and food and seeds arrive. A young plant gives its seed back. Nothing is lost.
6. Waiting: plant three, close the game for 10 minutes, open it: they are bigger. Leave it a day: all ripe, none gone.
7. Eat: select a carrot, tap the big mouth. Three bites, a soft crunch, Pip says a plain line (no "Yum"). Try apple, potato and milk. Wheat has no mouth button.
8. Animals: walk into the pasture. Hold out any food and they wander over. Tap a close cow: milk. Tap a chicken holding a carrot: an egg. Tap a resting animal: no food used. Tap with the hand: a pet. Nothing is scary or loud.
9. Not hurt: press and hold on an animal, nothing happens. Try to place a block on one: refused. Wall one in: it is lifted out after a few seconds.
10. Wool: craft wool into red, blue, yellow and white blocks and build with them.
11. Apple tree: plant a sapling, tap it to grow, pick the apples (they come back).
12. Camera: stand in tall wheat and turn the view. The camera is not shoved around.
13. Controller: eat (the Place button with food selected), feed, plant and choose from the bag with the pad.
14. Speed: village, farm and pasture in view while turning the view. The counter stays at 30 or more (write down the lowest). After 10 minutes the tablet is not hot.
15. Voices: all the new lines are British, clear and not too long. Listen especially for "Fern" and "sunshine".
16. East hill: if he built anything on the east side of the village before, look at it (see "Things to know").

### Village checks on the Tab A8

Use `?debug` once for the frame-rate counter, then play without it.

1. Speed: a fresh page shows the world in under 3 seconds. Frame rate stays at 30 or above in the meadow, on the path, in the village square (turn the view around there, it is the worst case) and inside a house. Write down the lowest you see.
2. Old save: open the new version first on the tablet that has his world. All his blocks and his position are there.
3. Starter cottage: he can walk in and turn the view, and it is bright.
4. Pip leads on a fresh game, does not nag, and gives up politely.
5. The path: he can tap his way along it to the village and back.
6. Each house: he walks in (also with the pad), the neighbour says hello in their own voice with a picture, and turning the view never goes through a wall or roof.
7. Voices: all four hellos and Pip's lines are British, clear and short.
8. Looks: nothing dark, odd or scary; he can say which house is which from the signs.
9. Build in the cottage, reload the page, the blocks are still there.
10. Controller: walk the path and enter a house with the stick.
11. After 10 minutes the tablet is not hot and the frame rate is the same.

## Running it on your computer

You need Node 22.22 or newer.

```
npm ci
npm run dev
```

Open the address it prints (it ends in `/block-pals/`). Add `?debug` to the
address to show the frame-rate counter (it also switches on some helpers for developers).

Other commands:

- `npm test` runs the unit tests.
- `npm run build` makes the finished site in the `dist` folder.
- `npm run preview` serves the finished site so you can try the offline mode.
- `npm run e2e` runs the quick end-to-end smoke tests in a real browser
  (loads, tap to walk, crafting, works offline, the village and the farm story: plant, grow, pick, eat, animals, old saves). The first time you may need
  `npx playwright install chromium`. These are not run on GitHub because they
  need a browser installed; run them yourself before a big change.

## Putting it online (GitHub Pages)

The site is hosted free on GitHub Pages at
`https://<your-username>.github.io/block-pals/`. Every time something is pushed
to the `main` branch, GitHub tests it, builds it and publishes it
automatically (see `.github/workflows/deploy.yml`). It can also be started by
hand from the Actions tab ("Run workflow").

One-time setup:

1. Create a new repository called `block-pals` on your GitHub account. Public
   is the simplest; a private repository needs a paid plan for Pages.
2. Push this project to its `main` branch.
3. In the repository go to Settings, then Pages, and under "Source" choose
   "GitHub Actions".
4. Open the Actions tab and wait for "Deploy to GitHub Pages" to go green. The
   address of the site is shown at the end of the run.

## Adding it to the Tab A8 home screen

1. On the tablet, open Chrome and go to the site address. Wait for it to finish
   loading once while you are online (this saves the game for offline use).
2. Tap the three dots at the top right, then "Add to Home screen" (or "Install
   app"), then "Install".
3. Open Block Pals from the new icon on the home screen. It opens full-screen in
   landscape.
4. To check offline mode, turn on aeroplane mode and open it again. It should
   still load. When you publish an update, the tablet picks it up by itself the
   next time it is opened while online (it may take a second open to show it).

## Grown-ups area

Hold the top-left corner of the screen for 3 seconds, then answer the simple
sum (the sum screen closes itself after 20 seconds of nobody touching it; once you are in, the panel stays open until you close it). Inside:

- Minutes played today, and a list of the last 7 days.
- **Break reminder:** choose how often Pip suggests a break. He pops up with a
  tick button (✔) that your child taps to dismiss. It is only a suggestion; the
  game is never locked.
- **Reset progress:** wipes the saved world (it asks you to confirm). It clears all three save entries: the current save, the old version 1 save and its backup.
- **Saves and rolling back:** the bigger-world version saves under its own name (`blockpals.save.v2`). The earlier version's save (`blockpals.save.v1`) is left exactly as it was and a one-time backup copy is kept, so going back to an older build of the app never loses his world.
- **Set up controller:** see above.

## Tablet playtest checklist

Do this on the Tab A8 (and with the pad), and note any problems so they can
become new tasks.

- [ ] It installs to the home screen and opens full-screen in landscape.
- [ ] It feels smooth (at least 30 frames a second). Add `?debug` to the address
      to show the frame-rate counter.
- [ ] Pip speaks in a British voice.
- [ ] A quick tap walks. A slow press that is lifted early still only walks
      and never digs.
- [ ] Press and hold for about half a second digs; the ring fills and the block
      is outlined (check on the tablet: is the outline easy to see?).
- [ ] Tap with a block selected builds; with the hand selected it walks.
- [ ] Dragging one finger turns the view, and never walks, digs or builds.
- [ ] Dig a tunnel down: the camera stays inside the hole, goes first-person and
      never shows the underside of the world.
- [ ] Crafting works for all three recipes; the bag stops at 99.
- [ ] The controller setup works with the generic pad; the left stick moves
      relative to the camera; the second stick (if any) turns the view.
- [ ] It works in aeroplane mode.
- [ ] A break reminder appears at the interval you set, and the tick dismisses it.
- [ ] Anything confusing for your child? Note where he gets stuck or asks for help.

## What's coming

The **Village** is being built in four steps. Step 1 (the bigger world, the village and houses he can walk into) is in; step 2 (eating, a little farm and friendly animals) is built and waiting for the tablet playtest; then shops and
coins; then friends, hearts and picture quests. After that come underground
bases, friendly bad guys, music, science quests and two-player on one screen.
The details are in the
[design document](docs/superpowers/specs/2026-11-05-block-pals-design.md)
(see section 7d for the Village).

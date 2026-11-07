# Block Pals

A gentle, Minecraft-style block-building game for a five-year-old. Your child
walks around a small friendly world by tapping the ground, digs and collects
blocks, builds with them, and crafts new ones. A little pal called Pip follows along and
talks, preferring a British voice. There is no way to lose, no scary bits, no
adverts, no accounts and no tracking, and the game itself makes no network
calls once it has loaded. Progress is saved on the tablet. Pip's voice comes
from the tablet's own speech; it prefers a British voice but may use another
English voice, and on some tablets there may be no voice at all (the game still
works in silence, with pictures).

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
- **The 🛠️ crafting screen** is all pictures. Three recipes: 1 wood makes
  2 planks; 3 sand makes 1 glass; 2 dirt and 2 stone make 1 brick.

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
  (loads, tap to walk, crafting, works offline). The first time you may need
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
- **Reset progress:** wipes the saved world (it asks you to confirm).
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

Next is the **Village**, in four steps: a bigger world with a village over the
hill and houses he can walk into; then eating and a little farm; then shops and
coins; then friends, hearts and picture quests. After that come underground
bases, friendly bad guys, music, science quests and two-player on one screen.
The details are in the
[design document](docs/superpowers/specs/2026-11-05-block-pals-design.md)
(see section 7d for the Village).

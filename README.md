# Block Pals

A gentle, Minecraft-style block-building game for a five-year-old. Your child
walks around a small friendly world by tapping the ground, collects blocks,
places them, and crafts new ones. A little pal called Pip follows along and
talks in a British voice. There is no way to lose, no scary bits, no adverts,
no analytics and no network calls once it has loaded. Everything stays on the
tablet.

It is made to be played on a Galaxy Tab A8 in Chrome, installed to the home
screen, and it works in aeroplane mode.

## Running it on your computer

You need Node 22 or newer.

```
npm ci
npm run dev
```

Open the address it prints (it ends in `/block-pals/`). Add `?debug` to the
address to show the frame-rate counter and the developer tools.

Other commands:

- `npm test` runs the unit tests.
- `npm run build` makes the finished site in the `dist` folder.
- `npm run preview` serves the finished site so you can try the offline mode.
- `npm run e2e` runs four quick end-to-end smoke tests in a real browser
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

Hold the top-left corner of the screen for 3 seconds. A simple sum appears;
answer it to get in. From there you can see how long the game has been played
each day, choose how often the gentle break reminder appears (it is only a
suggestion; the game is never locked), and set up a controller.

## Setting up the controller

Pair the Bluetooth pad with the tablet as usual in Android settings, then open
the grown-ups area and tap "Set up controller". The game asks you to press the
button you want for each action, one at a time, and then saves the choices on
the tablet. Press a button on the pad first if the game does not seem to notice
it.

## Tablet playtest checklist

Do this on the Tab A8 with the pad, and note any problems so they can become
new tasks.

- [ ] It installs to the home screen and opens full-screen in landscape.
- [ ] It feels smooth (at least 30 frames a second). Open the site with `?debug`
      on the end to show the frame-rate counter.
- [ ] Pip speaks in a British voice.
- [ ] Tap-to-walk, collecting, placing and crafting all work.
- [ ] The controller setup works with the generic pad.
- [ ] It works in aeroplane mode.
- [ ] A break reminder appears at the interval you set.

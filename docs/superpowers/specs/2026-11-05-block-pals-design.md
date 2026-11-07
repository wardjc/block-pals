# Block Pals — Design

*Working title, my call. Date: 5 November 2026.*

## 1. Intent and the why

A Minecraft-style 3D block game for one specific player: a 5-year-old boy in UK Year 1, an early reader (simple words, numbers below 20) who plays on a Samsung Galaxy tablet. He loves **crafting** and **exploring**, and loves the friendships between characters in the Minecraft adventure manga he reads with his parent. Real Minecraft frightens him because of night-time and the mobs: they **blow up, teleport, are very strong, look scary, and chase him**.

The game should give him the fun parts of Minecraft (explore, gather, craft weapons and new blocks, complete quests, trade with characters, defend against bad guys) without any of the fear, and with a gentle bit of STEM and music learning built into play.

**Success:** he plays happily on his own without needing anyone to read for him, is never scared, and keeps wanting to go back to his pals.

## 2. Goals

- Playable on its own by a child who can't read much: everything is pictures, sound and voice.
- Crafting and exploring are the heart of play.
- Friendship is the emotional hook: a companion pal and villagers who become friends.
- Bad guys that are fun to "defend against" but never frightening.
- Light, built-in learning: counting/number, simple science and engineering, and beat-based music.
- Grown-up controls for usage time and break reminders.

## 3. Non-goals (for now)

- Online play, multiplayer over a network, accounts, chat.
- App-store release (browser + add-to-home-screen is enough).
- Huge infinite worlds, survival mechanics (hunger, health bars), redstone-level complexity.
- Explicit lessons, tests or scores that feel like school.

## 4. Anti-goals (failure even if it "works")

- **Anything scary:** darkness/night, explosions, teleporting, chasing, big or strong enemies, scary faces, scary sounds, jump-scares.
- **The player being hurt or dying**, or losing what he's built/collected.
- **Needing to read** to make progress. Text is only ever a bonus beside pictures and voice.
- **Frustration:** fiddly controls, small targets, getting lost, dead ends with no hint.
- Ads, purchases, data collection, links out of the game.
- Copying real Minecraft or manga characters, names or music (everything original).
- American English.

## 5. Constraints

- **Device:** Samsung **Galaxy Tab A8** (10.5", 1920×1200, Unisoc T618, 3–4 GB RAM), landscape, Chrome. This is a modest GPU: target a steady 30 fps or better on this device, which limits view distance, world size and effects (no real-time shadows unless they prove cheap).
- **Input:** touch is primary. The controller is a **generic Bluetooth pad with small controls**. It may not report the standard Gamepad API button layout, so the game needs a simple button-mapping step (e.g. "press the button you want for jump") and must be tested on the real pad. Use as few buttons as possible, with nothing that needs precise or combined presses.
- **Hosting:** **GitHub Pages** on the parent's GitHub account (HTTPS, free, no ads, analytics or tracking added). Every milestone gets deployed there for tablet playtesting, from milestone 1.
- **Language:** British English throughout: spelling (colour, favourite, maths), vocabulary, and a British-accented voice. Number words as taught in UK schools.
- **Offline:** works with no internet after first load; saves locally on the tablet.
- **Reading level:** numbers as digits up to 20 (with dots/objects as backup where helpful); words limited to simple decodable words (e.g. "cat", "sun", "red"), always spoken aloud.

## 6. Decisions made

### What the parent decided
- 3D, **classic Minecraft look**: familiar green/brown/grey square blocks, bright sky.
- **Third-person** camera behind his character.
- **Always daytime.**
- Bad-guy rules (agreed): no exploding, no teleporting, not strong, cute not scary, never chase.
- Crafting outputs: **weapons and new blocks**. Weapons are used to defend against bad guys and to complete quests; crafted items can be traded with NPCs.
- Characters with **strong individual personalities and fun friendships**, in the spirit of the manga.
- **Solo play first**; two-player would be a nice later addition.
- **STEM and music learning** included; music should be **drum and bass** and other dance music with a beat he can dance to.
- **Grown-up area:** usage-time tracking and **configurable break reminders**. Reminders only **suggest** a break: his pal says it, and he can dismiss it and carry on. The game is never paused or locked. **No daily time limit for now.**
- **v1 = three things:** explore, craft a new block, meet one pal.
- Build shared between Claude, Ruflo and Codex by capability (see §9).

### My calls (parent agreed or didn't object, flagged so they can be checked)
- **Bad guys as harmless "grumps"**: small, slow, wobbly jelly blobs and sulky clouds with big eyes and soft colours. They wander and never follow him. A friendly weapon (bubble blaster, wand, water squirter) "poofs" them into confetti with a happy sound, or turns them into a friend who gives a reward. They can't hurt him; nothing ever "dies".
- **Voice for everything**: every quest, villager line and button is spoken; tapping any picture or word repeats it.
- **Picture recipes**: e.g. `3 🪵 + 1 ⭐ = 🗡️`, shown as icons with digits.
- **A companion pal** who follows him, chats, cheers his crafting and helps on quests. In later versions he picks one at the start (v1 has one fixed pal). Villagers build friendship (hearts) through quests and trades; friends join his crew, each with a personality and a special helpful ability.
- **Two-player (later):** same-screen co-op, one on touch and one on controller, sharing the same world and quests. Never competitive.
- **Learning woven into play:**
  - Maths: counting ingredients to 20, "one more / two fewer" quests, matching and sharing in trades.
  - Science/engineering: sorting materials (wood floats, stone sinks), growing plants, simple machines (levers, bridges).
  - Music: beat blocks (kick, clap, hi-hat, bass, synth) that he arranges into a loop playing over his world; pals and villagers dance; a dance-floor block; "copy this beat" quests with pictures flashing in time.
- **Music style:** original drum and bass and dance tracks, generated not licensed. DnB sits around 170 BPM; use a half-time feel so he can clap along. No harsh or scary sounds.
- **Grown-up area details:** behind a gate he can't open (hold a corner for 3 seconds plus a simple sum or a parent PIN). Shows time played today and the last 7 days. Break reminder interval set by the parent (e.g. 20 minutes, or off) is delivered gently by his pal ("Let's have a stretch!") and can be dismissed with one big tap. Option to reset progress.
- **Tech:** browser game in TypeScript with Three.js, installable as a PWA (add to home screen, offline, landscape full-screen). Saves to on-device storage.
- **Controls:** big touch targets; tap the ground to walk there, tap a block to collect it, tap to place. No twin-stick controls required. Camera follows automatically. On a controller: left stick to move, one button to collect/use, one to place, with as few buttons as possible.

## 7. v1 scope (first playable)

The smallest version he can play and enjoy:

1. **Explore**: one small, bounded, always-daytime classic-style area (a meadow, trees, a pond, a hill) that he can walk around without getting lost, with gentle edges.
2. **Craft a new block**: collect a few materials, open a picture-only crafting screen, make at least one new block and place it.
3. **Meet one pal**: a single, fixed companion with a distinct personality and voice who follows, talks and cheers him on. *(My call: no pal-choice screen in v1; choosing from several pals comes in a later version.)*

Plus, in v1: voice for everything, British English, touch and controller, local save, and the grown-up area with usage time and break reminders.

**Later versions** (updated 2026-11-07, see §7d): the Village version (in four steps) → Underground bases → bad guys and friendly weapons → beat blocks and music quests → STEM quests → more pals and areas → same-screen two-player.

### 7a. v1.1: separate moving from digging (agreed 2026-11-07)

After the first build, the parent found that moving and digging shared one tap, which was confusing. Agreed rule, modelled on Minecraft on tablets:

- **Quick tap with the ✋ hand walks** there (to the nearest reachable spot). A tap never digs.
- **Press and hold on a block for about ½ s digs it**, whichever slot is selected. A ring fills around the finger and the block is outlined. Lifting early or sliding away cancels. Too far away → he walks next to it instead. Blocks under his own or Pip's feet, water and bedrock can't be dug.
- **Quick tap with a block selected builds** on the tapped face if it's in reach and there's room. Otherwise he walks there.
- Every block takes the same time to dig. The controller is unchanged.
- **A bigger bag** (requested by our player, 2026-11-07): the 20-per-kind limit was too restrictive for building. *My call:* raise it to **99 of each kind**. The hotbar shows the real number; recipes and prices still never ask for more than 20, so nothing he must read goes above 20. The "bag full" line only plays at 99.

### 7b. Requests from our player (2026-11-07)

The child this game is for asked for these. They are the player's own wishes, so they carry extra weight when ordering later versions. (His name is deliberately kept out of this public document.)

1. **Eating things.** Food he can find, grow or buy (for example apples from trees, bread, carrots, cake) and eat with a happy munch animation and sound. Pip reacts ("Yum!"). **There is still no hunger bar and nothing bad happens if he doesn't eat.** Eating is a fun action, not a survival chore, which keeps the §3 non-goal. Sharing food with villagers could build friendship.
2. **Going into shops.** Shops are buildings he can walk into, each with a friendly shopkeeper character (a baker, a block shop, a toy or pet shop). Prices are pictures and digits up to 20 (for example "3 🪵 = 1 🍞"), trading blocks he has collected. Shopping is spoken, never needs reading, and works as the "trading" in the roadmap.
3. **Houses with other characters.** A small village of houses with doors he can walk through, each home to a villager with a strong, individual personality, in the spirit of the manga (§6). Villagers chat, give simple picture quests, become friends (hearts) and may join his crew.
4. **Finding and building underground bases.** Hidden underground rooms to discover (for example a secret base behind a hillside door or at the bottom of a staircase, with a little treasure chest inside), and the freedom to dig out and furnish his own base. **Underground must never be dark or scary** (§4): tunnels and rooms are lit by glowing blocks or lanterns, there are no creatures in them, and a big "home" button or Pip can always lead him back to the surface. A deeper world (more layers below the meadow) will be needed for this.
5. **A bigger bag.** Being built now in v1.1 (see §7a).

*My suggestion (to confirm at planning time):* items 1–3 fit together as one **"Village" version**, made up of the existing roadmap step "villagers, quests, trading and friendship hearts" plus eating. It could move ahead of "bad guys and friendly weapons", because it is what the player asked for and it builds the friendships the spec puts at the heart of the game. Item 4 could be its own **"Underground" version** straight after. Open design questions include: how big the village is and whether it is in the same meadow or through a gate; which shops come first; where food comes from (trees, farming, shops or all three); whether he can build his own house and invite villagers in; and how deep the underground goes and what he can find there.

### 7d. Village version: agreed design (2026-11-07)

Agreed with the parent, question by question. Everything below follows the §4 anti-goals: nothing scary, nothing lost, no reading needed, British English, everything spoken, numbers up to 20 with dots.

**World and layout.** One bigger connected world: the meadow grows, and the village and farm sit just over the hill. A clear path always links the meadow (home) and the village, so he can always walk back. The first time, Pip leads him: "Let's go and meet the neighbours!"

**First four villagers** (all original characters, each with a funny feature, their own British voice, short spoken lines and a picture in every speech bubble):
- **Bramble the Baker** 🍞: jolly, floury, hums while baking, "Ooh, lovely!". Runs the bakery with a chimney. Turns wheat, eggs and milk into bread and cake.
- **Captain Pebble** ⛏️: gruff but kind ex-miner with a huge moustache, loves shiny stones. Runs the block shop by the quarry. Sells special blocks (glowing blocks, coloured wool) and buys his spare blocks. Later he leads him to underground bases.
- **Fern the Farmer** 🥕: cheerful, outdoorsy, talks to her carrots. Lives in the farmhouse. Gives seeds and picture jobs ("collect 5 eggs", "plant 3 carrots").
- **Granny Willow** 🧶: gentle storyteller, knits, always has biscuits. Lives in a cosy cottage. Gives calm picture quests ("find my lost cat") and is a safe, quiet place.

*Later villagers (not in the first Village version):* Professor Cog (inventor; STEM quests), DJ Dash (drum and bass music corner), Sprocket (toy and pet shop), Mayor Muddle (village jobs).

**The farm.** Wheat, carrots, potatoes and apple trees. He plants seeds, then taps to water or give sunshine; each tap advances the plant one stage with a sparkle (instant feedback and a gentle science link). Plants also grow slowly by themselves in real time, so they are bigger when he returns. **Nothing ever wilts or dies.** He can dig his own farm patch. Friendly animals (chickens give eggs, cows milk, sheep wool, a pig) wander about, make happy noises and come over when he holds out food. **No animal is ever hurt or eaten.**

**Eating.** Food is eaten with a munch animation and sound and Pip's "Yum!". **No hunger bar and nothing bad happens if he doesn't eat.** Each villager has a favourite food (for example Bramble: cake, Pebble: carrots, Granny: biscuits); sharing it earns friendship hearts.

**Money.** Shiny coins 🪙. Shop prices are one number with dots, never above 20. He earns coins from villagers' jobs, from eggs and vegetables, and by selling spare blocks to Captain Pebble. **Coins are never lost or taken away.**

**Friendship.** Hearts grow by trading, sharing food and finishing quests. At full hearts a villager can join his crew, and can visit his cottage.

**Houses.** Built from real blocks with a door gap; he walks straight in (no picture-scene). The camera's close mode (§7c) handles small rooms, and **turning the view by dragging must work inside houses**, with a test. He has his **own tiny starter cottage** near the meadow from the beginning. He can furnish it with crafted or bought furniture (beds, tables, lamps) and knock walls through or build on as much as he likes; nothing is locked.

**Build order (each step its own pull request, playtested on the tablet before the next):**
1. **The bigger world:** the meadow grows; the village, farm and path are generated; houses with doors; his starter cottage; Pip leads him to the village the first time. No new rules to learn yet. *Done when:* he can walk the path to the village and home, walk into every house and turn the view inside it, and the world still loads fast on the Tab A8 (30 fps target) and saves/loads.
2. **Eating and the farm:** food items, the munch animation, planting, watering and growing, harvesting, animals and their gifts, his own farm patch. *Done when:* he can plant, tap to grow, harvest and eat, and nothing can wilt or be lost.
3. **Shops and coins:** the villagers and their shops, the coin purse, prices with dots, selling spare blocks, the bakery and block shop. *Done when:* every price is ≤ 20, spoken and shown with dots, and he can never be left unable to buy because coins were lost.
4. **Friendship and quests:** hearts, favourite foods, Fern's and Granny's picture jobs and quests, joining the crew, friends visiting his cottage. *Done when:* a full set of hearts can be earned from at least trading, sharing food and one quest per villager.

Each step gets its own detailed implementation plan when it starts. Step 1 first. After the Village steps comes the **Underground** version (§7b item 4), then bad guys with friendly weapons, music, STEM, more pals, and two-player.

## 8. Left to the builder

- World size, block set and exact materials in v1, within "small and can't get lost".
- How the pal and characters look and sound, within "original, distinct personalities, friendly, classic blocky style".
- Voice approach (pre-recorded/generated audio clips versus on-device speech), provided it is British-accented, clear and works offline.
- How the music is produced (synthesised in the browser or pre-made clips), provided it's original and offline.
- Save format, code structure, testing approach, performance tricks.
- Exact parent-gate mechanism, within "a 5-year-old can't get past it".

## 9. How the build is shared

- **Claude:** design, implementation plan, game architecture, child-UX decisions, and review of all work.
- **Ruflo:** orchestrates agents, tasks and shared memory across the build.
- **Codex** (installed, CLI 0.162.1): well-specified pieces in parallel, such as world and block generation, the crafting system, controller input, tests, and second-opinion review of Claude's code.
- **Rule:** every piece is written by one agent and reviewed by another; the parent playtests on the tablet at each milestone.

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

### 7c. v1.2: smart camera and turning the view (agreed 2026-11-07)

When our player dug down, the camera (fixed behind and above him) went inside the ground and showed the hollow underside of the world. The parent chose a "smart camera + rotation" fix:

1. **The camera never goes inside or behind blocks.** Every frame it looks from his head back towards where it wants to be. If any block is in the way (leaves and glass count; water does not), it sits just in front of the first one. It pulls in at once and glides back out over about ⅓ s when the way is clear, so it never pops through walls.
2. **Close mode.** When there is less than about 1.2 blocks of room, the camera sits at his head (first person) and his own model is hidden, so we never see inside his head. Pip still shows.
3. The camera's near plane is very close and the camera keeps a small gap from every block face, so block faces are never cut open at close range. In a dug-out hole the camera stays inside the hole, above its floor.
4. The sky and fog stay bright blue. Nothing gets dark.
5. **Drag to turn.** A one-finger drag on the world (anything past the 12 px slide that already cancels a tap or hold) turns the view: sideways turns around him, up and down tilts between slightly above the horizon and about 70° down, never flipping. A drag across the whole screen turns about 240°. A drag never walks, builds or digs, and drags that start on a button or overlay do nothing to the camera.
6. **The camera stays where he leaves it.** It follows him but no longer swings round behind him.
7. Tapping to walk works whichever way the camera faces. The controller's left stick moves relative to the camera. If the controller has a second stick it turns the view; otherwise the controller cannot turn it (axes that rest off-centre, like triggers, are ignored).

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

Each step gets its own detailed implementation plan when it starts. Step 1 first. After the Village steps comes the **Underground** version (§7b item 4), then bad guys with friendly weapons, music, STEM, more pals, and two-player. **Water (§7e) comes after the whole Village version; whether it comes before or after Underground is to be decided later.**

### 7e. Water: flowing channels and swimming (agreed 2026-11-07)

**Status: planned, not yet scheduled. Build after Village step 1 has merged and after the whole Village version (steps 1–4: bigger world, eating and the farm, shops and coins, friendship and quests).**

Agreed with the parent. Follows the §4 anti-goals: nothing scary, nothing lost, never stuck, no reading, British English, 30 fps on the Tab A8.

**Flowing water.**
- **Ponds stay still.** Water only flows when he lets it: first by digging a gap or channel in a pond bank. The water then runs gently downhill a few blocks, spreads only a limited distance from its source (it never floods the world) and settles.
- **He is always in charge.** He can plug a gap with a block to stop the water, **or press and hold on flowing water to drain it** (same ring as digging, a small splash sound). The original pond and any source block are protected and can never be drained by accident. It is an easy undo and nothing is permanent. A sponge block is a later idea.
- **Bucket (a separate later step, step 2):** craft a bucket, scoop water, pour it, carry it.
- **Farm link.** The flow rules must let a channel carry water from a source to a field, because the farm will irrigate with channels.

**Swimming.**
- No drowning, ever. In water he sinks slowly and floats up on his own when he stops.
- Tap to swim to a spot, drag to turn (the existing controls). **Tapping a point under the water (for example the pond bed) swims him down to it; there is no dive button.** He floats back up on his own when he stops, and hold-to-dig still works at the bottom. He is slower in water; thin flowing water is waded, deep water is swum.
- Underwater the camera gets a soft blue tint, never dark. The camera's close mode (§7c) keeps working underwater.
- **Pip swims alongside him** with the same swim rules and gets out when he does. Villagers stay out of water. No water voice line uses a cheer or a sound word.
- He can always get out of water and out of a flooded pit; a rescue rule like the pit lift (§7a) guarantees it.

**My calls (the parent can overrule; listed in the plan):** water has levels so it visibly thins out and stops; a walled channel carries water without thinning, so a trench can reach a field; a farm field gets its own small pool and the bucket carries water in step 2; flowing water is recomputed from the blocks on load (only a small list of drained cells is saved).

**Done when:** he can dig a pond bank and watch water run out a few blocks and stop; plug it and see it drain; swim across the pond by tapping, swim down to the pond bed by tapping it and float back up, and climb out onto either bank; drain a stream by holding on it while the pond stays full; see Pip swim alongside and get out with him; stop in the water and float up; see the soft blue tint underwater without it ever going dark; get out of a flooded pit without help; reload with the same water; and the tablet stays at 30 fps with the water running.

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

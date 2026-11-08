# Voice clips

Pip's lines are pre-recorded with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0, British
voices, runs offline on a laptop) and shipped as small OGG files in `public/voice/`. The game plays
those; if a clip is missing or audio is locked it falls back to the tablet's own speech.

## Regenerate (one command each)

First time only:

```
python -m venv tools/voice/.venv
tools/voice/.venv/bin/pip install -r tools/voice/requirements.txt
```

Then, after changing any line in `src/content/lines.ts`:

```
npm run voice:lines          # writes tools/voice/lines.json (committed, so review shows which lines changed)
for s in pip bramble pebble fern granny; do
  tools/voice/.venv/bin/python tools/voice/generate.py --speaker $s --lines tools/voice/lines.json --out public/voice --prune
done
```

The model files (`kokoro-v1.0.int8.onnx`, `voices-v1.0.bin`, about 100 MB) are downloaded on the first run into the
git-ignored `.voice-cache/`. Or pass your own with `--model` and `--voices`. Both files are checked against pinned SHA-256 sums; the tool stops on a mismatch.
Only missing clips are generated (`--no-only-missing` redoes everything). `--prune` deletes clips no line uses.

A unit test fails if any line has no clip in `public/voice/manifest.json`, so you cannot forget this step.

## How it hangs together

- `voices.json`: one entry per speaker (voice blend, tempo, pitch lift). `pip` speaks Pip's lines (`src/content/lines.ts`); `bramble`, `pebble`, `fern` and `granny` (Granny Willow) speak the villagers' hellos (`src/content/villagers.ts`); `fern` also speaks her seed lines (`FERN_LINES`). `src/content/spoken.ts` (`spokenLines()`) lists every line per speaker; the exporter and the clip tests both read it. Each speaker only generates its own lines.
- `pronunciations.json`: word to respelling, used only when making audio; the text on screen is unchanged.
  An empty respelling means "say it as written". **Please listen for these names** on the tablet:
  Pip, Bramble, Pebble, Fern, Willow, Cog, and the phrase "Whoops-a-daisy". If one sounds odd,
  put a phonetic respelling in the file (for example `"Cog": "Kogg"`) and regenerate.
- Clip name = first 12 hex digits of the SHA-1 of the line text (whitespace collapsed, curly quotes straightened):
  `public/voice/pip/<hash>.ogg`. Editing a line changes its hash, so it is regenerated, and the old file shows up as stale.
  The same hash is computed in `src/audio/voiceKey.ts`; a test pins them together.
- Lines must not contain cheers or sound effects ("whee", "yay", "hooray"...): the voice would read them as words. A test checks.

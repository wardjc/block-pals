#!/usr/bin/env python3
"""Pre-generate Pip's (or another speaker's) voice clips with Kokoro (offline).

  python tools/voice/generate.py --speaker pip --lines tools/voice/lines.json --out public/voice

Clip identity: key = "<speaker>/<first 12 hex of sha1(normalise(text))>". Edited lines get a new
hash, so they regenerate and the old file becomes stale (--prune removes it).
normalise(text) must match src/audio/voiceKey.ts: curly quotes -> straight, whitespace collapsed, trimmed.
"""
import argparse, hashlib, json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CACHE = ROOT / ".voice-cache"
SR = 24000
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL_NAME, VOICES_NAME = "kokoro-v1.0.int8.onnx", "voices-v1.0.bin"


def normalise(text: str) -> str:
    t = text.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", t).strip()


def clip_hash(text: str) -> str:
    return hashlib.sha1(normalise(text).encode("utf-8")).hexdigest()[:12]


def respell(text: str, prons: dict) -> str:
    for word, rep in prons.items():
        if word.startswith("_") or not rep:
            continue
        text = re.sub(r"(?<![\w-])" + re.escape(word) + r"(?![\w-])", rep, text)
    return text


SHA256 = {
    MODEL_NAME: "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    VOICES_NAME: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}


def verify(path, name: str) -> None:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    if h.hexdigest() != SHA256[name]:
        sys.exit(f"SHA-256 mismatch for {path}\n  expected {SHA256[name]}\n  got      {h.hexdigest()}\n"
                 "Delete it (or fix --model/--voices) so the pinned Kokoro v1.0 file is used.")


def ensure_model(path, name: str) -> str:
    if path:
        verify(path, name)
        return path
    CACHE.mkdir(exist_ok=True)
    p = CACHE / name
    if not p.exists():
        print(f"downloading {name} -> {p}")
        urllib.request.urlretrieve(BASE + name, p)
    verify(p, name)
    return str(p)


class Synth:
    def __init__(self, model: str, voices: str):
        from kokoro_onnx import Kokoro
        self.k = Kokoro(model, voices)

    def style(self, spec: str):
        import numpy as np
        if "+" not in spec:
            return spec
        tot = None
        for part in spec.split("+"):
            name, _, w = part.partition("*")
            s = np.asarray(self.k.get_voice_style(name), dtype=np.float32) * float(w or 0.5)
            tot = s if tot is None else tot + s
        return tot

    def say(self, text: str, spec: str, tempo: float = 1.0, lift: float = 1.0):
        import numpy as np
        from scipy.signal import resample_poly
        vs = self.style(spec)
        parts = [p.strip() for p in re.findall(r"[^.!?]+[.!?]*", text) if p.strip()]
        chunks = []
        for p in parts:
            sp = tempo * (1.08 if p[-1] == "!" else 0.97 if p[-1] == "?" else 1.0)
            a, _ = self.k.create(p, voice=vs, speed=sp / lift, lang="en-gb")
            chunks.append(a)
            chunks.append(np.zeros(int(SR * (0.45 if p[-1] in ".?" else 0.35) * lift), dtype=a.dtype))
        a = np.concatenate(chunks[:-1])
        if lift != 1.0:
            a = resample_poly(a, 100, int(round(lift * 100))).astype(np.float32)
        return (a / max(1.0, float(np.abs(a).max())) * 0.9).astype(np.float32)


def write_ogg(path: Path, audio, quality: float) -> None:
    import soundfile as sf
    # libsndfile's Vorbis "compression level" is the inverse of Vorbis quality (0 = best), so invert it.
    with sf.SoundFile(str(path), "w", samplerate=SR, channels=1, format="OGG", subtype="VORBIS",
                      compression_level=1.0 - quality) as f:
        f.write(audio)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--speaker", default="pip")
    ap.add_argument("--lines", required=True, help="JSON {speaker: [texts]} from `npm run voice:lines`")
    ap.add_argument("--out", default=str(ROOT / "public" / "voice"))
    ap.add_argument("--model")
    ap.add_argument("--voices")
    ap.add_argument("--only-missing", action=argparse.BooleanOptionalAction, default=True,
                    help="skip clips whose file exists (default); --no-only-missing regenerates all")
    ap.add_argument("--prune", action="store_true", help="delete clips no current line references")
    ap.add_argument("--quality", type=float, default=0.35, help="Vorbis quality 0..1")
    args = ap.parse_args()

    speakers = json.loads((HERE / "voices.json").read_text())
    if args.speaker not in speakers:
        sys.exit(f"unknown speaker {args.speaker!r}; known: {', '.join(speakers)}")
    sp = speakers[args.speaker]
    prons = json.loads((HERE / "pronunciations.json").read_text())
    texts = json.loads(Path(args.lines).read_text()).get(args.speaker, [])
    out = Path(args.out)
    (out / args.speaker).mkdir(parents=True, exist_ok=True)
    mpath = out / "manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else {}

    synth = None
    wanted = set()
    for text in texts:
        key = f"{args.speaker}/{clip_hash(text)}"
        wanted.add(key)
        rel = f"{key}.ogg"
        if args.only_missing and (out / rel).exists() and key in manifest:
            continue
        if synth is None:
            synth = Synth(ensure_model(args.model, MODEL_NAME), ensure_model(args.voices, VOICES_NAME))
        audio = synth.say(respell(normalise(text), prons), sp["blend"], sp["tempo"], sp["lift"])
        write_ogg(out / rel, audio, args.quality)
        manifest[key] = {"file": rel, "text": normalise(text), "duration": round(len(audio) / SR, 2)}
        print(f"ok   {key}  {manifest[key]['duration']}s  {(out / rel).stat().st_size} B  {text}")

    for k in [k for k in manifest if k.startswith(args.speaker + "/") and k not in wanted]:
        if args.prune:
            (out / manifest[k]["file"]).unlink(missing_ok=True)
            del manifest[k]
            print(f"pruned {k}")
        else:
            print(f"stale {k} (use --prune)")
    mpath.write_text(json.dumps(dict(sorted(manifest.items())), indent=1, ensure_ascii=False) + "\n")
    print(f"{len([k for k in manifest if k.startswith(args.speaker + '/')])} clips for {args.speaker}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

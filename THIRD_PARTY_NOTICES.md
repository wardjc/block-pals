# Third-party notices

## Pip's and the villagers' voice clips (public/voice)

The clips for Pip and for the villagers (Bramble, Captain Pebble, Fern and Granny Willow, each with their own blended voice) were synthesised, offline, with:

- **Kokoro-82M** by hexgrad, licensed under the **Apache License 2.0**
  (<https://huggingface.co/hexgrad/Kokoro-82M>, licence text: <https://www.apache.org/licenses/LICENSE-2.0>).
  The model weights and voice packs are not included in this repository; only the audio they produced is.
  Kokoro is used under Apache 2.0, with this notice retained.
- **kokoro-onnx** (ONNX runtime wrapper and model release files) by thewh1teagle, **MIT licence**
  (<https://github.com/thewh1teagle/kokoro-onnx>).

Python tools used by `tools/voice/generate.py` (not shipped in the game): ONNX Runtime (MIT),
NumPy (BSD-3-Clause), SciPy (BSD-3-Clause), python-soundfile (BSD-3-Clause) with libsndfile (LGPL-2.1+)
and libvorbis/libogg (BSD-3-Clause), via the pinned versions in `tools/voice/requirements.txt`.

## Game runtime

- **three.js** (MIT), <https://github.com/mrdoob/three.js>
- **Vite**, **Vitest** (MIT), **vite-plugin-pwa** (MIT), **Workbox** (MIT), **Playwright** (Apache 2.0), **TypeScript** (Apache 2.0).

The MIT licence permits use, copying, modification and distribution provided the copyright notice and permission notice are
included; the full texts are in each package's `LICENSE` file under `node_modules/`.

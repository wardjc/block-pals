export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const gb = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === 'en-gb');
  const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang));
  return gb.find((v) => v.localService) ?? gb[0] ?? en[0] ?? null;
}

export class Voice {
  readonly available: boolean;
  private synth: SpeechSynthesis | null;
  private voice: SpeechSynthesisVoice | null = null;

  constructor(synth?: SpeechSynthesis | null) {
    this.synth = synth === undefined ? (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null) : synth;
    this.available = !!this.synth && typeof SpeechSynthesisUtterance !== 'undefined';
    if (this.synth) {
      try {
        this.refreshVoice();
        // Chrome loads voices asynchronously.
        this.synth.addEventListener?.('voiceschanged', () => this.refreshVoice());
      } catch {
        /* ignore */
      }
    }
  }

  private refreshVoice(): void {
    try {
      this.voice = pickVoice(this.synth?.getVoices() ?? []);
    } catch {
      this.voice = null;
    }
  }

  say(text: string): void {
    if (!this.synth || !this.available) return;
    try {
      this.synth.cancel();
      if (!this.voice) this.refreshVoice();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.9;
      u.pitch = 1.1;
      u.lang = this.voice?.lang ?? 'en-GB';
      if (this.voice) u.voice = this.voice;
      this.synth.speak(u);
    } catch {
      /* speech is optional */
    }
  }
}

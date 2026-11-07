import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { clipKey, normalise, sha1Hex } from '../../src/audio/voiceKey';

describe('voiceKey', () => {
  it('matches the hash computed by tools/voice/generate.py (python hashlib.sha1)', () => {
    expect(clipKey('pip', 'Hello! What a lovely day for blocks!')).toBe('pip/8eb6d3c20463');
    expect(clipKey('pip', '  Let’s   go,\n café \u{1F600}! ')).toBe('pip/0d5ac80d9315');
  });
  it('normalise folds curly quotes and whitespace', () => {
    expect(normalise('  a’b \n c ')).toBe("a'b c");
  });
  it('sha1Hex agrees with node crypto for assorted lengths', () => {
    for (const n of [0, 1, 54, 55, 56, 63, 64, 65, 119, 200]) {
      const s = 'xé'.repeat(n);
      expect(sha1Hex(s)).toBe(createHash('sha1').update(s).digest('hex'));
    }
  });
});

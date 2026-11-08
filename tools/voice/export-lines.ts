// Prints every spoken line as JSON, per speaker: node --experimental-strip-types tools/voice/export-lines.ts
import { spokenLines } from '../../src/content/spoken.ts';

process.stdout.write(JSON.stringify(spokenLines(), null, 2) + '\n');

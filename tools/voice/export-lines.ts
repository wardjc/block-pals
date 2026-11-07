// Prints every spoken line as JSON: node --experimental-strip-types tools/voice/export-lines.ts
import { LINES } from '../../src/content/lines.ts';

const texts = [...new Set(Object.values(LINES).flat())];
process.stdout.write(JSON.stringify({ pip: texts }, null, 2) + '\n');

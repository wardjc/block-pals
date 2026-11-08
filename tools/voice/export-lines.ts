// Prints every spoken line as JSON, per speaker: node --experimental-strip-types tools/voice/export-lines.ts
import { LINES } from '../../src/content/lines.ts';
import { VILLAGER_LINES, VILLAGERS } from '../../src/content/villagers.ts';

const out: Record<string, string[]> = { pip: [...new Set(Object.values(LINES).flat())] };
for (const v of VILLAGERS) out[v.speaker] = [...new Set(VILLAGER_LINES[v.id])];
process.stdout.write(JSON.stringify(out, null, 2) + '\n');

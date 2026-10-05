// The version of this Meridian, from package.json: shown in Settings > System, written to the log at start, and sent
// as the User-Agent of outgoing calls.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.ts';

function read(): string {
  try {
    const v = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(v) ? v : '0.0.0';
  } catch { return '0.0.0'; }
}
export const VERSION = read();

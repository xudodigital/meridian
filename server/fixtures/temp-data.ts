// Imported first by a test file that loads server modules into its own process: points MERIDIAN_DATA at a new
// temporary folder, so nothing the test imports can open the real workspace in data/. paths.ts reads the variable once,
// when it is first imported, and modules run in the order their imports are written: this import must come before
// every import that reaches paths.ts (commons.ts does, through engine.ts). The test removes TEST_DATA when it ends.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TEST_DATA = mkdtempSync(join(tmpdir(), 'meridian-unit-'));
process.env.MERIDIAN_DATA = TEST_DATA;

// Quarantine even incidental database imports in tests. Never inherit the production data directory.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const data = mkdtempSync(join(tmpdir(), 'meridian-suite-'));
try {
  const files = readdirSync(join(root, 'server')).filter(x => x.endsWith('.test.ts')).sort().map(x => join(root, 'server', x));
  const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', '--test-concurrency=1', ...files], {
    cwd: root, stdio: 'inherit', env: { ...process.env, MERIDIAN_DATA: data },
  });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally { rmSync(data, { recursive: true, force: true, maxRetries: 3 }); }

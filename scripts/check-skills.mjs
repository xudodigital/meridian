import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..', 'skills');
let checked = 0;
for (const name of readdirSync(root)) {
  const dir = join(root, name), main = join(dir, 'SKILL.md');
  if (!existsSync(main)) continue;
  const texts = [readFileSync(main, 'utf8'), ...(existsSync(join(dir, 'references')) ? readdirSync(join(dir, 'references')).filter(f => f.endsWith('.md')).map(f => readFileSync(join(dir, 'references', f), 'utf8')) : [])];
  const ids = [...new Set(texts.flatMap(t => [...t.matchAll(/\[(E\d+)\]/g)].map(m => m[1])))];
  const evidence = join(dir, 'evidence.json');
  if (ids.length && !existsSync(evidence)) throw new Error(`${name}: evidence.json missing`);
  const records = existsSync(evidence) ? JSON.parse(readFileSync(evidence, 'utf8')) : [];
  const available = new Set(records.map(x => x.id));
  for (const id of ids) if (!available.has(id)) throw new Error(`${name}: ${id} has no evidence record`);
  checked++;
}
console.log(`${checked} skill packages: all cited evidence IDs resolve. Historical quotations are not a live source audit.`);

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SKILLS_DIR } from './paths.ts';
import { BUILTIN_SKILLS } from '../shared/agent-skills.ts';

const ALLOWED = new Set(Object.values(BUILTIN_SKILLS));
/** Never follow a reference or symlink outside this shipped skill. No source archives or credentials. */
export function readSkillFile(name: string, file: string): string {
  if (!ALLOWED.has(name) || !(file === 'SKILL.md' || /^references\/[a-zA-Z0-9_-]+\.(md|css)$/.test(file))) throw new Error('Unrecognized agent skill.');
  const root = realpathSync(SKILLS_DIR), dir = realpathSync(join(root, name)), path = realpathSync(join(dir, file));
  if (relative(root, dir).startsWith('..') || relative(dir, path).startsWith('..')) throw new Error('Agent skill files must stay inside the skills folder.');
  return readFileSync(path, 'utf8');
}
/** Read afresh per job: editing a skill takes effect without restarting the server. */
export function skillInstructions(names: readonly string[]): string {
  const context = [...new Set(names)].map(name => {
    if (!ALLOWED.has(name)) throw new Error('Unrecognized agent skill.');
    const main = readSkillFile(name, 'SKILL.md');
    const dir = join(SKILLS_DIR, name, 'references');
    const refs = (existsSync(dir) ? readdirSync(dir) : []).filter(f => /^[a-zA-Z0-9_-]+\.(md|css)$/.test(f))
      .filter(f => name !== 'agent-orchestration' || !['gemini.md', 'harga-model.md'].includes(f)).sort();
    const text = `\n--- ${name}/SKILL.md ---\n${main}` + refs.map(f => `\n--- ${name}/references/${f} ---\n${readSkillFile(name, 'references/' + f)}`).join('\n');
    if (Buffer.byteLength(text) > 250000) throw new Error('Agent skill context is too large.');
    return text;
  }).join('\n');
  if (Buffer.byteLength(context) > 1000000) throw new Error('Assigned agent skills are too large. Reduce the assignments.');
  return context;
}

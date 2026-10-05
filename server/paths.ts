import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SKILLS_DIR = join(ROOT, 'skills');
export const DATA_DIR = process.env.MERIDIAN_DATA || join(ROOT, 'data');
export const WORK_DIR = join(DATA_DIR, 'workspaces');

import { rowOf, storeValues } from './integrations.ts';
export const ENGINE_MODES = ['openai-api', 'codex-local', 'gemma-local'] as const;
export type RuntimeMode = typeof ENGINE_MODES[number];
export function runtimeMode(): RuntimeMode {
  let saved: unknown;
  try { saved = JSON.parse(rowOf('runtime')?.config || '{}').mode; } catch { /* use startup default */ }
  const mode = saved || process.env.MERIDIAN_ENGINE || 'openai-api';
  if (!(ENGINE_MODES as readonly unknown[]).includes(mode)) throw new Error('Unknown Meridian engine. Choose openai-api, codex-local or gemma-local.');
  return mode as RuntimeMode;
}
// Keep runtime selection separate from agent model defaults and from workspace reset.
export function selectRuntime(mode: RuntimeMode, by: string) {
  storeValues({ id: 'runtime', name: 'Agent engine', fields: [{ k: 'mode', label: 'Engine', secret: false }], help: '' }, { mode }, by);
}

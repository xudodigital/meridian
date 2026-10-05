// Supported execution models and conversion of saved configurations from retired providers.
export const OPENAI_MODELS = ['GPT-6 Luna', 'GPT-6.1 Sol', 'GPT-6 Astra'] as const;
export const OPENAI_IDS = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'] as const;
export const supportedModel = (v: unknown): v is string => typeof v === 'string' && ([...OPENAI_MODELS, ...OPENAI_IDS] as string[]).includes(v);
export const defaultModel = (agent: string): string => agent === 'kw' ? OPENAI_MODELS[0] : OPENAI_MODELS[1];
export function convertModel(v: unknown, agent = ''): string {
  if (supportedModel(v)) return v;
  return typeof v === 'string' && /haiku|flash.*lite/i.test(v) ? OPENAI_MODELS[0] : defaultModel(agent);
}

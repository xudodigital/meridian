// Pure validation, shared by the settings form and the inference client. No remote/cloud inference.
export function gemmaEndpoint(value = 'http://127.0.0.1:11434'): string {
  let u: URL;
  try { u = new URL(value); } catch { throw new Error('Enter the Ollama URL, for example http://127.0.0.1:11434.'); }
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/')
    throw new Error('Ollama must use an HTTP localhost address without a path or credentials.');
  // Resolve localhost explicitly to loopback; do not trust a modified hosts entry.
  if (u.hostname === 'localhost') u.hostname = '127.0.0.1';
  return u.origin;
}
export function gemmaConfig(v: Record<string, string> = {}) {
  const endpoint = gemmaEndpoint(v.endpoint || process.env.MERIDIAN_OLLAMA_URL || undefined);
  const model = v.model || process.env.MERIDIAN_GEMMA_MODEL || 'gemma4:31b';
  if (!/^gemma4(?::[a-z0-9._-]+)?$/i.test(model) || /cloud/i.test(model)) throw new Error('Choose an installed local Gemma 4 model, for example gemma4:31b. Cloud models are not supported.');
  const context = Number(v.context || process.env.MERIDIAN_GEMMA_CONTEXT || 32768);
  if (!Number.isInteger(context) || context < 8192 || context > 131072) throw new Error('Context size must be between 8192 and 131072 tokens.');
  return { endpoint, model, context };
}

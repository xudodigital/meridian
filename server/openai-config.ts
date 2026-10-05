// Idempotent configuration upgrade. Removes retired credentials, preserves accounts, content and settings.
import { db } from './db.ts';
import { convertModel } from './openai-models.ts';
type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export function openaiAgents(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  return data.map(a => !obj(a) ? a : { ...a, model: convertModel(a.model, String(a.id)), prev: obj(a.prev) && typeof a.prev.openai === 'string' ? {openai: convertModel(a.prev.openai, String(a.id))} : {} });
}
export function openaiSkills(data: unknown): unknown {
  if (!Array.isArray(data)) return data;
  return data.map(k => { if (!obj(k) || !k.only || k.only === 'openai') return k; const {only, ...rest} = k; return rest; });
}
export function upgradeOpenAI(): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("DELETE FROM integrations WHERE id IN ('claude','gemini')").run();
    const get = db.prepare('SELECT data FROM workspace_docs WHERE id = ?');
    const set = db.prepare('UPDATE workspace_docs SET data = ?, version = version + 1, updated_at = ? WHERE id = ?');
    for (const [id, convert] of [['agents',openaiAgents],['skills',openaiSkills]] as const) {
      const row = get.get(id) as {data:string} | undefined;
      if (!row) continue;
      const data = JSON.parse(row.data), next = JSON.stringify(convert(data));
      if (JSON.stringify(data) !== next) set.run(next, Date.now(), id);
    }
    // Pending jobs from a previous version must resume on a supported model; historical records retain their provenance.
    for (const [table,agent] of [['requests','kw'],['articles','wr']] as const) {
      const rows = db.prepare(`SELECT id, model FROM ${table} WHERE status IN ('queued','work','revision','failed','review')`).all() as {id:number;model:string}[];
      const setModel = db.prepare(`UPDATE ${table} SET model = ? WHERE id = ?`);
      for (const r of rows) { const model=convertModel(r.model,agent); if(model!==r.model) setModel.run(model,r.id); }
    }
    db.exec('COMMIT');
  } catch(e) {db.exec('ROLLBACK');throw e;}
}

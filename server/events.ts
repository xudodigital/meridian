// Server-sent events: every change to a research request, an article or the engine status is announced here and
// streamed to open dashboards by GET /api/events.
import { EventEmitter } from 'node:events';
import { engineStatus, type EngineStatus } from './engine.ts';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

/** Checks the engine again before a job starts, and tells the dashboards. */
export async function freshEngine(): Promise<EngineStatus> {
  const engine = await engineStatus(true);
  bus.emit('engine', engine);
  return engine;
}

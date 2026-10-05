/* Website builds from the server in the store (outside demo mode): the mutator live.ts and the sites slice call with
   an immer draft. A build is the server's own record (server/build-api.ts BuildWire); nothing here invents one. After
   a change the server's facts about sites (the "Last deploy" text) and the agents (liveApply: the Site Builder and
   Deploy & Monitor) are derived again. The pure derivations the screens share are in builds.ts. */
import { liveApply } from './liveApply';
import { serverFactsTo, type FactsTarget } from './serverFacts';
import type { BuildWire } from './types';

export type BuildsTarget = Parameters<typeof liveApply>[0] & FactsTarget;

/**
 * One build as the server now has it (the answer to an action, or the event stream). An answer that arrives after the
 * stream already reported a newer change (the job starting right after the request) is dropped. Demo mode keeps it
 * aside without showing it, like the server's articles.
 */
export function liveBuildTo(s: BuildsTarget, b: BuildWire): void {
  const known = s.live.builds[b.id];
  if (known && known.updatedAt > b.updatedAt) return;
  s.live.builds[b.id] = b;
  if (s.sample) return;
  serverFactsTo(s);
  liveApply(s);
}

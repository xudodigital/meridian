import type { LiveState } from './types';
export const emptyLive = (): LiveState => ({ on: false, ready: false, engine: null, reqs: {}, arts: {}, logged: [], ints: {}, access: {}, verify: {}, metrics: null, redirectUri: '', builds: {}, domains: {}, spend: null, workflows: {}, schedDue: {} });

/* The unsaved-changes guard of the article editor. While a person has changes in the editor that are not saved,
   anything that would take the editor off the screen (another article, another tab of the list, another view) goes
   through leaveEdit(): it runs at once when nothing would be lost, and otherwise waits for the person's answer to
   "Discard your changes?", which the editor shows. Kept outside the store: it holds a function, and the store's state
   is plain data. */
import { useSyncExternalStore } from 'react';
import type { Article } from './types';

export interface EditGuard {
  /** The article being edited, or null. */
  id: Article['id'] | null;
  /** The editor holds changes that are not saved. */
  dirty: boolean;
  /** Something is waiting for the person's answer. */
  asking: boolean;
}

let state: EditGuard = { id: null, dirty: false, asking: false };
let pending: (() => void) | null = null;
const listeners = new Set<() => void>();
const put = (next: EditGuard): void => { state = next; listeners.forEach(f => f()); };

export const editGuard = {
  get: (): EditGuard => state,
  subscribe: (f: () => void): (() => void) => { listeners.add(f); return () => { listeners.delete(f); }; },
  /** The editor opened on this article. */
  begin: (id: Article['id']): void => { pending = null; put({ id, dirty: false, asking: false }); },
  setDirty: (dirty: boolean): void => { if (state.id !== null && state.dirty !== dirty) put({ ...state, dirty }); },
  /** The editor closed (saved, cancelled, or taken off the screen). */
  end: (): void => { pending = null; if (state.id !== null || state.asking) put({ id: null, dirty: false, asking: false }); },
  /** The person's answer: discard the changes and go on, or stay in the editor. */
  answer: (discard: boolean): void => {
    const run = pending; pending = null;
    if (!discard) { put({ ...state, asking: false }); return; }
    put({ id: null, dirty: false, asking: false });
    run?.();
  },
};

/** Runs `run` now, or after the person agreed to discard the unsaved changes of the editor. */
export function leaveEdit(run: () => void): void {
  if (!state.dirty) { run(); return; }
  pending = run;
  put({ ...state, asking: true });
}

/** The guard's state in a component. */
export const useEditGuard = (): EditGuard => useSyncExternalStore(editGuard.subscribe, editGuard.get, editGuard.get);

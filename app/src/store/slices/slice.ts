/* The slice pattern. Each of the five screen groups owns one file in this folder and adds its own state and actions
   there; store.ts composes them and never needs to change.

   A slice file declares two interfaces (its state and its actions), then exports
     export const xSlice: Slice<XState, XActions> = { initial: {...}, actions: (set, get) => ({...}) };
   Inside an action, `set(d => { ... })` receives a draft of the WHOLE store that may be mutated directly
   (immer turns the mutations into an immutable update), and `get()` returns the current store, including
   every core action (get().guard(), get().snack(...)). */
import type { AppStore } from '../store';

export type SliceSet = (recipe: (draft: AppStore) => void) => void;
export type SliceGet = () => AppStore;
export interface Slice<State extends object, Actions extends object> {
  initial: State;
  actions: (set: SliceSet, get: SliceGet) => Actions;
}

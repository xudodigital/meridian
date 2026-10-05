import { create } from 'zustand';
export type JourneyKind = 'research' | 'review' | 'deploy' | 'sites' | 'workflow';
export interface JourneyTarget { kind: JourneyKind; id: string }
/** UI-only selection. Never persisted or sent to the workspace API. */
export const useJourney = create<{ target: JourneyTarget | null }>(() => ({ target: null }));
export const openJourney = (target: JourneyTarget) => useJourney.setState({ target });
export const closeJourney = () => useJourney.setState({ target: null });

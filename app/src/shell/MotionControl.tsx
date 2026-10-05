import { useEffect, useState } from 'react';
import { Icon } from '@/components';
import { KEY_MOTION, readKey, writeKey } from '@/store/storage';


/** A local display preference only: freezing motion must never pause jobs or live data. */
export function MotionControl() {
  const [paused, setPaused] = useState(() => readKey(KEY_MOTION) === '1');
  useEffect(() => {
    const apply = () => {
      const stop = paused || document.hidden;
      document.documentElement.dataset.motionPaused = String(stop);
      window.dispatchEvent(new Event('meridian-motion-change'));
      // Finish transient Office hand-offs immediately. CSS motion is disabled by the root attribute, including entrance animations.
      if (stop) for (const animation of document.getAnimations?.() ?? []) {
        if (!('animationName' in animation) && !('transitionProperty' in animation) && Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
      }
    };
    apply();
    document.addEventListener('visibilitychange', apply);
    return () => { document.removeEventListener('visibilitychange', apply); delete document.documentElement.dataset.motionPaused; };
  }, [paused]);
  useEffect(() => {
    const sync = (e: StorageEvent) => { if (e.key === KEY_MOTION) setPaused(e.newValue === '1'); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return <button type="button" className="ib motion-control" aria-label={paused ? 'Resume visual motion' : 'Pause visual motion'} aria-pressed={paused}
    title={paused ? 'Resume visual motion' : 'Pause visual motion; jobs and live updates continue'}
    onClick={() => { writeKey(KEY_MOTION, paused ? null : '1'); setPaused(!paused); }}><Icon name={paused ? 'play_circle' : 'motion_photos_pause'} /></button>;
}

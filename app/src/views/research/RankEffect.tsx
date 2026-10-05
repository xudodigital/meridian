import { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Pill } from '@/components';
import { useRank } from '@/store/insightsApi';
import { useStore } from '@/store/store';
import { signed } from './heatData';

/**
 * The rank effect of a deploy on the Build and deploy timeline: the average position change of the site's tracked
 * keywords, the 7 days after the deploy against the 7 days before, from Search Console. Nothing is shown until both
 * windows have data (and nothing at all while Search Console is not connected).
 */
export function RankEffect({ buildId }: { buildId: number }) {
  const connected = useStore(s => !s.sample && !!s.live.ints.gsc?.connected);
  /* The timeline is also drawn where no query client is set up (a preview, a test): then there is nothing to ask. */
  const client = useContext(QueryClientContext);
  return connected && client ? <Measured buildId={buildId} /> : null;
}

function Measured({ buildId }: { buildId: number }) {
  const e = useRank().data?.effects[String(buildId)];
  if (!e) return null;
  const kind = e.change >= 0.5 ? 'ok' : e.change <= -0.5 ? 'bad' : 'mut';
  return (
    <Pill kind={kind}>
      <span className="rank-effect" title={`Average position change of ${e.keywords} tracked keyword${e.keywords === 1 ? '' : 's'}: the 7 days after this deploy against the 7 days before, from Search Console. A plus means pages moved up.`}>
        Rank {signed(e.change)}
      </span>
    </Pill>
  );
}

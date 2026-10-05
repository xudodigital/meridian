import { Chip } from '@/components';
import { stamp } from '@/store/rules';
import type { ArticleAction, ArticleEvent } from '@/store/types';

const DID: Readonly<Record<ArticleAction, string>> = {
  requested: 'asked for the article',
  written: 'finished a version',
  failed: 'stopped with an error',
  approved: 'approved it (not published)',
  revision: 'requested a revision',
  rejected: 'rejected it',
  'language-review': 'finished the language review',
  retried: 'asked to try again',
  photos: 'looked for photos',
  edited: 'edited it',
  unapproved: 'sent it back to review',
  archived: 'archived it',
  unarchived: 'took it out of the archive',
};

/** The decision history of a real article, as the server recorded it: who did what, when, with what note. */
export function ArticleHistory({ events }: { events: ArticleEvent[] }) {
  if (!events.length) return null;
  return (
    <section>
      <h3>History</h3>
      <ul className="checks">
        {events.map((e, i) => <li key={i}><Chip>{stamp(e.at)}</Chip><span>{e.by} {DID[e.action] ?? e.action}{e.note ? ': ' + e.note : ''}</span></li>)}
      </ul>
    </section>
  );
}

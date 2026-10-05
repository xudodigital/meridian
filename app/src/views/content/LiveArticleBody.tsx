import type { ReactNode } from 'react';
import { Chip, Empty, Icon, Table } from '@/components';
import './editor.css';
import { useStore } from '@/store/store';
import type { Article, ArticleBlock, ArticleContent, ArticleLink, LiveArticle, PhotoWire } from '@/store/types';
import { ArticlePhotos, PhotoFigure, photoEnglish } from './ArticlePhotos';
import { Checks, NativeReview } from './ArticleReview';

/** A link only for an absolute http(s) URL; anything else is shown as text. The server already drops other schemes. */
const isHttp = (url: string): boolean => /^https?:\/\//i.test(url);

/** A heading or a labelled line: the marker, then the text. */
const marked = (mark: string, text: ReactNode, bold = false): ReactNode => <><Chip>{mark}</Chip> {bold ? <b>{text}</b> : text}</>;

/**
 * Beside English that no longer matches the text: a person edited the text by hand (the agent did not translate it
 * again), or added it, in which case there is no English at all.
 */
export function Stale({ added }: { added?: boolean }) {
  return <span className="ed-stale"><Icon name="translate" />{added ? 'Added by a person, not translated' : 'Edited, translation not updated'}</span>;
}
const stale = (on: boolean | undefined, en: string): ReactNode => on ? <Stale added={!en} /> : null;

/** What a link to another article of the site is called: that article's title, or that it is not there (any more). */
function TargetName({ id }: { id: number }) {
  const t = useStore(s => { const a = s.live.arts[id]; return a ? a.content?.title || a.keyword : ''; });
  return <>{t || 'an article that is no longer on this site'}</>;
}
function targetTitle(id: number): string {
  const a = useStore.getState().live.arts[id];
  return a ? 'Links to the article: ' + (a.content?.titleEn || a.content?.title || a.keyword) : 'Links to an article that is no longer on this site';
}

/**
 * A text with its links marked. The links are a structure (ranges of the text and a target), never HTML: the text
 * between them is plain text, a link to a web page is an <a> only for an http(s) address, and a link to another
 * article of the site is marked and says where it leads. A range that does not hold is skipped.
 */
export function Linked({ text, links }: { text: string; links?: readonly ArticleLink[] }) {
  if (!links?.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  [...links].sort((x, y) => x.start - y.start).forEach((l, i) => {
    if (!Number.isInteger(l.start) || !Number.isInteger(l.end) || l.start < at || l.end <= l.start || l.end > text.length) return;
    out.push(text.slice(at, l.start));
    const words = text.slice(l.start, l.end);
    out.push('article' in l ? <span key={i} className="ed-lk" title={targetTitle(l.article)}>{words}</span>
      : isHttp(l.url) ? <a key={i} className="ed-lk" href={l.url} target="_blank" rel="noopener noreferrer">{words}</a> : words);
    at = l.end;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

/** The links of a text as a list under it: the words, and where each leads. `onRemove` adds a button per link (the editor). */
export function LinkList({ text, links, onRemove }: { text: string; links?: readonly ArticleLink[]; onRemove?: (index: number) => void }) {
  if (!links?.length) return null;
  return (
    <ul className="ed-links" aria-label="Links in this text">
      {links.map((l, i) => (
        <li key={i}>
          <Icon name={'article' in l ? 'article' : 'open_in_new'} />
          <span><b>{text.slice(l.start, l.end)}</b> → {'article' in l ? <TargetName id={l.article} /> : l.url}</span>
          {onRemove ? <button type="button" className="ed-ib" aria-label={`Remove the link on “${text.slice(l.start, l.end)}”`} title="Remove this link" onClick={() => onRemove(i)}><Icon name="link_off" /></button> : null}
        </li>
      ))}
    </ul>
  );
}

/** One block as rows of the two-column table: [original, English]. A table block gives one row per table row. */
function blockRows(b: ArticleBlock): ReactNode[][] {
  switch (b.type) {
    case 'h2': case 'h3': return [[marked(b.type.toUpperCase(), b.text, true), <>{marked(b.type.toUpperCase(), b.en, true)}{stale(b.enStale, b.en)}</>]];
    case 'p': return [[<><Linked text={b.text} links={b.links} /><LinkList text={b.text} links={b.links} /></>, <>{b.en}{stale(b.enStale, b.en)}</>]];
    case 'list': return [[<ul>{b.items.map((x, i) => <li key={i}><Linked text={x.text} links={x.links} /><LinkList text={x.text} links={x.links} /></li>)}</ul>,
      <><ul>{b.items.map((x, i) => <li key={i}>{x.en}</li>)}</ul>{stale(b.items.some(x => x.enStale), b.items.map(x => x.en).join(''))}</>]];
    case 'table': return b.rows.map((r, i) => {
      const line = (k: 'text' | 'en') => r.map(c => c[k]).join(' | ');
      const en = <>{i === 0 ? marked('Table', line('en'), true) : line('en')}{stale(r.some(c => c.enStale), r.map(c => c.en).join(''))}</>;
      return i === 0 ? [marked('Table', line('text'), true), en] : [line('text'), en];
    });
  }
}

/**
 * The whole article in reading order: main heading, byline, the main photo, the body with each photo after the block
 * it follows, and the note on how it was made. This is where the built site places them.
 */
function articleRows(c: ArticleContent, aid: number, photos: readonly PhotoWire[]): ReactNode[][] {
  const photo = (p: PhotoWire): ReactNode[] => [<PhotoFigure aid={aid} p={p} />, photoEnglish(p)];
  const after = (i: number) => photos.filter(p => p.role === 'inline' && p.after === i).map(photo);
  return [
    [marked('H1', c.title, true), <>{marked('H1', c.titleEn, true)}{stale(c.titleEnStale, c.titleEn)}</>],
    [marked('Byline', c.byline.text), marked('Byline', c.byline.en)],
    ...photos.filter(p => p.role === 'hero').slice(0, 1).map(photo),
    ...c.blocks.flatMap((b, i) => [...blockRows(b), ...after(i)]),
    [marked('How it was made', c.disclosure.text), <>{marked('How it was made', c.disclosure.en)}{stale(c.disclosure.enStale, c.disclosure.en)}</>],
  ];
}

/** The sources the article cites, as links. */
export function Sources({ c }: { c: ArticleContent }) {
  return (
    <section>
      <h3>Sources</h3>
      {c.sources.length ? (
        <ol>{c.sources.map(s => <li key={s.url}>{isHttp(s.url) ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : s.title}</li>)}</ol>
      ) : <Empty>No sources were cited.</Empty>}
    </section>
  );
}

/** What the agent wants the reviewer to double-check, and the engine's own notes. */
export function AgentNotes({ c, engineNotes }: { c: ArticleContent; engineNotes: string }) {
  const notes = [...c.reviewerNotes, ...(engineNotes ? [engineNotes] : [])];
  return (
    <section>
      <h3>Notes from the agent</h3>
      {notes.length ? <ul className="checks">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : <p className="note">None.</p>}
    </section>
  );
}

/** A written real article: checks, language review, search appearance, photos, the text, sources and the agent's notes. */
export function LiveArticleBody({ a, live }: { a: Article; live: LiveArticle }) {
  const srv = useStore(s => s.live.arts[live.aid]);
  const c = live.content;
  if (!c) return null;
  return (
    <>
      <Checks a={a} />
      <NativeReview a={a} />
      <section>
        <h3>Search appearance</h3>
        <Table cols={['Field', 'Value']} rows={[['Title tag', c.titleTag || '—'], ['Meta description', c.metaDescription || '—'], ['URL slug', c.slug || '—'], ['Category', srv?.category || 'None']]} />
      </section>
      {srv ? <ArticlePhotos a={a} srv={srv} /> : null}
      <section>
        <h3>Article</h3>
        <Table tableClass="bi" cols={[`Original (${live.lang})`, 'English translation']} rows={articleRows(c, live.aid, srv?.images ?? [])} />
        <p className="note">The translation is made by the agent so the team can judge the content; language quality is judged by the native reviewer.</p>
      </section>
      <Sources c={c} />
      <AgentNotes c={c} engineNotes={live.engineNotes} />
    </>
  );
}

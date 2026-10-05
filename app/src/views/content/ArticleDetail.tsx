import { Button, Pill, Table, Tag } from '@/components';
import { AST } from '@/store/constants';
import { fmt, siteById } from '@/store/rules';
import { useStore } from '@/store/store';
import type { Article } from '@/store/types';
import { Checks, Decide, NativeReview } from './ArticleReview';
import { LiveArticleDetail } from './LiveArticleDetail';

/**
 * The prototype's rvDetail(a) (lines 1402-1422): the article, its checks, the native-speaker review and the decision.
 * A real article written by the Content Writer has its own detail (LiveArticleDetail).
 */
export function ArticleDetail({ a }: { a: Article | undefined }) {
  const site = useStore(s => a ? siteById(s, a.s) : undefined);
  const reviewBack = useStore(s => s.reviewBack);
  if (a?.live) return <LiveArticleDetail a={a} live={a.live} />;
  if (!a || !site) return <div className="rvd"><p className="note">Pick an article from the list to read it.</p></div>;
  return (
    <div className="rvd">
      <Button variant="text" icon="arrow_back" className="rvback" onClick={reviewBack}>Back to list</Button>
      <div><h2>{a.title}</h2><p className="lede">{a.titleEn}</p></div>
      <div className="tags">
        <Tag icon="language">{site.cc} · {site.domain}</Tag>
        <Tag icon="translate">{site.lang}</Tag>
        <Tag icon="notes">{fmt(a.words)} words</Tag>
        <Tag icon="key">{a.kw}</Tag>
        <Tag icon="history">Revision {a.rev}</Tag>
        <Pill kind={AST[a.status][0]}>{AST[a.status][1]}</Pill>
      </div>
      <Checks a={a} />
      <NativeReview a={a} />
      <section>
        <h3>Article</h3>
        <Table tableClass="bi" cols={[`Original (${site.lang})`, 'English translation']} rows={a.paras.map(p => [p[0], p[1]])} />
        <p className="note">Sample excerpt. The translation is made by an agent so the team can judge the content; language quality is judged by the native reviewer.</p>
      </section>
      {a.notes.length ? (
        <section><h3>History</h3><ul className="checks">{a.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></section>
      ) : null}
      {a.status === 'review' ? <Decide a={a} />
        : a.status === 'revisi' ? <p className="note">The Content Writer is rewriting from your note. The article will return to this queue.</p> : null}
    </div>
  );
}

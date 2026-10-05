import { useState } from 'react';
import { Button, Pill, Sheet, SheetActions, Tag } from '@/components';
import { siteById, codexLocal, runtimeModel } from '@/store/rules';
import type { SendResult } from '@/store/slices/content';
import { useStore } from '@/store/store';
import type { KwRequest } from '@/store/types';

/** One keyword of a finished research request chosen for an article, or several (`keywords`) for one article each. */
export interface ArticleTarget { r: KwRequest; keyword: string; keywords?: string[] }

/**
 * "Write article": confirms what the Content Writer will get (site, keyword, model) and what it costs, then sends it.
 * The site profile comes from the site, or from the request when its site is no longer in the store. With several
 * keywords it sends them in one call and, when some could not be started, says which and why.
 */
export function WriteArticleSheet({ target, onClose }: { target: ArticleTarget | null; onClose: () => void }) {
  return (
    <Sheet open={!!target} onClose={onClose} labelledBy="waT">
      {target ? <WriteArticle t={target} onClose={onClose} /> : null}
    </Sheet>
  );
}

function WriteArticle({ t, onClose }: { t: ArticleTarget; onClose: () => void }) {
  const local = useStore(codexLocal);
  const live = useStore(s => s.live);
  const site = useStore(s => siteById(s, t.r.site));
  const writer = useStore(s => s.agents.find(a => a.id === 'wr'));
  const sendArticle = useStore(s => s.sendArticle);
  const sendArticles = useStore(s => s.sendArticles);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const country = site?.country || t.r.country || 'country not recorded', lang = site?.lang || t.r.lang || 'language not recorded';
  const keywords = t.keywords?.length ? t.keywords : [t.keyword], n = keywords.length;

  const send = async () => {
    setBusy(true);
    if (n === 1) {
      const err = await sendArticle({ rid: t.r.rid ?? 0, keyword: keywords[0]! });
      if (err === null) { onClose(); return; }
      setBusy(false); setMsg(err);
      return;
    }
    const r = await sendArticles({ rid: t.r.rid ?? 0, keywords });
    if (typeof r === 'string') { setBusy(false); setMsg(r); return; }
    /* Everything started: nothing left to say. Otherwise the sheet stays and lists what happened to each keyword. */
    if (r.every(x => x.ok)) { onClose(); return; }
    setBusy(false); setResults(r);
  };

  if (results) {
    const ok = results.filter(x => x.ok).length;
    return (
      <>
        <h2 id="waT">{ok ? `Sent ${ok} of ${results.length} to the Content Writer` : 'No article could be started'}</h2>
        <ul className="checks kw-res">
          {results.map(x => <li key={x.keyword}><Pill kind={x.ok ? 'ok' : 'warn'}>{x.ok ? 'Sent' : 'Not sent'}</Pill><span><b>{x.keyword}</b>{x.ok ? '' : ': ' + x.error}</span></li>)}
        </ul>
        <SheetActions><Button variant="filled" onClick={onClose}>Close</Button></SheetActions>
      </>
    );
  }

  return (
    <>
      <h2 id="waT">{n === 1 ? 'Write an article' : `Write ${n} articles`}</h2>
      <p>
        {n === 1 ? 'The Content Writer writes one article for this keyword in the site\'s language' : `The Content Writer writes one article for each of these ${n} keywords in the site's language, one after the other`}, following the article-writing and Google SEO skills.
        {n === 1 ? ' It waits' : ' Each one waits'} in Article review until a person decides; nothing is published.
      </p>
      <div className="tags">
        <Tag icon="language">{(site?.domain || t.r.domain) + ' · ' + country}</Tag>
        <Tag icon="translate">{lang}</Tag>
        {keywords.map(k => <Tag key={k} icon="key">{k}</Tag>)}
        <Tag icon="memory">{writer ? 'Content Writer: ' + runtimeModel({live}, writer.model) : 'Content Writer removed'}</Tag>
      </div>
      <p className="note">{local ? `Writing uses your ChatGPT usage limits. ${n} article${n === 1 ? '' : 's'} = ${n} job${n === 1 ? '' : 's'}.` : n === 1 ? 'Writing takes several minutes and uses your OpenAI API quota.' : `Each article takes several minutes and uses your OpenAI API quota: ${n} articles are ${n} jobs.`}</p>
      <p className="err" id="waMsg" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="filled" icon="edit_note" disabled={busy} onClick={send}>{n === 1 ? 'Send to Content Writer' : `Send ${n} to Content Writer`}</Button>
      </SheetActions>
    </>
  );
}

/* The article editor: a person fixes the text of a real article before approving it, in the site's language. It
   takes the place of the read-only article (LiveArticleBody) with the same sections in the same order, so nothing
   jumps when it opens: "Search appearance" and "Article" become fields, the rest stays. The English beside a piece
   the person changed is kept and marked as not updated; the server does the same when it saves (article-edit.ts).
   Save: the button or Ctrl/Cmd+S. Cancel: the button or Escape. Unsaved changes are never dropped without asking
   (store/editGuard.ts).

   Links: the person selects words in a paragraph or a list item and presses the link button (or Ctrl/Cmd+K), then
   chooses another article of the site or types a web address. The links of a text are listed under it, each with a
   button to remove it. They are ranges of the text, moved along while the person types (editing.ts). */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Callout, Chip, Dialog, Field, Icon, Select, SheetActions, Tabs, cx } from '@/components';
import { editGuard, leaveEdit, useEditGuard } from '@/store/editGuard';
import { siteById } from '@/store/rules';
import { useStore } from '@/store/store';
import type { Article, ArticleBlock, ArticleContent, ArticleLink, LinkNodeWire, LiveArticle, PhotoWire, ServerArticle } from '@/store/types';
import { useSiteLinks } from '../research/siteLinks';
import { ArticlePhotos, PhotoFigure, photoEnglish } from './ArticlePhotos';
import { Checks, NativeReview } from './ArticleReview';
import { AgentNotes, LinkList, Sources, Stale } from './LiveArticleBody';
import {
  CATEGORY_MAX, LIMITS, MAX_LINKS, META_MAX, META_MIN, TITLE_TAG_MAX, addLink, blockEdited, blockEdits, chars, draftOf, editBody, emptyBlock, httpUrl, isDirty, linkCount, photoPlaces,
  problemOf, shiftLinks, sliceLinks, slugify, type Draft, type DraftBlock, type TextType,
} from './editing';
import './editor.css';

const TYPE_LABEL: Readonly<Record<DraftBlock['type'], string>> = { p: 'Paragraph', h2: 'Heading 2', h3: 'Heading 3', list: 'List', table: 'Table' };
const ADDABLE: readonly DraftBlock['type'][] = ['p', 'h2', 'list', 'table'];
const ADD_ICON: Readonly<Record<DraftBlock['type'], string>> = { p: 'notes', h2: 'title', h3: 'text_fields', list: 'format_list_bulleted', table: 'table' };
const isText = (b: DraftBlock): b is DraftBlock & { type: TextType; text: string } => b.type === 'p' || b.type === 'h2' || b.type === 'h3';

/** A textarea that is as tall as its text: it reads like the article, not like a form. */
function Grow({ value, className, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & { value: string; ref?: React.Ref<HTMLTextAreaElement> }) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const { ref, ...props } = rest;
  useLayoutEffect(() => {
    const el = own.current; if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight) el.style.height = el.scrollHeight + 'px';
  }, [value]);
  const set = (el: HTMLTextAreaElement | null) => {
    own.current = el;
    if (typeof ref === 'function') ref(el); else if (ref) (ref as React.RefObject<HTMLTextAreaElement | null>).current = el;
  };
  return <textarea ref={set} rows={1} className={cx('ed-in', className)} value={value} {...props} />;
}

/** "52 / 60": how long the text is against what a search result shows. */
function Count({ n, min = 0, max, id }: { n: number; min?: number; max: number; id: string }) {
  const off = n > max || (n > 0 && n < min);
  return <span id={id} className={cx('ed-count', off && 'off')}>{n} / {max}{n > max ? ' · may be cut off' : n > 0 && n < min ? ' · short' : ''}</span>;
}

/** The start of a text as a search result would show it. */
const cut = (t: string, max: number): string => { const c = [...t.trim()]; return c.length > max ? c.slice(0, max - 1).join('').trimEnd() + '…' : c.join(''); };

export function ArticleEditor({ a, live, srv, onDone }: { a: Article; live: LiveArticle; srv: ServerArticle; onDone: () => void }) {
  const site = useStore(s => siteById(s, a.s));
  const saveArticleEdit = useStore(s => s.saveArticleEdit);
  const guard = useEditGuard();
  /* The version the person edits: what the editor opened on. A later save names it, so the server can refuse to
     overwrite a version this person never saw. */
  const [base] = useState(() => ({ content: srv.content as ArticleContent, updatedAt: srv.updatedAt, json: JSON.stringify(srv.content), category: srv.category ?? '' }));
  const [d, setD] = useState<Draft>(() => draftOf(base.content, base.category));
  /* The site's other articles (what a link may lead to) and its categories, read from the server when the person
     first reaches for a link or the category. */
  const [wantSite, setWantSite] = useState(false);
  const siteLinks = useSiteLinks(wantSite ? a.s : undefined);
  const targets = (siteLinks.data?.articles ?? []).filter(x => x.id !== srv.id);
  /* The words a link is being put on: which text, and the range selected in it. */
  const [linking, setLinking] = useState<LinkAt | null>(null);
  /* The list item of each list block the caret was last in (the link button of a list acts on it). */
  const lastItem = useRef<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  /* The block whose menu is open, and where on the screen it opens (it is not clipped by the article's scroll box). */
  const [menu, setMenu] = useState<MenuAt | null>(null);
  /* Where the caret goes after a block was added, moved or removed: "key" or "key:item". */
  const focusNext = useRef<{ id: string; end?: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const dirty = isDirty(d, base.content, base.category);
  const changedElsewhere = srv.status !== 'review' || JSON.stringify(srv.content) !== base.json || (srv.category ?? '') !== base.category;
  const domain = site?.domain || live.domain;

  /* The editor is open exactly as long as the guard holds this article: when the person agreed to discard the
     changes (whatever asked), the editor closes too. */
  useEffect(() => {
    editGuard.begin(a.id);
    const off = editGuard.subscribe(() => { if (editGuard.get().id !== a.id) onDone(); });
    return () => { off(); editGuard.end(); };
  }, [a.id, onDone]);
  useEffect(() => { editGuard.setDirty(dirty); }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useLayoutEffect(() => {
    const f = focusNext.current; if (!f) return;
    focusNext.current = null;
    const el = root.current?.querySelector<HTMLTextAreaElement | HTMLInputElement | HTMLButtonElement>(`[data-ed="${f.id}"]`);
    if (!el) return;
    el.focus();
    if ('setSelectionRange' in el && !(el instanceof HTMLButtonElement)) { const n = f.end ? el.value.length : 0; el.setSelectionRange(n, n); }
  });
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!(e.target as Element | null)?.closest?.('.ed-tools')) setMenu(null); };
    const close = () => setMenu(null);
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [menu]);

  const save = async () => {
    if (busy) return;
    const problem = problemOf(d);
    if (problem) { setMsg(problem); return; }
    if (!dirty) { editGuard.end(); return; }
    setBusy(true); setMsg('');
    const err = await saveArticleEdit(a.id, editBody(d, base.updatedAt));
    if (err === null) { editGuard.end(); return; }
    setBusy(false); setMsg(err);
  };
  const cancel = () => leaveEdit(() => { editGuard.end(); });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (guard.asking || linking) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); }
    else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      /* Ctrl/Cmd+K in a paragraph or a list item: a link on the selected words. */
      const id = (e.target as HTMLElement).getAttribute?.('data-ed') ?? '';
      const [key, item] = id.split(':');
      const b = d.blocks.find(x => x.key === key);
      if (b && (b.type === 'p' || (b.type === 'list' && item !== undefined))) { e.preventDefault(); startLink(b, b.type === 'list' ? Number(item) : null); }
    }
    else if (e.key === 'Escape') {
      e.preventDefault();
      if (menu) { focusNext.current = { id: menu.key + ':menu' }; setMenu(null); } else cancel();
    }
  };

  /* ---- Changes to the draft ---- */
  const field = <K extends 'title' | 'titleTag' | 'metaDescription' | 'slug' | 'category'>(k: K, v: string) => setD(x => ({ ...x, [k]: v }));
  const setBlock = (key: string, fn: (b: DraftBlock) => DraftBlock) => setD(x => ({ ...x, blocks: x.blocks.map(b => b.key === key ? fn(b) : b) }));
  const full = d.blocks.length >= LIMITS.blocks;
  const addAfter = (key: string | null, type: DraftBlock['type'], text = '', links: ArticleLink[] = []) => {
    if (full) return;
    const made = emptyBlock(type, text);
    const nb: DraftBlock = links.length && isText(made) ? { ...made, links } : made;
    setD(x => { const i = key === null ? x.blocks.length - 1 : x.blocks.findIndex(b => b.key === key); const blocks = [...x.blocks]; blocks.splice(i + 1, 0, nb); return { ...x, blocks }; });
    focusNext.current = { id: nb.type === 'list' ? nb.key + ':0' : nb.type === 'table' ? nb.key + ':0:0' : nb.key };
    setMenu(null);
  };
  const remove = (key: string) => {
    const i = d.blocks.findIndex(b => b.key === key), near = d.blocks[i - 1] ?? d.blocks[i + 1];
    setD(x => ({ ...x, blocks: x.blocks.filter(b => b.key !== key) }));
    if (near) focusNext.current = { id: near.type === 'list' ? near.key + ':0' : near.type === 'table' ? near.key + ':0:0' : near.key, end: true };
  };
  const move = (key: string, by: -1 | 1, focus: string) => {
    const i = d.blocks.findIndex(b => b.key === key), j = i + by;
    if (i < 0 || j < 0 || j >= d.blocks.length) return;
    setD(x => { const blocks = [...x.blocks]; [blocks[i], blocks[j]] = [blocks[j]!, blocks[i]!]; return { ...x, blocks }; });
    focusNext.current = { id: focus, end: true };
  };

  /* ---- Links ---- */
  const linksN = linkCount(d.blocks);
  /** Opens the link dialog for the words selected in a paragraph, or in the item of a list the caret was last in. */
  function startLink(b: DraftBlock, item: number | null) {
    const id = item === null ? b.key : `${b.key}:${item}`;
    const el = root.current?.querySelector<HTMLTextAreaElement>(`[data-ed="${id}"]`);
    if (!el) return;
    setMenu(null); setMsg(''); setWantSite(true);
    setLinking({ key: b.key, item, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0, text: el.value });
  }
  const textLinks = (b: DraftBlock, item: number | null): ArticleLink[] => b.type === 'list' ? (item === null ? [] : b.links?.[item] ?? []) : isText(b) ? b.links ?? [] : [];
  const setLinks = (key: string, item: number | null, links: ArticleLink[]) => setBlock(key, x => {
    if (x.type === 'list' && item !== null) { const all = x.items.map((_, i) => x.links?.[i] ?? []); all[item] = links; return { ...x, links: all }; }
    return isText(x) ? { ...x, links } : x;
  });
  const linkingBlock = linking ? d.blocks.find(b => b.key === linking.key) : undefined;

  /* ---- Photos: shown where the save will put them ---- */
  const images = srv.images ?? [];
  const sent = d.blocks.filter(b => blockEdits([b]).length);
  const places = photoPlaces(images, base.content.blocks.length, sent);
  const photosAfter = (b: DraftBlock): PhotoWire[] => { const i = sent.indexOf(b); return i < 0 ? [] : images.filter(p => places.get(p.id) === i); };
  const moved = (p: PhotoWire, b: DraftBlock): boolean => b.from !== p.after;
  const hero = images.find(p => p.role === 'hero');

  const c = base.content;
  const titleEdited = d.title.replace(/\s+/g, ' ').trim() !== c.title;
  const slug = slugify(d.slug);
  const photoBusy = srv.photos?.status === 'work';

  return (
    <div className="ed" ref={root} onKeyDown={onKeyDown}>
      <Checks a={a} />
      <NativeReview a={a} />

      <section>
        <h3>Search appearance</h3>
        <div className="ed-search">
          <div className="ed-fields">
            <label className="ed-f">
              <span className="ed-l">Title tag<Count id="edTagN" n={chars(d.titleTag)} max={TITLE_TAG_MAX} /></span>
              <Grow className="ed-box" value={d.titleTag} maxLength={LIMITS.titleTag} aria-describedby="edTagN" onChange={e => field('titleTag', e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
            </label>
            <label className="ed-f">
              <span className="ed-l">Meta description<Count id="edMetaN" n={chars(d.metaDescription)} min={META_MIN} max={META_MAX} /></span>
              <Grow className="ed-box" value={d.metaDescription} maxLength={LIMITS.metaDescription} aria-describedby="edMetaN" onChange={e => field('metaDescription', e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
            </label>
            <label className="ed-f">
              <span className="ed-l">URL slug</span>
              <span className="ed-slug ed-box">
                <span aria-hidden="true">{domain}/</span>
                <input type="text" value={d.slug} maxLength={LIMITS.slug} spellCheck={false} autoCapitalize="none" onChange={e => field('slug', e.target.value)} onBlur={() => field('slug', slug)} />
              </span>
            </label>
            <label className="ed-f">
              <span className="ed-l">Category<span className="ed-count">{siteLinks.data?.categories.length ? 'Choose one of the site\'s, or type a new one' : 'A short name, in the site\'s language'}</span></span>
              <input type="text" className="ed-box" value={d.category} maxLength={CATEGORY_MAX} list="edCats" placeholder="No category" onFocus={() => setWantSite(true)} onChange={e => field('category', e.target.value)} />
              <datalist id="edCats">{(siteLinks.data?.allCategories ?? []).map(k => <option key={k} value={k} />)}</datalist>
            </label>
          </div>
          <div className="ed-serp" aria-label="How it may look in search results">
            <span className="ed-serp-h">In search results</span>
            <span className="ed-serp-url">{domain} › {slug || '…'}</span>
            <span className="ed-serp-t">{cut(d.titleTag, TITLE_TAG_MAX) || 'No title tag'}</span>
            <span className="ed-serp-d">{cut(d.metaDescription, META_MAX) || 'No meta description: the search engine picks a piece of the text.'}</span>
          </div>
        </div>
      </section>

      <ArticlePhotos a={a} srv={srv} />

      <section>
        <h3>Article</h3>
        <div className="scroll">
          <div className="ed-grid" role="group" aria-label="Article text">
            <div className="ed-row ed-head"><span>Original ({live.lang})</span><span>English translation</span><span className="ed-tools" /></div>

            <div className="ed-row">
              <div className="ed-o"><Chip>H1</Chip>
                <Grow className="ed-t-h1" value={d.title} maxLength={LIMITS.title} aria-label="Title (H1)" data-ed="title" onChange={e => field('title', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} />
              </div>
              <div className="ed-e"><b>{c.titleEn}</b>{titleEdited || c.titleEnStale ? <Stale /> : null}</div>
              <span className="ed-tools" />
            </div>
            <div className="ed-row ed-fixed">
              <div className="ed-o"><Chip>Byline</Chip> {c.byline.text}</div>
              <div className="ed-e">{c.byline.en}</div>
              <span className="ed-tools" />
            </div>
            {hero ? <PhotoRow aid={srv.id} p={hero} /> : null}

            {d.blocks.map((b, i) => {
              const edited = blockEdited(b, c.blocks);
              const n = i + 1, name = `${TYPE_LABEL[b.type]} (block ${n})`;
              const alt = (e: KeyboardEvent, focus: string) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return false;
                e.preventDefault(); move(b.key, e.key === 'ArrowUp' ? -1 : 1, focus); return true;
              };
              return (
                <div key={b.key} className="ed-block">
                  <div className={cx('ed-row', 'ed-k-' + b.type)}>
                    <div className="ed-o">
                      {isText(b) ? (
                        <>
                          {b.type === 'p' ? null : <Chip>{b.type.toUpperCase()}</Chip>}
                          <Grow className={'ed-t-' + b.type} value={b.text} maxLength={b.type === 'p' ? LIMITS.paragraph : LIMITS.heading} aria-label={name} data-ed={b.key}
                            placeholder={b.type === 'p' ? 'Write a paragraph' : 'Write a heading'}
                            onChange={e => { const v = e.target.value; setBlock(b.key, x => isText(x) ? { ...x, text: v, ...(x.links?.length ? { links: shiftLinks(x.links, x.text, v) } : {}) } : x); }}
                            onKeyDown={e => {
                              if (alt(e, b.key)) return;
                              const el = e.currentTarget;
                              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                                /* Enter ends this block: the text after the caret starts a new paragraph below. */
                                e.preventDefault();
                                const at = el.selectionStart ?? b.text.length, to = el.selectionEnd ?? at, rest = b.text.slice(to);
                                /* Each half keeps the links that lie wholly in it. */
                                setBlock(b.key, x => isText(x) ? { ...x, text: b.text.slice(0, at), links: sliceLinks(b.links, 0, at) } : x);
                                addAfter(b.key, 'p', rest, b.type === 'p' ? sliceLinks(b.links, to, b.text.length) : []);
                              } else if (e.key === 'Backspace' && !b.text && d.blocks.length > 1) { e.preventDefault(); remove(b.key); }
                            }} />
                          {b.type === 'p' ? <LinkList text={b.text} links={b.links} onRemove={k => setLinks(b.key, null, (b.links ?? []).filter((_, j) => j !== k))} /> : null}
                        </>
                      ) : b.type === 'list' ? (
                        <ListEditor b={b} name={name} onAlt={alt} onItem={k => { lastItem.current[b.key] = k; }}
                          unlink={(item, k) => setLinks(b.key, item, (b.links?.[item] ?? []).filter((_, j) => j !== k))}
                          set={(items, links) => setBlock(b.key, x => x.type === 'list' ? { ...x, items, links } : x)} focus={id => { focusNext.current = { id, end: true }; }} />
                      ) : (
                        <TableEditor b={b} name={name} onAlt={alt} set={rows => setBlock(b.key, x => x.type === 'table' ? { ...x, rows } : x)} />
                      )}
                    </div>
                    <div className="ed-e">{english(b, c.blocks, edited)}</div>
                    <div className={cx('ed-tools', (b.type === 'p' || b.type === 'list') && 'col')}>
                      {b.type === 'p' || b.type === 'list' ? (
                        <Tool icon="add_link" label={b.type === 'p' ? `Link the selected words of block ${n}` : `Link the selected words of the list item (block ${n})`} title="Link the selected words (Ctrl+K or ⌘K)"
                          /* The selection is read from the text box, which keeps it while the button is pressed. */
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => startLink(b, b.type === 'list' ? Math.min(lastItem.current[b.key] ?? 0, b.items.length - 1) : null)} />
                      ) : null}
                      <Tool icon="more_vert" label={`Actions for block ${n}, ${TYPE_LABEL[b.type].toLowerCase()}`} aria-haspopup="menu" aria-expanded={menu?.key === b.key} data-ed={b.key + ':menu'}
                        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu?.key === b.key ? null : { key: b.key, right: window.innerWidth - r.right, top: r.bottom, bottom: window.innerHeight - r.top }); }} />
                      {menu?.key === b.key ? (
                        <BlockMenu at={menu} type={b.type} first={i === 0} last={i === d.blocks.length - 1} full={full}
                          onMove={by => { setMenu(null); move(b.key, by, b.key + ':menu'); }}
                          onAdd={t => addAfter(b.key, t)}
                          onType={t => { setMenu(null); setBlock(b.key, x => isText(x) ? { ...x, type: t } : x); focusNext.current = { id: b.key, end: true }; }}
                          onRemove={() => { setMenu(null); remove(b.key); }} />
                      ) : null}
                    </div>
                  </div>
                  {photosAfter(b).map(p => <PhotoRow key={p.id} aid={srv.id} p={p} moved={moved(p, b)} />)}
                </div>
              );
            })}

            {d.blocks.length ? null : (
              <div className="ed-row"><div className="ed-o"><Button size="sm" variant="tonal" icon="add" onClick={() => addAfter(null, 'p')}>Add a paragraph</Button></div><div className="ed-e" /><span className="ed-tools" /></div>
            )}
            <div className="ed-row ed-fixed">
              <div className="ed-o"><Chip>How it was made</Chip><Grow aria-label="Disclosure" value={d.disclosure} onChange={e => setD(x => ({ ...x, disclosure: e.target.value }))} /></div>
              <div className="ed-e">{d.disclosure.trim() !== c.disclosure.text || c.disclosure.enStale ? <Stale /> : null}{c.disclosure.en}</div>
              <span className="ed-tools" />
            </div>
          </div>
        </div>
        <p className="note">You edit the text in {live.lang}. The English beside a piece you change is not rewritten: it is marked “translation not updated” so the team knows. Enter starts a new paragraph, Alt with the up or down arrow moves a block. To add a link, select words in a paragraph or a list item and press the link button beside it ({linksN} of {MAX_LINKS} links used).</p>
      </section>

      <Sources c={c} />
      <AgentNotes c={c} engineNotes={live.engineNotes} />

      <div className="ed-bar" role="region" aria-label="Save or cancel your changes">
        <div className="ed-bar-s">
          <Icon name={dirty ? 'edit' : 'check_circle'} />
          <span>
            <b>{busy ? 'Saving…' : dirty ? 'Unsaved changes' : 'No changes yet'}</b>
            <span className="ed-bar-n">{photoBusy ? 'The Site Builder is choosing photos: adding, removing or moving blocks can be saved when it has finished.'
              : 'Saving computes the checks again. A language review is cleared when the title or the text changes.'}</span>
          </span>
        </div>
        <div className="ed-bar-a">
          <Button variant="text" onClick={cancel} disabled={busy}>Cancel</Button>
          <Button variant="filled" icon="save" onClick={() => { void save(); }} disabled={busy || !dirty || changedElsewhere} title="Ctrl+S or ⌘S">{busy ? 'Saving…' : 'Save changes'}</Button>
        </div>
        {changedElsewhere ? (
          <Callout icon="sync_problem" warn><b>This article changed while you were editing.</b> {srv.status !== 'review' ? 'It is no longer waiting for review, so it cannot be edited.' : 'Someone else saved a newer version.'} Your changes cannot be saved over it: copy what you need, then cancel.</Callout>
        ) : null}
        {msg ? <p className="err ed-msg" role="alert">{msg}</p> : null}
      </div>

      <Dialog open={!!linking} onClose={() => setLinking(null)} labelledBy="edLinkT" className="ed-linkdlg" backdropClose>
        {linking ? (
          <LinkForm at={linking} targets={targets} loading={siteLinks.loading} loadError={siteLinks.error} full={linksN >= MAX_LINKS} onCancel={() => setLinking(null)}
            onAdd={to => {
              const b = linkingBlock;
              if (!b) return 'This text is no longer in the article.';
              const text = b.type === 'list' ? b.items[linking.item ?? 0] ?? '' : isText(b) ? b.text : '';
              if (text !== linking.text) return 'The text changed. Close this and select the words again.';
              const next = addLink(text, textLinks(b, linking.item), linking.start, linking.end, to);
              if (typeof next === 'string') return next;
              setLinks(b.key, linking.item, next);
              focusNext.current = { id: linking.item === null ? b.key : `${b.key}:${linking.item}`, end: true };
              setLinking(null);
              return '';
            }} />
        ) : null}
      </Dialog>

      <Dialog open={guard.asking} onClose={() => editGuard.answer(false)} labelledBy="edAskT" className="ed-ask">
        <h2 id="edAskT">Discard your changes?</h2>
        <p>The changes you made to this article are not saved. If you leave now they are lost.</p>
        <SheetActions>
          <Button variant="text" onClick={() => editGuard.answer(false)}>Keep editing</Button>
          <Button variant="danger" onClick={() => editGuard.answer(true)}>Discard changes</Button>
        </SheetActions>
      </Dialog>
    </div>
  );
}

/** The words a link is being put on: the block (and list item), the range selected in its text, and that text. */
interface LinkAt { key: string; item: number | null; start: number; end: number; text: string }

const STATUS_NOTE: Partial<Record<LinkNodeWire['status'], string>> = { review: ' (in review)' };

/**
 * The link dialog: the selected words, and where they lead: another article of this site (chosen from the site's
 * articles in review or approved) or a web address. `onAdd` returns '' when the link was added, else why not.
 */
function LinkForm({ at, targets, loading, loadError, full, onAdd, onCancel }: {
  at: LinkAt; targets: readonly LinkNodeWire[]; loading: boolean; loadError: string; full: boolean;
  onAdd: (to: { article: number } | { url: string }) => string; onCancel: () => void;
}) {
  const words = at.text.slice(Math.min(at.start, at.end), Math.max(at.start, at.end)).trim();
  const [kind, setKind] = useState<'article' | 'url'>('article');
  const [article, setArticle] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const options = targets.map(t => ({ value: String(t.id), label: (t.titleEn && t.titleEn !== t.title ? `${t.title} · ${t.titleEn}` : t.title) + (STATUS_NOTE[t.status] ?? '') }));
  const submit = () => {
    if (kind === 'article') {
      if (!article) { setErr('Choose the article the words lead to.'); return; }
      setErr(onAdd({ article: Number(article) }));
    } else {
      const u = httpUrl(url);
      if (!u) { setErr('Enter a full web address that starts with https:// or http://.'); return; }
      setErr(onAdd({ url: u }));
    }
  };
  const generic = /^(click here|here|read more|more|this|link|di sini|disini|klik di sini|baca selengkapnya|selengkapnya)$/i.test(words);
  return (
    <form onSubmit={e => { e.preventDefault(); submit(); }}>
      <h2 id="edLinkT">Add a link</h2>
      {words ? <p className="ed-words">{words}</p> : <Callout icon="info"><b>No words are selected.</b> Close this, select the words the link goes on in the text, then press the link button again.</Callout>}
      {full ? <Callout icon="warning" warn><b>This article already has {MAX_LINKS} links.</b> Remove one before adding another.</Callout> : null}
      {generic ? <Callout icon="warning" warn>These words say nothing about the page they lead to. Link words that describe it.</Callout> : null}
      <Tabs value={kind} onChange={k => { setKind(k); setErr(''); }} items={[{ id: 'article', label: 'Article on this site' }, { id: 'url', label: 'Web address' }]} />
      {kind === 'article' ? (
        options.length ? <Field label="Leads to"><Select label="Article the words lead to" value={article} onChange={v => { setArticle(v); setErr(''); }} options={[{ value: '', label: 'Choose an article' }, ...options]} searchPlaceholder="Search articles" /></Field>
          : <p className="note" style={{ marginTop: 12 }}>{loading ? 'Reading the articles of this site…' : loadError || 'This site has no other article in review or approved yet, so there is nothing to link to.'}</p>
      ) : (
        <Field label="Web address"><input type="url" value={url} placeholder="https://" maxLength={2000} autoFocus onChange={e => { setUrl(e.target.value); setErr(''); }} /></Field>
      )}
      {kind === 'article' && options.length ? <p className="note">The website shows the link once the article it leads to is approved; until then the words are plain text.</p> : null}
      {err ? <p className="err" role="alert">{err}</p> : null}
      <SheetActions>
        <Button variant="text" onClick={onCancel}>Cancel</Button>
        <Button variant="filled" type="submit" icon="add_link" disabled={!words || full}>Add link</Button>
      </SheetActions>
    </form>
  );
}

/** A small icon button of a block's tools. */
function Tool({ icon, label, danger, title, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; danger?: boolean }) {
  return <button type="button" className={cx('ed-ib', danger && 'danger')} aria-label={label} title={title ?? label} {...rest}><Icon name={icon} /></button>;
}

/** Where a block's menu opens: fixed to the screen at its button, below it or (near the bottom) above it. */
interface MenuAt { key: string; right: number; top: number; bottom: number }

/**
 * What can be done with a block: move it, add one below it, turn a paragraph into a heading (or back), remove it.
 * Arrow keys move through it; Escape or a click outside closes it.
 */
function BlockMenu({ at, type, first, last, full, onMove, onAdd, onType, onRemove }: {
  at: MenuAt; type: DraftBlock['type']; first: boolean; last: boolean; full: boolean;
  onMove: (by: -1 | 1) => void; onAdd: (t: DraftBlock['type']) => void; onType: (t: TextType) => void; onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])], i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  const item = (icon: string, text: string, onClick: () => void, opts: { disabled?: boolean; hint?: string; danger?: boolean } = {}) => (
    <button type="button" role="menuitem" className={opts.danger ? 'danger' : undefined} disabled={opts.disabled} onClick={onClick}><Icon name={icon} /><span>{text}</span>{opts.hint ? <kbd>{opts.hint}</kbd> : null}</button>
  );
  const text = type === 'p' || type === 'h2' || type === 'h3';
  /* Below the button while there is room above the save bar, else above it. */
  const up = at.top > window.innerHeight - 470;
  return (
    <div className="ed-menu" role="menu" aria-label="Block actions" ref={ref} onKeyDown={onKeyDown} style={up ? { right: at.right, bottom: at.bottom } : { right: at.right, top: at.top }}>
      {item('arrow_upward', 'Move up', () => onMove(-1), { disabled: first, hint: 'Alt ↑' })}
      {item('arrow_downward', 'Move down', () => onMove(1), { disabled: last, hint: 'Alt ↓' })}
      <span className="ed-menu-h">Add below</span>
      {ADDABLE.map(t => <span key={t} style={{ display: 'contents' }}>{item(ADD_ICON[t], t === 'h2' ? 'Heading' : TYPE_LABEL[t], () => onAdd(t), { disabled: full, hint: t === 'p' ? 'Enter' : undefined })}</span>)}
      {text ? (
        <>
          <span className="ed-menu-h">Turn into</span>
          {(['p', 'h2', 'h3'] as const).filter(t => t !== type).map(t => <span key={t} style={{ display: 'contents' }}>{item(ADD_ICON[t], TYPE_LABEL[t], () => onType(t))}</span>)}
        </>
      ) : null}
      <span className="ed-menu-sep" />
      {item('delete', 'Remove block', onRemove, { danger: true })}
    </div>
  );
}

type AltMove = (e: KeyboardEvent, focus: string) => boolean;

function ListEditor({ b, name, set, focus, onAlt, onItem, unlink }: {
  b: DraftBlock & { type: 'list' }; name: string; set: (items: string[], links: ArticleLink[][]) => void; focus: (id: string) => void; onAlt: AltMove;
  /** The caret is in item i. */
  onItem: (i: number) => void;
  /** Removes link k of item i. */
  unlink: (i: number, k: number) => void;
}) {
  /* The links of every item, in step with the items while they are typed in, split, added and removed. */
  const links = b.items.map((_, i) => b.links?.[i] ?? []);
  const put = (i: number, v: string) => set(b.items.map((x, k) => k === i ? v : x), links.map((l, k) => k === i ? shiftLinks(l, b.items[i] ?? '', v) : l));
  const add = (i: number, text = '') => {
    if (b.items.length >= LIMITS.items) return;
    const items = [...b.items], ls = [...links]; items.splice(i + 1, 0, text); ls.splice(i + 1, 0, []);
    set(items, ls); focus(`${b.key}:${i + 1}`);
  };
  const split = (i: number, from: number, to: number) => {
    if (b.items.length >= LIMITS.items) return;
    const t = b.items[i] ?? '', items = [...b.items], ls = [...links];
    items[i] = t.slice(0, from); items.splice(i + 1, 0, t.slice(to));
    ls[i] = sliceLinks(links[i], 0, from); ls.splice(i + 1, 0, sliceLinks(links[i], to, t.length));
    set(items, ls); focus(`${b.key}:${i + 1}`);
  };
  const drop = (i: number) => { if (b.items.length < 2) return; set(b.items.filter((_, k) => k !== i), links.filter((_, k) => k !== i)); focus(`${b.key}:${Math.max(0, i - 1)}`); };
  return (
    <ul className="ed-list" aria-label={name}>
      {b.items.map((t, i) => (
        <li key={i}>
          <Grow value={t} maxLength={LIMITS.item} aria-label={`Item ${i + 1} of the list`} data-ed={`${b.key}:${i}`} placeholder="List item" onChange={e => put(i, e.target.value)} onFocus={() => onItem(i)}
            onKeyDown={e => {
              if (onAlt(e, `${b.key}:${i}`)) return;
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                /* Enter ends this item: the text after the caret is the next item. */
                e.preventDefault();
                const el = e.currentTarget, at = el.selectionStart ?? t.length;
                split(i, at, el.selectionEnd ?? at);
              }
              else if (e.key === 'Backspace' && !t && b.items.length > 1) { e.preventDefault(); drop(i); }
            }} />
          {b.items.length > 1 ? <Tool icon="close" label={`Remove item ${i + 1}`} onClick={() => drop(i)} /> : null}
          <LinkList text={t} links={links[i]} onRemove={k => unlink(i, k)} />
        </li>
      ))}
      <li className="ed-more"><button type="button" className="ed-link" disabled={b.items.length >= LIMITS.items} onClick={() => add(b.items.length - 1)}><Icon name="add" />Add item</button></li>
    </ul>
  );
}

function TableEditor({ b, name, set, onAlt }: { b: DraftBlock & { type: 'table' }; name: string; set: (rows: string[][]) => void; onAlt: AltMove }) {
  const cols = Math.max(1, ...b.rows.map(r => r.length));
  const rows = b.rows.map(r => [...r, ...Array<string>(cols - r.length).fill('')]);
  const put = (y: number, x: number, v: string) => set(rows.map((r, j) => j === y ? r.map((cell, k) => k === x ? v : cell) : r));
  return (
    <div className="ed-tablew">
      <table className="ed-table" aria-label={name}>
        <tbody>
          {rows.map((r, y) => (
            <tr key={y}>{r.map((cell, x) => {
              const C = y === 0 ? 'th' : 'td';
              return <C key={x}><input type="text" value={cell} maxLength={LIMITS.cell} data-ed={`${b.key}:${y}:${x}`} aria-label={y === 0 ? `Heading of column ${x + 1}` : `Row ${y}, column ${x + 1}`}
                onChange={e => put(y, x, e.target.value)} onKeyDown={e => { onAlt(e, `${b.key}:${y}:${x}`); }} /></C>;
            })}</tr>
          ))}
        </tbody>
      </table>
      <div className="ed-tablet">
        <button type="button" className="ed-link" disabled={rows.length >= LIMITS.rows} onClick={() => set([...rows, Array<string>(cols).fill('')])}><Icon name="add" />Row</button>
        <button type="button" className="ed-link" disabled={cols >= LIMITS.cells} onClick={() => set(rows.map(r => [...r, '']))}><Icon name="add" />Column</button>
        <button type="button" className="ed-link" disabled={rows.length < 2} onClick={() => set(rows.slice(0, -1))}><Icon name="remove" />Last row</button>
        <button type="button" className="ed-link" disabled={cols < 2} onClick={() => set(rows.map(r => r.slice(0, -1)))}><Icon name="remove" />Last column</button>
      </div>
    </div>
  );
}

/** A photo in the article grid: not editable here, shown where the save will leave it. */
function PhotoRow({ aid, p, moved }: { aid: number; p: PhotoWire; moved?: boolean }) {
  return (
    <div className="ed-row ed-fixed ed-photo">
      <div className="ed-o"><PhotoFigure aid={aid} p={p} /></div>
      <div className="ed-e">{photoEnglish(p)}{moved ? <span className="ed-stale"><Icon name="low_priority" />Moves here when you save: its block was removed or changed</span> : null}</div>
      <span className="ed-tools" />
    </div>
  );
}

/** The English side of a block in the editor: the saved translation, and whether it still matches the text. */
function english(b: DraftBlock, saved: readonly ArticleBlock[], edited: boolean): ReactNode {
  const old = b.from === null ? undefined : saved[b.from];
  if (!old) return <Stale added />;
  const wasStale = old.type === 'list' ? old.items.some(x => x.enStale) : old.type === 'table' ? old.rows.some(r => r.some(x => x.enStale)) : !!old.enStale;
  const body = old.type === 'list' ? <ul>{old.items.map((x, i) => <li key={i}>{x.en}</li>)}</ul>
    : old.type === 'table' ? old.rows.map((r, i) => <span key={i} className={cx('ed-trow', i === 0 && 'h')}>{r.map(x => x.en).join(' | ')}</span>)
      : old.type === 'p' ? old.en : <b>{old.en}</b>;
  return <>{body}{edited || wasStale ? <Stale /> : null}</>;
}

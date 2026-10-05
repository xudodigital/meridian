import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export interface SelectOption { value: string; label: string }

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** Accessible name, announced as "Label: current choice". Use the visible field label, or what an aria-label would say. */
  label: string;
  id?: string;
  name?: string;
  /** Leading Material Symbol (the top-bar site picker uses "language"). */
  icon?: string;
  /** Placeholder of the search box, shown when there are more than 8 options. */
  searchPlaceholder?: string;
  disabled?: boolean;
}

/** Options rendered at once; the rest are reached by typing. */
const CAP = 60;

/**
 * The prototype's custom dropdown, which replaces the native select UI so it looks the same on every system.
 * Behaviour kept from the prototype: click or Arrow Up/Down opens it; Arrow keys move, Enter picks, Escape closes
 * and returns focus, Tab closes; a search box appears above 8 options; at most 60 options render at once;
 * the panel flips above the button when there is no room below and closes on resize, on an outside click and when
 * the page scrolls. Inside a dialog the panel is attached to that dialog so it stays in the top layer.
 * A visually hidden native <select> keeps the value in forms and passes label clicks on to the button.
 */
export function Select({ value, onChange, options, label, id, name, icon, searchPlaceholder, disabled }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [act, setAct] = useState(-1);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const selected = options.findIndex(o => o.value === value);
  const text = selected >= 0 ? options[selected]!.label : '';
  const many = options.length > 8;
  const needle = q.trim().toLowerCase();
  const list = options.map((o, i) => ({ t: o.label, i })).filter(x => !needle || x.t.toLowerCase().includes(needle));
  /* The highlighted option must be in the filtered list. */
  const active = list.some(x => x.i === act) ? act : list.length ? list[0]!.i : -1;

  const close = useCallback(() => { setOpen(false); setQ(''); }, []);
  const show = () => {
    if (disabled) return;
    setHost(btn.current?.closest<HTMLElement>('dialog[open]') || document.body);
    setAct(Math.max(0, selected)); setQ(''); setOpen(true);
  };
  const choose = (i: number) => { const o = options[i]; close(); if (o) onChange(o.value); btn.current?.focus(); };

  /* Place the panel under the button, or above it when there is no room (the prototype's ddPlace). */
  useLayoutEffect(() => {
    const b = btn.current, p = pop.current; if (!open || !b || !p) return;
    const r = b.getBoundingClientRect(), w = Math.min(Math.max(r.width, 240), innerWidth - 16);
    p.style.width = w + 'px'; p.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    const h = p.offsetHeight; let top = r.bottom + 6; if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    p.style.top = Math.max(8, top) + 'px';
  });
  useLayoutEffect(() => { if (open) pop.current?.querySelector('.ddo.act')?.scrollIntoView({ block: 'nearest' }); }, [open, active, q]);

  /* While open: keys are handled before anything else (so Escape closes the dropdown, not the dialog around it). */
  const live = useRef({ list, active, choose });
  useLayoutEffect(() => { live.current = { list, active, choose }; });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const { list: L, active: cur, choose: pickIt } = live.current, ix = L.findIndex(x => x.i === cur);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!L.length) return; setAct(L[Math.max(0, Math.min(L.length - 1, ix + (e.key === 'ArrowDown' ? 1 : -1)))]!.i); }
      else if (e.key === 'Enter') { e.preventDefault(); if (cur >= 0) pickIt(cur); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.current?.focus(); }
      else if (e.key === 'Tab') close();
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || wrap.current?.contains(t)) return;
      close();
    };
    const inDialog = !!btn.current?.closest('dialog');
    const main = inDialog ? null : document.querySelector('main');
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('resize', close);
    main?.addEventListener('scroll', close, { passive: true });
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('resize', close);
      main?.removeEventListener('scroll', close);
    };
  }, [open, close]);

  const onBtnKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); show(); }
  };

  return (
    <span className="ddw" ref={wrap}>
      <select className="ddn" id={id} name={name} tabIndex={-1} aria-hidden="true" data-dd="1" value={value} disabled={disabled}
        onChange={e => onChange(e.target.value)} onFocus={() => btn.current?.focus()}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button ref={btn} type="button" className="dd" aria-haspopup="listbox" aria-expanded={open} aria-label={label + ': ' + text} disabled={disabled}
        onClick={e => { e.preventDefault(); if (open) close(); else show(); }} onKeyDown={onBtnKey}>
        {icon ? <Icon name={icon} /> : null}<span className="lbl">{text}</span><span className="ms chev" aria-hidden="true">expand_more</span>
      </button>
      {open && host ? createPortal(
        <div className="ddp" role="listbox" aria-label={label} ref={pop}>
          {many ? <input type="text" className="ddq" placeholder={searchPlaceholder || 'Search'} aria-label="Search options" autoComplete="off" autoFocus value={q} onChange={e => setQ(e.target.value)} /> : null}
          <div className="ddl">
            {list.slice(0, CAP).map(x => (
              <button key={x.i} type="button" className={'ddo' + (x.i === active ? ' act' : '')} role="option" aria-selected={x.i === selected} onClick={() => choose(x.i)}>
                <Icon name="check" /><span>{x.t}</span>
              </button>
            ))}
            {list.length > CAP ? <div className="ddhint">Showing {CAP} of {list.length}. Type to narrow the list.</div> : null}
            {list.length ? null : <div className="ddhint">No matches.</div>}
          </div>
        </div>,
        host,
      ) : null}
    </span>
  );
}

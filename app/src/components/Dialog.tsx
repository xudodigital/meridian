import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

export interface DialogProps {
  open: boolean;
  /** Called when the dialog closes for any reason: Escape, a backdrop click, or `open` turning false. Set `open` to false here. */
  onClose: () => void;
  /** Element id. The ported CSS styles #dlg (confirm), #pop (popover) and #search. */
  id?: string;
  className?: string;
  /** Close when the person clicks outside the dialog box (sheets, popovers and search do; the confirm dialog does not). */
  backdropClose?: boolean;
  /** id of the element that names the dialog. */
  labelledBy?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
  children: ReactNode;
}

/**
 * A modal built on the native <dialog> element (showModal): the browser provides the backdrop, the focus trap,
 * Escape to close, and returns focus to the control that opened it. Children are mounted only while it is open,
 * so a form inside starts empty every time.
 */
export function Dialog({ open, onClose, id, className, backdropClose, labelledBy, label, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const onClick = backdropClose ? (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
  } : undefined;

  return createPortal(
    <dialog ref={ref} id={id} className={className} aria-labelledby={labelledBy} aria-label={label} onClick={onClick}
      /* React passes a nested dialog's close event up the component tree (a sheet opened from a sheet): only our own counts. */
      onClose={e => { if (e.target === e.currentTarget && open) onClose(); }}>
      {open ? children : null}
    </dialog>,
    document.body,
  );
}

export interface SheetProps extends Omit<DialogProps, 'backdropClose' | 'labelledBy' | 'label'> {
  /** Rendered as the sheet's <h2> and used as its accessible name. Omit it to render your own heading and pass `labelledBy`. */
  title?: ReactNode;
  /** Paragraph under the title. */
  description?: ReactNode;
  /** id of your own heading, when `title` is omitted. */
  labelledBy?: string;
  /** Wider space for results with tables; forms keep the standard width. */
  size?: 'default' | 'wide';
}

/**
 * A 560px dialog for forms and details, or a wider result sheet. A click on the backdrop closes it.
 * Put the buttons in <SheetActions>; that bar stays stuck to the bottom while the content scrolls.
 */
export function Sheet({ title, description, labelledBy, size = 'default', className, children, ...rest }: SheetProps) {
  const titleId = useId();
  return (
    <Dialog backdropClose labelledBy={title != null ? titleId : labelledBy} className={cx('sheet', size === 'wide' && 'sheet-wide', className)} {...rest}>
      {title != null ? <h2 id={titleId}>{title}</h2> : null}
      {description != null ? <p>{description}</p> : null}
      {children}
    </Dialog>
  );
}

/** The sticky button bar at the bottom of a Dialog or Sheet (the prototype's `dialog .actions`). */
export function SheetActions({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('actions', className)}>{children}</div>;
}

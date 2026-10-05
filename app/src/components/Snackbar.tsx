import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/store/store';
import { cx } from './cx';
import { fullscreenHost, useFullscreenElement } from './fullscreen';
import { Icon } from './Icon';

/** Icons the app shows a failure with (snack(msg, 'error') and the "cannot reach" kind). */
const ERROR_ICONS: ReadonlySet<string> = new Set(['error', 'cloud_off', 'warning', 'gpp_bad', 'report']);
/** A message that says something went wrong: it looks different and stays until the person closes it. */
export const isErrorSnack = (icon: string): boolean => ERROR_ICONS.has(icon);

/**
 * The prototype's #snack. Mounted once by the app; show a message with useStore.getState().snack(msg, icon). A
 * confirmation hides after 4 seconds. An error (snack(msg, 'error')) is drawn in the error colours, is announced as
 * an alert and stays until it is dismissed or another message replaces it, so it cannot be missed. While an element
 * is in full screen (the Workspace's office) the message shows inside that element, the only part of the page the
 * browser paints then.
 */
export function Snackbar() {
  const snack = useStore(s => s.snackMsg);
  const hide = useStore(s => s.hideSnack);
  const host = fullscreenHost(useFullscreenElement());
  const err = !!snack && isErrorSnack(snack.icon);
  useEffect(() => {
    if (!snack || err) return;
    const t = setTimeout(hide, 4000);
    return () => clearTimeout(t);
  }, [snack, err, hide]);
  /* The key restarts the entrance animation when a new message replaces one that is still showing. */
  const box = (
    <div className={cx('snack', err && 'err')} id="snack" role={err ? 'alert' : 'status'} hidden={!snack} key={snack ? snack.seq : 0}>
      {snack ? <><Icon name={snack.icon} /><span>{snack.msg}</span></> : null}
      {err ? <button type="button" className="ib" aria-label="Dismiss" title="Dismiss" onClick={hide}><Icon name="close" /></button> : null}
    </div>
  );
  return host ? createPortal(box, host) : box;
}

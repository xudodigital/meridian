import { useStore } from '@/store/store';
import { Button } from './Button';
import { Dialog, SheetActions } from './Dialog';

/**
 * The one confirm dialog (the prototype's #dlg). Mounted once by the app; open it from anywhere with
 * useStore.getState().openConfirm('site:<id>') and the store runs the matching action when the person confirms.
 */
export function ConfirmDialog() {
  const c = useStore(s => s.confirm);
  const close = useStore(s => s.closeConfirm);
  const ok = useStore(s => s.confirmOk);
  return (
    <Dialog id="dlg" open={!!c} onClose={close} labelledBy="dlgT">
      <h2 id="dlgT">{c?.title}</h2>
      <p id="dlgB">{c?.body}</p>
      <SheetActions>
        <Button variant="text" onClick={close}>Cancel</Button>
        <Button variant="danger" id="dlgOk" onClick={ok}>{c?.label}</Button>
      </SheetActions>
    </Dialog>
  );
}

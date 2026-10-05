import { useStore } from '@/store/store';
import { cx } from './cx';
import { Icon } from './Icon';

/**
 * A save to the server failed: non-blocking, and it goes away when a retry works. Nothing in demo mode, where nothing
 * is saved. The shell shows it above every view; the Office page and the Workspace's office in full screen show their own.
 */
export function SyncBanner({ id, className }: { id?: string; className?: string }) {
  const error = useStore(s => s.sample ? '' : s.sync.error);
  if (!error) return null;
  return <div className={cx('banner warn', className)} role="alert" id={id}><Icon name="cloud_off" /><span>{error}</span></div>;
}

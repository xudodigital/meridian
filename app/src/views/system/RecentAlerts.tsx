import { useQuery } from '@tanstack/react-query';
import { Pill, Table } from '@/components';
import { stamp } from '@/store/rules';
import { servicesApi } from '@/store/servicesApi';
import { useStore } from '@/store/store';

/** The last alerts the server handled, and what each channel did with them (admins, outside demo mode). */
export function RecentAlerts() {
  const sid = useStore(s => s.session?.id ?? null);
  const q = useQuery({ queryKey: ['live', 'alerts', sid], queryFn: servicesApi.alerts, enabled: !!sid, refetchInterval: 60_000 });
  const list = q.data ?? [];
  return (
    <Table
      cols={['When', 'Alert', 'Delivery']}
      rowKey={(_, i) => String(list[i]!.id)}
      loading={q.isPending}
      empty={q.isError ? 'The list could not be loaded.' : 'No alert was sent by email, Slack or Telegram yet.'}
      rows={list.slice(0, 10).map(a => [
        <span className="nw">{stamp(a.at)}</span>,
        a.title,
        a.sentAt ? <span className="note">{a.result}</span> : <Pill kind="info">Waiting for quiet hours to end</Pill>,
      ])}
    />
  );
}

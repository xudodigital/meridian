/* HTTP calls for Settings > System (server/system-api.ts): the health view and backups. Admins only; nothing here
   touches the store. A backup download is a plain same-origin GET (a link): the session cookie goes with it. */
import { apiGet, apiSend } from './serverApi';

/** One backup archive on the server's disk. `at` is when it was made (from its name). */
export interface BackupWire { name: string; bytes: number; at: number }

/** The job queue as the server reports it. `queued` counts waiting jobs per kind. */
export interface QueueWire {
  running: { kind: string; id: number; startedAt: number | null; ageMs: number } | null;
  queued: Record<string, number>;
  total?: number;
}

export interface SystemHealth {
  version: string;
  node: string;
  startedAt: number;
  uptimeSec: number;
  db: { ok: boolean; bytes: number; walBytes: number };
  /** null from a server that does not report its queue. */
  queue: QueueWire | null;
  engine: { mode: string; apiVersion: string; ready: boolean; reason: string };
  /** null when the server could not measure the disk. */
  disk: { freeBytes: number; totalBytes: number } | null;
  folders: { media: number; sites: number; backups: number; logs: number; workspaces: number };
  backups: { count: number; last: BackupWire | null; keepDaily: number; keepWeekly: number; nightlyHour: number; autoEnabled?: boolean };
  schedulers: { maintenance: { at: number; errors: string[] } | null; report: number | null; metrics: number | null; accessCheck: number | null };
}

/** Backup names are meridian-YYYYMMDD-HHMMSS.zip; anything else never becomes a link. */
const BACKUP_NAME = /^meridian-\d{8}-\d{6}\.zip$/;

export const systemApi = {
  health: () => apiGet<{ health: SystemHealth }>('/api/system/health').then(r => r.health),
  backups: () => apiGet<{ backups: BackupWire[] }>('/api/system/backups').then(r => r.backups),
  /** "Back up now": resolves to the new backup and the list after the rotation. */
  backup: () => apiSend<{ backup: BackupWire; backups: BackupWire[] }>('/api/system/backup'),
  setAutoBackup: (autoEnabled: boolean) => apiSend<{ autoEnabled: boolean }>('/api/system/backup-settings', { autoEnabled }),
};

/** Where a backup downloads from, or '' when the name is not a backup's. */
export const backupHref = (name: string): string => BACKUP_NAME.test(name) ? `/api/system/backups/${name}` : '';

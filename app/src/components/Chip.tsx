import type { ReactNode } from 'react';
import { chipText } from '@/store/rules';
import { useStore } from '@/store/store';

/** A plain .chip: small tabular text (a time, an email, a country code). */
export function Chip({ children }: { children: ReactNode }) { return <span className="chip">{children}</span>; }

/**
 * The prototype's chip(id): "VN · domain-a.example", "All sites" for null, "Removed site" for an unknown id.
 * `domain` is shown instead of "Removed site": a server request keeps the domain it was made for.
 */
export function SiteChip({ id, domain }: { id: string | null | undefined; domain?: string }) {
  const text = useStore(s => chipText(s, id, domain));
  return <span className="chip">{text}</span>;
}

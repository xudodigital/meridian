import { useState } from 'react';
import { Button, Sheet, SheetActions } from '@/components';
import type { ResetLink } from '@/store/authApi';

/**
 * The one-time password reset link an admin made for someone, shown once with a Copy button (like an invitation
 * link). The server keeps only a hash of it, so closing this sheet is the last time anyone sees the link.
 */
export function ResetLinkSheet({ made, onClose }: { made: { name: string; email: string; link: ResetLink } | null; onClose: () => void }) {
  return (
    <Sheet open={made !== null} onClose={onClose} title={made ? `Password reset link for ${made.name}` : 'Password reset link'}>
      {made ? <LinkBody email={made.email} link={made.link} onClose={onClose} /> : null}
    </Sheet>
  );
}

function LinkBody({ email, link, onClose }: { email: string; link: ResetLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try { void navigator.clipboard.writeText(link.link).then(() => setCopied(true), () => setCopied(false)); } catch { setCopied(false); }
  };
  return (
    <>
      <p><b>Share this link yourself.</b> Copy it and give it to {email}, for example in a chat. It works once, for {link.minutes} minutes, and is shown only now.</p>
      <div className="invlink">
        <input type="text" id="rlLink" readOnly value={link.link} aria-label="Password reset link" onFocus={e => e.currentTarget.select()} />
        <Button variant="tonal" icon="content_copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <p className="note">With it they choose a new password and are signed out everywhere. Their 2-step verification stays on. Making another link cancels this one.</p>
      <SheetActions><Button variant="filled" onClick={onClose}>Done</Button></SheetActions>
    </>
  );
}

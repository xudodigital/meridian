import { Button } from '@/components';
import { useStore } from '@/store/store';
import { LoginFrame } from './Login';
import { TwoStepSetup } from './TwoStepSetup';

/**
 * Settings require a 2-step verification code at sign-in and this person has not set it up yet: they set it up here
 * before they can use the app. The server refuses everything else until then.
 */
export function Enroll() {
  const name = useStore(s => s.session?.name ?? '');
  const setMe = useStore(s => s.setMe);
  const signOut = useStore(s => s.signOut);
  return (
    <LoginFrame>
      <div className="lform">
        <h1>Set up 2-step verification</h1>
        <p className="note" id="lgNote">{name ? name + ', this' : 'This'} workspace requires a 2-step verification code at sign-in. Set it up now to continue.</p>
        <TwoStepSetup onDone={setMe} onCancel={() => signOut()} cancelLabel="Sign out" />
      </div>
    </LoginFrame>
  );
}

/** Shown while the workspace is loading after sign-in. */
export function Loading() {
  const error = useStore(s => s.sync.error);
  const signOut = useStore(s => s.signOut);
  return (
    <LoginFrame>
      <div className="lform">
        <h1>Meridian</h1>
        <p className="note" id="lgNote">{error || 'Loading the workspace…'}</p>
        {error ? <Button variant="text" onClick={() => signOut()}>Sign out</Button> : null}
      </div>
    </LoginFrame>
  );
}

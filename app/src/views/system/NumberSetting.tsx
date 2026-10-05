import { useState } from 'react';
import { Field } from '@/components';
import { useStore } from '@/store/store';

/**
 * A number field of Settings. Like the prototype's change event, the value is saved when the field loses focus or on
 * Enter, not on every keystroke, and anything below 1 becomes 1.
 */
export function NumberSetting({ k, label }: { k: 'budget' | 'parallel'; label: string }) {
  const value = useStore(s => s.settings[k]);
  const setSystemSetting = useStore(s => s.setSystemSetting);
  const [draft, setDraft] = useState(String(value));
  /* Follow the stored value when it changes. */
  const [shown, setShown] = useState(value);
  if (shown !== value) { setShown(value); setDraft(String(value)); }
  const commit = () => {
    if (draft === String(value)) return;
    setSystemSetting(k, Math.max(1, Number(draft) || 1));
    setDraft(String(useStore.getState().settings[k]));
  };
  return (
    <Field label={label}>
      <input type="number" id={'st-' + k} min={1} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
    </Field>
  );
}

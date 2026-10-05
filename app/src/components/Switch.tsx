import type { ReactNode } from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name. Not needed inside SwitchRow, where the row text names it. */
  label?: string;
  id?: string;
  disabled?: boolean;
}
/** The prototype's <input type="checkbox" class="switch" role="switch">. */
export function Switch({ checked, onChange, label, id, disabled }: SwitchProps) {
  return <input type="checkbox" className="switch" role="switch" id={id} checked={checked} disabled={disabled} aria-label={label} onChange={e => onChange(e.target.checked)} />;
}

export interface SwitchRowProps extends Omit<SwitchProps, 'label'> { children: ReactNode }
/** The prototype's .swrow: a full-width row with the text on the left and the switch on the right. */
export function SwitchRow({ children, ...rest }: SwitchRowProps) {
  return <label className="swrow"><Switch {...rest} /><span>{children}</span></label>;
}

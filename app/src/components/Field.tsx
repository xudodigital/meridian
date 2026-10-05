import type { InputHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export interface FieldProps {
  /** Visible label text; it also names the control inside. */
  label: ReactNode;
  /** Spans the whole row of a .fields grid. */
  wide?: boolean;
  /** One control: <input>, <textarea> or <Select>. */
  children: ReactNode;
}
/** The prototype's <label class="f">Text<input></label>. */
export function Field({ label, wide, children }: FieldProps) {
  return <label className={cx('f', wide && 'wide')}>{label}{children}</label>;
}
/** The responsive .fields grid that holds Field elements. */
export function Fields({ children }: { children: ReactNode }) { return <div className="fields">{children}</div>; }

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Accessible name. */
  label: string;
}
/** The prototype's .sfield: a text input with a leading search icon. */
export function SearchField({ label, autoComplete = 'off', ...rest }: SearchFieldProps) {
  return <div className="sfield"><Icon name="search" /><input type="text" aria-label={label} autoComplete={autoComplete} {...rest} /></div>;
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Accessible name. */
  label: string;
}
/** The prototype's .ck: a native checkbox inside a 48px touch target. */
export function Checkbox({ label, ...rest }: CheckboxProps) {
  return <label className="ck"><input type="checkbox" aria-label={label} {...rest} /></label>;
}

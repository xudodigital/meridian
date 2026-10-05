import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';

export type ButtonVariant = 'outlined' | 'filled' | 'tonal' | 'text' | 'danger' | 'onhero' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** outlined is the bare .btn; the others add the prototype's modifier class. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading Material Symbol. */
  icon?: string;
  children?: ReactNode;
  /** The <button> element, for example to move focus to it. */
  ref?: Ref<HTMLButtonElement>;
}
/** The prototype's .btn. type defaults to "button"; pass type="submit" inside a form. */
export function Button({ variant = 'outlined', size = 'md', icon, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx('btn', variant !== 'outlined' && variant, size !== 'md' && size, className)} {...rest}>
      {icon ? <Icon name={icon} /> : null}{children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: string;
  /** Accessible name (aria-label). Pass `title` as well for a tooltip, as the prototype does on most icon buttons. */
  label: string;
  tone?: 'tonal' | 'err';
}
/** The prototype's .ib: a 48px round icon button. */
export function IconButton({ icon, label, tone, className, type = 'button', title, ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx('ib', tone, className)} aria-label={label} title={title} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/** The prototype's .linkbtn: text that behaves like a link inside a heading. */
export function LinkButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx('linkbtn', className)} {...rest} />;
}

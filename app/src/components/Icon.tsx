import { cx } from './cx';

export interface IconProps {
  /** Material Symbols Rounded ligature name, for example "rocket_launch". */
  name: string;
  /** Filled variant. */
  fill?: boolean;
  className?: string;
}
/** The prototype's ic(name): a decorative Material Symbol. Give the parent control its own accessible name. */
export function Icon({ name, fill, className }: IconProps) {
  return <span className={cx('ms', fill && 'fill', className)} aria-hidden="true">{name}</span>;
}

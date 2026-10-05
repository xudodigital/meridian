import type { FormEvent, ReactNode } from 'react';
import { Button, Fields, SheetActions } from '@/components';

export interface SheetFormProps {
  /** Validation message under the fields (the prototype's #formMsg); empty hides it. */
  msg: string;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  /** Field elements. */
  children: ReactNode;
}
/** The body of the prototype's openForm() sheet: the fields, the error line and Cancel / submit. Put it inside a Sheet with a title. */
export function SheetForm({ msg, submitLabel, onSubmit, onCancel, children }: SheetFormProps) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); onSubmit(); };
  return (
    <form onSubmit={submit}>
      <Fields>{children}</Fields>
      <p className="err" hidden={!msg}>{msg}</p>
      <SheetActions>
        <Button variant="text" onClick={onCancel}>Cancel</Button>
        <Button variant="filled" type="submit">{submitLabel}</Button>
      </SheetActions>
    </form>
  );
}

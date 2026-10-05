import { useEffect, useRef } from 'react';
import { Button, Field, Fields, Sheet, SheetActions } from '@/components';

/** The prototype's showCSV() (lines 1983-1986): shown when the browser refuses clipboard access. The text starts selected. */
export function CsvSheet({ csv, onClose }: { csv: string | null; onClose: () => void }) {
  return (
    <Sheet open={csv !== null} onClose={onClose} title="Weekly report as CSV" description="Copying was not allowed here, so select the text below and copy it yourself.">
      {csv !== null ? <CsvText csv={csv} /> : null}
      <SheetActions><Button variant="text" onClick={onClose}>Close</Button></SheetActions>
    </Sheet>
  );
}

function CsvText({ csv }: { csv: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /* The dialog opens in its own effect, which runs after this one; select once it is shown. */
  useEffect(() => { queueMicrotask(() => { ref.current?.focus(); ref.current?.select(); }); }, []);
  return (
    <Fields>
      <Field label="CSV" wide><textarea ref={ref} className="csv" id="csvT" rows={8} readOnly value={csv} /></Field>
    </Fields>
  );
}

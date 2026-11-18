import { useState } from 'react';
import ClarityNoteView from './ClarityNoteView';
import Tooltip from '../../../../components/ui/Tooltip';
import { useToast } from '../../../../contexts/ToastContext';
import { CLARITY_LABEL, clarityPreview, type Clarity } from './ClarityDialog';
import { clarityPaths, fileOf, viewDocument } from './targetProducts';
import { IcoCheck } from './icons';

/* Product Clarity in the Sourcing Target Report (read-only): the same green "✓ Text / Link / Pdf"
   chip as the Assign form. Text opens the note (ClarityNoteView); Link opens the link in a new tab;
   Pdf opens the document in a new tab (through GET /p2p/clarity/download). No clarity: a dash. */

export default function ClarityChip({ clarity, productName = '' }: { clarity?: Clarity; productName?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  if (!clarity) return <span className="str-dash">—</span>;

  const label = CLARITY_LABEL[clarity.type];

  if (clarity.type === 'text') {
    return (
      <>
        <Tooltip label={clarity.value.length > 60 ? `${clarity.value.slice(0, 60).trimEnd()}…` : clarity.value}>
          <button type="button" className="str-cla" onClick={() => setReading(true)} aria-label="Read the clarity note"><IcoCheck size={11} sw={3} />{label}</button>
        </Tooltip>
        {reading && <ClarityNoteView productName={productName} note={clarity.value} onClose={() => setReading(false)} />}
      </>
    );
  }

  if (clarity.type === 'link') {
    const safe = /^https?:\/\//i.test(clarity.value);
    return (
      <Tooltip label={clarity.value}>
        {safe ? (
          <a className="str-cla" href={clarity.value} target="_blank" rel="noopener noreferrer" aria-label={`Open clarity link: ${clarity.value}`}>
            <IcoCheck size={11} sw={3} />{label}
          </a>
        ) : <span className="str-cla" tabIndex={0}><IcoCheck size={11} sw={3} />{label}</span>}
      </Tooltip>
    );
  }

  const paths = clarityPaths(clarity);
  // Opens the document in a new tab (the first one; the tooltip names them all), as in the Edit form.
  const view = async () => {
    if (busy || !paths.length) return;
    setBusy(true);
    try {
      await viewDocument(paths[0]);
    } catch {
      toast.error('Couldn’t open the document', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const names = paths.map(fileOf).join(', ');
  return (
    <Tooltip label={busy ? 'Opening…' : `View ${names || clarityPreview(clarity)}`}>
      <button type="button" className={`str-cla${busy ? ' is-busy' : ''}`} onClick={() => { void view(); }} disabled={!paths.length}
        aria-label={`View clarity document: ${names}`} aria-busy={busy || undefined}>
        {busy ? <span className="sct-spin sct-spin--cla" aria-hidden /> : <IcoCheck size={11} sw={3} />}
        {label}{paths.length > 1 && <span className="str-cla__n">×{paths.length}</span>}
      </button>
    </Tooltip>
  );
}

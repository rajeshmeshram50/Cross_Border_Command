import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { useToast } from '../../../../contexts/ToastContext';
import { IcoBox, IcoDoc, IcoDownload, IcoEye, IcoReceipt, IcoShield, IcoX } from '../../icons';
import { money } from '../order/manage-payment/payment-shared';
import { PoApiError } from '../order/api/po-api';
import { spiVaultApi, type EvidenceVault, type VaultDocument } from './spi-api';
import type { InvoiceRow } from './types';

import './invoice-vault.css';

const GROUP_ICON = (key: string): ReactNode =>
  key === 'po' ? <IcoDoc /> : key === 'trade' ? <IcoShield /> : key.startsWith('spi') ? <IcoReceipt /> : <IcoBox />;

const extOf = (name: string) => {
  const m = /\.([a-z0-9]{2,4})$/i.exec(name);
  return m ? m[1].toUpperCase() : 'DOC';
};

const STATUS_TONE: Record<string, string> = {
  uploaded: '#15803d', signed: '#15803d', printed: '#15803d', released: '#15803d', generated: '#0e7490',
  pending: '#b45309', sent: '#0e7490', awaited: '#b45309',
};

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function InvoiceEvidenceVault({ row, onClose }: {
  row: InvoiceRow;
  onClose: () => void;
}) {
  useScrollLock(true, '.iev-card');
  const toast = useToast();

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [vault, setVault] = useState<EvidenceVault | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!row.apiId) { setState('failed'); setError('This invoice has not been saved yet.'); return; }
    let live = true;
    spiVaultApi.vault(row.apiId)
      .then(v => { if (live) { setVault(v); setState('ready'); } })
      .catch(e => {
        if (!live) return;
        setState('failed');
        setError(e instanceof PoApiError && e.status !== 500 ? e.firstError : 'The documents for this invoice could not be loaded.');
      });
    return () => { live = false; };
  }, [row.apiId]);

  const open = async (doc: VaultDocument, key: string, mode: 'view' | 'download') => {
    const target = doc.url ?? doc.action_url ?? null;
    if (!target || busy) return;
    const preview = mode === 'view';
    const tab = preview ? window.open('', '_blank') : null;
    setBusy(`${key}:${mode}`);
    try {
      const blob = doc.url
        ? await spiVaultApi.file(doc.url, preview)
        : await spiVaultApi.file(target, false);
      const name = doc.url ? doc.name : `${doc.name.replace(/[^\w.-]+/g, '_')}.pdf`;
      if (preview && tab) {
        tab.location.href = URL.createObjectURL(blob);
      } else {
        saveBlob(blob, name);
      }
    } catch (e) {
      tab?.close();
      toast.error(preview ? 'Could not open the document' : 'Could not download the document',
        e instanceof PoApiError ? e.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const groups = vault?.groups ?? [];
  const totals = vault?.totals;
  const poCode = vault?.related.purchase_order?.code ?? row.poNo;

  return createPortal(
    <div className="iev-backdrop">
      <div
        className="iev-card"
        role="dialog" aria-modal="true" aria-labelledby="iev-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="iev-head">
          <span className="iev-head__ico"><IcoShield /></span>
          <div className="iev-head__txt">
            <div className="iev-head__t" id="iev-title">Evidence Vault</div>
            <div className="iev-head__s">
              {[vault?.subject.code ?? row.invoiceNo, row.supplierName, poCode].filter(Boolean).join(' · ')}
              {totals && ` · ${totals.available} of ${totals.documents} on file`}
            </div>
          </div>
          <button type="button" className="iev-head__x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="iev-body">
          {state !== 'ready' ? (
            <div className="iev-grp" style={{ padding: 24, textAlign: 'center' }}>
              {state === 'loading' ? 'Loading documents…' : error}
            </div>
          ) : groups.length === 0 ? (
            <div className="iev-grp" style={{ padding: 24, textAlign: 'center' }}>
              Nothing has been filed against this invoice yet.
            </div>
          ) : groups.map(g => {
            const count = g.sections.reduce((n, s) => n + s.documents.length, 0);
            return (
              <section className="iev-grp" key={g.key}>
                <header className="iev-grp__hd">
                  <span className="iev-grp__ico">{GROUP_ICON(g.key)}</span>
                  <div className="iev-grp__txt">
                    <div className="iev-grp__t">{g.title}</div>
                    <div className="iev-grp__s">{g.subtitle}</div>
                  </div>
                  <span className="iev-grp__n">{count}</span>
                </header>

                {g.sections.map(sec => (
                  <div key={sec.key}>
                    {g.sections.length > 1 && <div className="iev-sec__t">{sec.title}</div>}
                    {sec.documents.map((doc, i) => {
                      const key = `${g.key}:${sec.key}:${i}`;
                      const canOpen = !!doc.url || !!doc.action_url;
                      const tone = STATUS_TONE[doc.source === 'awaited' ? 'awaited' : doc.status.toLowerCase()] ?? '#64748b';
                      const statusText = doc.source === 'awaited' ? 'Awaited' : doc.status;
                      const why = doc.source === 'awaited' ? 'This document has not been uploaded yet' : 'No file is stored for this document';
                      return (
                        <div className="iev-doc" key={key}>
                          <span className="iev-doc__ico">{doc.url ? extOf(doc.name) : doc.action_url ? 'PDF' : '—'}</span>
                          <div className="iev-doc__txt">
                            <div className="iev-doc__name" title={doc.name}>{doc.name}</div>
                            <div className="iev-doc__meta">
                              {[doc.meta, doc.amount != null ? money(doc.amount) : null].filter(Boolean).join(' · ')}
                              {' · '}<b style={{ color: tone }}>{statusText}</b>
                            </div>
                          </div>
                          <button type="button" className="iev-btn iev-btn--view"
                            disabled={!doc.url || !!busy}
                            title={doc.url ? `Open ${doc.name}` : doc.action_url ? 'Download it to view this generated document' : why}
                            onClick={() => void open(doc, key, 'view')}>
                            <IcoEye /> {busy === `${key}:view` ? 'Opening…' : 'View'}
                          </button>
                          <button type="button" className="iev-btn iev-btn--dl"
                            disabled={!canOpen || !!busy}
                            title={canOpen ? `Download ${doc.name}` : why}
                            onClick={() => void open(doc, key, 'download')}>
                            <IcoDownload /> {busy === `${key}:download` ? 'Preparing…' : 'Download'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </section>
            );
          })}
        </div>

        <div className="iev-foot">
          <button type="button" className="iev-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

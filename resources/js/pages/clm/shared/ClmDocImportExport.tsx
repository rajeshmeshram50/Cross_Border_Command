import { useEffect, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';

/* Sample-sheet / Import / Export toolbar + result popup, shared by the three
   authority-backed CLM document masters (KYC, DD, Trade Licence).

   The AUTHORITY column carries authority NAMES, not the ids the column
   actually stores: a name is what the grid shows and what a person filling
   the sheet can type. The sample workbook therefore ships a second sheet
   listing every authority in the tenant, so the valid values travel WITH the
   template instead of being something the user has to guess. Several
   authorities go in one cell, comma-separated. */

export type ClmDocRow = {
  id: number;
  code: string;
  name: string;
  authority: string;
  authority_names?: string;
  in_use?: boolean;
};

export type ClmAuthorityOption = { id: number; code: string; name: string };

export type ClmImportResult = {
  imported: { row: number; code: string; name: string; authority: string; validity: string }[];
  failed:   { row: number; name: string; authority: string; validity: string; reason: string }[];
};

type Props = {
  /** API base, e.g. '/clm/kyc-documents' */
  endpoint: string;
  /** File-name stem, e.g. 'KYC_Documents' */
  fileStem: string;
  /** Column header for the master's own name field, e.g. 'KYC Document Name' */
  nameLabel: string;
  /** Column header for the validity field — 'Expiry' (KYC/DD) or 'Validity' (TL) */
  validityLabel: string;
  /** Authority options already loaded by the page (for the sample sheet). */
  authorities: ClmAuthorityOption[];
  /** Two example rows for the sample sheet (authority filled in at runtime). */
  samples: { name: string; validity: string }[];
  /** Active search term, so an export matches what the grid shows. */
  search?: string;
  /** Called after an import that saved at least one row. */
  onImported: () => void;
  /** 'bulk': one "Bulk Data Import/Export" button that opens a guided popup holding
      the sample sheet, the upload and the export (as CredVault's Import &
      Recovery). Omitted: the three toolbar buttons. */
  variant?: 'bulk';
};

export default function ClmDocImportExport(props: Props) {
  const { endpoint, fileStem, nameLabel, validityLabel, authorities, samples, search, onImported, variant } = props;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ClmImportResult | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const authNames = authorities.map(a => a.name).filter(Boolean);

  const downloadSample = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1 — the rows to fill in.
    const first = authNames[0] ?? '';
    const ws = XLSX.utils.json_to_sheet(samples.map((s, i) => ({
      [nameLabel]: s.name,
      'Authority': i === 1 && authNames.length > 1 ? `${authNames[0]}, ${authNames[1]}` : first,
      [validityLabel]: s.validity,
    })));
    ws['!cols'] = [{ wch: 34 }, { wch: 40 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Import');

    /* Sheet 2 — every authority available to this tenant. Import matches on
       NAME, so this is the list of accepted values, not decoration. */
    const wsA = XLSX.utils.json_to_sheet(
      authNames.length
        ? authorities.map(a => ({ 'Authority ID': a.code, 'Authority Name': a.name }))
        : [{ 'Authority ID': '', 'Authority Name': 'No authorities found — add them in Authority Master first' }]
    );
    wsA['!cols'] = [{ wch: 16 }, { wch: 46 }];
    XLSX.utils.book_append_sheet(wb, wsA, 'Authority List');

    XLSX.writeFile(wb, `${fileStem}_Import_Sample.xlsx`);
  };

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // No per_page → the endpoint returns the whole (search-filtered) list.
      const { data } = await api.get<{ data: ClmDocRow[] }>(endpoint, {
        params: search ? { search } : {},
      });
      const list = data.data ?? [];
      if (!list.length) { toast.warning('Nothing to export', 'There are no records to export.'); return; }
      const ws = XLSX.utils.json_to_sheet(list.map((r, i) => ({
        'Sr. No': i + 1,
        'ID': r.code,
        [nameLabel]: r.name,
        // Names, not ids — so an exported file can be re-imported as-is.
        'Authority': r.authority_names || '',
        [validityLabel]: (r as any).expiry ?? (r as any).validity ?? '',
      })));
      ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 34 }, { wch: 40 }, { wch: 16 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Export');
      XLSX.writeFile(wb, `${fileStem}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch { toast.error('Export failed', 'Could not export the list'); }
    finally { setExporting(false); }
  };

  const onFile = async (file: File) => {
    setImporting(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      /* The FIRST sheet is the data sheet. The sample workbook's second sheet
         is the authority reference list — importing that by accident would
         report every one of its rows as a failure. */
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) { toast.error('Invalid file', 'This is not a readable Excel or CSV file.'); return; }
      /* raw:false → the cell's DISPLAYED text. With raw values a date typed
         into Expiry arrives as an Excel serial ("46418.229…") and was saved
         that way. */
      const json: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, dateNF: 'dd-mm-yyyy' });
      const nameKeys = [nameLabel.toLowerCase(), 'name', 'document name', 'licence name', 'license name'];
      const authKeys = ['authority', 'authorities', 'issuing authority', 'issuing authorities'];
      const valKeys  = [validityLabel.toLowerCase(), 'validity', 'expiry'];
      const pick = (o: Record<string, any>, keys: string[]) => {
        const k = Object.keys(o).find(h => keys.includes(h.trim().toLowerCase()));
        return k ? String(o[k] ?? '').trim() : '';
      };
      /* Headers are checked BEFORE rows: wrong headers, a missing header row
         or a non-spreadsheet file all used to surface as "Empty sheet",
         which tells the user nothing about what to fix. */
      const headers = json.length ? Object.keys(json[0]).map(h => h.trim().toLowerCase()) : [];
      if (json.length && (!headers.some(h => nameKeys.includes(h)) || !headers.some(h => authKeys.includes(h)))) {
        toast.error('Columns not recognised', `The first row must be the headers: ${nameLabel}, Authority, ${validityLabel}. Download the sample sheet.`);
        return;
      }
      const rows = json
        .map((o, i) => ({
          /* The real Excel row. sheet_to_json skips blank rows, so i + 2
             drifted after the first blank line and the Failed tab pointed
             at the wrong row. */
          row: ((o as any).__rowNum__ ?? i + 1) + 1,
          name: pick(o, nameKeys),
          authority: pick(o, authKeys),
          validity: pick(o, valKeys),
        }))
        .filter(r => r.name || r.authority || r.validity);
      if (!rows.length) { toast.warning('No data rows', 'No data rows found. Use the sample sheet: headers in row 1, data from row 2.'); return; }
      const { data } = await api.post<ClmImportResult>(`${endpoint}/import`, { rows });
      setResult({ imported: data.imported ?? [], failed: data.failed ?? [] });
      setBulkOpen(false);
      if ((data.imported ?? []).length) onImported();
    } catch (e: any) {
      toast.error('Import failed', e?.response?.data?.message ?? 'Could not read or import the file');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const resultModal = result && (
    <ClmImportResultModal
      result={result}
      nameLabel={nameLabel}
      validityLabel={validityLabel}
      fileStem={fileStem}
      onClose={() => setResult(null)}
    />
  );

  if (variant === 'bulk') {
    return (
      <>
        <style>{CLM_IE_CSS}</style>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
        <button type="button" className="clm-ie-btn cie-bulk-btn" onClick={() => setBulkOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Bulk Data Import/Export
        </button>
        {bulkOpen && (
          <ClmBulkModal
            nameLabel={nameLabel}
            validityLabel={validityLabel}
            importing={importing}
            exporting={exporting}
            onSample={downloadSample}
            onBrowse={() => fileRef.current?.click()}
            onDropFile={f => void onFile(f)}
            onExport={() => void onExport()}
            onClose={() => { if (!importing) setBulkOpen(false); }}
          />
        )}
        {resultModal}
      </>
    );
  }

  return (
    <>
      <style>{CLM_IE_CSS}</style>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
      <button type="button" className="clm-ie-btn" onClick={downloadSample}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        Sample Sheet
      </button>
      <button type="button" className="clm-ie-btn" onClick={() => fileRef.current?.click()} disabled={importing}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        {importing ? 'Importing…' : 'Import'}
      </button>
      <button type="button" className="clm-ie-btn" onClick={() => void onExport()} disabled={exporting}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        {exporting ? 'Exporting…' : 'Export'}
      </button>
      {resultModal}
    </>
  );
}

const IC = {
  up:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  down:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  sheet: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>,
  chev:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>,
  shield:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>,
};

/** "Bulk Data Import/Export" popup (variant="bulk"): three cards -- Download Sample Sheet,
 *  Import Records, Export Records -- each opening its panel underneath.
 *  The work itself is the toolbar's own sample / import / export. */
export function ClmBulkModal(props: {
  nameLabel: string; validityLabel: string;
  /** Columns listed in the Sample / Import panels: [header, required]. Defaults to
      name, Authority, validity (the authority-backed document masters). */
  cols?: [string, boolean][];
  /** The Sample panel's line about the sheet. */
  sampleNote?: string;
  importing: boolean; exporting: boolean;
  onSample: () => void | Promise<void>; onBrowse: () => void; onDropFile: (f: File) => void; onExport: () => void;
  onClose: () => void;
}) {
  const { nameLabel, validityLabel, importing, exporting, onSample, onBrowse, onDropFile, onExport, onClose } = props;
  const sampleNote = props.sampleNote ?? 'Fill in one record per row and keep the first row (the column names) as it is. A second sheet lists the valid authorities.';
  const [over, setOver] = useState(false);
  const [sampling, setSampling] = useState(false);
  const runSample = async () => {
    if (sampling) return;
    setSampling(true);
    const started = Date.now();
    try {
      await new Promise(r => setTimeout(r, 30));
      await onSample();
    } finally {
      setTimeout(() => setSampling(false), Math.max(0, 600 - (Date.now() - started)));
    }
  };
  const busy = { sample: sampling, import: importing, export: exporting };
  const go = (k: keyof typeof busy) => busy[k] ? <span className="cie-btn-spin cie-btn-spin--teal" aria-hidden /> : IC.chev;
  /* Which panel shows under the three cards; none until a card is picked. */
  const [mode, setMode] = useState<'sample' | 'import' | 'export' | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !importing) onDropFile(f);
  };
  const cols: [string, boolean][] = props.cols ?? [[nameLabel, true], ['Authority', true], [validityLabel, false]];

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal cie-modal" role="dialog" aria-modal="true" aria-label="Bulk Data Import/Export">
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico cie-hico">{IC.up}</div>
            <div>
              <div className="clm-modal-head-title">Bulk Data Import/Export</div>
              <div className="clm-modal-head-sub">Bring records in bulk from an Excel or CSV file, or export the list.</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose} disabled={importing} aria-label="Close">×</button>
        </div>

        <div className="clm-modal-body cie-body">
          {/* Three actions as cards; each opens its own panel underneath. */}
          <div className="cie-cards" role="group" aria-label="Bulk data actions">
            <button type="button" className={`cie-card${mode === 'sample' ? ' is-on' : ''}`} aria-pressed={mode === 'sample'} onClick={() => setMode('sample')}>
              <span className="cie-card__ico">{IC.sheet}</span>
              <span className="cie-card__t">
                <b>Download Sample Sheet</b>
                <small>The right columns and two example rows to fill in.</small>
              </span>
              <span className="cie-card__go">{go('sample')}</span>
            </button>
            <button type="button" className={`cie-card${mode === 'import' ? ' is-on' : ''}`} aria-pressed={mode === 'import'} onClick={() => setMode('import')}>
              <span className="cie-card__ico">{IC.up}</span>
              <span className="cie-card__t">
                <b>Import Records</b>
                <small>Upload a filled Excel or CSV file; every row is checked.</small>
              </span>
              <span className="cie-card__go">{go('import')}</span>
            </button>
            <button type="button" className={`cie-card${mode === 'export' ? ' is-on' : ''}`} aria-pressed={mode === 'export'} onClick={() => setMode('export')}>
              <span className="cie-card__ico">{IC.down}</span>
              <span className="cie-card__t">
                <b>Export Records</b>
                <small>Download the current list as Excel, ready to re-import.</small>
              </span>
              <span className="cie-card__go">{go('export')}</span>
            </button>
          </div>

          {mode === 'sample' && (
            <div className="cie-panel cie-export">
              <span className="cie-export__ico">{IC.sheet}</span>
              <div className="cie-export__t">
                <b>Sample sheet</b>
                <small>{sampleNote}</small>
                <div className="cie-cols">{cols.map(([c, req]) => <code key={c} className={req ? 'is-req' : ''}>{c}</code>)}</div>
              </div>
              <button type="button" className="cie-export-btn" onClick={() => void runSample()} disabled={sampling} aria-busy={sampling || undefined}>
                {sampling ? <span className="cie-btn-spin" aria-hidden /> : IC.down}{sampling ? 'Preparing…' : 'Download Sample Sheet'}
              </button>
            </div>
          )}

          {mode === 'import' && (
            <div className="cie-panel">
              <div className="cie-panel__head">
                <b>Columns in the file</b>
                <div className="cie-cols">{cols.map(([c, req]) => <code key={c} className={req ? 'is-req' : ''}>{c}</code>)}</div>
              </div>
              <div
                role="button" tabIndex={0}
                className={`cie-drop${over ? ' is-over' : ''}${importing ? ' is-busy' : ''}`}
                onClick={() => { if (!importing) onBrowse(); }}
                onKeyDown={ev => { if ((ev.key === 'Enter' || ev.key === ' ') && !importing) { ev.preventDefault(); onBrowse(); } }}
                onDragOver={ev => { ev.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                {importing ? (
                  <>
                    <span className="cie-spin" aria-hidden />
                    <b>Importing…</b>
                    <small>Checking every row — this takes a moment.</small>
                  </>
                ) : (
                  <>
                    <span className="cie-drop__ico">{IC.up}</span>
                    <b>Drag &amp; drop your file here</b>
                    <small>or <u>browse your computer</u></small>
                    <div className="cie-fmts"><span>{IC.sheet}Excel <em>.xlsx</em></span><span>{IC.sheet}CSV <em>.csv</em></span></div>
                  </>
                )}
              </div>
            </div>
          )}

          {mode === 'export' && (
            <div className="cie-panel cie-export">
              <span className="cie-export__ico">{IC.down}</span>
              <div className="cie-export__t">
                <b>Export the list</b>
                <small>Downloads the current list (with the search applied) as Excel. It can be re-imported as it is.</small>
              </div>
              <button type="button" className="cie-export-btn" onClick={onExport} disabled={exporting} aria-busy={exporting || undefined}>
                {exporting ? <span className="cie-btn-spin" aria-hidden /> : IC.down}{exporting ? 'Exporting…' : 'Export Records'}
              </button>
            </div>
          )}
        </div>

        <div className="clm-modal-foot cie-foot">
          <span className="cie-foot__info">{IC.shield}Nothing is saved until every row has been checked</span>
          <button type="button" className="clm-btn-cancel" onClick={onClose} disabled={importing}>Close</button>
        </div>
      </div>
    </div>
  ), document.body);
}

export const CLM_IE_CSS = `
/* 40px — a tab's height, not the rail's 48. These are buttons, the same kind
   of control as a tab, so they take the tab's number; 48 belongs to the boxes
   that CONTAIN something, the rail and the search field. They sat at 36. */
.clm-root .clm-ie-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 12px;
  border: 1px solid rgba(8,145,178,.35); border-radius: 8px; background: #fff;
  color: #0e7490; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.clm-root .clm-ie-btn:hover:not(:disabled) { background: #ecfeff; }
.clm-root .clm-ie-btn:disabled { opacity: .6; cursor: progress; }
[data-bs-theme="dark"] .clm-root .clm-ie-btn { background: #0f172a; color: #67e8f9; }
/* Dark hover: a teal wash, not the light #ecfeff - that turned the button
   white under light-cyan text, unreadable (QA #51). */
[data-bs-theme="dark"] .clm-root .clm-ie-btn:hover:not(:disabled):not(.cie-bulk-btn) { background: rgba(34,211,238,.14); border-color: rgba(34,211,238,.55); color: #a5f3fc; }

/* ── Bulk Data Import/Export (variant="bulk") ── */
.clm-root .clm-ie-btn.cie-bulk-btn {
  gap: 7px; padding: 0 18px; border: 0; border-radius: 12px;
  font-size: 12.5px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #0e7490 0%, #0891b2 50%, #06b6d4 100%);
  box-shadow: 0 4px 14px rgba(8,145,178,.4), inset 0 1px 0 rgba(255,255,255,.2);
  transition: transform .14s, box-shadow .14s;
}
.clm-root .clm-ie-btn.cie-bulk-btn:hover { background: linear-gradient(135deg, #0891b2 0%, #0e7490 50%, #155e75 100%); transform: translateY(-1px); }
[data-bs-theme="dark"] .clm-root .clm-ie-btn.cie-bulk-btn { color: #fff; }

.cie-modal { width: min(820px, 96vw); max-width: 820px; }
.cie-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.cie-card {
  display: flex; align-items: center; gap: 10px; min-width: 0; padding: 12px;
  border: 1.5px solid #cdeef5; border-radius: 12px; background: #fff;
  font-family: inherit; text-align: left; cursor: pointer;
  transition: border-color .15s, box-shadow .15s, transform .14s;
}
.cie-card:hover { border-color: #7fcfdf; box-shadow: 0 6px 16px -8px rgba(8,145,178,.45); transform: translateY(-1px); }
.cie-card.is-on { border-color: #0891b2; background: #f0fdff; box-shadow: 0 0 0 3px rgba(34,211,238,.16); }
.cie-card:focus-visible { outline: 2px solid #0891b2; outline-offset: 2px; }
.cie-card__ico {
  flex-shrink: 0; width: 38px; height: 38px; border-radius: 11px;
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
  background: linear-gradient(135deg, #22d3ee, #0891b2 60%, #0e7490);
  box-shadow: 0 6px 14px -6px rgba(8,145,178,.6);
}
.cie-card__ico svg { width: 18px; height: 18px; }
.cie-card__t { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cie-card__t b { font-size: 12.5px; font-weight: 800; color: #0c4a6e; }
.cie-card__t small { font-size: 11px; line-height: 1.35; color: #5b7585; }
.cie-card__go { flex-shrink: 0; display: inline-flex; color: #7fcfdf; }
.cie-card__go svg { width: 14px; height: 14px; }
.cie-card.is-on .cie-card__go { color: #0891b2; transform: rotate(90deg); }
.cie-panel { display: flex; flex-direction: column; gap: 10px; animation: cie-in .18s ease-out; }
@keyframes cie-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.cie-panel__head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.cie-panel__head b { font-size: 11.5px; font-weight: 800; color: #0c4a6e; }
.cie-panel__head .cie-cols { margin-top: 0; }
.cie-panel.cie-export { flex-direction: row; }
.cie-export-btn {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 7px;
  height: 40px; padding: 0 18px; border: 0; border-radius: 12px; cursor: pointer;
  font-family: inherit; font-size: 12.5px; font-weight: 700; color: #fff; white-space: nowrap;
  background: linear-gradient(135deg, #0e7490 0%, #0891b2 50%, #06b6d4 100%);
  box-shadow: 0 4px 14px rgba(8,145,178,.4), inset 0 1px 0 rgba(255,255,255,.2);
}
.cie-export-btn:hover:not(:disabled) { background: linear-gradient(135deg, #0891b2 0%, #0e7490 50%, #155e75 100%); }
.cie-export-btn:disabled { opacity: .6; cursor: progress; }
.cie-export-btn svg { width: 14px; height: 14px; }
@media (max-width: 720px) { .cie-cards { grid-template-columns: 1fr; } }
[data-bs-theme="dark"] .cie-card { background: rgba(255,255,255,.03); border-color: rgba(34,211,238,.18); }
[data-bs-theme="dark"] .cie-card.is-on { background: rgba(34,211,238,.08); border-color: #22d3ee; }
[data-bs-theme="dark"] .cie-card__t b, [data-bs-theme="dark"] .cie-panel__head b { color: #e2e8f0; }
[data-bs-theme="dark"] .cie-card__t small { color: #94a3b8; }
.cie-hico { color: #fff; }
.cie-hico svg { width: 20px; height: 20px; stroke: #fff; }
.cie-body { display: flex; flex-direction: column; gap: 14px; }
.cie-guide { display: flex; align-items: stretch; gap: 8px; }
.cie-g {
  flex: 1 1 0; min-width: 0; display: flex; gap: 10px; padding: 12px;
  border: 1px solid #cdeef5; border-radius: 12px; background: #fff;
}
.cie-g__n {
  flex-shrink: 0; width: 24px; height: 24px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #22d3ee, #0891b2 60%, #0e7490);
}
.cie-g__t { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cie-g__t b { font-size: 12.5px; font-weight: 800; color: #0c4a6e; }
.cie-g__t small { font-size: 11px; line-height: 1.4; color: #5b7585; }
.cie-g__arr { align-self: center; flex-shrink: 0; color: #7fcfdf; display: inline-flex; }
.cie-g__arr svg { width: 14px; height: 14px; }
.cie-cols { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.cie-cols code {
  padding: 2px 7px; border-radius: 6px; font-size: 10.5px; font-weight: 700;
  color: #0e7490; background: #ecfeff; border: 1px solid #cdeef5;
}
.cie-cols code.is-req::after { content: ' *'; color: #ef4444; }
.cie-chip-btn {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; margin-top: 4px;
  height: 32px; padding: 0 12px; border-radius: 9px; cursor: pointer;
  border: 1px solid rgba(8,145,178,.4); background: #fff; color: #0e7490;
  font-family: inherit; font-size: 12px; font-weight: 700; white-space: nowrap;
}
.cie-chip-btn:hover:not(:disabled) { background: #ecfeff; }
.cie-chip-btn:disabled { opacity: .6; cursor: progress; }
.cie-chip-btn svg { width: 13px; height: 13px; }
.cie-drop {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
  min-height: 170px; padding: 20px; border-radius: 14px; cursor: pointer; text-align: center;
  border: 2px dashed #9ddfec; background: linear-gradient(180deg, #f6feff, #ecfbfe);
  transition: border-color .15s, background .15s;
}
.cie-drop:hover, .cie-drop.is-over { border-color: #0891b2; background: #e0f8fc; }
.cie-drop.is-busy { cursor: progress; }
.cie-drop:focus-visible { outline: 2px solid #0891b2; outline-offset: 2px; }
.cie-drop b { font-size: 13.5px; font-weight: 800; color: #0c4a6e; }
.cie-drop small { font-size: 11.5px; color: #5b7585; }
.cie-drop u { color: #0891b2; font-weight: 700; }
.cie-drop__ico {
  width: 48px; height: 48px; border-radius: 14px; margin-bottom: 4px;
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
  background: linear-gradient(135deg, #22d3ee, #0891b2 60%, #0e7490);
  box-shadow: 0 8px 18px -6px rgba(8,145,178,.6);
}
.cie-drop__ico svg { width: 24px; height: 24px; }
.cie-fmts { display: flex; gap: 6px; margin-top: 6px; }
.cie-fmts span {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 700; color: #0e7490; background: #fff; border: 1px solid #cdeef5;
}
.cie-fmts svg { width: 11px; height: 11px; }
.cie-fmts em { font-style: normal; color: #7ba6b8; font-weight: 600; }
.cie-spin {
  width: 30px; height: 30px; border-radius: 50%; margin-bottom: 4px;
  border: 3px solid #cdeef5; border-top-color: #0891b2; animation: cie-rot .8s linear infinite;
}
@keyframes cie-rot { to { transform: rotate(360deg); } }
.cie-btn-spin {
  display: inline-block; flex-shrink: 0; width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.45); border-top-color: #fff; animation: cie-rot .7s linear infinite;
}
.cie-btn-spin--teal { border-color: #cdeef5; border-top-color: #0891b2; }
.cie-export-btn[aria-busy="true"]:disabled { opacity: .9; }
.cie-export {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  border: 1px solid #cdeef5; border-radius: 12px; background: #fff;
}
.cie-export__ico {
  flex-shrink: 0; width: 34px; height: 34px; border-radius: 10px;
  display: inline-flex; align-items: center; justify-content: center; color: #0e7490; background: #ecfeff;
}
.cie-export__ico svg { width: 16px; height: 16px; }
.cie-export__t { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cie-export__t b { font-size: 12.5px; font-weight: 800; color: #0c4a6e; }
.cie-export__t small { font-size: 11px; color: #5b7585; }
.cie-export .cie-chip-btn { margin-top: 0; align-self: center; }
.cie-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cie-foot__info { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: #5b7585; }
.cie-foot__info svg { width: 13px; height: 13px; color: #0891b2; }
@media (max-width: 720px) {
  .cie-guide { flex-direction: column; }
  .cie-g__arr { transform: rotate(90deg); }
  .cie-export { flex-wrap: wrap; }
}
[data-bs-theme="dark"] .cie-g,
[data-bs-theme="dark"] .cie-export { background: rgba(255,255,255,.03); border-color: rgba(34,211,238,.18); }
[data-bs-theme="dark"] .cie-g__t b, [data-bs-theme="dark"] .cie-export__t b, [data-bs-theme="dark"] .cie-drop b { color: #e2e8f0; }
[data-bs-theme="dark"] .cie-g__t small, [data-bs-theme="dark"] .cie-export__t small, [data-bs-theme="dark"] .cie-drop small, [data-bs-theme="dark"] .cie-foot__info { color: #94a3b8; }
[data-bs-theme="dark"] .cie-cols code, [data-bs-theme="dark"] .cie-fmts span { color: #67e8f9; background: rgba(34,211,238,.10); border-color: rgba(34,211,238,.24); }
[data-bs-theme="dark"] .cie-chip-btn { background: #0f172a; color: #67e8f9; border-color: rgba(34,211,238,.35); }
[data-bs-theme="dark"] .cie-chip-btn:hover:not(:disabled) { background: rgba(34,211,238,.10); }
[data-bs-theme="dark"] .cie-drop { background: rgba(34,211,238,.05); border-color: rgba(34,211,238,.35); }
[data-bs-theme="dark"] .cie-drop:hover, [data-bs-theme="dark"] .cie-drop.is-over { background: rgba(34,211,238,.10); border-color: #22d3ee; }
[data-bs-theme="dark"] .cie-export__ico { background: rgba(34,211,238,.10); color: #67e8f9; }
`;

/** Import outcome — Completed and Failed as two tabs, failures downloadable. */
function ClmImportResultModal(props: {
  result: ClmImportResult;
  nameLabel: string;
  validityLabel: string;
  fileStem: string;
  onClose: () => void;
}) {
  const { result, nameLabel, validityLabel, fileStem, onClose } = props;
  const [tab, setTab] = useState<'done' | 'failed'>(
    result.imported.length || !result.failed.length ? 'done' : 'failed'
  );

  const downloadFailed = () => {
    const ws = XLSX.utils.json_to_sheet(result.failed.map(f => ({
      'Row': f.row,
      [nameLabel]: f.name,
      'Authority': f.authority,
      [validityLabel]: f.validity,
      'Reason': f.reason,
    })));
    ws['!cols'] = [{ wch: 6 }, { wch: 32 }, { wch: 34 }, { wch: 14 }, { wch: 52 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Failed');
    XLSX.writeFile(wb, `${fileStem}_Import_Failed.xlsx`);
  };

  const tabStyle = (active: boolean, color: string): React.CSSProperties => ({
    flex: 1, padding: '10px 12px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
    background: 'transparent', color: active ? color : 'var(--vz-secondary-color)',
    borderBottom: `2px solid ${active ? color : 'transparent'}`,
  });
  const cell: React.CSSProperties = {
    padding: '8px 10px', borderBottom: '1px solid rgba(148,163,184,.25)',
    fontSize: 13, textAlign: 'left', verticalAlign: 'top',
  };
  const empty = (msg: string) => (
    <div style={{ padding: 20, textAlign: 'center', color: 'var(--vz-secondary-color)' }}>{msg}</div>
  );

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal" style={{ maxWidth: 860, width: '96vw' }}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div>
              <div className="clm-modal-head-title">Import Result</div>
              <div className="clm-modal-head-sub">
                {result.imported.length} imported successfully, {result.failed.length} failed.
              </div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(148,163,184,.3)' }}>
          <button type="button" style={tabStyle(tab === 'done', '#059669')} onClick={() => setTab('done')}>
            Completed ({result.imported.length})
          </button>
          <button type="button" style={tabStyle(tab === 'failed', '#dc2626')} onClick={() => setTab('failed')}>
            Failed ({result.failed.length})
          </button>
        </div>
        <div className="clm-modal-body" style={{ maxHeight: '55vh', overflow: 'auto' }}>
          {tab === 'done' ? (
            result.imported.length === 0 ? empty('No rows were imported.') : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={cell}>Row</th><th style={cell}>ID</th><th style={cell}>{nameLabel}</th>
                  <th style={cell}>Authority</th><th style={cell}>{validityLabel}</th>
                </tr></thead>
                <tbody>{result.imported.map(r => (
                  <tr key={`d${r.row}`}>
                    <td style={cell}>{r.row}</td>
                    <td style={cell}><span className="clm-code-pill">{r.code}</span></td>
                    <td style={cell}>{r.name}</td>
                    <td style={cell}>{r.authority}</td>
                    <td style={cell}>{r.validity}</td>
                  </tr>
                ))}</tbody>
              </table>
            )
          ) : (
            result.failed.length === 0 ? empty('No failed rows.') : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={cell}>Row</th><th style={cell}>{nameLabel}</th>
                  <th style={cell}>Authority</th><th style={cell}>Reason</th>
                </tr></thead>
                <tbody>{result.failed.map(r => (
                  <tr key={`f${r.row}`}>
                    <td style={cell}>{r.row}</td>
                    <td style={cell}>{r.name || '—'}</td>
                    <td style={cell}>{r.authority || '—'}</td>
                    <td style={{ ...cell, color: '#dc2626' }}>{r.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
            )
          )}
        </div>
        <div className="clm-modal-foot">
          {result.failed.length > 0 && (
            <button className="clm-btn-cancel" onClick={downloadFailed}>Download Failed Rows</button>
          )}
          <button className="clm-btn-save" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  ), document.body);
}

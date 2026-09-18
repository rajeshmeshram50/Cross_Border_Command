import { useRef, useState } from 'react';
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
};

export default function ClmDocImportExport(props: Props) {
  const { endpoint, fileStem, nameLabel, validityLabel, authorities, samples, search, onImported } = props;
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<ClmImportResult | null>(null);

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
      const json: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const pick = (o: Record<string, any>, keys: string[]) => {
        const k = Object.keys(o).find(h => keys.includes(h.trim().toLowerCase()));
        return k ? String(o[k] ?? '').trim() : '';
      };
      const nameKeys = [nameLabel.toLowerCase(), 'name', 'document name', 'licence name', 'license name'];
      const rows = json
        .map((o, i) => ({
          row: i + 2,
          name: pick(o, nameKeys),
          authority: pick(o, ['authority', 'authorities', 'issuing authority']),
          validity: pick(o, [validityLabel.toLowerCase(), 'validity', 'expiry']),
        }))
        .filter(r => r.name || r.authority || r.validity);
      if (!rows.length) { toast.warning('Empty sheet', 'No rows found. Use the sample sheet format.'); return; }
      const { data } = await api.post<ClmImportResult>(`${endpoint}/import`, { rows });
      setResult({ imported: data.imported ?? [], failed: data.failed ?? [] });
      if ((data.imported ?? []).length) onImported();
    } catch (e: any) {
      toast.error('Import failed', e?.response?.data?.message ?? 'Could not read or import the file');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

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
      {result && (
        <ClmImportResultModal
          result={result}
          nameLabel={nameLabel}
          validityLabel={validityLabel}
          fileStem={fileStem}
          onClose={() => setResult(null)}
        />
      )}
    </>
  );
}

const CLM_IE_CSS = `
.clm-root .clm-ie-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px;
  border: 1px solid rgba(8,145,178,.35); border-radius: 8px; background: #fff;
  color: #0e7490; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.clm-root .clm-ie-btn:hover:not(:disabled) { background: #ecfeff; }
.clm-root .clm-ie-btn:disabled { opacity: .6; cursor: progress; }
[data-bs-theme="dark"] .clm-root .clm-ie-btn { background: #0f172a; color: #67e8f9; }
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

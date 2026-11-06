import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, type PageMeta, type TransferRow } from '../cvApi';
import { CvCard, CvPage, CvStrip, CvTabsRow, Svg, errMsg } from '../shared';
import BackupModal, { type BackupInfo } from './BackupModal';
import ImportModal from './ImportModal';
import { HistoryCard, IR_I } from './irShared';
import type { ImportReview } from './irSample';

/* CredVault · Import & Recovery — the prototype's importRecoveryBody: bulk import into My Vault, and backups. */

type Tab = 'import' | 'backup';
interface Hist { rows: TransferRow[]; meta: PageMeta | null; loading: boolean; error: string; page: number }
const EMPTY: Hist = { rows: [], meta: null, loading: true, error: '', page: 1 };

export default function ImportRecovery() {
  const [params] = useSearchParams();
  const navKey = useLocation().key;
  // ?tab= picks the tab on mount and whenever it changes (header quick actions while already here); otherwise the tab lives in state.
  const qTab = params.get('tab');
  const [tab, setTab] = useState<Tab>(() => (qTab === 'backup' ? 'backup' : 'import'));
  // Keyed on the navigation too, so the same quick action re-selects its tab after a manual switch.
  useEffect(() => { if (qTab === 'import' || qTab === 'backup') setTab(qTab); }, [qTab, navKey]);
  const [imp, setImp] = useState<Hist>(EMPTY);
  const [bk, setBk] = useState<Hist>(EMPTY);
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [importing, setImporting] = useState(false);
  const [sampleImports, setSampleImports] = useState<TransferRow[]>([]);
  const [q, setQ] = useState('');
  const [qBk, setQBk] = useState('');
  const [backingUp, setBackingUp] = useState(false);
  const toast = useToast();
  const { user } = useAuth();
  // One request id per list, so a slow older page can't overwrite a newer one.
  const impSeq = useRef(0);
  const bkSeq = useRef(0);
  // Rows per page of each history table (the pager's select); kept in refs so the loaders stay stable.
  const impPer = useRef(10);
  const bkPer = useRef(10);

  const loadImports = useCallback((page: number) => {
    const my = ++impSeq.current;
    setImp(h => ({ ...h, loading: true, page }));
    cvApi.imports(page, impPer.current)
      .then(r => { if (my === impSeq.current) setImp({ rows: r.data, meta: r.meta, loading: false, error: '', page }); })
      .catch(e => { if (my === impSeq.current) setImp(h => ({ ...h, loading: false, error: errMsg(e) })); });
  }, []);
  const loadBackups = useCallback((page: number) => {
    const my = ++bkSeq.current;
    setBk(h => ({ ...h, loading: true, page }));
    cvApi.backups(false, page, bkPer.current)
      .then(r => {
        if (my !== bkSeq.current) return;
        setBk({ rows: r.data, meta: r.meta, loading: false, error: '', page });
        setInfo({ scopes: r.scopes ?? [], columns: r.columns ?? null, lock_note: r.lock_note ?? '' });
      })
      .catch(e => { if (my === bkSeq.current) setBk(h => ({ ...h, loading: false, error: errMsg(e) })); });
  }, []);

  useEffect(() => { loadImports(1); loadBackups(1); }, [loadImports, loadBackups]);

  /* Sample data: a saved review becomes a row of the import history on this screen only (nothing is sent to the API). */
  const saved = (r: ImportReview) => {
    const n = (imp.meta?.total ?? 0) + sampleImports.length + 1;
    const weak = r.accepted.filter(x => x.flags.includes('weak')).length;
    const dups = r.discarded.filter(x => x.reasons.some(y => y.label === 'Duplicate')).length;
    const row: TransferRow = {
      id: -Date.now(), code: `IM-${String(n).padStart(4, '0')}`, kind: 'import', scope: 'mine', scope_label: 'My Vault',
      format: r.format, format_label: r.format === 'csv' ? 'CSV' : 'Excel', file_name: r.fileName, source: `${r.category.label} sheet`,
      items: r.accepted.length, skipped: r.discarded.length, weak, duplicates: dups, size_bytes: null,
      include_passwords: false, locked: false, status: 'done', failure_reason: null,
      by: user?.name ?? 'You', by_id: user?.id ?? 0, by_me: true, by_role: null, at: new Date().toISOString(),
    };
    setSampleImports(s => [row, ...s]);
    setImporting(false);
    setTab('import');
    toast.success(`${r.accepted.length} ${r.category.label} ${r.accepted.length === 1 ? 'credential' : 'credentials'} imported to My Vault`,
      `${r.discarded.length} discarded${weak ? ` · ${weak} with weak passwords` : ''}`);
  };

  /* Search filters the history rows on screen (the loaded page and this session's imports). */
  const term = q.trim().toLowerCase();
  const allImp = [...sampleImports, ...imp.rows];
  const impRows = term
    ? allImp.filter(h => [h.code, h.file_name, h.source, h.format_label, h.by, h.scope_label].some(v => (v ?? '').toLowerCase().includes(term)))
    : allImp;
  const impMeta: PageMeta | null = imp.meta
    ? (term ? { ...imp.meta, total: impRows.length, current_page: 1, last_page: 1 } : { ...imp.meta, total: imp.meta.total + sampleImports.length })
    : null;
  const termBk = qBk.trim().toLowerCase();
  const bkRows = termBk
    ? bk.rows.filter(h => [h.code, h.format_label, h.scope_label, h.by, h.file_name, h.status === 'failed' ? 'failed' : 'downloaded', h.locked ? 'password locked' : 'not locked']
      .some(v => (v ?? '').toLowerCase().includes(termBk)))
    : bk.rows;
  const bkMeta: PageMeta | null = bk.meta && termBk ? { ...bk.meta, total: bkRows.length, current_page: 1, last_page: 1 } : bk.meta;
  const isImport = tab === 'import';

  return (
    <CvPage className="mv-page ir-page tv-page">
      <CvStrip icon={IR_I.db} title="Import & Recovery"
        sub="Bring credentials into My Vault in bulk, and download password-locked backups whenever you need them." />

      <CvCard pane>
        <CvTabsRow active={tab} onTab={k => setTab(k as Tab)} tabs={[
          { key: 'import', label: 'Import Bulk Credentials', icon: IR_I.up, count: imp.meta ? imp.meta.total + sampleImports.length : null },
          { key: 'backup', label: 'Download Credentials Backup', icon: IR_I.down, count: bk.meta?.total ?? null },
        ]}
          search={isImport ? q : qBk} onSearch={isImport ? setQ : setQBk}
          placeholder={isImport ? 'Search by import ID, file, format or who imported...' : 'Search by backup ID, format, scope, status or who downloaded...'}
          after={isImport ? (
            <button type="button" className="cstrip__action-btn ir-import-btn" onClick={() => setImporting(true)}>
              <span className="cstrip__action-btn-sheen" />
              <Svg d={IR_I.up} size={13} />Import data
            </button>
          ) : (
            <button type="button" className="cstrip__action-btn ir-import-btn" onClick={() => setBackingUp(true)}>
              <span className="cstrip__action-btn-sheen" />
              <Svg d={IR_I.down} size={13} />Download backup
            </button>
          )} />
        <div className="ir-body is-fill">
          <div style={{ display: isImport ? 'contents' : 'none' }}>
            <HistoryCard kind="import" rows={impRows} meta={impMeta}
              loading={imp.loading} error={imp.error} onPage={loadImports}
              onPageSize={n => { impPer.current = n; loadImports(1); }} />
          </div>
          <div style={{ display: isImport ? 'none' : 'contents' }}>
            <HistoryCard kind="backup" rows={bkRows} meta={bkMeta} loading={bk.loading} error={bk.error} onPage={loadBackups}
              onPageSize={n => { bkPer.current = n; loadBackups(1); }} />
          </div>
        </div>
      </CvCard>

      {importing && <ImportModal onClose={() => setImporting(false)} onImported={saved} />}
      {backingUp && <BackupModal info={info} infoError={info ? '' : bk.error} infoLoading={bk.loading}
        onRetry={() => loadBackups(1)} onDone={() => loadBackups(1)} onClose={() => setBackingUp(false)} />}
    </CvPage>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, type PageMeta, type TransferRow } from '../cvApi';
import { CvCard, CvPage, CvStrip, CvTabsRow, StripBtn, errMsg } from '../shared';
import BackupTab, { type BackupInfo } from './BackupTab';
import ImportTab from './ImportTab';
import { HistoryCard, IR_I } from './irShared';

/* CredVault · Import & Recovery — the prototype's importRecoveryBody: bulk import into My Vault, and backups. */

type Tab = 'import' | 'backup';
interface Hist { rows: TransferRow[]; meta: PageMeta | null; loading: boolean; error: string; page: number }
const EMPTY: Hist = { rows: [], meta: null, loading: true, error: '', page: 1 };

export default function ImportRecovery() {
  const toast = useToast();
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
  // "Your recent downloads" always reflects the newest page, whatever page the history card shows.
  const [bkLatest, setBkLatest] = useState<TransferRow[]>([]);
  // One request id per list, so a slow older page can't overwrite a newer one.
  const impSeq = useRef(0);
  const bkSeq = useRef(0);

  const loadImports = useCallback((page: number) => {
    const my = ++impSeq.current;
    setImp(h => ({ ...h, loading: true, page }));
    cvApi.imports(page)
      .then(r => { if (my === impSeq.current) setImp({ rows: r.data, meta: r.meta, loading: false, error: '', page }); })
      .catch(e => { if (my === impSeq.current) setImp(h => ({ ...h, loading: false, error: errMsg(e) })); });
  }, []);
  const loadBackups = useCallback((page: number) => {
    const my = ++bkSeq.current;
    setBk(h => ({ ...h, loading: true, page }));
    cvApi.backups(false, page)
      .then(r => {
        if (my !== bkSeq.current) return;
        setBk({ rows: r.data, meta: r.meta, loading: false, error: '', page });
        if (page === 1) setBkLatest(r.data);
        setInfo({ scopes: r.scopes ?? [], columns: r.columns ?? null, lock_note: r.lock_note ?? '' });
      })
      .catch(e => { if (my === bkSeq.current) setBk(h => ({ ...h, loading: false, error: errMsg(e) })); });
  }, []);

  useEffect(() => { loadImports(1); loadBackups(1); }, [loadImports, loadBackups]);

  const sample = async () => {
    try {
      await cvApi.importSample('xlsx');
      toast.success('Sample file downloaded', 'Fill it in and upload it here');
    } catch (e) { toast.error('Could not download the sample', errMsg(e)); }
  };

  return (
    <CvPage className="mv-page ir-page">
      <CvStrip icon={IR_I.db} title="Import & Recovery"
        sub="Bring credentials into My Vault in bulk, and download password-locked backups whenever you need them."
        actions={<StripBtn icon={IR_I.down} ghost onClick={sample}>Sample File</StripBtn>} />

      <CvCard>
        <CvTabsRow active={tab} onTab={k => setTab(k as Tab)} tabs={[
          { key: 'import', label: 'Import Bulk Credentials', icon: IR_I.up, count: imp.meta?.total ?? null },
          { key: 'backup', label: 'Download Credentials Backup', icon: IR_I.down, count: bk.meta?.total ?? null },
        ]} />
        <div className="ir-body">
          {/* Both stay mounted so an open import review survives a tab switch. */}
          <div style={{ display: tab === 'import' ? 'contents' : 'none' }}>
            <ImportTab onImported={() => loadImports(1)} />
            <HistoryCard kind="import" rows={imp.rows} meta={imp.meta} loading={imp.loading} error={imp.error} onPage={loadImports} />
          </div>
          <div style={{ display: tab === 'backup' ? 'contents' : 'none' }}>
            <BackupTab info={info} history={bkLatest} infoError={info ? '' : bk.error} infoLoading={bk.loading}
              onRetry={() => loadBackups(1)} onDone={() => loadBackups(1)} />
            <HistoryCard kind="backup" rows={bk.rows} meta={bk.meta} loading={bk.loading} error={bk.error} onPage={loadBackups} />
          </div>
        </div>
      </CvCard>
    </CvPage>
  );
}

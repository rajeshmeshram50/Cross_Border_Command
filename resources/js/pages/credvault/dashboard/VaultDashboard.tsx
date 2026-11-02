import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CV_ROUTES, type AuditEvent, type Loose } from '../cvApi';
import { CvPage, CvStrip, StripBtn, Svg, errMsg } from '../shared';
import { AnimCtx, VD_I, num, useVdTip } from './vdKit';
import { Activity, Attention, Backup, Depts, Hero, Hygiene, Imports, Kpis, Recent, RiskCard, Types, Where, type Routes } from './widgets';
import './dashboard.css';

/* ─────────────────────────────────────────────────────────────────────────
 * CredVault · Vault Dashboard — the module's landing page (the prototype's
 * vaultDashBody / vdInner). One call, GET /credvault/dashboard, feeds every
 * widget; the activity range (7/14/30) re-asks it.
 * ───────────────────────────────────────────────────────────────────────── */

const R: Routes = {
  myVault: CV_ROUTES.myVault, teamVault: CV_ROUTES.teamVault, critical: CV_ROUTES.critical, requests: CV_ROUTES.requests,
  health: CV_ROUTES.health, audit: CV_ROUTES.audit, importRecovery: CV_ROUTES.importRecovery, bin: CV_ROUTES.bin,
};

const hhmm = (iso?: string | null) => (iso ? new Date(iso) : new Date()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function Shimmer() {
  const b = (h: number, key: number | string) => <div key={key} className="cvd-shim" style={{ height: h }} />;
  return (
    <div className="cvd-root" aria-busy="true" aria-label="Loading dashboard">
      <div className="cvd-row cvd-row--hero">{b(330, 'h')}<div className="cvd-kpis">{[0, 1, 2, 3, 4, 5].map(i => b(160, i))}</div></div>
      <div className="cvd-row cvd-row--3">{[0, 1, 2].map(i => b(360, i))}</div>
      <div className="cvd-row cvd-row--21">{b(470, 'a')}{b(470, 'b')}</div>
      <div className="cvd-row cvd-row--3">{[0, 1, 2].map(i => b(540, i))}</div>
      <div className="cvd-row cvd-row--2">{b(480, 'x')}{b(480, 'y')}</div>
    </div>
  );
}

export default function VaultDashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<Loose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(14);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [animOn, setAnimOn] = useState(false);
  const reqId = useRef(0);
  const { tipRef, onMove, onLeave } = useVdTip();

  /** full = a fresh dashboard (first load / Refresh): remount and replay the grow-in animations. */
  const load = useCallback(async (r: number, full: boolean) => {
    const id = ++reqId.current;
    setBusy(true);
    try {
      const d = await cvApi.dashboard(r);
      if (id !== reqId.current) return false;
      setData(d);
      setError(null);
      if (full) { setAnimOn(false); setVersion(v => v + 1); }
      return true;
    } catch (e) {
      if (id !== reqId.current) return false;
      const msg = errMsg(e, 'Could not load the dashboard.');
      setError(msg);
      return msg;
    } finally {
      if (id === reqId.current) setBusy(false);
    }
  }, []);

  useEffect(() => { void load(14, true); }, [load]);

  // Two frames after a remount, so the browser paints the "from" state before the transition.
  useEffect(() => {
    if (!version) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setAnimOn(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [version]);

  const refresh = async () => {
    const res = await load(range, true);
    if (res === true) toast.success('Dashboard refreshed', 'Showing the latest vault data.');
    else if (typeof res === 'string') toast.error('Refresh failed', res);
  };
  const changeRange = async (n: number) => {
    if (n === range) return;
    const prev = range;
    setRange(n);
    const res = await load(n, false);
    if (typeof res === 'string') { setRange(prev); toast.error('Could not load activity', res); }
  };
  const go = (path: string) => navigate(path);

  const total = num(data?.kpis?.total?.value);

  return (
    <CvPage className="mv-page cvd-page">
      <CvStrip icon={VD_I.dash} title="Vault Dashboard"
        sub="One view of every credential, how safe it is, who is using it and what needs your attention."
        actions={<>
          {data && <span className="cvd-upd"><i />Updated {hhmm(data.updated_at)}</span>}
          <StripBtn ghost icon={VD_I.refresh} onClick={refresh} disabled={busy}>Refresh</StripBtn>
          <StripBtn icon={VD_I.plus} onClick={() => navigate(`${CV_ROUTES.myVault}?action=add`)}>Add Credential</StripBtn>
        </>} />

      {!data && error ? (
        <section className="cvd-card">
          <div className="cvd-card__bd">
            <div className="cvd-empty cvd-err">
              <Svg d={VD_I.alert} size={26} />
              <b>Could not load the dashboard</b>
              <small>{error}</small>
              <button type="button" className="cvd-link" onClick={() => void load(range, true)}>Try again<Svg d={VD_I.chev} size={12} /></button>
            </div>
          </div>
        </section>
      ) : !data ? <Shimmer /> : (
        <AnimCtx.Provider value={animOn}>
          <div className="cvd-root" key={version} onMouseMove={onMove} onMouseLeave={onLeave}>
            <div className="cvd-row cvd-row--hero">
              <Hero score={data.score ?? {}} />
              <Kpis k={data.kpis ?? {}} go={go} R={R} />
            </div>
            <div className="cvd-row cvd-row--3">
              <Types byGroup={data.by_group ?? []} topTypes={data.top_types ?? []} total={total} go={go} R={R} />
              <RiskCard byRisk={data.by_risk ?? {}} total={total} go={go} R={R} />
              <Where w={data.where ?? {}} total={total} go={go} R={R} />
            </div>
            <div className="cvd-row cvd-row--21">
              <Activity a={data.activity ?? {}} range={range} onRange={changeRange} busy={busy} go={go} R={R} />
              <Hygiene hy={data.hygiene ?? {}} go={go} R={R} />
            </div>
            <div className="cvd-row cvd-row--3">
              <Attention rows={data.attention ?? []} summary={data.attention_summary ?? {}} go={go} R={R} />
              <Recent rows={(data.recent ?? []) as AuditEvent[]} go={go} R={R} />
              <Depts rows={data.departments ?? []} total={total} go={go} R={R} />
            </div>
            <div className="cvd-row cvd-row--2">
              <Backup b={data.backups ?? {}} go={go} R={R} />
              <Imports im={data.imports ?? {}} go={go} R={R} />
            </div>
          </div>
        </AnimCtx.Provider>
      )}

      {createPortal(<div className="cvx"><div ref={tipRef} className="cvd-tip" /></div>, document.body)}
    </CvPage>
  );
}

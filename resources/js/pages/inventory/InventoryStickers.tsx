import { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardBody, CardHeader, Button, Alert, Input, Label } from 'reactstrap';
import QRCode from 'qrcode';
import { PageHeader } from '../../components/ui/PageHeader';
import InventoryTabs from './InventoryTabs';
import {
  BOXES, RACKS, SHELVES, makeSticker, TENANT,
  type EntityType,
} from './putAwayStore';
import '../../../css/inventory-scan.css';

interface StickerSpec {
  type: EntityType;
  id: string;
  name: string;
  sub: string;
  payload: string;
}

const GROUPS: { type: EntityType; heading: string; rows: { id: string; name: string; sub: string }[] }[] = [
  { type: 'BOX',   heading: 'Box labels',   rows: BOXES },
  { type: 'RACK',  heading: 'Rack labels',  rows: RACKS },
  { type: 'SHELF', heading: 'Shelf labels', rows: SHELVES.map(s => ({ id: s.id, name: s.name, sub: `${s.sub} · on ${s.rack}` })) },
];

/* One <canvas> per sticker, painted once the payload is known. Canvas beats an
   <img> here: it prints crisply and never fires a network request. */
function StickerQr({ payload, size }: { payload: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    QRCode.toCanvas(el, payload, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => setErr(true));
  }, [payload, size]);

  if (err) return <div className="text-danger fs-12">Could not render code</div>;
  return <canvas ref={ref} width={size} height={size} className="inv-qr" />;
}

export default function InventoryStickers() {
  const [size, setSize] = useState(140);
  const [show, setShow] = useState<Record<EntityType, boolean>>({ BOX: true, RACK: true, SHELF: true });

  const groups = useMemo(
    () => GROUPS
      .filter(g => show[g.type])
      .map(g => ({
        ...g,
        stickers: g.rows.map<StickerSpec>(r => ({
          type: g.type, id: r.id, name: r.name, sub: r.sub,
          payload: makeSticker(g.type, r.id),
        })),
      })),
    [show],
  );

  const total = groups.reduce((n, g) => n + g.stickers.length, 0);

  return (
    <div className="inv-scan">
      <div className="inv-noprint">
        <PageHeader
          title="Sticker Sheet"
          subtitle="Signed labels for every box, rack and shelf. Print them, or scan them straight off this screen."
          icon={<i className="ri-price-tag-3-line" />}
          actions={
            <Button color="primary" size="sm" onClick={() => window.print()}>
              <i className="ri-printer-line me-1" />Print sheet
            </Button>
          }
        />
        <InventoryTabs />

        <Alert color="info" className="d-flex gap-2">
          <i className="ri-information-line mt-1" />
          <div>
            <strong>How to test with a real TC27.</strong> Open the Put-Away screen on the
            handheld, then scan these codes from a monitor or a printout. Each code carries
            only <code>CBC1|{TENANT}|TYPE|ID|nonce|signature</code> — no product name, no
            price. The handheld gets the real data back from the server only if its
            credential is accepted.
          </div>
        </Alert>

        <Card className="mb-3">
          <CardHeader><h5 className="card-title mb-0 fs-14">Sheet options</h5></CardHeader>
          <CardBody className="d-flex flex-wrap align-items-end gap-4">
            <div>
              <Label className="inv-prompt-eyebrow d-block mb-2">Include</Label>
              <div className="d-flex gap-3">
                {(['BOX', 'RACK', 'SHELF'] as EntityType[]).map(t => (
                  <div className="form-check" key={t}>
                    <Input
                      type="checkbox"
                      id={`inc-${t}`}
                      checked={show[t]}
                      onChange={e => setShow({ ...show, [t]: e.target.checked })}
                    />
                    <Label check for={`inc-${t}`} className="ms-1">
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ minWidth: 220 }}>
              <Label className="inv-prompt-eyebrow d-block mb-2">Code size — {size}px</Label>
              <Input
                type="range" min={90} max={240} step={10}
                value={size}
                onChange={e => setSize(Number(e.target.value))}
              />
              <small className="text-muted">
                Bigger codes scan from further away. 140px works at arm&apos;s length on a monitor.
              </small>
            </div>
            <div className="ms-auto text-muted fs-12">{total} stickers</div>
          </CardBody>
        </Card>
      </div>

      {/* ------------------------------------------------------- the sheet */}
      <div className="inv-sheet">
        {groups.map(g => (
          <section key={g.type} className="inv-sheet-group">
            <h6 className="inv-sheet-heading">{g.heading}</h6>
            <div className="inv-sheet-grid">
              {g.stickers.map(s => (
                <article key={s.id} className="inv-label">
                  <div className="inv-label-head">
                    <span className="inv-label-type">{s.type}</span>
                    <span className="inv-label-id">{s.id}</span>
                  </div>
                  <StickerQr payload={s.payload} size={size} />
                  <div className="inv-label-name">{s.name}</div>
                  <div className="inv-label-sub">{s.sub}</div>
                  <div className="inv-label-payload">{s.payload}</div>
                </article>
              ))}
            </div>
          </section>
        ))}
        {total === 0 && (
          <p className="text-muted text-center py-5">
            Nothing selected — tick at least one label type above.
          </p>
        )}
      </div>
    </div>
  );
}

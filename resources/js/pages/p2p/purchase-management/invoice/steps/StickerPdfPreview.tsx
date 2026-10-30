import { useEffect, useState, type ReactNode } from 'react';
import { spiApi } from '../spi-api';

export default function StickerPdfPreview({ spiId, boxId, fallback }: {
  spiId: number | null;
  boxId: number | null;
  fallback: ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!spiId || !boxId) return;
    let live = true;
    let made: string | null = null;
    setLoading(true);
    setFailed(false);
    setUrl(null);
    spiApi.stickerPdf(spiId, boxId)
      .then(blob => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [spiId, boxId]);

  if (!spiId || !boxId || failed) return <>{fallback}</>;
  if (loading || !url) {
    return (
      <div className="stk-pv stk-pv--load" role="status">
        <span className="spi-btn-spin" aria-hidden />Loading sticker…
      </div>
    );
  }
  return <iframe className="stk-pv" src={`${url}#toolbar=0&navpanes=0&view=FitH`} title="Sticker preview" />;
}

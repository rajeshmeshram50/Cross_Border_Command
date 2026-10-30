import { useEffect, useState } from 'react';
import api from '../../api';

export type LabelKind = 'warehouses' | 'zones' | 'racks' | 'shelves';

export function useLabelPdf(kind: LabelKind, id: number | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) { setFailed(true); return; }
    let live = true;
    let made: string | null = null;
    setLoading(true);
    setFailed(false);
    api.get(`/inventory/${kind}/${id}/label`, { responseType: 'blob' })
      .then(res => {
        if (!live) return;
        const b = new Blob([res.data as BlobPart], { type: 'application/pdf' });
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [kind, id]);

  const save = (fileName: string) => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  };

  return { url, blob, loading, failed, ready: !!url && !failed, save };
}

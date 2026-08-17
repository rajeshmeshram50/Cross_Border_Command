import api from '../api';

/**
 * Force-download a file, reliably, regardless of where it's hosted.
 *
 * Two problems this solves:
 *  1. An `<a download>` link is ignored by the browser for CROSS-ORIGIN URLs
 *     (and for files served `Content-Disposition: inline`) — so the file just
 *     OPENS instead of saving.
 *  2. On the deployed server, attachments live on Azure Blob
 *     (idimsbucket.blob.core.windows.net) — a different origin with no CORS, so
 *     even a client-side `fetch` is blocked. Locally everything is the same
 *     http://127.0.0.1 origin, which is why downloads "work locally but not on
 *     the server".
 *
 * Strategy:
 *  - Our own uploads (paths under `segment_doc_uploads/…`) are pulled THROUGH
 *    the backend (`/segment-uploads/download`), which streams the file
 *    same-origin with a download disposition — works whether storage is local
 *    or Azure.
 *  - Anything else is normalised to the current origin and blob-fetched, with a
 *    plain `window.open` as the last-resort fallback.
 */
export async function downloadFile(rawUrl: string | null | undefined, filename = ''): Promise<void> {
  if (!rawUrl) return;
  const name = filename || nameFromUrl(rawUrl);

  // Our segment uploads (Azure on prod) → stream through the backend.
  if (/segment_doc_uploads\//i.test(rawUrl)) {
    try {
      const res = await api.get('/segment-uploads/download', {
        params: { url: rawUrl },
        responseType: 'blob',
      });
      saveBlob(res.data as Blob, name);
      return;
    } catch {
      // fall through to the direct attempt below
    }
  }

  // Otherwise: normalise to the current origin and blob-fetch directly.
  const url = toSameOrigin(rawUrl);
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    saveBlob(await res.blob(), name);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** Magic bytes every reader uses to recognise the format. */
const MAGIC: Record<string, { bytes: string; label: string }> = {
  pdf:  { bytes: '%PDF',           label: 'PDF' },
  docx: { bytes: 'PK\x03\x04',     label: 'Word document' },   // DOCX is a zip
};

/**
 * Save a blob from an API endpoint that is supposed to return a binary file.
 *
 * With `responseType: 'blob'` axios hands back whatever the server sent — an
 * HTML page or a JSON error body included — and if that came with HTTP 200
 * nothing throws. The browser then writes that HTML under a `.pdf` name and
 * the reader says "Failed to load PDF document", which points suspicion at
 * the generator when the real cause is upstream: a route that never matched
 * (stale route cache), a session redirect, a proxy error page.
 *
 * Checking the first bytes turns that silent corruption into a real error.
 */
export async function saveApiBlob(
  blob: Blob,
  filename: string,
  expect: keyof typeof MAGIC,
): Promise<void> {
  const sig = MAGIC[expect];
  const head = await blob.slice(0, 8).text();
  if (!head.startsWith(sig.bytes)) {
    throw new Error(
      `The server did not return a ${sig.label}. ` +
      (head.trimStart().startsWith('<')
        ? 'It returned a web page — the download endpoint was not reached.'
        : 'The response was not a file.'),
    );
  }
  saveBlob(blob, filename);
}

/** Trigger a browser save for an in-memory Blob via a same-origin blob: URL. */
function saveBlob(blob: Blob, name: string): void {
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
}

function nameFromUrl(u: string): string {
  return decodeURIComponent(String(u).split('/').pop()?.split('?')[0] || '') || 'document';
}

/**
 * Normalise a stored file URL to the CURRENT page origin (same scheme + host),
 * keeping any `/storage/…` or `/uploads/…` path. Fixes server cases where the
 * stored URL carries a stale/HTTP host (mixed-content blocks the fetch) even
 * though the file lives at this origin. Genuinely external URLs are left as-is.
 */
function toSameOrigin(rawUrl: string): string {
  const raw = String(rawUrl).trim();
  const m = raw.match(/\/((?:storage|uploads)\/.+)$/i);
  if (m) return window.location.origin + '/' + m[1];
  if (/^https?:\/\//i.test(raw)) return raw;
  return window.location.origin + (raw.startsWith('/') ? '' : '/') + raw;
}

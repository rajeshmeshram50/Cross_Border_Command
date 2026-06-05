/**
 * Force-download a file, reliably, regardless of where it's hosted.
 *
 * An `<a download>` link is ignored by the browser for CROSS-ORIGIN URLs (and
 * for files the server marks `Content-Disposition: inline`) — so the file just
 * OPENS in a new tab instead of downloading. This bites on the deployed server
 * where attachments come from a storage URL the browser treats as cross-origin.
 *
 * Fetching the file into a Blob and downloading via a `blob:` object URL always
 * works, because the blob URL is same-origin. Falls back to opening the URL if
 * the fetch is blocked (e.g. a truly cross-origin host with no CORS).
 */

/**
 * Normalise a stored file URL to the CURRENT page origin (same scheme + host).
 *
 * On the deployed server the stored `attachment_url` often carries a stale or
 * HTTP host (e.g. APP_URL = http://… while the site is served over HTTPS). The
 * browser then blocks the fetch as mixed-content / cross-origin, so the file
 * "won't download" — even though it actually lives at this very origin. Locally
 * everything is the same http://127.0.0.1 origin, which is why it works there.
 *
 * If the URL points at a Laravel `/storage/…` (or `/uploads/…`) path we keep
 * that path and swap the origin for `window.location.origin`. A genuinely
 * external URL (Azure / CDN with a different host that ISN'T /storage) is left
 * as-is so we don't break legitimately remote files.
 */
function toSameOrigin(rawUrl: string): string {
  const raw = String(rawUrl).trim();
  // Pull out a /storage/... or /uploads/... segment wherever it appears.
  const m = raw.match(/\/((?:storage|uploads)\/.+)$/i);
  if (m) return window.location.origin + '/' + m[1];
  // Already absolute, no storage path → leave the host alone.
  if (/^https?:\/\//i.test(raw)) return raw;
  // Relative path → resolve against the current origin.
  return window.location.origin + (raw.startsWith('/') ? '' : '/') + raw;
}
export async function downloadFile(rawUrl: string | null | undefined, filename = ''): Promise<void> {
  if (!rawUrl) return;
  const url = toSameOrigin(rawUrl);
  const name = filename || decodeURIComponent(url.split('/').pop()?.split('?')[0] || '') || 'document';
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
  } catch {
    // Last resort — open it (lets the browser handle it). Better than nothing.
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

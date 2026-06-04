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
export async function downloadFile(rawUrl: string | null | undefined, filename = ''): Promise<void> {
  if (!rawUrl) return;
  const url = /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : window.location.origin + (rawUrl.startsWith('/') ? '' : '/') + rawUrl;
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

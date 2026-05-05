// src/utils/resolveFileUrl.ts

export const resolveFileUrl = (path?: string | null) => {
    if (!path) return "";

    const raw = String(path).trim();

    // If already a full URL (Azure / CDN / external)
    if (/^https?:\/\//i.test(raw)) {
        // FIX: remove wrong /api/storage if it slipped in
        if (raw.includes("/api/storage/")) {
            return raw.replace("/api/storage/", "/storage/");
        }
        return raw;
    }

    // Normalize slashes
    const p = raw.replace(/^\/+/, "").replace(/\\/g, "/");

    const API = import.meta.env.VITE_API_URL || window.location.origin;
    const base = String(API).replace(/\/api\/?$/, "");

    // Case 1: Laravel storage path
    if (p.startsWith("storage/")) {
        return `${base}/${p}`;
    }

    // Case 2: uploads path
    if (p.startsWith("uploads/")) {
        return `${base}/${p}`;
    }

    // Fallback: assume it's a disk-relative path under /storage/
    return `${base}/storage/${p}`;
};

/**
 * Download a file from a URL
 * @param url - The file URL to download
 * @param fileName - Optional custom file name (defaults to filename from URL)
 */
export const downloadFile = async (url: string, fileName?: string) => {
    if (!url) {
        console.error('No URL provided for download');
        return false;
    }

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const blob = await response.blob();

        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;

        const finalFileName = fileName || url.split('/').pop() || 'download';
        link.download = finalFileName;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        window.URL.revokeObjectURL(blobUrl);

        return true;
    } catch (error) {
        console.error('Download failed:', error);
        // Fallback: open in new tab
        window.open(url, '_blank');
        return false;
    }
};

/**
 * Open a file URL in a new tab
 * @param url - The file URL to open
 */
export const viewFile = (url: string) => {
    if (!url) return;
    window.open(url, '_blank');
};

/**
 * Check if a URL is accessible
 * @param url - The URL to check
 */
export const checkFileAccess = async (url: string): Promise<boolean> => {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
    } catch {
        return false;
    }
};

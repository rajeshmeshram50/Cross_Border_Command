import api from '../../../../api';

/** What the file is for: a product clarity document, or a New Supplier's business card. */
type UploadKind = 'clarity' | 'card';

/**
 * POST /p2p/upload — store one file and get back its stored path (sent with the target or the
 * mapping). The server allows PDF, JPG, PNG and WEBP up to 5 MB and files it per company and kind.
 */
export async function uploadP2pFile(file: File, kind: UploadKind): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', kind);
  // An undefined Content-Type lets the browser set multipart/form-data with its boundary
  // (the api client defaults to JSON; a bare 'multipart/form-data' would drop the boundary).
  const res = await api.post<{ data: { path: string } }>('/p2p/upload', fd, { headers: { 'Content-Type': undefined as unknown as string } });
  return res.data?.data?.path ?? '';
}

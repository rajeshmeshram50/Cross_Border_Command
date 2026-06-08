<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\EmployeeDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;


class EmployeeDocumentController extends Controller
{
    /** Per-document upload size cap (MB). Catalogue can override later. */
    private const MAX_MB = 2;
    // Canonical MIME list. Variants below cover platform quirks:
    //   - image/x-png: legacy / IE-era PNG MIME some Windows servers
    //     still emit via mime_content_type().
    //   - image/pjpeg: progressive JPEG variant emitted by some old
    //     PHP/Symfony combinations.
    // We also fall back to the file extension when the MIME doesn't
    // match, so prod servers with a stale magic.mime database still
    // accept valid uploads.
    private const MIME_ALLOWED = [
        'application/pdf',
        'image/jpeg', 'image/jpg', 'image/pjpeg',
        'image/png',  'image/x-png',
        'image/webp',
    ];
    private const EXT_ALLOWED = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];

    public function index(Request $request, Employee $employee)
    {
        $this->authorizeEmployeeAccess($request, $employee);

        $rows = EmployeeDocument::where('employee_id', $employee->id)
            ->with('uploader:id,name', 'verifier:id,name')
            ->orderBy('document_key')
            ->get()
            ->map(fn ($d) => $this->formatRow($d));

        return response()->json($rows);
    }

    public function store(Request $request, Employee $employee)
    {
        $this->authorizeEmployeeAccess($request, $employee);

        $data = $request->validate([
            'document_key' => 'required|string|max:60',
            'file'         => 'required|file|max:' . (self::MAX_MB * 1024),
        ]);

        $file = $request->file('file');
        // Two-signal check (mirrors the frontend validator). Some prod
        // servers return non-canonical MIMEs from getMimeType() (e.g.
        // image/x-png), and some browsers/proxies strip the MIME header
        // entirely. As long as EITHER the MIME or the file extension
        // is in the allowed list, accept the upload. The list of
        // accepted extensions is the canonical one — frontend has
        // already enforced the picker filter, so anything reaching here
        // with a .pdf/.jpg/.png/.webp extension is safe to trust.
        $mime = strtolower((string) ($file->getMimeType() ?: $file->getClientMimeType() ?: ''));
        $ext  = strtolower((string) $file->getClientOriginalExtension());
        $mimeOk = $mime !== '' && in_array($mime, self::MIME_ALLOWED, true);
        $extOk  = $ext  !== '' && in_array($ext,  self::EXT_ALLOWED,  true);
        if (!$mimeOk && !$extOk) {
            return response()->json([
                // Surface what we actually saw so the user can fix it
                // (e.g. "got 'image/heic'") instead of staring at a
                // generic rejection.
                'message' => sprintf(
                    'Only PDF / JPG / PNG / WEBP files are allowed. (got "%s")',
                    $mime ?: ($ext ?: 'unknown'),
                ),
            ], 422);
        }

        $key = trim($data['document_key']);
        // withTrashed() — the unique constraint (employee_id, document_key)
        // is NOT scoped to deleted_at IS NULL, so a row that was soft-
        // deleted earlier will still trip the constraint on INSERT. We
        // pull the trashed row too, restore it if needed, and overwrite
        // its file/metadata below. Without this, a delete-and-reupload
        // cycle crashed with 23505 ("duplicate key value").
        $existing = EmployeeDocument::withTrashed()
            ->where('employee_id', $employee->id)
            ->where('document_key', $key)
            ->first();

        // If we're replacing, drop the previous file from disk so we
        // don't leak storage. Eloquent + soft-deletes don't auto-prune
        // the file — we manage it explicitly.
        if ($existing && $existing->file_path) {
            try { Storage::disk('public')->delete($existing->file_path); } catch (\Throwable $e) { /* best-effort */ }
        }
        // If we found a soft-deleted row, bring it back so the existing
        // primary key can be re-used by the fill() below.
        if ($existing && method_exists($existing, 'trashed') && $existing->trashed()) {
            $existing->restore();
        }

        $stored = $file->storeAs(
            "employee-documents/{$employee->id}",
            $key . '-' . time() . '.' . ($file->getClientOriginalExtension() ?: 'bin'),
            'public',
        );

        $row = $existing ?: new EmployeeDocument(['employee_id' => $employee->id, 'document_key' => $key]);
        $row->fill([
            'employee_id'     => $employee->id,
            'client_id'       => $employee->client_id,
            'branch_id'       => $employee->branch_id,
            'document_key'    => $key,
            'file_path'       => $stored,
            'original_name'   => $file->getClientOriginalName(),
            'mime_type'       => $mime,
            'size_bytes'      => $file->getSize(),
            'status'          => 'uploaded',
            'rejection_reason' => null,
            'uploaded_by'     => $request->user()?->id,
            'uploaded_at'     => now(),
            // Re-upload after a rejection clears the previous verify info
            // so HR is forced to re-review.
            'verified_by'     => null,
            'verified_at'     => null,
        ]);
        $row->save();
        $row->load('uploader:id,name', 'verifier:id,name');

        return response()->json([
            'message'  => 'Uploaded.',
            'document' => $this->formatRow($row),
        ], 201);
    }

    public function verify(Request $request, EmployeeDocument $document)
    {
        $this->authorizeDocumentAccess($request, $document);
        $document->update([
            'status'          => 'verified',
            'rejection_reason' => null,
            'verified_by'     => $request->user()?->id,
            'verified_at'     => now(),
        ]);
        $document->load('uploader:id,name', 'verifier:id,name');
        return response()->json(['message' => 'Verified.', 'document' => $this->formatRow($document)]);
    }

    public function reject(Request $request, EmployeeDocument $document)
    {
        $this->authorizeDocumentAccess($request, $document);
        $data = $request->validate([
            'rejection_reason' => 'required|string|max:500',
        ]);
        $document->update([
            'status'          => 'rejected',
            'rejection_reason' => $data['rejection_reason'],
            'verified_by'     => $request->user()?->id,
            'verified_at'     => now(),
        ]);
        $document->load('uploader:id,name', 'verifier:id,name');
        return response()->json(['message' => 'Rejected.', 'document' => $this->formatRow($document)]);
    }

    public function destroy(Request $request, EmployeeDocument $document)
    {
        $this->authorizeDocumentAccess($request, $document);
        if ($document->file_path) {
            try { Storage::disk('public')->delete($document->file_path); } catch (\Throwable $e) { /* best-effort */ }
        }
        $document->delete();
        return response()->json(['message' => 'Removed.']);
    }

    /**
     * Stream the document through the app (same-origin) with an attachment
     * disposition so it DOWNLOADS instead of opening a preview. A plain file
     * URL points straight at Azure Blob on prod (cross-origin, no CORS, served
     * inline) — which only ever opens in a new tab. Routing the bytes through
     * here mirrors how the customer Evidence Vault downloads its segment
     * uploads via /segment-uploads/download.
     */
    public function download(Request $request, EmployeeDocument $document)
    {
        $this->authorizeDocumentAccess($request, $document);
        if (! $document->file_path || ! Storage::disk('public')->exists($document->file_path)) {
            abort(404, 'File is missing on storage.');
        }
        $name = $document->original_name ?: basename($document->file_path);
        return Storage::disk('public')->download($document->file_path, $name);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  Helpers
     * ───────────────────────────────────────────────────────────────── */

    /** Allow access if the user can view employees in the row's tenant. */
    private function authorizeEmployeeAccess(Request $request, Employee $employee): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        if ($user->isSuperAdmin()) return;
        // Super admins always pass; everyone else must be in the same tenant.
        if ($employee->client_id && $user->client_id !== $employee->client_id) {
            abort(403, 'Document belongs to a different organization.');
        }
    }

    private function authorizeDocumentAccess(Request $request, EmployeeDocument $doc): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        if ($user->isSuperAdmin()) return;
        if ($doc->client_id && $user->client_id !== $doc->client_id) {
            abort(403, 'Document belongs to a different organization.');
        }
    }

    /** Wire-format a row for the SPA. Public URL is built off the public disk. */
    private function formatRow(EmployeeDocument $d): array
    {
        return [
            'id'              => $d->id,
            'employee_id'     => $d->employee_id,
            'document_key'    => $d->document_key,
            'status'          => $d->status,
            'original_name'   => $d->original_name,
            'mime_type'       => $d->mime_type,
            'size_bytes'      => $d->size_bytes,
            'rejection_reason' => $d->rejection_reason,
            'uploaded_at'     => $d->uploaded_at?->toIso8601String(),
            'verified_at'     => $d->verified_at?->toIso8601String(),
            'uploader'        => $d->uploader ? ['id' => $d->uploader->id, 'name' => $d->uploader->name] : null,
            'verifier'        => $d->verifier ? ['id' => $d->verifier->id, 'name' => $d->verifier->name] : null,
            'url'             => file_url($d->file_path),
        ];
    }
}

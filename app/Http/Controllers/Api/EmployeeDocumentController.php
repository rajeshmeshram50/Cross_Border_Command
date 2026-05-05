<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\EmployeeDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Stage 2 — Document Management endpoints.
 *
 *   GET    /api/employees/{employee}/documents          list all rows for the employee
 *   POST   /api/employees/{employee}/documents          upload (multipart)
 *   PATCH  /api/documents/{document}/verify             admin marks verified
 *   PATCH  /api/documents/{document}/reject             admin marks rejected with a reason
 *   DELETE /api/documents/{document}                    remove the upload
 *
 * Tenant scope mirrors EmployeeController — the employee's own
 * (client_id, branch_id) tuple gates everything. Files land on the
 * `public` disk under `employee-documents/{employee_id}/...`.
 */
class EmployeeDocumentController extends Controller
{
    /** Per-document upload size cap (MB). Catalogue can override later. */
    private const MAX_MB = 8;
    private const MIME_ALLOWED = [
        'application/pdf',
        'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
    ];

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
        $mime = $file->getMimeType() ?: $file->getClientMimeType();
        if (!in_array($mime, self::MIME_ALLOWED, true)) {
            return response()->json([
                'message' => 'Only PDF / JPG / PNG / WEBP files are allowed.',
            ], 422);
        }

        $key = trim($data['document_key']);
        $existing = EmployeeDocument::where('employee_id', $employee->id)
            ->where('document_key', $key)
            ->first();

        // If we're replacing, drop the previous file from disk so we
        // don't leak storage. Eloquent + soft-deletes don't auto-prune
        // the file — we manage it explicitly.
        if ($existing && $existing->file_path) {
            try { Storage::disk('public')->delete($existing->file_path); } catch (\Throwable $e) { /* best-effort */ }
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

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\EmployeeDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class EmployeeDocumentController extends Controller
{
    private const MAX_MB = 2;
    private const MIME_ALLOWED = [
        'application/pdf',
        'image/jpeg', 'image/jpg', 'image/pjpeg',
        'image/png',  'image/x-png',
        'image/webp',
    ];
    private const EXT_ALLOWED = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];

    public function index(Request $request, $employeeId)
    {
        $employee = Employee::withTrashed()->find($employeeId);
        if (!$employee) {
            return response()->json([]);
        }

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
        if ($employee->isDisabled()) {
            abort(422, 'This employee is disabled — restore/re-activate them before adding documents.');
        }

        $data = $request->validate([
            'document_key' => 'required|string|max:60',
            'file'         => 'required|file|max:' . (self::MAX_MB * 1024) . '|mimes:pdf,jpg,jpeg,png,webp',
        ]);

        $file = $request->file('file');
        $mime = strtolower((string) ($file->getMimeType() ?: $file->getClientMimeType() ?: ''));
        $ext  = strtolower((string) $file->getClientOriginalExtension());
        $mimeOk = $mime !== '' && in_array($mime, self::MIME_ALLOWED, true);
        $extOk  = $ext  !== '' && in_array($ext,  self::EXT_ALLOWED,  true);
        if (!$mimeOk && !$extOk) {
            return response()->json([
                'message' => sprintf(
                    'Only PDF / JPG / PNG / WEBP files are allowed. (got "%s")',
                    $mime ?: ($ext ?: 'unknown'),
                ),
            ], 422);
        }

        $key = trim($data['document_key']);
        $existing = EmployeeDocument::withTrashed()
            ->where('employee_id', $employee->id)
            ->where('document_key', $key)
            ->first();

        if ($existing && $existing->file_path) {
            try { Storage::disk('public')->delete($existing->file_path); } catch (\Throwable $e) { }
        }
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
            try { Storage::disk('public')->delete($document->file_path); } catch (\Throwable $e) { }
        }
        $document->delete();
        return response()->json(['message' => 'Removed.']);
    }

    public function download(Request $request, EmployeeDocument $document)
    {
        $this->authorizeDocumentAccess($request, $document);
        if (! $document->file_path || ! Storage::disk('public')->exists($document->file_path)) {
            abort(404, 'File is missing on storage.');
        }
        $name = $document->original_name ?: basename($document->file_path);
        return Storage::disk('public')->download($document->file_path, $name);
    }

    private function authorizeEmployeeAccess(Request $request, Employee $employee): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        if ($user->isSuperAdmin()) return;
        if ((int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'Document belongs to a different organization.');
        }
    }

    private function authorizeDocumentAccess(Request $request, EmployeeDocument $doc): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        if ($user->isSuperAdmin()) return;
        if ((int) $doc->client_id !== (int) $user->client_id) {
            abort(403, 'Document belongs to a different organization.');
        }
    }

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

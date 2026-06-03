<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Consignee;
use App\Models\ConsigneeDocument;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;


class ConsigneeDocumentController extends Controller
{
    public function index(Request $request, $consigneeId): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId);

        $q = $consignee->documents();
        if ($kind = $request->query('kind')) {
            $q->where('kind', $kind);
        }
        if ($search = trim((string) $request->query('q', ''))) {
            $q->where(function ($w) use ($search) {
                $w->where('name',              'ilike', "%{$search}%")
                  ->orWhere('license_number',  'ilike', "%{$search}%")
                  ->orWhere('issuing_authority','ilike', "%{$search}%");
            });
        }

        $rows = $q->get()->map(fn ($d) => $this->shape($d))->all();
        return response()->json(['data' => $rows, 'count' => count($rows)]);
    }

    public function show(Request $request, $consigneeId, $id): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId);
        $doc = $consignee->documents()->findOrFail($id);
        return response()->json(['data' => $this->shape($doc)]);
    }

    public function store(Request $request, $consigneeId): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId, 'edit');
        $data = $this->validatePayload($request);

        $data['consignee_id'] = $consignee->id;
        $data['created_by']   = optional($request->user())->id;
        if ($request->hasFile('attachment')) {
            $data['attachment_path'] = $this->storeUpload($request->file('attachment'), $consignee->id, 'doc');
        }

        $doc = ConsigneeDocument::create($data);
        return response()->json(['data' => $this->shape($doc)], 201);
    }

    public function update(Request $request, $consigneeId, $id): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId, 'edit');
        $doc = $consignee->documents()->findOrFail($id);
        $data = $this->validatePayload($request, $doc->id);

        if ($request->hasFile('attachment')) {
            // Drop previous file (best-effort) before replacing.
            if ($doc->attachment_path) {
                Storage::disk('public')->delete($doc->attachment_path);
            }
            $data['attachment_path'] = $this->storeUpload($request->file('attachment'), $consignee->id, 'doc');
        } elseif ($request->boolean('remove_attachment')) {
            if ($doc->attachment_path) {
                Storage::disk('public')->delete($doc->attachment_path);
            }
            $data['attachment_path'] = null;
        }

        $doc->update($data);
        return response()->json(['data' => $this->shape($doc->fresh())]);
    }

    public function destroy(Request $request, $consigneeId, $id): JsonResponse
    {
        $consignee = $this->resolveConsignee($request, $consigneeId, 'delete');
        $doc = $consignee->documents()->findOrFail($id);
        if ($doc->attachment_path) {
            Storage::disk('public')->delete($doc->attachment_path);
        }
        $doc->delete();
        return response()->json(['id' => $doc->id, 'deleted' => true]);
    }

    /* ── Helpers ──────────────────────────────────────────────────── */

    private function shape(ConsigneeDocument $d): array
    {
        return [
            'id'                => $d->id,
            'kind'              => $d->kind,
            'name'              => $d->name,
            'license_number'    => $d->license_number,
            'issuing_authority' => $d->issuing_authority,
            'issue_date'        => optional($d->issue_date)->toDateString(),
            'expiry_date'       => optional($d->expiry_date)->toDateString(),
            'attachment_path'   => $d->attachment_path,
            // Uses the project-wide file_url() helper (app/helpers.php),
            // the same one HR Employees + Onboarding use for their docs.
            // It strips legacy storage/ + public/ prefixes, falls back
            // to a constructed URL when the disk has no `url` config,
            // and collapses double slashes — so the View link works on
            // every server configuration (local, Azure, prod).
            'attachment_url'    => file_url($d->attachment_path),
            'attachment_name'   => $d->attachment_path ? basename($d->attachment_path) : null,
            'description'       => $d->description,
            'status'            => $d->status,
            'created_at'        => $d->created_at?->toDateTimeString(),
        ];
    }

    private function validatePayload(Request $request, ?int $docId = null): array
    {
        return $request->validate([
            'kind'              => 'required|in:dd,tl',
            'name'              => 'required|string|max:255',
            'license_number'    => 'nullable|string|max:128',
            'issuing_authority' => 'nullable|string|max:255',
            'issue_date'        => 'nullable|date',
            'expiry_date'       => 'nullable|date|after_or_equal:issue_date',
            'description'       => 'nullable|string|max:1000',
            'status'            => 'nullable|in:Active,Inactive',
            // Attachment: 2 MB cap, restricted to safe document types
            // (image / PDF / Office docs). Rejects executables, scripts,
            // and archives (.php, .zip, .txt, .exe, etc.) at the server
            // so even a manipulated client request can't slip them through.
            'attachment'        => 'sometimes|file|mimes:jpg,jpeg,png,pdf,doc,docx|max:2048',
        ], [
            'attachment.mimes' => 'Attachment must be a JPG, JPEG, PNG, PDF, DOC or DOCX file.',
            'attachment.max'   => 'Attachment must not exceed 2 MB.',
        ]);
    }

    private function storeUpload($file, int $consigneeId, string $slug): string
    {
        $ext  = $file->getClientOriginalExtension() ?: 'bin';
        $name = $slug . '-' . bin2hex(random_bytes(6)) . '.' . $ext;
        return $file->storeAs("consignee_documents/{$consigneeId}", $name, 'public');
    }

    /**
     * Resolve the parent consignee with the same tenant rules used by
     * ConsigneeController. Aborts with 404 before any document touch
     * if the caller isn't entitled to see this consignee.
     */
    private function resolveConsignee(Request $request, $consigneeId, ?string $action = null): Consignee
    {
        $consignee = Consignee::query()
            ->forUser($request->user())
            ->findOrFail($consigneeId);
        if ($action) {
            $denial = \App\Support\MasterVisibility::hierarchicalDenial($request->user(), $consignee, $action);
            if ($denial) abort(403, $denial);
        }
        return $consignee;
    }
}

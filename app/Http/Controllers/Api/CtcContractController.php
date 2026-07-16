<?php

namespace App\Http\Controllers\Api;

use App\Events\CtcApprovalUpdated;
use App\Http\Controllers\Concerns\HandlesDocxHtmlRoundtrip;
use App\Http\Controllers\Controller;
use App\Models\CtcContract;
use App\Models\User;
use App\Support\CtcAuditTime;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * CLM Operations · Without Shipment ID → Case-to-Case (CTC) Contracts.
 *
 * One controller drives the add/drafting form plus the three views:
 *   index()         → Case to Case Contracts list
 *   sentIndex()     → Agreements We Sent      (created_by = me)
 *   toApproveIndex()→ Agreements To Approve   (my email is an approver)
 * Approver actions: approve / reject / clarify; sender: respond.
 *
 * Counterparties, page header/footer, approvers and the clarification thread
 * round-trip as JSON, so the response shapes match the SPA's CtcContract /
 * AwsContract / AtaContract types 1:1.
 */
class CtcContractController extends Controller
{
    use HandlesDocxHtmlRoundtrip;

    /* ── shared helpers ── */

    /** Display timezone — timestamps are stored UTC and converted on read
     *  (same convention as AttendanceController::DISPLAY_TZ). */
    private const DISPLAY_TZ = 'Asia/Kolkata';

    private function fmt($d): string
    {
        if (!$d) return '—';
        try { return \Illuminate\Support\Carbon::parse($d)->setTimezone(self::DISPLAY_TZ)->format('d M Y'); }
        catch (\Throwable $e) { return '—'; }
    }

    /**
     * Convert a stored UTC date string (already formatted as "d M Y" or
     * "d M Y H:i" by now()->format() at write time) to the display timezone.
     *
     * Delegates to CtcAuditTime — ClmSignatureController::ctcSignatureStatus()
     * feeds the SAME Review Timeline as show(), and when each controller kept
     * its own copy of this logic only one got fixed, so the timeline's times
     * shifted by 5:30 as the SPA's poll switched endpoints (CBC-574).
     */
    private function istStr(?string $s): string
    {
        return CtcAuditTime::str($s);
    }

    /**
     * Convert the `date` / `acted_at` fields inside a list of audit entries
     * (versions, clarifications, approvers) from stored UTC to display TZ.
     */
    private function istEntries($arr): array
    {
        return CtcAuditTime::entries($arr);
    }

    /** Append a content-snapshot version entry (append-only audit). */
    private function pushVersion(CtcContract $c, string $label, string $status, string $by, ?string $content = null, array $extra = []): void
    {
        $versions = array_values($c->versions ?? []);
        $versions[] = array_merge([
            'v'       => count($versions) + 1,
            'label'   => $label,
            'status'  => $status,
            'date'    => now()->format('d M Y H:i'),
            'by'      => $by,
            'content' => $content !== null ? $content : $c->content,
        ], $extra);
        $c->versions = $versions;
    }
    private function broadcastApproval(CtcContract $c): void
    {
        app()->terminating(function () use ($c) {
            try {
                broadcast(new CtcApprovalUpdated($c));
            } catch (\Throwable $e) {
                report($e);
            }
        });
    }

    private function myApproverStatus(CtcContract $c, string $email): ?string
    {
        $email = strtolower(trim($email));
        if ($email === '') return null;
        $approvers = array_values($c->approvers ?? []);
        foreach ($approvers as $a) {
            if (strtolower((string) ($a['email'] ?? '')) === $email) {
                return $a['status'] ?? 'pending';
            }
        }
        // Legacy rows that only stored the primary approver slot.
        if (strtolower((string) $c->primary_approver_email) === $email && isset($approvers[0])) {
            return $approvers[0]['status'] ?? 'pending';
        }
        return null;
    }

    /**
     * Every approver on this contract with their individual decision — so the
     * UI can list all of them (Parth: approved, Vedant: approved) instead of
     * only the static primary approver. Falls back to the primary slot for
     * legacy rows that never stored an approver list.
     */
    private function approverList(CtcContract $c): array
    {
        $approvers = array_values($c->approvers ?? []);
        if (empty($approvers)) {
            return $c->primary_approver_name
                ? [['name' => $c->primary_approver_name, 'status' => $c->approval_status ?: 'pending']]
                : [];
        }
        return array_map(fn ($a) => [
            'name'   => $a['name'] ?? '—',
            'status' => $a['status'] ?? 'pending',
        ], $approvers);
    }

    /**
     * Each approval round derived from the version audit, newest first. A
     * round opens on every "Under Review" submission (initial draft +
     * resubmissions) and closes on the approver's Rejected / Approved
     * decision — so a draft that was rejected, revised and approved yields
     * three persistent entries (Rejected → Pending → Approved) instead of a
     * single row whose status keeps flipping.
     */
    private function approvalRoundsShaped(CtcContract $c, string $approverName, string $approverEmail = ''): array
    {
        $reasonFromLabel = function (string $label): ?string {
            return preg_match('/—\s*(.+)$/u', $label, $m) ? trim($m[1]) : null;
        };
        $rounds = [];
        $cur = null;
        foreach (array_values($c->versions ?? []) as $v) {
            $st = $v['status'] ?? '';
            if ($st === 'Under Review') {
                if ($cur) $rounds[] = $cur;
                $cur = ['status' => 'pending', 'date' => $v['date'] ?? null, 'reason' => null];
            } elseif ($st === 'Rejected') {
                $entry = ['status' => 'rejected', 'date' => $v['date'] ?? ($cur['date'] ?? null), 'reason' => $v['reason'] ?? $reasonFromLabel((string) ($v['label'] ?? ''))];
                $rounds[] = $cur ? array_merge($cur, $entry) : $entry;
                $cur = null;
            } elseif ($st === 'Approved') {
                $entry = ['status' => 'approved', 'date' => $v['date'] ?? ($cur['date'] ?? null), 'reason' => null];
                $rounds[] = $cur ? array_merge($cur, $entry) : $entry;
                $cur = null;
            }
            // 'Sent for Signing' / 'Signed' are post-approval — ignored here.
        }
        if ($cur) {
            // Open round — reflect THIS approver's own decision first (personal
            // inbox view): once they've approved their slot the row moves to
            // their Approved tab even while other approvers are still pending.
            // Otherwise surface a live clarification state, else stay pending.
            $mine = $this->myApproverStatus($c, $approverEmail);
            if ($mine === 'approved')                        $cur['status'] = 'approved';
            elseif ($mine === 'rejected')                    $cur['status'] = 'rejected';
            elseif ($c->approval_status === 'clarification') $cur['status'] = 'clarification';
            $rounds[] = $cur;
        }
        if (empty($rounds)) {                                 // legacy rows w/o audit
            $shaped = $this->shapeApprove($c, $approverName);
            $mine = $this->myApproverStatus($c, $approverEmail);
            if ($mine === 'approved')     $shaped['status'] = 'approved';
            elseif ($mine === 'rejected') $shaped['status'] = 'rejected';
            return [$shaped];
        }

        return collect(array_reverse($rounds))->map(fn ($r) => [
            'id'             => $c->code,
            'dbId'           => $c->id,
            'title'          => $c->title,
            'date'           => $r['date'] ? $this->istStr($r['date']) : $this->fmt($c->submitted_at ?: $c->created_at),
            'createdBy'      => $c->created_by_name ?: '—',
            'approver'       => $c->primary_approver_name ?: $approverName,
            'approvers'      => $this->approverList($c),
            'status'         => $r['status'],
            // Keep the full clarification history visible across rounds (it was
            // only surfaced while the round itself sat in 'clarification', so it
            // looked deleted once the agreement moved on — the data was never lost).
            'clarifications' => $this->istEntries($c->clarifications ?? []),
            'expDate'        => $this->fmt($c->end_date),
            'rejReason'      => $r['reason'] ?? null,
        ])->all();
    }

    /** Approval lifecycle → CTC-list bucket. */
    private function listStatus(CtcContract $c): string
    {
        if ($c->approval_status === 'rejected') return 'rejected';
        if ($c->stage >= 4 || $c->status === 'signed') return 'signed';
        return 'inprogress';
    }

    private function cpNames(CtcContract $c): array
    {
        return collect($this->resolveCounterparties($c))->map(fn ($x) => $x['name'] ?? '')->filter()->values()->all();
    }

    /**
     * Same as cpNames() but each name is suffixed with its entity type —
     * "Royal Cashews (Customer)" — so the +N counterparty popover tells the
     * user whether a company is the Customer, Consignee or Supplier (a company
     * can appear as more than one role on the same agreement).
     */
    private function cpNamesLabeled(CtcContract $c): array
    {
        return collect($this->resolveCounterparties($c))
            ->map(function ($x) {
                $name = trim((string) ($x['name'] ?? ''));
                if ($name === '') return '';
                $role = $this->cpRoleLabel($x);
                return $role !== '' ? "{$name} ({$role})" : $name;
            })
            ->filter()->values()->all();
    }

    /** Map a counterparty's source_type / role to a display label. */
    private function cpRoleLabel(array $cp): string
    {
        $type = strtolower((string) ($cp['source_type'] ?? $cp['role'] ?? ''));
        if (str_contains($type, 'consignee')) return 'Consignee';
        if (str_contains($type, 'supplier') || str_contains($type, 'vendor')) return 'Supplier';
        if (str_contains($type, 'customer') || str_contains($type, 'buyer')) return 'Customer';
        return '';
    }

    /**
     * Refresh each stored counterparty against its live source record
     * (Customer / Consignee / Vendor) by source_type + source_id, so edits made
     * in those masters flow through to the agreement. Only the factual fields
     * (name, country, phone, email) are overlaid; the user-set `referred` alias,
     * `badge`, and the `source_*` reference keys are preserved as stored. Manual
     * / legacy entries without a source reference keep their snapshot.
     */
    private function resolveCounterparties(CtcContract $c): array
    {
        $cps = is_array($c->counterparties) ? $c->counterparties : [];
        return array_map(function ($cp) use ($c) {
            $type = strtolower((string) ($cp['source_type'] ?? ''));
            $id   = $cp['source_id'] ?? null;
            if ($id === null || $id === '' || $type === '') return $cp;
            $live = $this->liveParty($type, $id, (int) $c->client_id);
            return $live ? array_merge($cp, $live) : $cp;
        }, $cps);
    }

    /**
     * Resolve a party model from a stored source_id by: numeric PK → code column
     * → the numeric id embedded in a "PREFIX-NNN" display-fallback code. That
     * last step matters for consignees stored as "CN-014" whose consignee_code
     * column is null (the code is the id-based fallback the UI shows), which
     * would otherwise fail to resolve and surface as an empty / "Not Applicable"
     * company name in Stage 2 and in the {{consignee.*}} placeholders.
     */
    private function resolvePartyRow($q, $id, string $codeCol)
    {
        if (is_numeric($id)) return $q->find($id);
        $row = (clone $q)->where($codeCol, $id)->first();
        if ($row) return $row;
        return preg_match('/(\d+)\s*$/', (string) $id, $m) ? (clone $q)->find((int) $m[1]) : null;
    }

    /** Current name/country/phone/email for a party reference, or null if it no longer exists. */
    private function liveParty(string $type, $id, int $clientId): ?array
    {
        if ($type === 'buyer' || $type === 'customer') {
            // source_id is the customer_code (e.g. "C-009"), not the numeric PK —
            // resolve by code, falling back to the id (numeric or "C-NNN" form).
            $q = \App\Models\Customer::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->resolvePartyRow($q, $id, 'customer_code');
            if (!$row) return null;
            $a = $row->primaryAddress;
            return [
                'name'    => (string) $row->company_name,
                'country' => (string) ($a?->country ?? ''),
                'phone'   => (string) ($a?->cp_contact ?? ''),
                'email'   => (string) ($a?->cp_email ?? $row->primary_email ?? ''),
            ];
        }
        if ($type === 'consignee') {
            $q = \App\Models\Consignee::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->resolvePartyRow($q, $id, 'consignee_code');
            if (!$row) return null;
            $a = $row->primaryAddress;
            return [
                'name'    => (string) $row->company_name,
                'country' => (string) ($a?->country ?? ''),
                'phone'   => (string) ($a?->cp_contact ?? ''),
                'email'   => (string) ($a?->cp_email ?? $row->primary_email ?? ''),
            ];
        }
        if ($type === 'supplier' || $type === 'vendor') {
            $q = \App\Models\Vendor::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->resolvePartyRow($q, $id, 'vendor_code');
            if (!$row) return null;
            $a = $row->primaryAddress;
            return [
                'name'    => (string) $row->company_name,
                'country' => (string) ($a?->city ?? ''),
                'phone'   => (string) ($a?->contact_no ?? ''),
                'email'   => (string) ($a?->email ?? $row->primary_email ?? ''),
            ];
        }
        return null;
    }

    /**
     * Load the live Eloquent model + its CLM model-name for a counterparty
     * reference, so its {{customer.*}} / {{consignee.*}} / {{supplier.*}}
     * placeholders can be resolved against real data. Returns [model, name]
     * or [null, ''] when the reference can't be resolved.
     */
    private function livePartyModel(string $type, $id, int $clientId): array
    {
        $type = strtolower($type);
        if ($type === 'buyer' || $type === 'customer') {
            $q = \App\Models\Customer::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->resolvePartyRow($q, $id, 'customer_code');
            return $row ? [$row, 'Customer'] : [null, ''];
        }
        if ($type === 'consignee') {
            $q = \App\Models\Consignee::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->resolvePartyRow($q, $id, 'consignee_code');
            return $row ? [$row, 'Consignee'] : [null, ''];
        }
        if ($type === 'supplier' || $type === 'vendor') {
            $q = \App\Models\Vendor::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->resolvePartyRow($q, $id, 'vendor_code');
            return $row ? [$row, 'Vendor'] : [null, ''];
        }
        return [null, ''];
    }

    /**
     * Replace the {{customer.*}} / {{consignee.*}} / {{supplier.*}} party
     * placeholders in agreement HTML with each counterparty's real data,
     * reusing the same resolver the trade-doc / signature render uses.
     */
    private function resolvePartyTokens(string $html, CtcContract $row): string
    {
        foreach ((is_array($row->counterparties) ? $row->counterparties : []) as $cp) {
            $type = (string) ($cp['source_type'] ?? '');
            $id   = $cp['source_id'] ?? null;
            if ($id === null || $id === '' || $type === '') continue;
            [$model, $modelName] = $this->livePartyModel($type, $id, (int) $row->client_id);
            if ($model) $html = ClmSignatureController::replacePartyNamespaceTokens($html, $model, $modelName);
        }
        return $html;
    }

    /**
     * Fill the organisation-detail placeholders ({{company_name}} {{company_no}}
     * {{email}} {{contact_no}} {{address}}) from the Company Details master row
     * backing this agreement's "Our Organisation" selection.
     */
    private function resolveOrgTokens(string $html, CtcContract $row): string
    {
        $orgName = trim((string) ($row->org_name ?? ''));
        $company = $orgName
            ? \App\Models\Masters\Company::where('client_id', $row->client_id)->where('company_name', $orgName)->first()
            : null;
        $orgTokens = [
            'company_name' => $row->org_name ?: ($company->company_name ?? ''),
            'company_no'   => $company->cin ?? '',
            'email'        => $company->email ?? '',
            'contact_no'   => $company->mobile ?? '',
            'address'      => $company->address ?? '',
        ];
        foreach ($orgTokens as $tok => $val) {
            $html = preg_replace('/\{\{\s*' . $tok . '\s*\}\}/i', e((string) $val), $html);
        }
        return $html;
    }

    /**
     * Agreement HTML with party + organisation placeholders resolved to real
     * data, for the Stage-2 "Agreement Preview" pane. The {{signature}} token
     * is intentionally left untouched — the SPA swaps it for a sign-here marker.
     */
    private function previewContent(CtcContract $row): string
    {
        $html = (string) ($row->content ?? '');
        if ($html === '') return '';
        $html = $this->resolvePartyTokens($this->resolveOrgTokens($html, $row), $row);
        // Blank out any placeholder still left over — a party that isn't mapped
        // ({{supplier.*}} with no supplier), product tokens (CTC has none), or a
        // typo'd token — so the preview shows nothing instead of raw {{...}}.
        // {{signature}} is preserved: the SPA swaps it for the sign-here marker.
        $html = preg_replace('/\{\{\s*(?!signature\s*\}\})[^{}]*\}\}/i', '', $html);
        return $html;
    }

    /** Case to Case Contracts list row. */
    private function shapeList(CtcContract $c): array
    {
        $approval = $c->approval_status === 'clarification' ? 'pending' : ($c->approval_status ?: 'pending');
        return [
            'id'           => $c->code,
            'dbId'         => $c->id,
            'title'        => $c->title,
            'cp'           => $this->cpNames($c) ?: ['—'],
            'cpLabeled'    => $this->cpNamesLabeled($c) ?: ['—'],
            'org'          => $c->org_name ?: '—',
            'stage'        => $c->stage,
            'status'       => $this->listStatus($c),
            'date'         => $this->fmt($c->submitted_at ?: $c->created_at),
            'type'         => $c->agreement_type ?: '—',
            'effDate'      => $this->fmt($c->eff_date),
            'endDate'      => $this->fmt($c->end_date),
            'createdBy'    => $c->created_by_name ?: '—',
            'approval'     => $approval,
            'cpSignedDate' => $this->fmt($c->cp_signed_date),
        ];
    }

    /** Approval progress: [approvedCount, totalApprovers]. */
    private function approvalProgress(CtcContract $c): array
    {
        $approvers = array_values($c->approvers ?? []);
        $total     = count($approvers);
        $approved  = collect($approvers)->filter(fn ($a) => (($a['status'] ?? 'pending')) === 'approved')->count();
        return [$approved, $total];
    }

    /** Agreements We Sent row. */
    private function shapeSent(CtcContract $c): array
    {
        $statusMap = ['approved' => 'approved', 'rejected' => 'rejected', 'clarification' => 'clarify', 'pending' => 'pending'];
        $approval  = $c->approval_status === 'clarification' ? 'pending' : ($c->approval_status ?: 'pending');
        [$approvedCount, $approverCount] = $this->approvalProgress($c);
        return [
            'id'        => $c->code,
            'dbId'      => $c->id,
            'title'     => $c->title,
            'cp'        => $this->cpNames($c) ?: ['—'],
            'cpLabeled' => $this->cpNamesLabeled($c) ?: ['—'],
            'org'       => $c->org_name ?: '—',
            'date'      => $this->fmt($c->submitted_at ?: $c->created_at),
            'effDate'   => $this->fmt($c->eff_date),
            'endDate'   => $this->fmt($c->end_date),
            'createdBy' => $c->created_by_name ?: '—',
            'approver'  => $c->primary_approver_name ?: '—',
            'approval'  => $approval,
            'status'    => $statusMap[$c->approval_status] ?? 'pending',
            'approvers'     => $this->istEntries($c->approvers ?? []),
            'approvedCount' => $approvedCount,
            'approverCount' => $approverCount,
            'clarifications' => $this->istEntries($c->clarifications ?? []),
            'rejReason' => $c->rejection_reason,
            'expDate'   => $this->fmt($c->end_date),
        ];
    }

    /** Agreements To Approve row. */
    private function shapeApprove(CtcContract $c, string $approverName): array
    {
        return [
            'id'             => $c->code,
            'dbId'           => $c->id,
            'title'          => $c->title,
            'date'           => $this->fmt($c->submitted_at ?: $c->created_at),
            'createdBy'      => $c->created_by_name ?: '—',
            'approver'       => $c->primary_approver_name ?: $approverName,
            'status'         => $c->approval_status ?: 'pending',
            'clarifications' => $this->istEntries($c->clarifications ?? []),
            'expDate'        => $this->fmt($c->end_date),
            'rejReason'      => $c->rejection_reason,
        ];
    }

    /* ── Case to Case Contracts list ── */
    public function index(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);

        // Branch-scope the list the same way as the approver picker: a branch
        // user only ever sees their OWN branch's contracts; a tenant-level
        // client_admin (no own branch) sees the SPA-injected active branch, or
        // all branches when none is selected.
        $branchFilter = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        $rows = CtcContract::where('client_id', $user->client_id)
            ->when($branchFilter, fn ($q) => $q->where('branch_id', $branchFilter))
            ->orderByDesc('id')->get()
            ->map(fn ($c) => $this->shapeList($c));
        return response()->json(['status' => true, 'data' => $rows]);
    }

    /* ── Agreements We Sent (mine) ── */
    public function sentIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $rows = CtcContract::where('client_id', $user->client_id)
            ->where('created_by', $user->id)
            ->orderByDesc('id')->get()
            ->map(fn ($c) => $this->shapeSent($c));
        return response()->json(['status' => true, 'data' => $rows]);
    }

    /* ── Agreements To Approve (I'm an approver) ── */
    public function toApproveIndex(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $email = strtolower((string) $user->email);
        $rows = CtcContract::where('client_id', $user->client_id)
            ->where(function ($w) use ($email) {
                $w->whereJsonContains('approver_emails', $email)
                  ->orWhere('primary_approver_email', $email);
            })
            ->orderByDesc('id')->get()
            ->flatMap(fn ($c) => $this->approvalRoundsShaped($c, $user->name ?? '', $user->email ?? ''))
            // One row per CTC — keep only the latest round (rounds come back
            // newest-first, so the first occurrence of each code is the latest).
            ->unique('id')
            ->values();
        return response()->json(['status' => true, 'data' => $rows->values()]);
    }

    /** Branch (our-organisation) authorised-signatory image = signature + stamp combined. */
    private function orgSignatureUrl(CtcContract $c): ?string
    {
        $branch = $c->branch_id ? \App\Models\Branch::find($c->branch_id) : null;
        return $branch?->signature_url;
    }

    /** Same image as a data URI for dompdf (which can't fetch /storage URLs). */
    private function orgSignatureDataUri(CtcContract $c): ?string
    {
        $branch = $c->branch_id ? \App\Models\Branch::find($c->branch_id) : null;
        $path = $branch?->signature_path;
        if (!$path) return null;
        if (preg_match('#/storage/(.+)$#', (string) $path, $m)) $path = $m[1];
        try {
            if (!Storage::disk('public')->exists($path)) return null;
            $data = base64_encode(Storage::disk('public')->get($path));
            $ext  = strtolower(pathinfo($path, PATHINFO_EXTENSION) ?: 'png');
            $mime = in_array($ext, ['jpg', 'jpeg']) ? 'image/jpeg' : ($ext === 'webp' ? 'image/webp' : 'image/png');
            return "data:$mime;base64,$data";
        } catch (\Throwable $e) { return null; }
    }

    /**
     * GET /clm/ctc-contracts/contact-persons?type=buyer|consignee|supplier&id=...
     *
     * Contact persons captured on the counterparty's own form — the address /
     * contact rows of the Customer (buyer), Consignee or Vendor (supplier).
     * Drives the "Select contact persons to notify" picker in Send-for-Signing.
     */
    public function contactPersons(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        $type = strtolower((string) $request->query('type'));
        $id   = $request->query('id');
        if ($id === null || $id === '') return response()->json(['status' => true, 'data' => []]);

        if ($type === 'buyer' || $type === 'customer') {
            $row = $this->resolvePartyRow(\App\Models\Customer::where('client_id', $user->client_id)->with('addresses'), $id, 'customer_code');
            return response()->json(['status' => true, 'data' => $this->mapCpAddresses($row)]);
        }
        if ($type === 'consignee') {
            $row = $this->resolvePartyRow(\App\Models\Consignee::where('client_id', $user->client_id)->with('addresses'), $id, 'consignee_code');
            return response()->json(['status' => true, 'data' => $this->mapCpAddresses($row)]);
        }
        if ($type === 'supplier' || $type === 'vendor') {
            $q = \App\Models\Vendor::where('client_id', $user->client_id)->with('addresses');
            $row = $this->resolvePartyRow($q, $id, 'vendor_code');
            if (!$row) return response()->json(['status' => true, 'data' => []]);
            $contacts = collect($row->addresses ?? [])->map(fn ($a) => [
                'name'        => $a->contact_name,
                'email'       => $a->email,
                'designation' => $a->designation,
                'phone'       => $a->contact_no,
                'is_primary'  => (bool) $a->is_primary,
            ])->filter(fn ($c) => $c['name'] || $c['email'])->values()->all();
            return response()->json(['status' => true, 'data' => $contacts]);
        }
        return response()->json(['status' => true, 'data' => []]);
    }

    /** Customer/Consignee addresses → contact persons (shared cp_* columns). */
    private function mapCpAddresses($row): array
    {
        if (!$row) return [];
        return collect($row->addresses ?? [])->map(fn ($a) => [
            'name'        => $a->cp_name,
            'email'       => $a->cp_email,
            'designation' => $a->cp_designation,
            'phone'       => $a->cp_contact,
            'is_primary'  => (bool) $a->is_primary,
        ])->filter(fn ($c) => $c['name'] || $c['email'])->values()->all();
    }

    public function show(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        // Surface the branch signature+stamp so the SPA can drop it onto the
        // {{signature}} placeholder once the agreement is approved.
        $row->org_signature_url = $this->orgSignatureUrl($row);
        // Fully-signed PDF (from Zoho) once the signature request completed.
        $row->signed_document_url = $this->signedDocumentUrl($row);
        // Re-hydrate counterparties from their live source masters so any edit
        // made in Customer / Consignee / Vendor since this was saved shows here.
        $row->counterparties = $this->resolveCounterparties($row);
        // Stage-2 preview content: same body with {{party.*}} + {{org}} tokens
        // resolved to real data so the preview shows actual values, not raw
        // {{consignee.gst}} placeholders. Raw `content` is kept for editing.
        $row->content_preview = $this->previewContent($row);
        // Audit-trail timestamps (versions / clarifications / approver decisions)
        // are stored UTC; convert to display TZ for the timeline view. In-memory
        // only — show() never persists, so storage stays UTC.
        $row->versions       = $this->istEntries($row->versions ?? []);
        $row->clarifications = $this->istEntries($row->clarifications ?? []);
        $row->approvers      = $this->istEntries($row->approvers ?? []);
        return response()->json(['status' => true, 'data' => $row]);
    }

    /**
     * GET /clm/ctc-contracts/placeholder-values?type=&id=
     *
     * Resolved field → value map for one counterparty, so the Insert
     * Placeholder modal can show ONLY the fields that actually have data
     * (hide empty GST/PAN/contact/etc. instead of inserting blank tokens).
     */
    public function placeholderValues(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        [$model, $modelName] = $this->livePartyModel((string) $request->query('type', ''), $request->query('id'), (int) $user->client_id);
        if (!$model) return response()->json(['status' => true, 'data' => []]);

        $addr   = $model->primaryAddress;
        $vendor = $modelName === 'Vendor';
        $scalar = static fn ($v) => $v === null ? '' : (is_object($v) ? (string) ($v->name ?? '') : (string) $v);
        $country = $scalar($addr?->country);
        $state   = $scalar($addr?->state);
        $pin     = $scalar($vendor ? ($addr?->pincode ?? null) : ($addr?->pin ?? null));
        $codeAttr = $modelName === 'Customer' ? 'customer_code' : ($modelName === 'Consignee' ? 'consignee_code' : 'vendor_code');

        $values = [
            'name'           => (string) ($model->company_name ?? ''),
            'code'           => (string) ($model->{$codeAttr} ?? ''),
            'company'        => (string) (($model->legal_name ?: $model->company_name) ?? ''),
            'contact_person' => (string) ($vendor ? ($addr?->contact_name ?? '') : ($addr?->cp_name ?? '')),
            'phone'          => (string) ($vendor ? ($addr?->contact_no ?? '') : ($addr?->cp_contact ?? '')),
            'email'          => (string) ($model->primary_email ?? ''),
            // No backing column yet → always empty (so they get hidden).
            'gst'            => '',
            'pan'            => '',
            'iec'            => '',
            'bank_account'   => '',
            'country'        => $country,
            'state'          => $state,
            'city'           => $scalar($addr?->city ?? null),
            'address'        => trim(implode(', ', array_filter([$addr?->address_line, $addr?->city, $state, $country, $pin]))),
            'zip_code'       => $pin,
            'delivery_address' => trim(implode(', ', array_filter([$addr?->address_line, $addr?->city, $state, $country, $pin]))),
        ];
        return response()->json(['status' => true, 'data' => $values]);
    }

    /** Public URL of the fully-signed PDF (from the linked signature request), or null. */
    private function signedDocumentUrl(CtcContract $c): ?string
    {
        if (!$c->signature_request_id) return null;
        $sr = \App\Models\ClmSignatureRequest::find($c->signature_request_id);
        $paths = is_array($sr?->signed_document_paths) ? $sr->signed_document_paths : [];
        $first = $paths[0] ?? null;
        if (!is_array($first)) return null;
        return $first['file_url'] ?? $first['url'] ?? (isset($first['path']) ? file_url($first['path']) : null);
    }

    /**
     * GET /clm/ctc-contracts/approver-candidates
     *
     * Internal people who can be picked as approvers for a CTC draft:
     * the client (client_admin), the branch (branch_user) and the employees
     * under the active branch. Scoped to the caller's client; when a
     * branch_id is present (auto-injected by the SPA), employees/branch users
     * are narrowed to that branch while the client admin stays tenant-wide.
     */
    public function approverCandidates(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);

        // Approvers must belong to the SAME branch as the contract. Always scope
        // to the caller's OWN branch when they have one (branch users / employees)
        // so the picker never lists other branches' people — even when the branch
        // switcher is on "All". A tenant-level client_admin (no own branch) falls
        // back to the SPA-injected active branch_id.
        $branchFilter = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        // Internal approvers are branch users and employees only — clients
        // (client_admin) are intentionally excluded from the approver list.
        $query = User::where('client_id', $user->client_id)
            ->where('status', 'active')
            ->whereIn('user_type', ['branch_user', 'employee'])
            ->with('branch:id,name');

        if ($branchFilter) {
            $query->where('branch_id', $branchFilter);    // branch + its employees
        }

        $candidates = $query->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id']);

        // Only employees who actually hold a CLM module grant (can_view on any
        // clm.* module) may appear — otherwise, in a 500-employee company, the
        // whole roster floods the picker and the user can't tell who has CLM
        // access. Branch users (the branch Director / CEO) are the internal
        // decision-makers and stay eligible regardless of explicit grants.
        $clmUserIds = \App\Models\Permission::whereIn('user_id', $candidates->pluck('id'))
            ->where('can_view', true)
            ->whereHas('module', fn ($m) => $m->where('slug', 'like', 'clm.%'))
            ->pluck('user_id')->unique()->flip();

        // Designation + Department come from each candidate's linked Employee row
        // so the picker shows the person's job title / team instead of just the
        // branch name — the reviewer knows who they're sending to.
        $employees = \App\Models\Employee::whereIn('user_id', $candidates->pluck('id'))
            ->with(['designation:id,name', 'department:id,name'])
            ->get()->keyBy('user_id');

        // BRANCH first, then employees — and alphabetical within each.
        $order = ['branch_user' => 0, 'employee' => 1];
        $rows = $candidates
            ->filter(fn ($u) => $u->user_type === 'branch_user' || $clmUserIds->has($u->id))
            ->sortBy(fn ($u) => [$order[$u->user_type] ?? 9, strtolower($u->name ?? '')])
            ->values()
            ->map(function ($u) use ($employees) {
                $emp = $employees->get($u->id);
                return [
                    'id'          => $u->id,
                    'name'        => $u->name,
                    'email'       => $u->email,
                    'user_type'   => $u->user_type,
                    'branch_name' => $u->branch->name ?? null,
                    'designation' => $emp?->designation?->name,
                    'department'  => $emp?->department?->name,
                ];
            });

        return response()->json(['status' => true, 'data' => $rows->values()]);
    }

    /* ── Create (Submit & Send for Approval from the add form) ── */
    public function store(Request $request)
    {
        $user = $request->user(); if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'title'              => 'required|string|max:255',
            'agreement_type'     => 'nullable|string|max:64',
            'org_name'           => 'nullable|string|max:255',
            'org_short_code'     => 'nullable|string|max:64',
            'org_state'          => 'nullable|string|max:128',
            'org_country'        => 'nullable|string|max:128',
            'counterparties'     => 'nullable|array',
            'eff_date'           => 'nullable|date',
            'end_date'           => 'nullable|date',
            'auto_renewal'       => 'nullable|boolean',
            'renewal_type'       => 'nullable|string|max:16',
            'content'            => 'nullable|string',
            'header_config'      => 'nullable|array',
            'footer_config'      => 'nullable|array',
            'approvers'          => 'nullable|array',
            'days_to_approve'    => 'nullable|integer',
            'reminder_days'      => 'nullable|integer',
        ]);

        // Each approver carries its own decision so the contract only counts
        // as approved once EVERY selected approver has approved (see approve()).
        // `status` starts 'pending'; `acted_at` stamps when they decide.
        $approvers = collect($data['approvers'] ?? [])->map(fn ($a) => [
            'name'      => (string) ($a['name'] ?? ''),
            'email'     => strtolower((string) ($a['email'] ?? '')),
            'role'      => (string) ($a['role'] ?? ''),
            'mandatory' => (bool) ($a['mandatory'] ?? false),
            'status'    => 'pending',
            'acted_at'  => null,
        ])->values();
        $primary = $approvers->first();

        $row = DB::transaction(function () use ($user, $data, $approvers, $primary) {
            // Per-BRANCH sequential code under a client row lock (same locking as
            // Quotation/PI). Branch-scoped so each branch restarts at CTC-001
            // instead of continuing the client-wide tally — a fresh branch's
            // first agreement is CTC-001, not CTC-007. withTrashed() keeps the
            // count gap-free across soft-deletes. Client-level creators
            // (branch_id null) share the unassigned-branch sequence.
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $seq  = CtcContract::withTrashed()
                ->where('client_id', $user->client_id)
                ->when($user->branch_id, fn ($q) => $q->where('branch_id', $user->branch_id), fn ($q) => $q->whereNull('branch_id'))
                ->count() + 1;
            $code = sprintf('CTC-%03d', $seq);

            $v1 = [[
                'v'       => 1,
                'label'   => 'Agreement drafted & submitted for internal review',
                'status'  => 'Under Review',
                'date'    => now()->format('d M Y H:i'),
                'by'      => $user->name ?? '',
                'content' => $data['content'] ?? null,
            ]];

            return CtcContract::create([
                'client_id'          => $user->client_id,
                'branch_id'          => $user->branch_id ?? null,
                'code'               => $code,
                'title'              => $data['title'],
                'agreement_type'     => $data['agreement_type'] ?? null,
                'org_name'           => $data['org_name'] ?? null,
                'org_short_code'     => $data['org_short_code'] ?? null,
                'org_state'          => $data['org_state'] ?? null,
                'org_country'        => $data['org_country'] ?? null,
                'counterparties'     => $data['counterparties'] ?? [],
                'eff_date'           => $data['eff_date'] ?? null,
                'end_date'           => $data['end_date'] ?? null,
                'auto_renewal'       => $data['auto_renewal'] ?? false,
                'renewal_type'       => $data['renewal_type'] ?? null,
                'content'            => $data['content'] ?? null,
                'header_config'      => $data['header_config'] ?? null,
                'footer_config'      => $data['footer_config'] ?? null,
                'approvers'          => $approvers->all(),
                'approver_emails'    => $approvers->pluck('email')->filter()->values()->all(),
                'clarifications'     => [],
                'versions'           => $v1,
                'stage'              => 2,                 // submitted → Internal Review
                'approval_status'    => 'pending',
                'status'             => 'inprogress',
                'days_to_approve'    => $data['days_to_approve'] ?? null,
                'reminder_days'      => $data['reminder_days'] ?? null,
                'primary_approver_name'  => $primary['name'] ?? null,
                'primary_approver_email' => $primary['email'] ?? null,
                'created_by'         => $user->id,
                'created_by_name'    => $user->name ?? null,
                'submitted_at'       => now(),
            ]);
        });

        $this->broadcastApproval($row);
        return response()->json(['status' => true, 'data' => $this->shapeList($row), 'code' => $row->code], 201);
    }

    public function update(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'title'          => 'sometimes|string|max:255',
            'agreement_type' => 'nullable|string|max:64',
            'content'        => 'nullable|string',
            'header_config'  => 'nullable|array',
            'footer_config'  => 'nullable|array',
            'counterparties' => 'nullable|array',
            'eff_date'       => 'nullable|date',
            'end_date'       => 'nullable|date',
        ]);
        $row->update($data);
        return response()->json(['status' => true, 'data' => $this->shapeList($row->fresh())]);
    }

    public function destroy(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true]);
    }

    /* ── Approver actions ── */

    /**
     * Mark the caller's approval. The contract is only flagged `approved`
     * (which is what unlocks "Send for Signing" → Stage 3) once EVERY
     * selected approver has approved — a single approver's nod is no longer
     * enough. Each approver's decision is tracked inside the `approvers`
     * JSON so partial progress survives reloads and is queryable.
     *
     * Backward-compatible: drafts created before per-approver tracking (no
     * `status` keys, or an empty approver list) approve outright on one nod.
     */
    public function approve(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $email     = strtolower((string) $user->email);
        $approvers = array_values($row->approvers ?? []);

        // Legacy / no approver list → single approval approves outright.
        if (empty($approvers)) {
            $row->approval_status = 'approved';
            $row->rejection_reason = null;
            $this->pushVersion($row, 'Approved by ' . ($user->name ?? 'approver'), 'Approved', $user->name ?? '');
            $row->save();
            $this->broadcastApproval($row);
            return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
        }

        // Stamp this approver's decision (match by email; fall back to the
        // primary-approver slot for legacy rows that only stored the primary).
        $matched = false;
        foreach ($approvers as &$a) {
            if (strtolower((string) ($a['email'] ?? '')) === $email && $email !== '') {
                $a['status']   = 'approved';
                $a['acted_at'] = now()->format('d M Y H:i');
                $matched = true;
            }
        }
        unset($a);
        if (!$matched && $email !== '' && strtolower((string) $row->primary_approver_email) === $email) {
            $approvers[0]['status']   = 'approved';
            $approvers[0]['acted_at'] = now()->format('d M Y H:i');
            $matched = true;
        }
        if (!$matched) {
            return response()->json(['status' => false, 'message' => 'You are not an approver for this agreement.'], 403);
        }

        $row->approvers = $approvers;

        $total    = count($approvers);
        $approved = collect($approvers)->filter(fn ($a) => ($a['status'] ?? 'pending') === 'approved')->count();

        if ($approved >= $total) {
            // Everyone has approved → contract is approved (stays at Stage 2;
            // the sender then chooses "Send for Signing & Negotiation").
            $row->approval_status  = 'approved';
            $row->rejection_reason = null;
            $this->pushVersion($row, 'Approved by all ' . $total . ' approver' . ($total > 1 ? 's' : ''), 'Approved', $user->name ?? '');
        } else {
            // Still waiting on others → keep the round open. The audit note uses
            // a non-round status so approvalRoundsShaped() doesn't close it early.
            $row->approval_status = 'pending';
            $this->pushVersion($row, ($user->name ?? 'Approver') . ' approved (' . $approved . ' of ' . $total . ') — awaiting remaining approvers', 'Approving', $user->name ?? '');
        }
        $row->save();
        $this->broadcastApproval($row);
        return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
    }

    public function reject(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['reason' => 'required|string|max:1000']);

        // One rejection blocks the whole agreement — record which approver
        // declined, then flip the contract to rejected. Rejected → sender can
        // revise & resubmit (multiple times), so the row stays workable
        // (status 'inprogress'); only approval_status flips.
        $email = strtolower((string) $user->email);
        $approvers = array_values($row->approvers ?? []);
        foreach ($approvers as &$a) {
            if (strtolower((string) ($a['email'] ?? '')) === $email && $email !== '') {
                $a['status']   = 'rejected';
                $a['acted_at'] = now()->format('d M Y H:i');
            }
        }
        unset($a);
        if (!empty($approvers)) $row->approvers = $approvers;

        $row->approval_status = 'rejected';
        $row->status = 'inprogress';
        $row->rejection_reason = $data['reason'];
        $this->pushVersion($row, 'Rejected by ' . ($user->name ?? 'approver') . ' — ' . $data['reason'], 'Rejected', $user->name ?? '', null, ['reason' => $data['reason']]);
        $row->save();
        $this->broadcastApproval($row);
        return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
    }

    public function clarify(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['query' => 'required|string|max:2000']);
        $thread = $row->clarifications ?? [];
        // Stamp the raising approver so the shared thread can attribute each
        // remark — any of the contract's approvers may add to the same thread.
        $thread[] = ['query' => $data['query'], 'by' => $user->name ?: 'Approver', 'date' => now()->format('d M Y H:i'), 'response' => '', 'resolved' => false];
        $row->update(['approval_status' => 'clarification', 'clarifications' => $thread]);
        $this->broadcastApproval($row->fresh());
        return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
    }

    /** Sender responds to the latest open clarification. */
    public function respond(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['response' => 'required|string|max:2000']);
        $thread = $row->clarifications ?? [];
        for ($i = count($thread) - 1; $i >= 0; $i--) {
            if (empty($thread[$i]['response'])) {
                $thread[$i]['response'] = $data['response'];
                // Stamp WHEN the sender answered — distinct from the request's
                // `date` so the review timeline shows the real answer time
                // instead of reusing the "Clarification Requested" timestamp.
                $thread[$i]['response_date'] = now()->format('d M Y H:i');
                break;
            }
        }
        $row->update(['clarifications' => $thread]);
        $this->broadcastApproval($row->fresh());
        return response()->json(['status' => true, 'data' => $this->shapeSent($row->fresh())]);
    }

    /* ── Lifecycle transitions (sender side, from the add/edit form) ── */

    /**
     * POST /clm/ctc-contracts/{id}/resubmit
     * Revise the draft and re-send for internal review — used both after an
     * internal rejection AND after a counterparty declined the e-sign. Either
     * way the contract re-enters Stage 2 approval (a decline cannot go straight
     * back to Zoho), so any live signing request is cleared. Repeatable.
     */
    public function resubmit(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'content'        => 'nullable|string',
            'title'          => 'sometimes|string|max:255',
            'agreement_type' => 'nullable|string|max:64',
            'header_config'  => 'nullable|array',
            'footer_config'  => 'nullable|array',
            // Full-edit fields — sent by the add/edit form's "Update & Send for
            // Approval"; absent on the lighter rejected/declined resubmit.
            'counterparties' => 'nullable|array',
            'eff_date'       => 'nullable|date',
            'end_date'       => 'nullable|date',
            'org_name'       => 'nullable|string|max:255',
            'org_short_code' => 'nullable|string|max:64',
            'org_state'      => 'nullable|string|max:128',
            'org_country'    => 'nullable|string|max:128',
            'approvers'         => 'nullable|array',
            'days_to_approve'   => 'nullable|integer',
            'reminder_days'     => 'nullable|integer',
        ]);

        if (array_key_exists('content', $data))         $row->content = $data['content'];
        if (array_key_exists('title', $data))           $row->title = $data['title'];
        if (array_key_exists('agreement_type', $data))  $row->agreement_type = $data['agreement_type'];
        if (array_key_exists('header_config', $data))   $row->header_config = $data['header_config'];
        if (array_key_exists('footer_config', $data))   $row->footer_config = $data['footer_config'];
        if (array_key_exists('counterparties', $data))  $row->counterparties = $data['counterparties'] ?? [];
        if (array_key_exists('eff_date', $data))         $row->eff_date = $data['eff_date'];
        if (array_key_exists('end_date', $data))         $row->end_date = $data['end_date'];
        if (array_key_exists('org_name', $data))         $row->org_name = $data['org_name'];
        if (array_key_exists('org_short_code', $data))   $row->org_short_code = $data['org_short_code'];
        if (array_key_exists('org_state', $data))        $row->org_state = $data['org_state'];
        if (array_key_exists('org_country', $data))      $row->org_country = $data['org_country'];
        if (array_key_exists('days_to_approve', $data))  $row->days_to_approve = $data['days_to_approve'];
        if (array_key_exists('reminder_days', $data))    $row->reminder_days = $data['reminder_days'];

        $wasDeclined = collect($row->signing_recipients ?? [])->contains(fn ($r) => !empty($r['declined']));

        // Approvers: when the edit form supplies a new list, replace it
        // (rebuilding approver_emails + primary); otherwise keep the existing
        // approvers. Either way, reset every approver's decision so the
        // all-must-approve gate starts over for this fresh round.
        if (!empty($data['approvers'])) {
            $approvers = collect($data['approvers'])->map(fn ($a) => [
                'name'      => (string) ($a['name'] ?? ''),
                'email'     => strtolower((string) ($a['email'] ?? '')),
                'role'      => (string) ($a['role'] ?? ''),
                'mandatory' => (bool) ($a['mandatory'] ?? false),
                'status'    => 'pending',
                'acted_at'  => null,
            ])->values();
            $row->approvers              = $approvers->all();
            $row->approver_emails        = $approvers->pluck('email')->filter()->values()->all();
            $primary                     = $approvers->first();
            $row->primary_approver_name  = $primary['name'] ?? null;
            $row->primary_approver_email = $primary['email'] ?? null;
        } else {
            $row->approvers = collect($row->approvers ?? [])->map(function ($a) {
                $a = (array) $a;
                $a['status']   = 'pending';
                $a['acted_at'] = null;
                return $a;
            })->values()->all();
        }

        $row->approval_status = 'pending';
        $row->status = 'inprogress';
        $row->stage = 2;
        $row->rejection_reason = null;
        $row->submitted_at = now();
        // Re-entering the approval cycle → drop the previous signing request so
        // it can't be reused; a fresh one is created after the new approval.
        $row->signing_recipients   = [];
        $row->zoho_request_id      = null;
        $row->signature_request_id = null;
        $row->signature_declined_at = null;
        $label = $wasDeclined
            ? 'Draft revised after counterparty decline & resubmitted for internal review'
            : 'Revised draft resubmitted for internal review';
        $this->pushVersion($row, $label, 'Under Review', $user->name ?? '');
        $row->save();

        $this->broadcastApproval($row);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /**
     * POST /clm/ctc-contracts/{id}/send-for-signing
     * Approved → send to counterparties for signature & negotiation (Stage 3).
     */
    public function sendForSigning(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        if ($row->approval_status !== 'approved') {
            return response()->json(['status' => false, 'message' => 'Agreement must be approved before sending for signing.'], 422);
        }

        $data = $request->validate([
            'recipients'             => 'required|array|min:1',
            'recipients.*.name'      => 'required|string|max:255',
            'recipients.*.email'     => 'nullable|string|max:255',
            'recipients.*.role'      => 'nullable|string|max:128',
            'recipients.*.contact'   => 'nullable|string|max:255',
            'days_to_sign'           => 'nullable|integer|min:1|max:365',
        ]);

        $recipients = collect($data['recipients'])->map(fn ($r) => [
            'name'      => (string) ($r['name'] ?? ''),
            'email'     => strtolower((string) ($r['email'] ?? '')),
            'role'      => (string) ($r['role'] ?? ''),
            'contact'   => (string) ($r['contact'] ?? ''),
            'signed'    => false,
            'signed_at' => null,
        ])->values()->all();

        $row->signing_recipients = $recipients;
        $row->days_to_sign = $data['days_to_sign'] ?? null;
        $row->stage = 3;
        $row->status = 'inprogress';
        $this->pushVersion($row, 'Agreement sent to counterparty for signature & negotiation', 'Sent for Signing', $user->name ?? '');
        $row->save();

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /**
     * POST /clm/ctc-contracts/{id}/record-signature
     * Mark one recipient (by index/email) signed, or all at once.
     * When every recipient has signed, a "signed by all parties" version is added.
     */
    public function recordSignature(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'index' => 'nullable|integer|min:0',
            'email' => 'nullable|string|max:255',
            'all'   => 'nullable|boolean',
        ]);

        $recipients = array_values($row->signing_recipients ?? []);
        if (!count($recipients)) {
            return response()->json(['status' => false, 'message' => 'No signing recipients to mark.'], 422);
        }

        $stamp = now()->format('d M Y H:i');
        if (!empty($data['all'])) {
            foreach ($recipients as &$r) { if (empty($r['signed'])) { $r['signed'] = true; $r['signed_at'] = $stamp; } }
            unset($r);
        } elseif (array_key_exists('index', $data) && $data['index'] !== null && isset($recipients[$data['index']])) {
            $recipients[$data['index']]['signed'] = true;
            $recipients[$data['index']]['signed_at'] = $stamp;
        } elseif (!empty($data['email'])) {
            $email = strtolower($data['email']);
            foreach ($recipients as &$r) { if (($r['email'] ?? '') === $email) { $r['signed'] = true; $r['signed_at'] = $stamp; } }
            unset($r);
        } else {
            return response()->json(['status' => false, 'message' => 'Specify which recipient signed.'], 422);
        }

        $row->signing_recipients = $recipients;
        $allSigned = collect($recipients)->every(fn ($r) => !empty($r['signed']));
        if ($allSigned) {
            $row->cp_signed_date = now();
            $this->pushVersion($row, 'Agreement signed by all parties', 'Signed', $user->name ?? '');
        }
        $row->save();

        return response()->json(['status' => true, 'data' => $row->fresh(), 'allSigned' => $allSigned]);
    }

    /**
     * POST /clm/ctc-contracts/{id}/move-to-repository
     * All parties signed → store in the Final Contract Repository (Stage 4).
     */
    public function moveToRepository(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $recipients = array_values($row->signing_recipients ?? []);
        $allSigned  = count($recipients) > 0 && collect($recipients)->every(fn ($r) => !empty($r['signed']));
        if (!$allSigned) {
            return response()->json(['status' => false, 'message' => 'All parties must sign before moving to the repository.'], 422);
        }

        $row->stage = 4;
        $row->status = 'signed';
        if (!$row->cp_signed_date) $row->cp_signed_date = now();
        $this->pushVersion($row, 'Agreement stored in final contract repository', 'Signed', $user->name ?? '');
        $row->save();

        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    /** GET /clm/ctc-contracts/{id}/versions — version history list. */
    public function versions(Request $request, int $id)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        return response()->json(['status' => true, 'data' => $this->istEntries($row->versions ?? [])]);
    }

    /**
     * GET /clm/ctc-contracts/{id}/versions/{v}/download
     * Render a specific version's content snapshot to PDF (page-shell + footer
     * page numbers), reusing the shared signature-document blade + dompdf.
     */
    public function downloadVersion(Request $request, int $id, int $v)
    {
        $user = $request->user(); if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $versions = array_values($row->versions ?? []);
        $entry = collect($versions)->firstWhere('v', $v);
        if (!$entry) abort(404);

        $html = trim((string) ($entry['content'] ?? $row->content));
        if ($html === '') $html = '<p><em>No content saved for this version.</em></p>';
        $processedHtml = $this->normaliseEditorHtml($html);

        // Once approved, the {{signature}} placeholder (receiving-party / our
        // organisation) is filled with the branch's signature + stamp image.
        $approved = $row->approval_status === 'approved' || (int) $row->stage >= 3;
        $sigUri = $approved ? $this->orgSignatureDataUri($row) : null;
        $sigHtml = $sigUri
            ? '<img src="' . $sigUri . '" alt="Authorised Signatory" style="max-height:80px;max-width:210px;object-fit:contain;" />'
            : '';
        $processedHtml = preg_replace('/\{\{\s*signature\s*\}\}/i', $sigHtml, $processedHtml);

        // Organisation-detail placeholders — filled from the Company Details
        // master row backing this agreement's "Our Organisation" selection.
        // ({{company_name}} {{company_no}} {{email}} {{contact_no}} {{address}})
        $orgName = trim((string) ($row->org_name ?? ''));
        $company = $orgName
            ? \App\Models\Masters\Company::where('client_id', $row->client_id)
                ->where('company_name', $orgName)->first()
            : null;
        $orgTokens = [
            'company_name' => $row->org_name ?: ($company->company_name ?? ''),
            'company_no'   => $company->cin ?? '',          // registered company number (CIN)
            'email'        => $company->email ?? '',
            'contact_no'   => $company->mobile ?? '',
            'address'      => $company->address ?? '',
        ];
        foreach ($orgTokens as $tok => $val) {
            $processedHtml = preg_replace('/\{\{\s*' . $tok . '\s*\}\}/i', e((string) $val), $processedHtml);
        }

        // Party placeholders ({{customer.*}} / {{consignee.*}} / {{supplier.*}})
        // → real counterparty data, so the rendered PDF/DOCX never leaks raw
        // tokens like {{consignee.gst}}.
        $processedHtml = $this->resolvePartyTokens($processedHtml, $row);
        // Blank any placeholder still left (unmapped party, missing data, typo)
        // so the final document shows nothing rather than raw {{...}}.
        // ({{signature}} was already substituted above.)
        $processedHtml = preg_replace('/\{\{[^{}]*\}\}/', '', $processedHtml);

        $headerConfig = is_array($row->header_config) ? $row->header_config : [];
        $footerConfig = is_array($row->footer_config) ? $row->footer_config : [];
        $client = \App\Models\Client::find($row->client_id);

        $urlPath = (isset($headerConfig['logo_url']) && preg_match('#/storage/(.+)$#', (string) $headerConfig['logo_url'], $m)) ? $m[1] : null;
        $headerLogoBase64 = '';
        foreach (array_filter([$headerConfig['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            try {
                if (Storage::disk('public')->exists($path)) { $headerLogoBase64 = base64_encode(Storage::disk('public')->get($path)); break; }
            } catch (\Throwable $e) { /* try next candidate */ }
        }

        // Make the document title reflect the version for the blade heading.
        $row->title = ($row->title ?: 'Agreement') . ' — v' . $v;

        // DOCX export — same processed content rendered to an editable Word file.
        if (strtolower((string) $request->query('format')) === 'docx') {
            return $this->renderVersionDocx($processedHtml, $row->title, ($row->code ?: 'CTC') . '-v' . $v);
        }

        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $row,
            'party'            => null,
            'modelName'        => '',
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => $row->code ?: 'CTC',
            'signers'          => [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'footerConfig'     => $footerConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper('a4')->setOption('isPhpEnabled', true);

        return $pdf->download(($row->code ?: 'CTC') . '-v' . $v . '.pdf');
    }

    /**
     * Render a version's processed HTML to an editable .docx via PhpWord.
     * Data-URI images (e.g. the signature stamp) are stripped first because
     * PhpWord's HTML reader chokes on them; the malformed-HTML fallback drops
     * to plain paragraphs so a download is always produced.
     */
    private function renderVersionDocx(string $html, string $title, string $baseName)
    {
        $phpWord = new \PhpOffice\PhpWord\PhpWord();
        $section = $phpWord->addSection();
        $section->addTitle(strip_tags($title), 1);

        $clean = preg_replace('/<img[^>]*src="data:[^"]*"[^>]*>/i', '', $html) ?? $html;
        try {
            \PhpOffice\PhpWord\Shared\Html::addHtml($section, $clean, false, false);
        } catch (\Throwable $e) {
            foreach (preg_split('/<\/p>|<br\s*\/?>/i', $clean) ?: [] as $chunk) {
                $text = trim(html_entity_decode(strip_tags($chunk), ENT_QUOTES | ENT_HTML5));
                if ($text !== '') $section->addText($text);
            }
        }

        $writer = \PhpOffice\PhpWord\IOFactory::createWriter($phpWord, 'Word2007');
        return response()->streamDownload(function () use ($writer) {
            $writer->save('php://output');
        }, $baseName . '.docx', [
            'Content-Type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ]);
    }
}

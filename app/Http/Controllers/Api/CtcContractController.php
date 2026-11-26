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
use Illuminate\Validation\ValidationException;

class CtcContractController extends Controller
{
    use HandlesDocxHtmlRoundtrip;

    private const DISPLAY_TZ = 'Asia/Kolkata';

    private function fmt($d): string
    {
        if (!$d) return '—';
        try {
            return \Illuminate\Support\Carbon::parse($d)->setTimezone(self::DISPLAY_TZ)->format('d M Y');
        } catch (\Throwable $e) {
            return '—';
        }
    }

    private function istStr(?string $s): string
    {
        return CtcAuditTime::str($s);
    }

    private function istEntries($arr): array
    {
        return CtcAuditTime::entries($arr);
    }

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

    /* Pre-render the approver's PDF after the response has been sent, so opening
       the agreement in Agreements To Approve reads it from cache instead of
       waiting on a full dompdf render. Failure only means the approver renders
       it on open, exactly as before. */
    private function warmApproverPreview(int $id): void
    {
        app()->terminating(function () use ($id) {
            try {
                $c = CtcContract::find($id);
                if ($c && trim((string) $c->content) !== '') {
                    app(ClmSignatureController::class)->warmCtcPreview($c);
                }
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
        if (strtolower((string) $c->primary_approver_email) === $email && isset($approvers[0])) {
            return $approvers[0]['status'] ?? 'pending';
        }
        return null;
    }

    private function isApprover(CtcContract $c, $user): bool
    {
        $email = strtolower(trim((string) ($user->email ?? '')));
        $approvers = array_values($c->approvers ?? []);
        $emails    = array_values($c->approver_emails ?? []);
        $primary   = strtolower(trim((string) $c->primary_approver_email));

        if (empty($approvers) && empty($emails) && $primary === '') return true;
        if ($email === '') return false;

        foreach ($approvers as $a) {
            if (strtolower(trim((string) ($a['email'] ?? ''))) === $email) return true;
        }
        foreach ($emails as $e) {
            if (strtolower(trim((string) $e)) === $email) return true;
        }
        return $primary === $email;
    }

    private function hasMyOpenClarification(CtcContract $c, string $email, string $name = ''): bool
    {
        $email = strtolower(trim($email));
        $name  = strtolower(trim($name));
        foreach (array_values($c->clarifications ?? []) as $cl) {
            if (trim((string) ($cl['response'] ?? '')) !== '') continue;
            $byEmail = strtolower(trim((string) ($cl['by_email'] ?? '')));
            if ($byEmail !== '') {
                if ($email !== '' && $byEmail === $email) return true;
                continue;
            }
            if ($name !== '' && strtolower(trim((string) ($cl['by'] ?? ''))) === $name) return true;
        }
        return false;
    }

    private function approverList(CtcContract $c): array
    {
        $approvers = array_values($c->approvers ?? []);
        if (empty($approvers)) {
            return $c->primary_approver_name
                ? [['name' => $c->primary_approver_name, 'status' => $c->approval_status ?: 'pending']]
                : [];
        }
        return array_map(fn($a) => [
            'name'   => $a['name'] ?? '—',
            'status' => $a['status'] ?? 'pending',
        ], $approvers);
    }

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
        }
        if ($cur) {
            $mine = $this->myApproverStatus($c, $approverEmail);
            if ($mine === 'approved')     $cur['status'] = 'approved';
            elseif ($mine === 'rejected') $cur['status'] = 'rejected';
            $rounds[] = $cur;
        }
        if (empty($rounds)) {
            $shaped = $this->shapeApprove($c, $approverName);
            $mine = $this->myApproverStatus($c, $approverEmail);
            if ($mine === 'approved')     $shaped['status'] = 'approved';
            elseif ($mine === 'rejected') $shaped['status'] = 'rejected';
            elseif ($shaped['status'] === 'clarification' && !$this->hasMyOpenClarification($c, $approverEmail, $approverName)) {
                $shaped['status'] = 'pending';
            }
            return [$shaped];
        }

        $ordered = array_reverse($rounds);

        if (
            !empty($ordered)
            && $ordered[0]['status'] !== 'rejected'
            && $this->hasMyOpenClarification($c, $approverEmail, $approverName)
        ) {
            $ordered[0]['status'] = 'clarification';
        }

        return collect($ordered)->map(fn($r) => [
            'id'             => $c->code,
            'dbId'           => $c->id,
            'title'          => $c->title,
            'date'           => $r['date'] ? $this->istStr($r['date']) : $this->fmt($c->submitted_at ?: $c->created_at),
            'createdBy'      => $c->created_by_name ?: '—',
            'approver'       => $c->primary_approver_name ?: $approverName,
            'approvers'      => $this->approverList($c),
            'status'         => $r['status'],
            'clarifications' => $this->istEntries($c->clarifications ?? []),
            'expDate'        => $this->fmt($c->end_date),
            'rejReason'      => $r['reason'] ?? null,
        ])->all();
    }

    private function listStatus(CtcContract $c): string
    {
        if ($c->approval_status === 'rejected') return 'rejected';
        if ($c->stage >= 4 || $c->status === 'signed') return 'signed';
        return 'inprogress';
    }

    private function cpNamesFromStored(CtcContract $c, bool $labeled): array
    {
        $cps = is_array($c->counterparties) ? $c->counterparties : [];
        return collect($cps)->map(function ($cp) use ($labeled) {
            if (!is_array($cp)) return '';
            $name = trim((string) ($cp['name'] ?? ''));
            if ($name === '' || !$labeled) return $name;
            $role = $this->cpRoleLabel($cp);
            return $role !== '' ? "{$name} ({$role})" : $name;
        })->filter()->values()->all();
    }

    private function cpRoleLabel(array $cp): string
    {
        $type = strtolower((string) ($cp['source_type'] ?? $cp['role'] ?? ''));
        if (str_contains($type, 'consignee')) return 'Consignee';
        if (str_contains($type, 'supplier') || str_contains($type, 'vendor')) return 'Supplier';
        if (str_contains($type, 'customer') || str_contains($type, 'buyer')) return 'Customer';
        return '';
    }

    private function cpIsDomestic(array $cp): bool
    {
        return strtolower(trim((string) ($cp['country'] ?? ''))) === 'india';
    }

    private function assertCounterpartyCategories(?array $cps): void
    {
        $rows     = is_array($cps) ? $cps : [];
        $customer = null;
        $consignee = null;
        foreach ($rows as $cp) {
            if (!is_array($cp)) continue;
            $label = $this->cpRoleLabel($cp);
            if ($label === '') {
                $badge = strtolower((string) ($cp['badge'] ?? ''));
                if (str_contains($badge, 'consignee')) $label = 'Consignee';
                elseif (str_contains($badge, 'buyer') || str_contains($badge, 'customer')) $label = 'Customer';
            }
            if ($label === 'Customer')  $customer  = $cp;
            if ($label === 'Consignee') $consignee = $cp;
        }
        if ($customer === null || $consignee === null) return;
        if ($this->cpIsDomestic($customer) !== $this->cpIsDomestic($consignee)) {
            $custCat = $this->cpIsDomestic($customer) ? 'Domestic (India)' : 'International';
            $consCat = $this->cpIsDomestic($consignee) ? 'Domestic (India)' : 'International';
            throw ValidationException::withMessages([
                'counterparties' => "Customer and Consignee must be in the same category. Customer is {$custCat} but Consignee is {$consCat}.",
            ]);
        }
    }

    private function resolveCounterparties(CtcContract $c): array
    {
        $cps = is_array($c->counterparties) ? $c->counterparties : [];
        return array_map(function ($cp) use ($c) {
            $type = strtolower((string) ($cp['source_type'] ?? ''));
            $id   = $cp['source_id'] ?? null;
            $dbId = $cp['source_db_id'] ?? null;
            if ($type === '') return $cp;
            if (($id === null || $id === '') && ($dbId === null || $dbId === '')) return $cp;
            $live = $this->liveParty($type, $id, (int) $c->client_id, $dbId, $c->branch_id);
            return $live ? array_merge($cp, $live) : $cp;
        }, $cps);
    }

    private function resolvePartyRow($q, $id, string $codeCol, $branchId = null)
    {
        if (is_numeric($id)) return (clone $q)->find($id);

        if ($branchId !== null) {
            $row = (clone $q)->where($codeCol, $id)->where('branch_id', $branchId)->first();
            if ($row) return $row;
        }
        $row = (clone $q)->where($codeCol, $id)->first();
        if ($row) return $row;
        return preg_match('/(\d+)\s*$/', (string) $id, $m) ? (clone $q)->find((int) $m[1]) : null;
    }

    private function partyByRef($q, $id, string $codeCol, $dbId = null, $branchId = null)
    {
        if ($dbId !== null && $dbId !== '' && (int) $dbId > 0) {
            $row = (clone $q)->find((int) $dbId);
            if ($row) return $row;
        }
        return $this->resolvePartyRow($q, $id, $codeCol, $branchId);
    }

    private function liveParty(string $type, $id, int $clientId, $dbId = null, $branchId = null): ?array
    {
        if ($type === 'buyer' || $type === 'customer') {
            $q = \App\Models\Customer::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->partyByRef($q, $id, 'customer_code', $dbId, $branchId);
            if (!$row) return null;
            $a = $row->primaryAddress;
            return [
                'name'         => (string) $row->company_name,
                'country'      => (string) ($a?->country ?? ''),
                'phone'        => (string) ($a?->cp_contact ?? ''),
                'email'        => (string) ($a?->cp_email ?? $row->primary_email ?? ''),
                'source_db_id' => (int) $row->id,
            ];
        }
        if ($type === 'consignee') {
            $q = \App\Models\Consignee::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->partyByRef($q, $id, 'consignee_code', $dbId, $branchId);
            if (!$row) return null;
            $a = $row->primaryAddress;
            return [
                'name'         => (string) $row->company_name,
                'country'      => (string) ($a?->country ?? ''),
                'phone'        => (string) ($a?->cp_contact ?? ''),
                'email'        => (string) ($a?->cp_email ?? $row->primary_email ?? ''),
                'source_db_id' => (int) $row->id,
            ];
        }
        if ($type === 'supplier' || $type === 'vendor') {
            $q = \App\Models\Vendor::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->partyByRef($q, $id, 'vendor_code', $dbId, $branchId);
            if (!$row) return null;
            $a = $row->primaryAddress;
            return [
                'name'         => (string) $row->company_name,
                'country'      => (string) ($a?->city ?? ''),
                'phone'        => (string) ($a?->contact_no ?? ''),
                'email'        => (string) ($a?->email ?? $row->primary_email ?? ''),
                'source_db_id' => (int) $row->id,
            ];
        }
        return null;
    }

    private function livePartyModel(string $type, $id, int $clientId, $dbId = null, $branchId = null): array
    {
        $type = strtolower($type);
        if ($type === 'buyer' || $type === 'customer') {
            $q = \App\Models\Customer::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->partyByRef($q, $id, 'customer_code', $dbId, $branchId);
            return $row ? [$row, 'Customer'] : [null, ''];
        }
        if ($type === 'consignee') {
            $q = \App\Models\Consignee::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->partyByRef($q, $id, 'consignee_code', $dbId, $branchId);
            return $row ? [$row, 'Consignee'] : [null, ''];
        }
        if ($type === 'supplier' || $type === 'vendor') {
            $q = \App\Models\Vendor::where('client_id', $clientId)->with('primaryAddress');
            $row = $this->partyByRef($q, $id, 'vendor_code', $dbId, $branchId);
            return $row ? [$row, 'Vendor'] : [null, ''];
        }
        return [null, ''];
    }

    private function resolvePartyTokens(string $html, CtcContract $row): string
    {
        foreach ((is_array($row->counterparties) ? $row->counterparties : []) as $cp) {
            $type = (string) ($cp['source_type'] ?? '');
            $id   = $cp['source_id'] ?? null;
            $dbId = $cp['source_db_id'] ?? null;
            if ($type === '') continue;
            if (($id === null || $id === '') && ($dbId === null || $dbId === '')) continue;
            [$model, $modelName] = $this->livePartyModel($type, $id, (int) $row->client_id, $dbId, $row->branch_id);
            if ($model) $html = ClmSignatureController::replacePartyNamespaceTokens($html, $model, $modelName);
        }
        return $html;
    }

    private function resolveOrgTokens(string $html, CtcContract $row): string
    {
        foreach ($this->orgBranchTokens($row) as $tok => $val) {
            $html = preg_replace('/\{\{\s*' . $tok . '\s*\}\}/i', e((string) $val), $html);
        }
        return $html;
    }

    private function previewContent(CtcContract $row): string
    {
        $html = (string) ($row->content ?? '');
        if ($html === '') return '';
        $html = $this->resolvePartyTokens($this->resolveOrgTokens($html, $row), $row);
        $html = preg_replace('/\{\{\s*(?!signature\s*\}\})[^{}]*\}\}/i', '', $html);
        return $html;
    }

    private function cpSignatureCounts(CtcContract $c): array
    {
        $recs  = is_array($c->signing_recipients) ? $c->signing_recipients : [];
        $cps   = is_array($c->counterparties) ? $c->counterparties : [];
        $total = count($recs) ?: count($cps);
        $signed = 0;
        foreach ($recs as $r) {
            if (is_array($r) && !empty($r['signed']) && empty($r['declined'])) $signed++;
        }
        return ['signed' => $signed, 'total' => $total, 'sent' => count($recs) > 0];
    }

    private function shapeList(CtcContract $c): array
    {
        $approval = $c->approval_status === 'clarification' ? 'pending' : ($c->approval_status ?: 'pending');
        $sig = $this->cpSignatureCounts($c);
        return [
            'id'           => $c->code,
            'dbId'         => $c->id,
            'title'        => $c->title,
            'cp'           => $this->cpNamesFromStored($c, false) ?: ['—'],
            'cpLabeled'    => $this->cpNamesFromStored($c, true) ?: ['—'],
            'cpSigned'    => $sig['signed'],
            'cpTotal'      => $sig['total'],
            'cpSent'       => $sig['sent'],
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

    private function approvalProgress(CtcContract $c): array
    {
        $approvers = array_values($c->approvers ?? []);
        $total     = count($approvers);
        $approved  = collect($approvers)->filter(fn($a) => (($a['status'] ?? 'pending')) === 'approved')->count();
        return [$approved, $total];
    }

    private function shapeSent(CtcContract $c): array
    {
        $statusMap = ['approved' => 'approved', 'rejected' => 'rejected', 'clarification' => 'clarify', 'pending' => 'pending'];
        $approval  = $c->approval_status === 'clarification' ? 'pending' : ($c->approval_status ?: 'pending');
        [$approvedCount, $approverCount] = $this->approvalProgress($c);
        $sig = $this->cpSignatureCounts($c);
        return [
            'id'        => $c->code,
            'dbId'      => $c->id,
            'title'     => $c->title,
            'cp'        => $this->cpNamesFromStored($c, false) ?: ['—'],
            'cpLabeled' => $this->cpNamesFromStored($c, true) ?: ['—'],
            'cpSigned' => $sig['signed'],
            'cpTotal'   => $sig['total'],
            'cpSent'    => $sig['sent'],
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

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $branchFilter = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        $rows = CtcContract::where('client_id', $user->client_id)
            ->when($branchFilter, fn($q) => $q->where('branch_id', $branchFilter))
            ->orderByDesc('id')->get()
            ->map(fn($c) => $this->shapeList($c));
        return response()->json(['status' => true, 'data' => $rows]);
    }

    public function sentIndex(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $rows = CtcContract::where('client_id', $user->client_id)
            ->where('created_by', $user->id)
            ->orderByDesc('id')->get()
            ->map(fn($c) => $this->shapeSent($c));
        return response()->json(['status' => true, 'data' => $rows]);
    }

    public function toApproveIndex(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $email = strtolower((string) $user->email);
        $rows = CtcContract::where('client_id', $user->client_id)
            ->where(function ($w) use ($email) {
                $w->whereJsonContains('approver_emails', $email)
                    ->orWhere('primary_approver_email', $email);
            })
            ->orderByDesc('id')->get()
            ->flatMap(fn($c) => $this->approvalRoundsShaped($c, $user->name ?? '', $user->email ?? ''))
            ->unique('id')
            ->values();
        return response()->json(['status' => true, 'data' => $rows->values()]);
    }

    private function resolveOrgBranch(CtcContract $c): ?\App\Models\Branch
    {
        $orgName = trim((string) ($c->org_name ?? ''));
        $branch = $orgName !== ''
            ? \App\Models\Branch::where('client_id', $c->client_id)->where('name', $orgName)->first()
            : null;
        return $branch ?: ($c->branch_id ? \App\Models\Branch::find($c->branch_id) : null);
    }

    private function branchAddress(?\App\Models\Branch $b): string
    {
        if (!$b) return '';
        return trim(implode(', ', array_filter([
            trim((string) $b->address),
            trim((string) $b->city),
            trim((string) $b->state),
            trim(trim((string) $b->pincode) . ' ' . trim((string) $b->country)),
        ], fn($v) => $v !== '')), ', ');
    }

    private function orgBranchTokens(CtcContract $c): array
    {
        $b = $this->resolveOrgBranch($c);
        return [
            'company_name' => $c->org_name ?: ($b->name ?? ''),
            'company_no'   => $b->cin ?? '',
            'email'        => $b->email ?? '',
            'contact_no'   => $b->phone ?? '',
            'address'      => $this->branchAddress($b),
        ];
    }

    private function orgSignatureUrl(CtcContract $c): ?string
    {
        return $this->resolveOrgBranch($c)?->signature_url;
    }

    private function orgSignatureDataUri(CtcContract $c): ?string
    {
        $branch = $this->resolveOrgBranch($c);
        $path = $branch?->signature_path;
        if (!$path) return null;
        if (preg_match('#/storage/(.+)$#', (string) $path, $m)) $path = $m[1];
        try {
            if (!Storage::disk('public')->exists($path)) return null;
            $data = base64_encode(Storage::disk('public')->get($path));
            $ext  = strtolower(pathinfo($path, PATHINFO_EXTENSION) ?: 'png');
            $mime = in_array($ext, ['jpg', 'jpeg']) ? 'image/jpeg' : ($ext === 'webp' ? 'image/webp' : 'image/png');
            return "data:$mime;base64,$data";
        } catch (\Throwable $e) {
            return null;
        }
    }

    public function contactPersons(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $type = strtolower((string) $request->query('type'));
        $id   = $request->query('id');
        if ($id === null || $id === '') return response()->json(['status' => true, 'data' => []]);

        if ($type === 'buyer' || $type === 'customer') {
            $row = $this->resolvePartyRow(\App\Models\Customer::where('client_id', $user->client_id)->with('addresses'), $id, 'customer_code', $user->branch_id);
            return response()->json(['status' => true, 'data' => $this->mapCpAddresses($row)]);
        }
        if ($type === 'consignee') {
            $row = $this->resolvePartyRow(\App\Models\Consignee::where('client_id', $user->client_id)->with('addresses'), $id, 'consignee_code', $user->branch_id);
            return response()->json(['status' => true, 'data' => $this->mapCpAddresses($row)]);
        }
        if ($type === 'supplier' || $type === 'vendor') {
            $q = \App\Models\Vendor::where('client_id', $user->client_id)->with('addresses');
            $row = $this->resolvePartyRow($q, $id, 'vendor_code', $user->branch_id);
            if (!$row) return response()->json(['status' => true, 'data' => []]);
            $contacts = collect($row->addresses ?? [])->map(fn($a) => [
                'name'        => $a->contact_name,
                'email'       => $a->email,
                'designation' => $a->designation,
                'phone'       => $a->contact_no,
                'is_primary'  => (bool) $a->is_primary,
            ])->filter(fn($c) => $c['name'] || $c['email'])->values()->all();
            return response()->json(['status' => true, 'data' => $contacts]);
        }
        return response()->json(['status' => true, 'data' => []]);
    }

    private function mapCpAddresses($row): array
    {
        if (!$row) return [];
        return collect($row->addresses ?? [])->map(fn($a) => [
            'name'        => $a->cp_name,
            'email'       => $a->cp_email,
            'designation' => $a->cp_designation,
            'phone'       => $a->cp_contact,
            'is_primary'  => (bool) $a->is_primary,
        ])->filter(fn($c) => $c['name'] || $c['email'])->values()->all();
    }

    public function show(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $row->org_signature_url = $this->orgSignatureUrl($row);
        $row->signed_document_url = $this->signedDocumentUrl($row);
        $row->counterparties = $this->resolveCounterparties($row);
        $row->content_preview = $this->previewContent($row);
        $row->versions       = $this->istEntries($row->versions ?? []);
        $row->clarifications = $this->istEntries($row->clarifications ?? []);
        $row->approvers      = $this->istEntries($row->approvers ?? []);
        return response()->json(['status' => true, 'data' => $row]);
    }

    public function placeholderValues(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        [$model, $modelName] = $this->livePartyModel((string) $request->query('type', ''), $request->query('id'), (int) $user->client_id, $request->query('db_id'), $user->branch_id);
        if (!$model) return response()->json(['status' => true, 'data' => []]);

        $addr   = $model->primaryAddress;
        $vendor = $modelName === 'Vendor';
        $scalar = static fn($v) => $v === null ? '' : (is_object($v) ? (string) ($v->name ?? '') : (string) $v);
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

    private function signedDocumentUrl(CtcContract $c): ?string
    {
        if (!$c->signature_request_id) return null;
        $sr = \App\Models\ClmSignatureRequest::find($c->signature_request_id);
        $paths = is_array($sr?->signed_document_paths) ? $sr->signed_document_paths : [];
        $first = $paths[0] ?? null;
        if (!is_array($first)) return null;
        return $first['file_url'] ?? $first['url'] ?? (isset($first['path']) ? file_url($first['path']) : null);
    }

    public function approverCandidates(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $branchFilter = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);

        $query = User::where('client_id', $user->client_id)
            ->where('status', 'active')
            ->whereIn('user_type', ['branch_user', 'employee'])
            ->with('branch:id,name');

        if ($branchFilter) {
            $query->where('branch_id', $branchFilter);
        }

        $candidates = $query->get(['id', 'name', 'email', 'user_type', 'client_id', 'branch_id']);

        $clmUserIds = \App\Models\Permission::whereIn('user_id', $candidates->pluck('id'))
            ->where('can_view', true)
            ->whereHas('module', fn($m) => $m->where('slug', 'like', 'clm.%'))
            ->pluck('user_id')->unique()->flip();

        $employees = \App\Models\Employee::whereIn('user_id', $candidates->pluck('id'))
            ->with(['designation:id,name', 'department:id,name'])
            ->get()->keyBy('user_id');

        $order = ['branch_user' => 0, 'employee' => 1];
        $rows = $candidates
            ->filter(fn($u) => $u->user_type === 'branch_user' || $clmUserIds->has($u->id))
            ->sortBy(fn($u) => [$order[$u->user_type] ?? 9, strtolower($u->name ?? '')])
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

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (!$user->client_id) return response()->json(['status' => false, 'message' => 'No tenant context'], 403);

        $data = $request->validate([
            'title'              => 'required|string|max:255',
            'agreement_type'     => 'nullable|string|max:255',
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
            'page_config'        => 'nullable|array',
            'footer_config'      => 'nullable|array',
            'approvers'          => 'nullable|array',
            'days_to_approve'    => 'nullable|integer',
            'reminder_days'      => 'nullable|integer',
        ]);

        $this->assertCounterpartyCategories($data['counterparties'] ?? []);

        $approvers = collect($data['approvers'] ?? [])->map(fn($a) => [
            'name'      => (string) ($a['name'] ?? ''),
            'email'     => strtolower((string) ($a['email'] ?? '')),
            'role'      => (string) ($a['role'] ?? ''),
            'mandatory' => (bool) ($a['mandatory'] ?? false),
            'status'    => 'pending',
            'acted_at'  => null,
        ])->values();
        $primary = $approvers->first();

        $row = DB::transaction(function () use ($user, $data, $approvers, $primary) {
            DB::table('clients')->where('id', $user->client_id)->lockForUpdate()->first();
            $seq  = CtcContract::withTrashed()
                ->where('client_id', $user->client_id)
                ->when($user->branch_id, fn($q) => $q->where('branch_id', $user->branch_id), fn($q) => $q->whereNull('branch_id'))
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
                'page_config'        => $data['page_config'] ?? null,
                'footer_config'      => $data['footer_config'] ?? null,
                'approvers'          => $approvers->all(),
                'approver_emails'    => $approvers->pluck('email')->filter()->values()->all(),
                'clarifications'     => [],
                'versions'           => $v1,
                'stage'              => 2,
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
        $this->warmApproverPreview((int) $row->id);
        return response()->json(['status' => true, 'data' => $this->shapeList($row), 'code' => $row->code], 201);
    }

    public function update(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'title'          => 'sometimes|string|max:255',
            'agreement_type' => 'nullable|string|max:255',
            'content'        => 'nullable|string',
            'header_config'  => 'nullable|array',
            'page_config'    => 'nullable|array',
            'footer_config'  => 'nullable|array',
            'counterparties' => 'nullable|array',
            'eff_date'       => 'nullable|date',
            'end_date'       => 'nullable|date',
        ]);
        if (array_key_exists('counterparties', $data)) {
            $this->assertCounterpartyCategories($data['counterparties'] ?? []);
        }
        $row->update($data);
        $this->warmApproverPreview((int) $row->id);
        return response()->json(['status' => true, 'data' => $this->shapeList($row->fresh())]);
    }

    public function destroy(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $row->delete();
        return response()->json(['status' => true]);
    }

    public function approve(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $email     = strtolower((string) $user->email);
        $approvers = array_values($row->approvers ?? []);

        if (empty($approvers)) {
            $row->approval_status = 'approved';
            $row->rejection_reason = null;
            $this->pushVersion($row, 'Approved by ' . ($user->name ?? 'approver'), 'Approved', $user->name ?? '');
            $row->save();
            $this->broadcastApproval($row);
            return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
        }

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
        $approved = collect($approvers)->filter(fn($a) => ($a['status'] ?? 'pending') === 'approved')->count();

        $derived = $this->deriveApprovalStatus($row);

        if ($approved >= $total && $derived === 'approved') {
            $row->rejection_reason = null;
            $this->pushVersion($row, 'Approved by all ' . $total . ' approver' . ($total > 1 ? 's' : ''), 'Approved', $user->name ?? '');
        } else {
            $note = ($user->name ?? 'Approver') . ' approved (' . $approved . ' of ' . $total . ')'
                . ($derived === 'clarification'
                    ? ' — awaiting a response to an open clarification'
                    : ' — awaiting remaining approvers');
            $this->pushVersion($row, $note, 'Approving', $user->name ?? '');
        }
        $row->approval_status = $derived;
        $row->save();
        $this->broadcastApproval($row);
        return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
    }

    public function reject(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        if (!$this->isApprover($row, $user)) {
            return response()->json(['status' => false, 'message' => 'You are not an approver for this agreement.'], 403);
        }
        $data = $request->validate(['reason' => 'required|string|max:1000']);

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
        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        if (!$this->isApprover($row, $user)) {
            return response()->json(['status' => false, 'message' => 'You are not an approver for this agreement.'], 403);
        }
        $data = $request->validate(['query' => 'required|string|max:2000']);
        $thread = $row->clarifications ?? [];
        $thread[] = [
            'query'    => $data['query'],
            'by'       => $user->name ?: 'Approver',
            'by_email' => strtolower((string) $user->email),
            'date'     => now()->format('d M Y H:i'),
            'response' => '',
            'resolved' => false,
        ];
        $row->clarifications = $thread;
        $row->approval_status = $this->deriveApprovalStatus($row);
        $row->save();
        $this->broadcastApproval($row->fresh());
        return response()->json(['status' => true, 'data' => $this->shapeApprove($row->fresh(), $user->name ?? '')]);
    }

    private function deriveApprovalStatus(CtcContract $row): string
    {
        if (($row->approval_status ?? '') === 'rejected') return 'rejected';

        $approvers = array_values($row->approvers ?? []);
        foreach ($approvers as $a) {
            if (($a['status'] ?? 'pending') === 'rejected') return 'rejected';
        }

        $open = collect($row->clarifications ?? [])
            ->contains(fn($c) => trim((string) ($c['response'] ?? '')) === '');
        if ($open) return 'clarification';

        if (!empty($approvers)) {
            $approved = collect($approvers)->filter(fn($a) => ($a['status'] ?? 'pending') === 'approved')->count();
            if ($approved >= count($approvers)) return 'approved';
        }

        return 'pending';
    }

    public function respond(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        $data = $request->validate(['response' => 'required|string|max:2000']);
        $thread = $row->clarifications ?? [];
        $answeredAt = now()->format('d M Y H:i');
        foreach ($thread as $i => $entry) {
            if (trim((string) ($entry['response'] ?? '')) !== '') continue;
            $thread[$i]['response'] = $data['response'];
            $thread[$i]['response_date'] = $answeredAt;
        }
        $row->clarifications = $thread;
        $row->approval_status = $this->deriveApprovalStatus($row);
        $row->save();
        $this->broadcastApproval($row->fresh());
        return response()->json(['status' => true, 'data' => $this->shapeSent($row->fresh())]);
    }

    public function resubmit(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $data = $request->validate([
            'content'        => 'nullable|string',
            'title'          => 'sometimes|string|max:255',
            'agreement_type' => 'nullable|string|max:255',
            'header_config'  => 'nullable|array',
            'page_config'    => 'nullable|array',
            'footer_config'  => 'nullable|array',
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

        if (array_key_exists('counterparties', $data)) {
            $this->assertCounterpartyCategories($data['counterparties'] ?? []);
        }

        if (array_key_exists('content', $data))         $row->content = $data['content'];
        if (array_key_exists('title', $data))           $row->title = $data['title'];
        if (array_key_exists('agreement_type', $data))  $row->agreement_type = $data['agreement_type'];
        if (array_key_exists('header_config', $data))   $row->header_config = $data['header_config'];
        if (array_key_exists('page_config', $data))     $row->page_config   = $data['page_config'];
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

        $wasDeclined = collect($row->signing_recipients ?? [])->contains(fn($r) => !empty($r['declined']));

        if (!empty($data['approvers'])) {
            $approvers = collect($data['approvers'])->map(fn($a) => [
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
        $this->warmApproverPreview((int) $row->id);
        return response()->json(['status' => true, 'data' => $row->fresh()]);
    }

    public function sendForSigning(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
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

        $recipients = collect($data['recipients'])->map(fn($r) => [
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

    public function recordSignature(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
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
            foreach ($recipients as &$r) {
                if (empty($r['signed'])) {
                    $r['signed'] = true;
                    $r['signed_at'] = $stamp;
                }
            }
            unset($r);
        } elseif (array_key_exists('index', $data) && $data['index'] !== null && isset($recipients[$data['index']])) {
            $recipients[$data['index']]['signed'] = true;
            $recipients[$data['index']]['signed_at'] = $stamp;
        } elseif (!empty($data['email'])) {
            $email = strtolower($data['email']);
            foreach ($recipients as &$r) {
                if (($r['email'] ?? '') === $email) {
                    $r['signed'] = true;
                    $r['signed_at'] = $stamp;
                }
            }
            unset($r);
        } else {
            return response()->json(['status' => false, 'message' => 'Specify which recipient signed.'], 422);
        }

        $row->signing_recipients = $recipients;
        $allSigned = collect($recipients)->every(fn($r) => !empty($r['signed']));
        if ($allSigned) {
            $row->cp_signed_date = now();
            $this->pushVersion($row, 'Agreement signed by all parties', 'Signed', $user->name ?? '');
        }
        $row->save();

        return response()->json(['status' => true, 'data' => $row->fresh(), 'allSigned' => $allSigned]);
    }

    public function moveToRepository(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $recipients = array_values($row->signing_recipients ?? []);
        $allSigned  = count($recipients) > 0 && collect($recipients)->every(fn($r) => !empty($r['signed']));
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

    public function versions(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
        return response()->json(['status' => true, 'data' => $this->istEntries($row->versions ?? [])]);
    }

    public function downloadVersion(Request $request, int $id, int $v)
    {
        @ini_set('memory_limit', '1024M');
        @set_time_limit(300);

        $user = $request->user();
        if (!$user) abort(401);
        $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);

        $versions = array_values($row->versions ?? []);
        $entry = collect($versions)->firstWhere('v', $v);
        if (!$entry) abort(404);

        $html = trim((string) ($entry['content'] ?? $row->content));
        if ($html === '') $html = '<p><em>No content saved for this version.</em></p>';
        $processedHtml = $this->normaliseEditorHtml($html);

        $approved = $row->approval_status === 'approved' || (int) $row->stage >= 3;
        $sigUri = $approved ? $this->orgSignatureDataUri($row) : null;
        $sigHtml = $sigUri
            ? '<img src="' . $sigUri . '" alt="Authorised Signatory" style="display:block;max-height:80px;max-width:210px;object-fit:contain;margin:8px 0 6px;" />'
            : '';
        $processedHtml = preg_replace('/\{\{\s*signature\s*\}\}/i', $sigHtml, $processedHtml);

        foreach ($this->orgBranchTokens($row) as $tok => $val) {
            $processedHtml = preg_replace('/\{\{\s*' . $tok . '\s*\}\}/i', e((string) $val), $processedHtml);
        }

        $processedHtml = $this->resolvePartyTokens($processedHtml, $row);
        $processedHtml = preg_replace('/\{\{[^{}]*\}\}/', '', $processedHtml);

        $headerConfig = is_array($row->header_config) ? $row->header_config : [];
        $footerConfig = is_array($row->footer_config) ? $row->footer_config : [];
        $client = \App\Models\Client::find($row->client_id);

        $urlPath = (isset($headerConfig['logo_url']) && preg_match('#/storage/(.+)$#', (string) $headerConfig['logo_url'], $m)) ? $m[1] : null;
        $headerLogoBase64 = '';
        foreach (array_filter([$headerConfig['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            try {
                if (Storage::disk('public')->exists($path)) {
                    $headerLogoBase64 = base64_encode(Storage::disk('public')->get($path));
                    break;
                }
            } catch (\Throwable $e) {
            }
        }

        $row->title = ($row->title ?: 'Agreement') . ' — v' . $v;

        if (strtolower((string) $request->query('format')) === 'docx') {
            return $this->renderVersionDocx($processedHtml, $row->title, ($row->code ?: 'CTC') . '-v' . $v);
        }

        $fingerprint = sha1(implode("\0", [
            $processedHtml,
            json_encode($headerConfig),
            json_encode($footerConfig),
            $headerLogoBase64,
            (string) $row->title,
            (string) ($row->name ?? ''),
            (string) ($client?->org_name ?? ''),
        ]));

        $fileName  = ($row->code ?: 'CTC') . '-v' . $v . '.pdf';
        $cacheDir  = 'ctc-version-pdf/' . $row->id;
        $cachePath = $cacheDir . '/v' . $v . '-' . $fingerprint . '.pdf';
        $disk = Storage::disk('local');

        if ($disk->exists($cachePath)) {
            return response()->download($disk->path($cachePath), $fileName, ['Content-Type' => 'application/pdf']);
        }

        $processedHtml = \App\Support\PdfHtml::repairTableMarkup($processedHtml);
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

        $bytes = $pdf->output();

        try {
            foreach ($disk->files($cacheDir) as $old) {
                if (str_starts_with(basename($old), 'v' . $v . '-')) $disk->delete($old);
            }
            $disk->put($cachePath, $bytes);
        } catch (\Throwable $e) {
            report($e);
        }

        return response()->streamDownload(
            fn() => print($bytes),
            $fileName,
            ['Content-Type' => 'application/pdf']
        );
    }

    public function previewLive(Request $request)
    {
        @ini_set('memory_limit', '1024M');
        /* 300, not 120: a 300-page table-heavy draft takes ~54s locally and
           longer on a busier server, and at 120 the request was killed - the
           panel then never showed the document at all. */
        @set_time_limit(300);

        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'id'            => 'nullable|integer',
            'content'       => 'nullable|string',
            'page_config'   => 'nullable|array',
            'header_config' => 'nullable|array',
            'footer_config' => 'nullable|array',
            /* quick=1: render only the opening of a long draft (~0.9s instead of
               ~54s for 300 pages) so the panel shows something at once; the
               editor then asks for the full render and swaps it in. The reply
               says which it is in X-Preview-Partial. */
            'quick'         => 'nullable|boolean',
        ]);

        $row = null;
        if (!empty($data['id'])) {
            $row = CtcContract::where('client_id', $user->client_id)->find($data['id']);
        }

        $html = trim((string) ($data['content'] ?? ($row->content ?? '')));
        if ($html === '') {
            $html = '<p><em>Nothing to preview yet — start typing in the editor.</em></p>';
        }
        $processedHtml = $this->normaliseEditorHtml($html);

        $processedHtml = preg_replace('/\{\{\s*signature\s*\}\}/i', '', $processedHtml);

        if ($row) {
            foreach ($this->orgBranchTokens($row) as $tok => $val) {
                $processedHtml = preg_replace('/\{\{\s*' . $tok . '\s*\}\}/i', e((string) $val), $processedHtml);
            }
            $processedHtml = $this->resolvePartyTokens($processedHtml, $row);
        }
        $processedHtml = preg_replace('/\{\{[^{}]*\}\}/', '', $processedHtml);

        $headerConfig = $data['header_config'] ?? (is_array($row->header_config ?? null) ? $row->header_config : []);
        $footerConfig = $data['footer_config'] ?? (is_array($row->footer_config ?? null) ? $row->footer_config : []);
        $pageConfig   = $data['page_config']   ?? (is_array($row->page_config   ?? null) ? $row->page_config   : []);
        $client = \App\Models\Client::find($user->client_id);

        $urlPath = (isset($headerConfig['logo_url']) && preg_match('#/storage/(.+)$#', (string) $headerConfig['logo_url'], $m)) ? $m[1] : null;
        $headerLogoBase64 = '';
        foreach (array_filter([$headerConfig['logo_path'] ?? null, $urlPath, $client?->logo]) as $path) {
            try {
                if (Storage::disk('public')->exists($path)) {
                    $headerLogoBase64 = base64_encode(Storage::disk('public')->get($path));
                    break;
                }
            } catch (\Throwable $e) {
            }
        }

        $document = $row ?: new CtcContract(['title' => 'Agreement (draft preview)']);

        $partial = false;
        if (!empty($data['quick'])) {
            $head = $this->previewHead($processedHtml, 45000);
            if ($head !== null) {
                $processedHtml = $head;
                $partial = true;
            }
        }

        $cacheKey = 'clm:ctcpreview:' . sha1(implode('|', [
            (int) $user->client_id,
            (string) ($row->code ?? 'DRAFT'),
            md5($processedHtml),
            md5(json_encode($headerConfig)),
            md5(json_encode($footerConfig)),
            md5(json_encode($pageConfig)),
            md5((string) $headerLogoBase64),
            $partial ? 'head' : 'full',
            now()->format('Y-m-d'),
        ]));
        $headers = [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="ctc-preview.pdf"',
            'X-Preview-Partial'   => $partial ? '1' : '0',
        ];
        try {
            if ($hit = \Illuminate\Support\Facades\Cache::get($cacheKey)) {
                return response(base64_decode($hit), 200, $headers);
            }
        } catch (\Throwable $e) {
        }

        $processedHtml = \App\Support\PdfHtml::repairTableMarkup($processedHtml);
        $pdf = \Barryvdh\DomPDF\Facade\Pdf::loadView('pdf.clm-signature-document', [
            'document'         => $document,
            'party'            => null,
            'modelName'        => '',
            'processedHtml'    => $processedHtml,
            'generatedDate'    => now()->format('d/m/Y'),
            'requestId'        => $row->code ?? 'DRAFT',
            'signers'          => [],
            'client'           => $client,
            'headerConfig'     => $headerConfig,
            'footerConfig'     => $footerConfig,
            'pageConfig'       => $pageConfig,
            'headerLogoBase64' => $headerLogoBase64,
        ])->setPaper('a4')->setOption('isPhpEnabled', true);

        $bytes = $pdf->output();
        if (strlen($bytes) <= 5 * 1024 * 1024) {
            try {
                // 60 min, was 10: reopening an unchanged draft within the hour
                // skips the render entirely (same content = same key).
                \Illuminate\Support\Facades\Cache::put($cacheKey, base64_encode($bytes), now()->addMinutes(60));
            } catch (\Throwable $e) {
            }
        }

        return response($bytes, 200, $headers);
    }

    /**
     * The opening of a long draft for the quick preview: whole top-level blocks
     * (paragraphs, headings, lists, tables) up to roughly $budget bytes, never a
     * cut through the middle of a table or list. Returns null when the draft is
     * short enough that a quick pass would not save anything.
     */
    private function previewHead(string $html, int $budget): ?string
    {
        if (strlen($html) <= (int) ($budget * 1.5)) return null;
        try {
            $doc = new \DOMDocument();
            $prev = libxml_use_internal_errors(true);
            $doc->loadHTML('<?xml encoding="UTF-8"><html><body>' . $html . '</body></html>', LIBXML_NOERROR | LIBXML_NOWARNING);
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
            $body = $doc->getElementsByTagName('body')->item(0);
            if (!$body) return null;
            $out = '';
            foreach (iterator_to_array($body->childNodes) as $node) {
                $out .= $doc->saveHTML($node);
                if (strlen($out) >= $budget) break;
            }
            return trim($out) === '' ? null : $out;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function renderVersionDocx(string $html, string $title, string $baseName)
    {
        $phpWord = new \PhpOffice\PhpWord\PhpWord();
        $section = $phpWord->addSection();
        $section->addTitle(strip_tags($title), 1);

        $clean = preg_replace('/<img[^>]*src="data:[^"]*"[^>]*>/i', '', $html) ?? $html;
        $clean = preg_replace(
            '#<(br|hr|col|input|area|base|embed|link|meta|param|source|track|wbr)\b([^>]*?)/?>#i',
            '<$1$2/>',
            $clean
        ) ?? $clean;

        $before = count($section->getElements());
        $added  = false;
        try {
            \PhpOffice\PhpWord\Shared\Html::addHtml($section, $clean, false, false);
            $added = count($section->getElements()) > $before;
        } catch (\Throwable $e) {
            $added = false;
        }
        if (!$added) {
            foreach (preg_split('/<\/p>|<\/h[1-6]>|<\/tr>|<br\s*\/?>/i', $clean) ?: [] as $chunk) {
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

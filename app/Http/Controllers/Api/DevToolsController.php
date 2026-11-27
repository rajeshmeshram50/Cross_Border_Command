<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\P2p\PoRefundAdjustment;
use App\Models\P2p\PurchaseOrder;
use App\Models\Vendor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;

class DevToolsController extends Controller
{
    public function mailPreview(Request $request, string $template)
    {
        abort_unless(app()->environment('local'), 404);

        $views = [
            'employee-email-changed' => 'emails.employee-email-changed',
        ];

        abort_unless(isset($views[$template]), 404, 'Unknown template.');

        $mail = new \App\Mail\EmployeeEmailChangedMail(
            employeeName: (string) $request->query('name', 'Rahul Sharma'),
            oldEmail:     (string) $request->query('old', 'rahul.sharma@oldcompany.com'),
            newEmail:     (string) $request->query('new', 'rahul.sharma@newcompany.com'),
            variant:      $request->query('variant') === 'old' ? 'old' : 'new',
            profileUrl:   $request->query('profile') ?: null,
            branding:     array_filter([
                'brandName'    => $request->query('brand') ?: null,
                'supportEmail' => $request->query('support') ?: null,
            ]),
            branchName:   (string) $request->query('branch', 'Mumbai Central Warehouse'),
        );

        return response()
            ->view($views[$template], $mail->data() + $mail->branding)
            ->header('Content-Type', 'text/html; charset=utf-8');
    }

    private function guardDevTools(Request $request): void
    {
        $this->guardPermission($request);
        $key = $this->unlockKey($request);
        if (!Cache::get($key)) {
            abort(423, 'Dev Tools is locked — enter the developer password to continue.');
        }
        Cache::put($key, true, now()->addMinutes($this->idleMinutes()));
    }

    private function idleMinutes(): int
    {
        return max(1, (int) config('devtools.idle_minutes'));
    }

    private function guardPermission(Request $request): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        if (in_array($user->user_type, ['super_admin', 'client_admin'], true)) {
            return;
        }
        $moduleId = \App\Models\Module::where('slug', 'dev-tools')->value('id');
        $ok = $moduleId && \App\Models\Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)->where('can_view', true)->exists();
        if (!$ok) {
            abort(403, 'You do not have permission to view Dev Tools.');
        }
    }

    private function unlockKey(Request $request): string
    {
        $user = $request->user();
        $token = method_exists($user, 'currentAccessToken') ? $user->currentAccessToken() : null;
        return 'devtools:unlocked:' . $user->id . ':' . ($token->id ?? 'session');
    }

    private function passwordMatches(string $given): bool
    {
        if ($given === '') return false;

        $file = (string) config('devtools.password_file');
        if ($file !== '' && Storage::disk('local')->exists($file)) {
            $onDisk = trim((string) Storage::disk('local')->get($file));
            if ($onDisk !== '') return hash_equals($onDisk, $given);
        }

        $hash = (string) config('devtools.password_hash');
        if ($hash !== '') return Hash::check($given, $hash);

        $plain = (string) config('devtools.password');
        return $plain !== '' && hash_equals($plain, $given);
    }

    private function passwordConfigured(): bool
    {
        $file = (string) config('devtools.password_file');
        if ($file !== '' && Storage::disk('local')->exists($file)
            && trim((string) Storage::disk('local')->get($file)) !== '') {
            return true;
        }
        return filled(config('devtools.password_hash')) || filled(config('devtools.password'));
    }

    private function throttleKey(Request $request): string
    {
        return 'devtools:unlock:' . ($request->user()?->id ?? 'guest') . ':' . $request->ip();
    }

    public function lockState(Request $request): JsonResponse
    {
        $this->guardPermission($request);
        $seconds = RateLimiter::availableIn($this->throttleKey($request));
        $locked  = RateLimiter::tooManyAttempts($this->throttleKey($request), config('devtools.max_attempts'));

        return response()->json(['status' => true, 'data' => [
            'unlocked'         => (bool) Cache::get($this->unlockKey($request)),
            'locked_out'       => $locked,
            'retry_in_seconds' => $locked ? $seconds : 0,
            'retry_at'         => $locked ? now()->addSeconds($seconds)->toIso8601String() : null,
            'configured'       => $this->passwordConfigured(),
            'idle_minutes'     => $this->idleMinutes(),
        ]]);
    }

    public function unlock(Request $request): JsonResponse
    {
        $this->guardPermission($request);
        $request->validate(['password' => 'required|string|max:200']);

        $key     = $this->throttleKey($request);
        $max     = max(1, (int) config('devtools.max_attempts'));
        $lockout = max(1, (int) config('devtools.lockout_minutes'));

        if (RateLimiter::tooManyAttempts($key, $max)) {
            return $this->lockedOut($key);
        }

        if (!$this->passwordMatches((string) $request->input('password'))) {
            RateLimiter::hit($key, $lockout * 60);
            $left = $max - RateLimiter::attempts($key);
            if ($left <= 0) return $this->lockedOut($key);

            return response()->json([
                'status'  => false,
                'message' => 'That password is not right. ' . $left . ' attempt' . ($left === 1 ? '' : 's') . ' left.',
                'attempts_left' => $left,
            ], 422);
        }

        RateLimiter::clear($key);
        Cache::put($this->unlockKey($request), true, now()->addMinutes($this->idleMinutes()));

        return response()->json(['status' => true, 'data' => [
            'unlocked'     => true,
            'idle_minutes' => $this->idleMinutes(),
        ]]);
    }

    public function lock(Request $request): JsonResponse
    {
        $this->guardPermission($request);
        Cache::forget($this->unlockKey($request));
        return response()->json(['status' => true, 'data' => ['unlocked' => false]]);
    }

    private function lockedOut(string $key): JsonResponse
    {
        $seconds = RateLimiter::availableIn($key);
        return response()->json([
            'status'  => false,
            'message' => 'Too many wrong passwords.',
            'retry_in_seconds' => $seconds,
            'retry_at'         => now()->addSeconds($seconds)->toIso8601String(),
        ], 429);
    }

    public function profileDetail(Request $request, string $id): JsonResponse
    {
        $this->guardDevTools($request);

        $data = \Illuminate\Support\Facades\Cache::get(
            \App\Http\Middleware\ProfileRequest::cacheKey($id)
        );
        if (!$data) {
            return response()->json([
                'status'  => false,
                'message' => 'That capture has expired — re-run the request to inspect it.',
            ], 404);
        }

        return response()->json(['status' => true] + $data);
    }

    public function apiUsage(Request $request): JsonResponse
    {
        $this->guardDevTools($request);

        if (!app()->environment(['local', 'staging'])) {
            return response()->json(['status' => false, 'message' => 'Disabled outside local / staging.'], 403);
        }

        $path = (string) $request->query('path', '');
        if ($path === '') {
            return response()->json(['status' => false, 'message' => 'A ?path= is required.'], 422);
        }

        return response()->json(
            ['status' => true] + \App\Support\ApiUsageScanner::find($path)
        );
    }

    public function profileTargets(Request $request): JsonResponse
    {
        $this->guardDevTools($request);

        if (!app()->environment(['local', 'staging'])) {
            return response()->json(['status' => false, 'message' => 'Load Testing is disabled outside local / staging.'], 403);
        }

        $user     = $request->user();
        $clientId = $user->client_id ?: 1;
        $branchId = $request->integer('branch_id') ?: $user->branch_id;

        $modules = \App\Support\DevToolsProfileTargets::all($clientId, $branchId);
        foreach ($modules as &$m) {
            foreach ($m['pages'] as &$p) {
                $p['frontend'] = \App\Support\DevToolsProfileTargets::frontendInfo($p['component'] ?? null);
                $p['assets']   = \App\Support\DevToolsProfileTargets::assetGraph($p['component'] ?? null);
            }
            unset($p);
        }
        unset($m);

        return response()->json([
            'status'  => true,
            'modules' => $modules,
            'context' => ['client_id' => $clientId, 'branch_id' => $branchId],
        ]);
    }

    public function zoho(Request $request, string $type): JsonResponse
    {
        $this->guardDevTools($request);
        $user = $request->user();

        $clientId = $user->client_id ?: null;
        $scope = fn ($q) => $clientId ? $q->where('client_id', $clientId) : $q;

        $data = match ($type) {
            'items'          => $this->items($scope),
            'vendors'        => $this->vendors($scope),
            'purchase-orders'=> $this->purchaseOrders($scope),
            'vendor-credits' => $this->vendorCredits($scope),
            'bills'          => $this->bills($scope),
            'payments'       => $this->payments($scope),
            default          => null,
        };

        if ($data === null) {
            return response()->json(['status' => false, 'message' => 'Unknown Dev Tools type.'], 422);
        }

        return response()->json(['status' => true, 'data' => $data, 'count' => count($data)]);
    }

    private function items(callable $scope): array
    {
        return $scope(Product::query()->whereNotNull('zoho_item_id'))
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'product_code', 'name', 'status', 'zoho_item_id', 'updated_at'])
            ->map(fn ($p) => [
                'id'          => $p->id,
                'client_id'   => $p->client_id,
                'code'        => $p->product_code,
                'name'        => $p->name,
                'status'      => $p->status,
                'zoho_id'     => $p->zoho_item_id,
                'updated_at'  => optional($p->updated_at)->toDateTimeString(),
            ])->all();
    }

    private function vendors(callable $scope): array
    {
        return $scope(Vendor::query()->whereNotNull('zoho_contact_id'))
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'vendor_code', 'company_name', 'status', 'zoho_contact_id', 'updated_at'])
            ->map(fn ($v) => [
                'id'          => $v->id,
                'client_id'   => $v->client_id,
                'code'        => $v->vendor_code,
                'name'        => $v->company_name,
                'status'      => $v->status,
                'zoho_id'     => $v->zoho_contact_id,
                'updated_at'  => optional($v->updated_at)->toDateTimeString(),
            ])->all();
    }

    private function purchaseOrders(callable $scope): array
    {
        return $scope(PurchaseOrder::query()->whereNotNull('zoho_purchaseorder_id'))
            ->with('vendor:id,company_name')
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'code', 'vendor_id', 'zoho_purchaseorder_id', 'zoho_bill_id', 'zoho_bill_number', 'zoho_status', 'zoho_synced_at'])
            ->map(fn ($po) => [
                'id'           => $po->id,
                'client_id'    => $po->client_id,
                'code'         => $po->code,
                'supplier'     => $po->vendor?->company_name,
                'zoho_id'      => $po->zoho_purchaseorder_id,
                'bill_id'      => $po->zoho_bill_id,
                'bill_number'  => $po->zoho_bill_number,
                'zoho_status'  => $po->zoho_status,
                'synced_at'    => optional($po->zoho_synced_at)->toDateTimeString(),
                'pdf'          => null,
            ])->all();
    }

    private function vendorCredits(callable $scope): array
    {
        return $scope(PoRefundAdjustment::query()->whereNotNull('zoho_vendorcredit_id'))
            ->with('vendor:id,company_name')
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'code', 'vendor_id', 'zoho_vendorcredit_id', 'zoho_vendorcredit_number', 'zoho_applied_amount', 'zoho_synced_at'])
            ->map(fn ($dn) => [
                'id'             => $dn->id,
                'client_id'      => $dn->client_id,
                'code'           => $dn->code,
                'supplier'       => $dn->vendor?->company_name,
                'zoho_id'        => $dn->zoho_vendorcredit_id,
                'credit_number'  => $dn->zoho_vendorcredit_number,
                'applied_amount' => (float) $dn->zoho_applied_amount,
                'synced_at'      => optional($dn->zoho_synced_at)->toDateTimeString(),
            ])->all();
    }

    private function bills(callable $scope): array
    {
        return $scope(PurchaseOrder::query()->whereNotNull('zoho_bill_id'))
            ->with('vendor:id,company_name')
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'code', 'vendor_id', 'zoho_bill_id', 'zoho_bill_number', 'zoho_status', 'zoho_synced_at'])
            ->map(fn ($spi) => [
                'id'           => $spi->id,
                'client_id'    => $spi->client_id,
                'code'         => $spi->code,
                'invoice_no'   => null,
                'supplier'     => $spi->vendor?->company_name,
                'zoho_id'      => $spi->zoho_bill_id,
                'bill_number'  => $spi->zoho_bill_number,
                'zoho_status'  => $spi->zoho_status,
                'synced_at'    => optional($spi->zoho_synced_at)->toDateTimeString(),
                'pdf'          => null,
            ])->all();
    }

    private function payments(callable $scope): array
    {
        $po = $scope(\App\Models\P2p\PoPayment::query()->whereNotNull('zoho_payment_id'))
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'purchase_order_id', 'amount', 'bank_name', 'utr_cheque_number', 'utr_cheque_date', 'zoho_sync_status', 'zoho_payment_id', 'zoho_applied_amount']);
        $spi = collect();

        $poCodes  = PurchaseOrder::whereIn('id', $po->pluck('purchase_order_id')->filter()->unique())->pluck('code', 'id');
        $spiCodes = collect();

        $rows = [];
        foreach ($po as $p) {
            $rows[] = [
                'client_id' => $p->client_id,
                'against'   => 'PO',
                'source'    => $poCodes[$p->purchase_order_id] ?? ('PO#' . $p->purchase_order_id),
                'amount'    => (float) $p->amount,
                'applied'   => (float) $p->zoho_applied_amount,
                'bank'      => $p->bank_name,
                'ref'       => $p->utr_cheque_number,
                'date'      => optional($p->utr_cheque_date)->toDateString(),
                'status'    => $p->zoho_sync_status,
                'zoho_id'   => $p->zoho_payment_id,
            ];
        }
        foreach ($spi as $p) {
            $rows[] = [
                'client_id' => $p->client_id,
                'against'   => 'SPI',
                'source'    => $spiCodes[$p->supplier_purchase_invoice_id] ?? ('SPI#' . $p->supplier_purchase_invoice_id),
                'amount'    => (float) $p->amount,
                'applied'   => (float) $p->zoho_applied_amount,
                'bank'      => $p->bank_name,
                'ref'       => $p->utr_cheque_number,
                'date'      => optional($p->utr_cheque_date)->toDateString(),
                'status'    => $p->status,
                'zoho_id'   => $p->zoho_payment_id,
            ];
        }
        return $rows;
    }
}

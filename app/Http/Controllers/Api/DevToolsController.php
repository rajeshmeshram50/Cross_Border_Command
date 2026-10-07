<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DebitNote;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\SupplierPurchaseInvoice;
use App\Models\Vendor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;

/**
 * Dev Tools — a read-only inspector for the Zoho Books data we STORE in our DB
 * but never surface in the normal UI (the Zoho ids / sync state stamped on each
 * entity after a sync). Grouped like Zoho's own entities so an admin can see
 * exactly what we pushed: Items, Vendors, Purchase Orders, Vendor Credits, Bills.
 *
 * Admin-only (super_admin / client_admin). Tenant-scoped: a client_admin sees
 * only their own client's rows; a super_admin (no client_id) sees across all
 * clients. Only rows that actually carry a Zoho id are returned — i.e. the ones
 * that have a matching entry in Zoho Books.
 */
class DevToolsController extends Controller
{
    /**
     * Same gate zoho() uses. Extracted so a second Dev Tools endpoint cannot
     * drift from the first — a third copy is how one of them ends up open.
     */
    private function guardDevTools(Request $request): void
    {
        $this->guardPermission($request);
        /* The password is a second gate, not a replacement for the first: the
           page ships in the bundle and these endpoints answer on their own, so
           a check in the browser alone would gate nothing. */
        $key = $this->unlockKey($request);
        if (!Cache::get($key)) {
            abort(423, 'Dev Tools is locked — enter the developer password to continue.');
        }
        /* Slide the idle window forward. Using the module keeps it open; the
           countdown only runs while nothing is being asked for, so stepping
           away is what re-locks it, not the clock since you unlocked. */
        Cache::put($key, true, now()->addMinutes($this->idleMinutes()));
    }

    private function idleMinutes(): int
    {
        return max(1, (int) config('devtools.idle_minutes'));
    }

    /** Who may ask for the password at all. */
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

    /* Per access token, not per user: unlocking on your laptop must not unlock
       the session someone left open elsewhere. */
    private function unlockKey(Request $request): string
    {
        $user = $request->user();
        $token = method_exists($user, 'currentAccessToken') ? $user->currentAccessToken() : null;
        return 'devtools:unlocked:' . $user->id . ':' . ($token->id ?? 'session');
    }

    /**
     * Does this answer match? Three sources, most specific first: a file on
     * this server, a hash in config, then the plain password in config. The
     * file lets one machine differ without a code change; the hash keeps the
     * plaintext out of git. None set means nothing matches — a gate with no
     * password must not read as a gate that is off.
     */
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

    /** Whether anything at all can open the door — for the "not configured" notice. */
    private function passwordConfigured(): bool
    {
        $file = (string) config('devtools.password_file');
        if ($file !== '' && Storage::disk('local')->exists($file)
            && trim((string) Storage::disk('local')->get($file)) !== '') {
            return true;
        }
        return filled(config('devtools.password_hash')) || filled(config('devtools.password'));
    }

    /** Attempts are counted per user AND per IP, so neither alone is the way round it. */
    private function throttleKey(Request $request): string
    {
        return 'devtools:unlock:' . ($request->user()?->id ?? 'guest') . ':' . $request->ip();
    }

    /**
     * GET /api/dev-tools/lock-state
     *
     * Whether this session still needs the password, and how long any lockout
     * has left. Answers for anyone who may ask — being told "locked" reveals
     * nothing the menu item did not already.
     */
    public function lockState(Request $request): JsonResponse
    {
        $this->guardPermission($request);
        $seconds = RateLimiter::availableIn($this->throttleKey($request));
        $locked  = RateLimiter::tooManyAttempts($this->throttleKey($request), config('devtools.max_attempts'));

        return response()->json(['status' => true, 'data' => [
            'unlocked'         => (bool) Cache::get($this->unlockKey($request)),
            'locked_out'       => $locked,
            'retry_in_seconds' => $locked ? $seconds : 0,
            /* The instant the lockout ends, not a duration. A countdown that
               decrements its own number drifts — browsers throttle timers in a
               background tab — so the client ticks against this instead. */
            'retry_at'         => $locked ? now()->addSeconds($seconds)->toIso8601String() : null,
            'configured'       => $this->passwordConfigured(),
            'idle_minutes'     => $this->idleMinutes(),
        ]]);
    }

    /**
     * POST /api/dev-tools/unlock   { password }
     *
     * Three wrong answers and the door shuts for 30 minutes. The counter is
     * server-side: a client-side one resets with the page.
     */
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

        /* No password configured locks everyone out rather than letting
           everyone in. A wrong answer costs an attempt either way, so the
           response cannot be used to probe whether one is set. */
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

    /** POST /api/dev-tools/lock — hand the key back early. */
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
            // The screen counts it down; the message only has to say what happened.
            'message' => 'Too many wrong passwords.',
            'retry_in_seconds' => $seconds,
            'retry_at'         => now()->addSeconds($seconds)->toIso8601String(),
        ], 429);
    }

    /**
     * GET /api/dev-tools/profile/{id}
     *
     * The full statement list for one profiled request, keyed by the
     * X-Profile-Id header that request came back with. Kept out of the headers
     * because a page firing 20 queries produces far more text than a header can
     * hold — and out of the response body because the body has to stay identical
     * to a normal call for the timings to mean anything.
     */
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

    /**
     * GET /api/dev-tools/api-usage?path=/employees
     *
     * Every front-end call site for one endpoint, plus the controller action
     * that serves it. Timing tells you an endpoint is expensive; this tells you
     * what it would cost to change — an endpoint called from one screen and one
     * called from nine are the same number on a chart and opposite decisions.
     */
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

    /**
     * GET /api/dev-tools/profile-targets
     *
     * The module → page → requests map behind Load Testing, plus the weight of
     * each page's React component. The browser replays the requests itself with
     * X-Profile: 1 rather than having the server call itself, so the timings
     * include real network and auth cost instead of a loopback that skips both.
     */
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

    /** GET /api/dev-tools/zoho/{type} — one Zoho entity type per tab. */
    public function zoho(Request $request, string $type): JsonResponse
    {
        /* Was its own inline copy of the permission check, which is exactly the
           drift guardDevTools() was extracted to prevent: the copy never
           learned about the password, so this endpoint stayed open while every
           other one was locked. */
        $this->guardDevTools($request);
        $user = $request->user();

        // client_admin → own client only; super_admin (client_id null) → all clients.
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

    /** Products synced to Zoho as Items (carry zoho_item_id). */
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

    /** Vendors synced to Zoho as Contacts (carry zoho_contact_id). */
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

    /** Purchase Orders pushed to Zoho (carry zoho_purchaseorder_id). */
    private function purchaseOrders(callable $scope): array
    {
        return $scope(PurchaseOrder::query()->whereNotNull('zoho_purchaseorder_id'))
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'code', 'supplier_name', 'zoho_purchaseorder_id', 'zoho_bill_id', 'zoho_bill_number', 'zoho_status', 'zoho_synced_at', 'zoho_pdf_path'])
            ->map(fn ($po) => [
                'id'           => $po->id,
                'client_id'    => $po->client_id,
                'code'         => $po->code,
                'supplier'     => $po->supplier_name,
                'zoho_id'      => $po->zoho_purchaseorder_id,
                'bill_id'      => $po->zoho_bill_id,
                'bill_number'  => $po->zoho_bill_number,
                'zoho_status'  => $po->zoho_status,
                'synced_at'    => optional($po->zoho_synced_at)->toDateTimeString(),
                'pdf'          => $po->zoho_pdf_path,
            ])->all();
    }

    /** Debit Notes pushed to Zoho as Vendor Credits (carry zoho_vendorcredit_id). */
    private function vendorCredits(callable $scope): array
    {
        return $scope(DebitNote::query()->whereNotNull('zoho_vendorcredit_id'))
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'code', 'supplier_name', 'zoho_vendorcredit_id', 'zoho_vendorcredit_number', 'zoho_applied_amount', 'zoho_synced_at'])
            ->map(fn ($dn) => [
                'id'             => $dn->id,
                'client_id'      => $dn->client_id,
                'code'           => $dn->code,
                'supplier'       => $dn->supplier_name,
                'zoho_id'        => $dn->zoho_vendorcredit_id,
                'credit_number'  => $dn->zoho_vendorcredit_number,
                'applied_amount' => (float) $dn->zoho_applied_amount,
                'synced_at'      => optional($dn->zoho_synced_at)->toDateTimeString(),
            ])->all();
    }

    /** Supplier Purchase Invoices pushed to Zoho as Bills (carry zoho_bill_id). */
    private function bills(callable $scope): array
    {
        return $scope(SupplierPurchaseInvoice::query()->whereNotNull('zoho_bill_id'))
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'code', 'invoice_no', 'supplier_name', 'zoho_bill_id', 'zoho_bill_number', 'zoho_status', 'zoho_synced_at', 'zoho_pdf_path'])
            ->map(fn ($spi) => [
                'id'           => $spi->id,
                'client_id'    => $spi->client_id,
                'code'         => $spi->code,
                'invoice_no'   => $spi->invoice_no,
                'supplier'     => $spi->supplier_name,
                'zoho_id'      => $spi->zoho_bill_id,
                'bill_number'  => $spi->zoho_bill_number,
                'zoho_status'  => $spi->zoho_status,
                'synced_at'    => optional($spi->zoho_synced_at)->toDateTimeString(),
                'pdf'          => $spi->zoho_pdf_path,
            ])->all();
    }

    /**
     * Payments actually POSTED to Zoho Books as vendor "Payments Made" against a
     * bill — the po_payments / spi_payments rows that carry a zoho_payment_id.
     * Unified across both payment tables, tagged with the PO/SPI they settled.
     */
    private function payments(callable $scope): array
    {
        $po = $scope(\App\Models\PoPayment::query()->whereNotNull('zoho_payment_id'))
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'purchase_order_id', 'amount', 'bank_name', 'utr_cheque_number', 'utr_cheque_date', 'status', 'zoho_payment_id', 'zoho_applied_amount']);
        $spi = $scope(\App\Models\SpiPayment::query()->whereNotNull('zoho_payment_id'))
            ->latest('id')->limit(500)
            ->get(['id', 'client_id', 'supplier_purchase_invoice_id', 'amount', 'bank_name', 'utr_cheque_number', 'utr_cheque_date', 'status', 'zoho_payment_id', 'zoho_applied_amount']);

        $poCodes  = PurchaseOrder::whereIn('id', $po->pluck('purchase_order_id')->filter()->unique())->pluck('code', 'id');
        $spiCodes = SupplierPurchaseInvoice::whereIn('id', $spi->pluck('supplier_purchase_invoice_id')->filter()->unique())->pluck('code', 'id');

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
                'status'    => $p->status,
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

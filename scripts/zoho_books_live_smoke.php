<?php
/**
 * LIVE Zoho Books smoke test — creates a DUMMY vendor, a DUMMY bill, and a
 * DUMMY vendor credit in the real org so you can confirm the payloads land
 * correctly, then applies the credit to the bill. Leaves the records in place
 * (clearly named "ZZZ SMOKE TEST — DELETE") so you can eyeball them in Zoho.
 *
 * Requires ZOHO_BOOKS_REFRESH_TOKEN + ZOHO_BOOKS_ORG_ID in .env.
 * Run:  php artisan tinker scripts/zoho_books_live_smoke.php
 */

use App\Services\ZohoBooksService;

$books = app(ZohoBooksService::class);

if (!$books->isConfigured()) {
    echo "\n✗ Zoho Books is NOT configured.\n";
    echo "  Add these to .env, then re-run:\n";
    echo "    ZOHO_BOOKS_ORG_ID=60077655856\n";
    echo "    ZOHO_BOOKS_REFRESH_TOKEN=<a refresh token with scope ZohoBooks.fullaccess.all>\n";
    echo "    (ZOHO_BOOKS_CLIENT_ID / _SECRET fall back to the Zoho Sign app if unset)\n\n";
    return;
}

$line = fn ($s) => print($s . "\n");
$stamp = 'SMOKE-' . substr(md5((string) getmypid()), 0, 6);   // stable-ish per run
$line("Org configured ✓  — creating dummy records (tag: {$stamp})\n");

try {
    /* 1) Dummy vendor (contact). Clear any stray id=0 row from a prior run so
     *    the transient test vendor can be re-saved without a PK collision. */
    App\Models\Vendor::where('id', 0)->forceDelete();
    $vendor = new App\Models\Vendor();
    $vendor->id = 0;
    $vendor->company_name = 'ZZZ SMOKE TEST VENDOR — DELETE';
    $vendor->legal_name   = 'ZZZ SMOKE TEST VENDOR — DELETE';
    // No GSTIN → unregistered → Zoho bill goes in pre-tax (expected).
    $vendorId = $books->findOrCreateVendorId($vendor, null, '27');
    $line("Vendor (contact) id  : {$vendorId}");

    /* 2) Dummy BILL — one ₹1,000 line, no tax (unregistered vendor). */
    $bill = $books->createBill([
        'vendor_id'        => $vendorId,
        'bill_number'      => 'ZZ-BILL-' . $stamp,
        'date'             => now()->toDateString(),
        'reference_number' => 'SMOKE/' . $stamp,
        'line_items'       => [[
            'item_id'  => $books->findOrCreateItemId('ZZZ Smoke Item — delete', 1000.0, null),
            'name'     => 'ZZZ Smoke Item — delete',
            'rate'     => 1000.0,
            'quantity' => 1.0,
        ]],
        'notes'            => 'Automated smoke test — safe to delete.',
    ]);
    $line("BILL id / number     : {$bill['bill_id']} / " . ($bill['bill_number'] ?? '?') . "  (total " . ($bill['total'] ?? '?') . ", balance " . ($bill['balance'] ?? '?') . ")");

    /* 3) Record a dummy vendor PAYMENT against the bill. */
    $acct = $books->resolvePaidThroughAccountId('HDFC');
    if ($acct) {
        // Deliberately PARTIAL (75%) so the bill keeps an open balance and step 5
        // can actually exercise the credit-apply path. A full payment would leave
        // balance 0 and silently skip it.
        $applyAmt = round((float) ($bill['balance'] ?? 1000.0) * 0.75, 2);
        $pay = $books->recordVendorPayment([
            'vendor_id'               => $vendorId,
            'payment_mode'            => 'banktransfer',
            'amount'                  => $applyAmt,
            'date'                    => now()->toDateString(),
            'paid_through_account_id' => $acct,
            'reference_number'        => 'UTR-' . $stamp,
            'description'             => 'Bank: HDFC (smoke test)',
            'bills'                   => [['bill_id' => $bill['bill_id'], 'amount_applied' => $applyAmt]],
        ]);
        $line("Vendor PAYMENT id    : " . ($pay['payment_id'] ?? '?') . "  (applied {$applyAmt} → account {$acct})");
    } else {
        $line("Vendor PAYMENT       : SKIPPED — no Bank/Cash account in the org (this is the Z4 path).");
    }

    /* 4) Dummy VENDOR CREDIT — one ₹250 line. */
    $vc = $books->createVendorCredit([
        'vendor_id'             => $vendorId,
        'vendor_credit_number'  => 'ZZ-VC-' . $stamp,   // org has auto-numbering off
        'date'                  => now()->toDateString(),
        'reference_number'      => 'SMOKE-DN/' . $stamp,
        // This org enforces "associate with a bill" at creation — without it Zoho
        // rejects with "Select the associated bill number or bill type".
        // Mirrors DebitNoteController::buildZohoVendorCreditPayload().
        'bill_id'               => (string) $bill['bill_id'],
        'line_items'       => [[
            'item_id'  => $books->findOrCreateItemId('ZZZ Smoke Item — delete', 250.0, null),
            'name'     => 'ZZZ Smoke Item — delete',
            'rate'     => 250.0,
            'quantity' => 1.0,
        ]],
        'notes'            => 'Automated smoke test — safe to delete.',
    ]);
    // Service normalises to vendor_credit_id; keep the legacy key as a fallback
    // (same read as DebitNoteController::sync).
    $vcId = (string) ($vc['vendor_credit_id'] ?? $vc['vendorcredit_id']);
    $line("VENDOR CREDIT id/no  : {$vcId} / " . ($vc['vendor_credit_number'] ?? '?') . "  (balance " . ($vc['balance'] ?? '?') . ")");

    /* 5) Apply the credit to the bill (capped at the bill's open balance). */
    $bFresh = $books->getBill((string) $bill['bill_id']);
    $open = round((float) ($bFresh['balance'] ?? 0), 2);
    $applyVc = round(min((float) ($vc['balance'] ?? 0), $open), 2);
    if ($applyVc > 0.005) {
        $books->applyVendorCreditToBills($vcId, [['bill_id' => $bill['bill_id'], 'amount_applied' => $applyVc]]);
        $line("Applied credit → bill: {$applyVc} (bill open balance was {$open})");
    } else {
        $line("Credit apply         : bill already fully settled (open {$open}) — credit left open (expected).");
    }

    $line("\n✓ DONE. Check these in Zoho Books → Purchases → Bills / Vendor Credits.");
    $line("  Search 'ZZZ SMOKE TEST' or the tag {$stamp}. Delete them when you're satisfied.");
} catch (\Throwable $e) {
    $line("\n✗ Zoho rejected a call: " . $e->getMessage());
    $line("  (The exact message above is what the app surfaces to the user.)");
}

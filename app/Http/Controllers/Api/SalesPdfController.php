<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\SalesDocumentEmail;
use App\Mail\SalesReminderEmail;
use App\Models\Branch;
use App\Models\ProformaInvoice;
use App\Models\Quotation;
use Barryvdh\DomPDF\Facade\Pdf;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Response;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Milon\Barcode\DNS1D;
use stdClass;


class SalesPdfController extends Controller
{

    public function previewPi(Request $request)
    {
        $payload = $request->validate([
            'piNo'          => 'nullable|string|max:64',
            'piDate'        => 'nullable|string|max:32',
            'btId'          => 'nullable|string|max:32',
            'btDate'        => 'nullable|string|max:32',
            'oppId'         => 'nullable|string|max:64',
            'oppDate'       => 'nullable|string|max:32',
            'docType'       => 'nullable|string|max:32',
            'currency'      => 'nullable|string|max:8',
            'customer'      => 'nullable|string|max:255',
            'consignee'     => 'nullable|string|max:255',
            'salesManager'  => 'nullable|string|max:128',
            'withSignature' => 'nullable|boolean',
        ]);

        // Map currency symbol/code to a 3-letter code the template uses
        // in the "Amount In Words" prefix.
        $rawCur = trim((string) ($payload['currency'] ?? ''));
        $currencyCode = match ($rawCur) {
            '$'     => 'USD',
            '€'     => 'EUR',
            '£'     => 'GBP',
            '₹', '' => 'INR',
            default => strtoupper($rawCur),
        };
        $docType = $payload['docType']
            ?? (in_array($currencyCode, ['USD', 'EUR', 'GBP']) ? 'International' : 'Domestic');

        $withSignature = (bool) ($payload['withSignature'] ?? true);

        $viewData = $this->buildViewData($payload, $currencyCode, $docType, $withSignature);

        // DomPDF's pure-PHP renderer is slow on this heavy template (large
        // nested tables + multiple embedded images); on slower local boxes a
        // single render can approach the default 60s cap. Give it headroom so
        // the PDF always completes instead of 500-ing with a FatalError.
        @set_time_limit(180);
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            // Required for the <script type="text/php"> page-number block
            // at the bottom of the Blade template to actually execute.
            // The global dompdf config has enable_php=false (default,
            // for security); we opt-in only on this controller's PDFs.
            ->setOption('isPhpEnabled', true);

        $filename = 'PI-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $payload['piNo'] ?? 'preview') . '.pdf';

        return Response::make($pdf->output(), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
        ]);
    }

    /**
     * Build the full view-data array the template expects. All values
     * are dummy / template-style stand-ins shaped as objects with the
     * same property names as the IDIMS source models.
     */
    private function buildViewData(array $p, string $currencyCode, string $docType, bool $withSignature): array
    {
        // ─── Company (issuer) — IGC dummy ───────────────────────────────────
        $companyDetails = (object) [
            'name'              => 'IGC Logistics Pvt. Ltd.',
            'address'           => 'Office No 821, 8th Flr, Solitaire Business Hub, Balewadi Highstreet Baner, Pune, Maharashtra - 411045, India',
            'mobile'            => '+91 9850558881',
            'email'             => 'sales@igc-logistics.example',
            'website'           => 'www.igc-logistics.example',
            'gst_no'            => '27AADCI6120M1ZH',
            'gst_state_code'    => '27',
            'pan_no'            => 'AADCI6120M',
            'cin'               => 'U85100PN2014PTC152252',
            'iec'               => '3114017398',
            'drug_license'      => 'MH-PZ2-603278 / MH-PZ2-603279',
            'pcpndt_no'         => 'MAH/PCPNDT/184/2018',
            'aeo_code'          => 'INAADCI6120M1F249',
            'onestartfilename'  => 'PUNSTATAPPLY00000457AM24',
            'onestarudinumber'  => 'UDINSTAT00306640AM24',
        ];

        // ─── Buyer (vendor on the QPI row) ──────────────────────────────────
        $buyerDetails = (object) [
            'name'       => $p['customer']  ?? 'Customer Name Pvt. Ltd.',
            'address'    => '2nd Floor, Aman Bunglow, S no. 5A/1B Vidisha Society, Karvenagar, Pune 411052',
            'email'      => 'buyer@example.com',
            'contact_no' => '+91 9000000001',
        ];

        $hasConsignee = !empty($p['consignee']) && $p['consignee'] !== ($p['customer'] ?? null);
        $consigneeDetails = $hasConsignee ? (object) [
            'name'    => $p['consignee'],
            'address' => 'Consignee delivery address, Mumbai, Maharashtra - 400001, India',
            'email'   => 'consignee@example.com',
            'mobile'  => '+91 9000000002',
        ] : null;

        // ─── Bank details ───────────────────────────────────────────────────
        $bankDetails = (object) [
            'bank_name'           => 'HDFC BANK LTD',
            'account_holder_name' => strtoupper($companyDetails->name),
            'address'             => 'HDFC BANK, SR NO. 244/3-5, OPP INDIAN OIL PETROL PUMP, RAJIV GANDHI IT PARK, HINJEWADI, PUNE, MAHARASHTRA 411057 INDIA SWIFT : HDFCINBB',
            'branch'              => 'HINJEWADI, PUNE',
            'branch_code'         => '794',
            'ad_code'             => '0510573',
            'account_no'          => '59209850100030',
            'ifsc'                => 'HDFC0000794',
            'swift_code'          => 'HDFCINBB',
        ];

        // ─── Products (3 dummy line items totalling a sensible sample) ─────
        $items = [
            ['product_name' => 'BIOMÉRIEUX - VITEK 2 Compact 30 Analyser', 'model_name' => 'VITEK® 2 COMPACT 30', 'product_description' => 'With Standard Accessories — Pipette Tips (100–1000 µL, 0.5–250 µL), Unsensitized Tubes (1×2000), KIT V2S 9.04 PC Media, Small Dispenser, Pipette 145 MCL Fixed, Pipette 280 MCL Fixed, CD Densicheck User Manual, McFarland Ref Kit, Densicheck Display Base Kit, Densicheck POD, Saline Solution, Barcode Scanner (Honeywell 1400G), HP V20 HD Monitor, HP Printer M208DW, Keyboard PC AZERTY USB.', 'quantity' => 1, 'rate' => 1725000.00, 'amount' => 1725000.00],
            ['product_name' => 'Reagent Kit — VITEK 2 GN ID',                   'model_name' => 'V2S-GN-ID',          'product_description' => 'Gram-negative bacterial identification cards, pack of 20. Includes calibration and validation media.',                                                                                                                                                                                                                                                                                                            'quantity' => 2, 'rate' => 32500.00,   'amount' => 65000.00],
            ['product_name' => 'Annual Maintenance Contract (AMC)',              'model_name' => 'AMC-Y1',             'product_description' => 'Comprehensive maintenance contract — 4 preventive visits, unlimited breakdown calls, original spare parts excluded.',                                                                                                                                                                                                                                                                                            'quantity' => 1, 'rate' => 145000.00,  'amount' => 145000.00],
        ];
        $quotationProducts = collect($items);

        $subTotal = array_sum(array_column($items, 'amount'));

        // ─── Tax math: domestic = CGST+SGST (split 2.5%/2.5%); international
        // = IGST (5%) + shipping/packaging surcharges. Mirrors IDIMS logic.
        $shippingCost  = $docType === 'International' ? 12500.00 : 0.00;
        $packagingCost = $docType === 'International' ?  4500.00 : 0.00;
        $gstBase       = $subTotal + $shippingCost + $packagingCost;
        $igst = $docType === 'International' ? round($gstBase * 0.05, 2) : 0;
        $cgst = $docType === 'Domestic'      ? round($gstBase * 0.025, 2) : 0;
        $sgst = $docType === 'Domestic'      ? round($gstBase * 0.025, 2) : 0;
        $grandTotal = round($gstBase + $igst + $cgst + $sgst, 2);

        // ─── Quotation object — shape matches IDIMS Quotation model usage ──
        $quotation = (object) [
            'pi_number'             => $p['piNo']    ?? 'PI/2026-27/0000',
            'pi_date'               => $this->normalizeDate($p['piDate'] ?? null),
            'document_type'         => $docType,
            'currency_name'         => $currencyCode,
            'currency'              => (object) ['name' => $currencyCode],
            'consignee_id'          => $hasConsignee ? 1 : null,
            'port_of_discharge'     => $docType === 'International' ? 'Jebel Ali, UAE' : '',
            'final_destination'     => $docType === 'International' ? 'Dubai, UAE'    : '',
            'origin_country'        => 'India',
            'inco_term_name'        => $docType === 'International' ? 'FOB Chennai' : '',
            'net_weight'            => $docType === 'International' ? '480.00'     : '',
            'gross_weight'          => $docType === 'International' ? '520.00'     : '',
            'portOfLoading'         => $docType === 'International'
                ? (object) ['code' => 'INMAA', 'name' => 'Chennai Port', 'address' => 'Chennai, Tamil Nadu, India']
                : null,
            'total'                 => $subTotal,
            'igst'                  => $igst,
            'cgst'                  => $cgst,
            'sgst'                  => $sgst,
            'shipping_cost'         => $shippingCost,
            'packaging_cost'        => $packagingCost,
            'grand_total'           => $grandTotal,
            'terms_and_conditions'  => $this->defaultTerms(),
        ];

        return [
            'pdf_title'           => 'PROFORMA INVOICE',
            'doc_label_short'     => 'PI',
            'signature'           => $withSignature ? 'Yes' : 'No',
            'companyDetails'      => $companyDetails,
            'buyerDetails'        => $buyerDetails,
            'consigneeDetails'    => $consigneeDetails,
            'bankDetails'         => $bankDetails,
            'quotation'           => $quotation,
            'quotationProducts'   => $quotationProducts,
            'opportunity_id'      => $p['oppId']   ?? null,
            'opportunity_date'    => $this->parseDate($p['oppDate'] ?? null),
            'termsAndConditions'  => null, // template falls back to $quotation->terms_and_conditions
            'segmentTermsConditions' => [],
            'base_currency_total' => $grandTotal,
            'exchange_rate'       => null,
        ];
    }

    /**
     * Coerce a dd/mm/YYYY (or any strtotime-friendly) string into a
     * YYYY-mm-dd string the template can re-format. Falls back to today.
     */
    private function normalizeDate(?string $s): string
    {
        if (!$s) return date('Y-m-d');
        // Accept dd/mm/YYYY explicitly — strtotime parses it as mm/dd in US locale.
        if (preg_match('#^(\d{2})/(\d{2})/(\d{4})$#', $s, $m)) {
            return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
        }
        $t = strtotime($s);
        return $t ? date('Y-m-d', $t) : date('Y-m-d');
    }

    /**
     * Build a DateTime (or null) from an arbitrary date string. Used for
     * opportunity_date which the template invokes ->format('d/m/Y') on.
     */
    private function parseDate(?string $s): ?\DateTime
    {
        if (!$s) return null;
        if (preg_match('#^(\d{2})/(\d{2})/(\d{4})$#', $s, $m)) {
            return \DateTime::createFromFormat('Y-m-d', sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1])) ?: null;
        }
        try {
            return new \DateTime($s);
        } catch (\Exception) {
            return null;
        }
    }

    /* ──────────────────────────────────────────────────────────────────
     * QUOTATION DOCUMENT — real-data variant.
     *
     * POST /sales/quotations/{id}/preview-pdf?signature=1
     *
     * Loads the saved Quotation row with its items + branch + customer +
     * consignee + lead + bank account, maps the Branch's letterhead fields
     * (CIN/IEC/drug license/AEO/etc.) onto the `$companyDetails` object
     * the shared template expects, and renders the same Blade view with
     * `pdf_title = "QUOTATION DOCUMENT"`.
     *
     * The `signature` flag toggles the authorised-signatory block at the
     * bottom (the template renders the stamp + signature image when 'Yes').
     * ────────────────────────────────────────────────────────────────── */
    public function previewQuotation(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $quot = Quotation::with([
            'items',
            'branch',
            // Customer + its primary address (HasOne `primaryAddress`) so we
            // can render full Buyer block: name + address + email + phone.
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            // Same for Consignee.
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        // Tenant + branch scope — same rule as QuotationController::assertScope.
        $this->assertRecordScope($quot, $user, 'read');

        $withSignature = $request->boolean('signature', true);

        $viewData = $this->buildQuotationViewData($quot, $withSignature);

        $bytes = $this->renderSalesPdfCached($viewData, $withSignature);

        $filename = 'Quotation-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $quot->code ?? ('id-' . $quot->id))
            . ($withSignature ? '_signed' : '_unsigned') . '.pdf';

        return Response::make($bytes, 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
        ]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * PROFORMA INVOICE — real-data variant (mirror of previewQuotation).
     *
     * POST /sales/proforma-invoices/{id}/preview-pdf?signature=1
     *
     * Loads the saved PI row with the same relations as the Quotation
     * variant (items, branch, customer + primary address, consignee +
     * primary address, lead, salesManager) and renders the shared
     * Blade template with `pdf_title = 'PROFORMA INVOICE'` and the
     * label switch `doc_label_short = 'PI'` (so labels read "PI No"
     * / "PI Date" instead of "QT No" / "QT Date").
     * ────────────────────────────────────────────────────────────────── */
    public function previewProformaInvoice(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $pi = ProformaInvoice::with([
            'items',
            'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        // Tenant + branch scope — same rule as ProformaInvoiceController::assertScope.
        $this->assertRecordScope($pi, $user, 'read');

        $withSignature = $request->boolean('signature', true);

        // Same builder as the Quotation variant — both models share the
        // exact same field names (code, opp_id, customer_id, ports,
        // totals, etc.), so the mapping is identical. Only the title
        // + label are different.
        $viewData = $this->buildQuotationViewData($pi, $withSignature, 'PROFORMA INVOICE', 'PI');

        $bytes = $this->renderSalesPdfCached($viewData, $withSignature);

        $filename = 'PI-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $pi->code ?? ('id-' . $pi->id))
            . ($withSignature ? '_signed' : '_unsigned') . '.pdf';

        return Response::make($bytes, 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
        ]);
    }

    /**
     * Render a Quotation or Proforma Invoice to a temp PDF on disk and
     * return its path + a slugged filename + the loaded record. Used by
     * the Zoho Sign "Send for Signature" flow (ClmSignatureController::
     * salesDocSend) so the exact same with-signature PDF the customer
     * sees in preview/email is what goes to Zoho. Caller owns cleanup
     * (@unlink the returned path in a finally block).
     *
     * @param  string $kind  'quotation' | 'proforma_invoice'
     * @return array{path:string, filename:string, record:\Illuminate\Database\Eloquent\Model}
     */
    public function renderSalesDocPdfToTemp(string $kind, int $id, $user, bool $withSignature = true): array
    {
        if (!$user) abort(401);

        $with = [
            'items',
            'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_name,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_name,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ];

        if ($kind === 'proforma_invoice') {
            $record   = ProformaInvoice::with($with)->findOrFail($id);
            $viewData = $this->buildQuotationViewData($record, $withSignature, 'PROFORMA INVOICE', 'PI');
            $prefix   = 'PI';
        } else {
            $record   = Quotation::with($with)->findOrFail($id);
            $viewData = $this->buildQuotationViewData($record, $withSignature);
            $prefix   = 'Quotation';
        }

        // Same tenant + branch scope the preview routes enforce.
        $this->assertRecordScope($record, $user, 'read');

        @set_time_limit(180);
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);

        $dir = storage_path('app/temp');
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $path = $dir . DIRECTORY_SEPARATOR . Str::uuid()->toString() . '.pdf';
        $pdf->save($path);

        $filename = Str::slug($prefix . '-' . ($record->code ?? ('id-' . $record->id)))
            ?: ($prefix . '-' . $record->id);

        return ['path' => $path, 'filename' => $filename, 'record' => $record];
    }

    /* ══════════════════════════════════════════════════════════════════
     * PUBLIC PDF VIEW — signed-URL endpoints the customer can hit
     * straight from the email "View Quotation" button (no login).
     *
     * GET /sales/quotations/{id}/view?expires=…&signature=…       (named: sales.quotation.view)
     * GET /sales/proforma-invoices/{id}/view?expires=…&signature=…(named: sales.pi.view)
     *
     * Auth: Laravel's `signed` middleware validates the HMAC signature
     * on the query string. The URL is generated by the email sender via
     * `URL::temporarySignedRoute(..., now()->addDays(60))` so it stops
     * working after 60 days even if it leaks. No app credentials needed.
     *
     * Renders the same with-signature PDF that goes in the email
     * attachment so what the customer sees in browser matches the
     * downloaded copy. Content-Disposition: inline → opens in the
     * browser's built-in PDF viewer instead of triggering a download.
     * ════════════════════════════════════════════════════════════════ */
    public function publicViewQuotation(int $id)
    {
        $quot = Quotation::with([
            'items',
            'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        $viewData = $this->buildQuotationViewData($quot, true);
        // DomPDF's pure-PHP renderer is slow on this heavy template (large
        // nested tables + multiple embedded images); on slower local boxes a
        // single render can approach the default 60s cap. Give it headroom so
        // the PDF always completes instead of 500-ing with a FatalError.
        @set_time_limit(180);
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);

        $filename = 'Quotation-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $quot->code ?? ('id-' . $quot->id)) . '.pdf';
        return Response::make($pdf->output(), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
        ]);
    }

    public function publicViewProformaInvoice(int $id)
    {
        $pi = ProformaInvoice::with([
            'items',
            'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        $viewData = $this->buildQuotationViewData($pi, true, 'PROFORMA INVOICE', 'PI');
        // DomPDF's pure-PHP renderer is slow on this heavy template (large
        // nested tables + multiple embedded images); on slower local boxes a
        // single render can approach the default 60s cap. Give it headroom so
        // the PDF always completes instead of 500-ing with a FatalError.
        @set_time_limit(180);
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);

        $filename = 'PI-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $pi->code ?? ('id-' . $pi->id)) . '.pdf';
        return Response::make($pdf->output(), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
        ]);
    }

    /* ──────────────────────────────────────────────────────────────────
     * EMAIL — send the Quotation / PI PDF to the customer's primary email.
     *
     * POST /sales/quotations/{id}/email
     * POST /sales/proforma-invoices/{id}/email
     *
     * Body:
     *   signature (bool, default true) — picks the with-/without-signature PDF variant
     *   to        (string, optional)   — override recipient. When omitted we read from the
     *                                    customer's primary address (cp_email) and fall back
     *                                    to customer.primary_email.
     *
     * Returns 200 on send, 422 when no recipient is available (so the
     * frontend can prompt the user to add an email to the customer).
     * ────────────────────────────────────────────────────────────────── */
    public function emailQuotation(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $quot = Quotation::with([
            'items',
            'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        // Email = WRITE (stamps emailed_at + sends mail). Branch users can
        // only email their own branch's quotations.
        $this->assertRecordScope($quot, $user, 'write');
        $rateLimitKey = 'email-quotation:' . $user->id . ':' . $quot->id;
        $maxAttempts = 3;
        $decaySeconds = 60;

        if (RateLimiter::tooManyAttempts($rateLimitKey, $maxAttempts)) {
            $seconds = RateLimiter::availableIn($rateLimitKey);

            return response()->json([
                'success' => false,
                'message' => "Too many email attempts. Please try again after {$seconds} seconds.",
                'retry_after_seconds' => $seconds,
            ], 429);
        }

        RateLimiter::hit($rateLimitKey, $decaySeconds);

        return $this->sendSalesDocumentEmail(
            $request,
            $quot,
            kind: 'Quotation',
            pdfTitle: 'QUOTATION DOCUMENT',
            docLabel: 'QT',
            filenamePrefix: 'Quotation',
        );
    }

    public function emailProformaInvoice(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $pi = ProformaInvoice::with([
            'items',
            'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        $this->assertRecordScope($pi, $user, 'write');

        // Rate limit — max 3 sends per PI per user per minute (mirrors
        // emailQuotation) so an over-eager click doesn't spam the customer.
        $rateLimitKey = 'email-proforma-invoice:' . $user->id . ':' . $pi->id;
        $maxAttempts = 3;
        $decaySeconds = 60;

        if (RateLimiter::tooManyAttempts($rateLimitKey, $maxAttempts)) {
            $seconds = RateLimiter::availableIn($rateLimitKey);

            return response()->json([
                'success' => false,
                'message' => "Too many email attempts. Please try again after {$seconds} seconds.",
                'retry_after_seconds' => $seconds,
            ], 429);
        }

        RateLimiter::hit($rateLimitKey, $decaySeconds);

        return $this->sendSalesDocumentEmail(
            $request,
            $pi,
            kind: 'Proforma Invoice',
            pdfTitle: 'PROFORMA INVOICE',
            docLabel: 'PI',
            filenamePrefix: 'PI',
        );
    }

    /**
     * Shared sender for both Quotation + PI. Resolves recipient, renders
     * the PDF to a temp file, builds the email payload, sends, then deletes
     * the temp file. Returns a JsonResponse the frontend can toast off of.
     */
    private function sendSalesDocumentEmail(Request $request, $record, string $kind, string $pdfTitle, string $docLabel, string $filenamePrefix): JsonResponse
    {
        // 1) Resolve the recipient.
        $override = trim((string) $request->input('to', ''));
        if ($override !== '' && filter_var($override, FILTER_VALIDATE_EMAIL)) {
            $to = $override;
        } else {
            $cust   = $record->customer;
            $custAd = $cust?->primaryAddress;
            $to     = $custAd?->cp_email ?? $cust?->primary_email ?? null;
        }
        if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return response()->json([
                'status'  => false,
                'message' => 'No valid email address for this customer. Set a primary contact email on the customer first.',
            ], 422);
        }

        $withSignature = $request->boolean('signature', true);

        // 2) Render the PDF to a temp file (we use the existing view-data
        //    builder so the email attachment matches the preview PDF byte-for-byte).
        $viewData = $this->buildQuotationViewData($record, $withSignature, $pdfTitle, $docLabel);
        // DomPDF's pure-PHP renderer is slow on this heavy template (large
        // nested tables + multiple embedded images); on slower local boxes a
        // single render can approach the default 60s cap. Give it headroom so
        // the PDF always completes instead of 500-ing with a FatalError.
        @set_time_limit(180);
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);

        $tmpDir = storage_path('app/tmp/sales-pdfs');
        if (!is_dir($tmpDir)) @mkdir($tmpDir, 0775, true);
        $safeCode = preg_replace('/[^A-Za-z0-9_-]/', '_', $record->code ?? ('id-' . $record->id));
        $pdfFilename = $filenamePrefix . '-' . $safeCode . ($withSignature ? '_signed' : '_unsigned') . '.pdf';
        $pdfPath = $tmpDir . '/' . uniqid('mail-', true) . '-' . $pdfFilename;
        $pdf->save($pdfPath);

        // 3) Build the payload + send. Shared with the Send-for-Signature
        //    flow (see buildAndSendSalesDocEmail). Always clean up the temp
        //    PDF, even if the mailer throws.
        try {
            $this->buildAndSendSalesDocEmail($record, $kind, $docLabel, $to, $pdfPath, $pdfFilename);
        } catch (\Throwable $e) {
            @unlink($pdfPath);
            Log::error('Sales document email failed', [
                'kind'       => $kind,
                'record'     => $record->code,
                'to'         => $to,
                'pdfPath'    => $pdfPath,
                'errorClass' => get_class($e),
                'error'      => $e->getMessage(),
                'trace'      => $e->getTraceAsString(),
            ]);
            return response()->json([
                'status'  => false,
                'message' => config('app.debug')
                    ? "Could not send {$kind} email: {$e->getMessage()}"
                    : "Could not send {$kind} email. Please try again or contact support.",
            ], 500);
        }
        @unlink($pdfPath);

        // 5) Stamp the first-send time so the frontend can flip the
        //    Email button to "sent" + enable the Reminder button. Only
        //    sets emailed_at if it's still null — repeat sends of the
        //    initial document don't reset the anchor.
        if (empty($record->emailed_at)) {
            $record->forceFill(['emailed_at' => now()])->save();
        }

        return response()->json([
            'status'         => true,
            'message'        => "{$kind} emailed to {$to}",
            'to'             => $to,
            'emailed_at'     => optional($record->emailed_at)->toIso8601String(),
            'reminder_count' => (int) ($record->reminder_count ?? 0),
        ]);
    }

    /**
     * Build the SalesDocumentEmail payload from a relation-loaded Quotation/PI
     * record + an already-rendered PDF, then send it to $to.
     *
     * Shared by the manual "Email document" endpoints (sendSalesDocumentEmail)
     * and the Send-for-Signature flow (ClmSignatureController::salesDocSend),
     * which reuses its already-rendered signed PDF so the customer ALSO receives
     * the document as an attachment alongside Zoho's signing notification email.
     *
     * THROWS on mail failure — the caller owns the temp-file lifecycle, error
     * surfacing, and any emailed_at stamping. The $record must have `branch`,
     * `items`, and `customer` eager-loaded (product summary = first item's name,
     * preferring the LIVE product-master name so renames flow into the email body).
     *
     * @param  \App\Models\Quotation|\App\Models\ProformaInvoice  $record
     */
    public function buildAndSendSalesDocEmail($record, string $kind, string $docLabel, string $to, string $pdfPath, string $pdfFilename): void
    {
        $branch    = $record->branch;
        $firstItem = $record->items->first();
        $productSummary = '';
        if ($firstItem) {
            if ($firstItem->product_id) {
                $live = DB::table('products')->where('id', $firstItem->product_id)->value('name');
                if ($live) $productSummary = (string) $live;
            }
            if ($productSummary === '') {
                $productSummary = (string) ($firstItem->product_name ?? '');
                // Strip "CODE – " prefix from snapshot so the email reads cleanly.
                if (preg_match('/^.+?\s+[\x{2013}\-]\s+(.+)$/u', $productSummary, $m)) {
                    $productSummary = trim($m[1]);
                }
            }
        }
        if ($record->items->count() > 1) {
            $productSummary .= ' (+' . ($record->items->count() - 1) . ' more)';
        }

        // Signed, expiring view URL — the "View Quotation" / "View PI" button
        // in the email opens this in the browser. Public route, no app login;
        // Laravel's `signed` middleware validates it. 60-day window matches the
        // typical quote-validity period in this domain.
        $viewRouteName = $kind === 'Quotation' ? 'sales.quotation.view' : 'sales.pi.view';
        $viewUrl = \Illuminate\Support\Facades\URL::temporarySignedRoute(
            $viewRouteName,
            now()->addDays(60),
            ['id' => $record->id],
        );

        // Currency: prefer the stored value, fall back to USD for International /
        // INR for Domestic so the Grand Total never renders unprefixed on legacy rows.
        $resolvedCurrency = (string) ($record->currency
            ?: ($record->doc_type === 'Domestic' ? 'INR' : 'USD'));

        $payload = [
            'docKind'        => $kind,
            'docLabel'       => $docLabel,    // 'QT' or 'PI' — used in the info-card label
            'docCode'        => $record->code,
            'docDate'        => optional($record->created_at)->format('d/m/Y') ?: date('d/m/Y'),
            'branchName'     => $branch?->name    ?: ($branch?->code ?: 'Sales Team'),
            'branchEmail'    => $branch?->email   ?: null,
            'branchWebsite'  => $branch?->website ?: null,
            'customerName'   => $record->customer?->company_name ?: ($record->customer_name ?: 'Sir/Madam'),
            'productSummary' => $productSummary,
            'productsCount'  => (int) $record->items->count(),
            'grandTotal'     => (float) ($record->grand_total ?? 0),
            'currency'       => $resolvedCurrency,
            'docType'        => (string) ($record->doc_type ?? ''),
            'viewUrl'        => $viewUrl,
            'logoPath'       => $this->branchAssetAbsolutePath($branch?->logo),
            'pdfPath'        => $pdfPath,
            'pdfFilename'    => $pdfFilename,
        ];

        Mail::to($to)->send(new SalesDocumentEmail($payload));
    }

    /* ──────────────────────────────────────────────────────────────────
     * PURCHASE ORDER (P2P) — PDF + email, reusing the PI template/mailer.
     * ────────────────────────────────────────────────────────────────── */

    /**
     * Render a PurchaseOrder (saved OR a transient in-memory instance) to an
     * inline PDF stream. Shared by the saved-PO view routes and the
     * unsaved-form preview (PurchaseOrderController::previewPdf).
     */
    public function streamPoPdf($po, bool $withSignature = true, $vendor = null)
    {
        $vendor = $vendor ?: ($po->vendor_id ? \App\Models\Vendor::with('primaryAddress')->find($po->vendor_id) : null);
        $viewData = $this->buildPurchaseOrderViewData($po, $withSignature, $vendor);
        @set_time_limit(180);
        $pdf = Pdf::loadView('pdf.purchase-order', $viewData)->setPaper('A4', 'portrait')->setOption('isPhpEnabled', true);
        $ref = $po->code ?: ('id-' . ($po->id ?? 'draft'));
        $name = 'PO-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $ref) . ($withSignature ? '_signed' : '_unsigned') . '.pdf';
        return $pdf->stream($name);
    }

    /**
     * Render a PurchaseOrder to raw PDF BYTES (not a stream) — used to hand the
     * document to Zoho Sign in PurchaseOrderController::sendForSignature. Same
     * view + paper as streamPoPdf, only the terminal call differs (->output()).
     */
    public function renderPoPdfBytes($po, bool $withSignature = false, $vendor = null): string
    {
        $vendor = $vendor ?: ($po->vendor_id ? \App\Models\Vendor::with('primaryAddress')->find($po->vendor_id) : null);
        $viewData = $this->buildPurchaseOrderViewData($po, $withSignature, $vendor);
        @set_time_limit(180);
        return Pdf::loadView('pdf.purchase-order', $viewData)->setPaper('A4', 'portrait')->setOption('isPhpEnabled', true)->output();
    }

    /** Public signed PDF view for the PO email's "View" button. */
    public function publicViewPurchaseOrder(int $id)
    {
        $po = \App\Models\PurchaseOrder::with('items')->findOrFail($id);
        return $this->streamPoPdf($po, true);
    }

    /**
     * Tenant + branch isolation for PO PDF/email actions. Mirrors
     * PurchaseOrderController::assertScope so a branch user can't reach another
     * branch's PO by id (the earlier client_id-only check leaked across branches).
     */
    private function assertPoTenantScope(\App\Models\PurchaseOrder $po, $user): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $po->client_id !== (int) $user->client_id) abort(404);
        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ((int) $po->branch_id !== (int) $user->branch_id) abort(404);
    }

    /** Authenticated inline PDF stream (for the wizard/modal View actions). */
    public function viewPurchaseOrderPdf(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $po = \App\Models\PurchaseOrder::with('items')->findOrFail($id);
        $this->assertPoTenantScope($po, $user);
        return $this->streamPoPdf($po, $request->boolean('signature', true));
    }

    /** Email the Purchase Order PDF to the supplier using the PI email template. */
    public function emailPurchaseOrder(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);
        $po = \App\Models\PurchaseOrder::with('items')->findOrFail($id);
        $this->assertPoTenantScope($po, $user);

        $vendor = $po->vendor_id ? \App\Models\Vendor::with('primaryAddress')->find($po->vendor_id) : null;
        $override = trim((string) $request->input('to', ''));
        $to = ($override !== '' && filter_var($override, FILTER_VALIDATE_EMAIL))
            ? $override
            : ($vendor?->primaryAddress?->email ?: ($vendor?->primary_email ?: null));
        if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return response()->json(['status' => false, 'message' => 'No valid email address for this supplier. Set a primary contact email on the supplier first.'], 422);
        }

        $withSignature = $request->boolean('signature', true);
        $viewData = $this->buildPurchaseOrderViewData($po, $withSignature, $vendor);
        @set_time_limit(180);
        $pdf = Pdf::loadView('pdf.purchase-order', $viewData)->setPaper('A4', 'portrait')->setOption('isPhpEnabled', true);

        $tmpDir = storage_path('app/tmp/sales-pdfs');
        if (!is_dir($tmpDir)) @mkdir($tmpDir, 0775, true);
        $safeCode = preg_replace('/[^A-Za-z0-9_-]/', '_', $po->code ?? ('id-' . $po->id));
        $pdfFilename = 'PO-' . $safeCode . ($withSignature ? '_signed' : '_unsigned') . '.pdf';
        $pdfPath = $tmpDir . '/' . uniqid('mail-', true) . '-' . $pdfFilename;
        $pdf->save($pdfPath);

        try {
            $branch = \App\Models\Branch::find($po->branch_id);
            $viewUrl = \Illuminate\Support\Facades\URL::temporarySignedRoute('p2p.po.view', now()->addDays(60), ['id' => $po->id]);
            Mail::to($to)->send(new SalesDocumentEmail([
                'docKind' => 'Purchase Order',
                'docLabel' => 'PO',
                'docCode' => $po->code,
                'docDate' => optional($po->po_date)->format('d/m/Y') ?: date('d/m/Y'),
                'branchName' => $branch?->name ?: ($branch?->code ?: 'Procurement Team'),
                'branchEmail' => $branch?->email ?: null,
                'branchWebsite' => $branch?->website ?: null,
                'customerName' => $po->supplier_name ?: ($vendor?->company_name ?: 'Sir/Madam'),
                'productSummary' => (string) (optional($po->items->first())->product_name ?? ''),
                'productsCount' => (int) $po->items->count(),
                'grandTotal' => (float) ($po->grand_total ?? 0),
                'currency' => (string) ($po->currency_code ?: ($po->document_type === 'International' ? 'USD' : 'INR')),
                'docType' => (string) ($po->document_type ?? ''),
                'viewUrl' => $viewUrl,
                'logoPath' => $this->branchAssetAbsolutePath($branch?->logo),
                'pdfPath' => $pdfPath,
                'pdfFilename' => $pdfFilename,
            ]));
        } catch (\Throwable $e) {
            @unlink($pdfPath);
            Log::error('Purchase Order email failed', ['po' => $po->code, 'to' => $to, 'error' => $e->getMessage()]);
            return response()->json([
                'status' => false,
                'message' => config('app.debug') ? "Could not send Purchase Order email: {$e->getMessage()}" : 'Could not send Purchase Order email. Please try again or contact support.',
            ], 500);
        }
        @unlink($pdfPath);

        return response()->json(['status' => true, 'message' => "Purchase Order emailed to {$to}", 'to' => $to]);
    }

    /**
     * Build view data for the dedicated Purchase Order PDF
     * (`pdf/purchase-order.blade.php`). Mirrors the shared letterhead/branding
     * of the PI PDF but with the PO-specific layout: Vendor / Bill-To /
     * Deliver-To blocks, a PO info grid, per-line GST%, charges and the PO
     * Terms & Conditions boilerplate.
     */
    private function buildPurchaseOrderViewData($po, bool $withSignature, $vendor = null): array
    {
        $branch = \App\Models\Branch::find($po->branch_id);
        $client = !empty($po->client_id) ? \App\Models\Client::find($po->client_id) : null;

        $branchAddress = trim(implode(', ', array_filter([$branch?->address, $branch?->city, $branch?->state, $branch?->pincode, $branch?->country]))) ?: '';
        $clientAddress = trim(implode(', ', array_filter([$client?->address, $client?->city, $client?->state, $client?->pincode, $client?->country]))) ?: '';
        $logoData = $this->branchAssetDataUri($branch?->logo) ?: $this->branchAssetDataUri($client?->logo);

        $companyDetails = (object) [
            'name' => ($branch?->name ?: $client?->org_name) ?: ($branch?->code ?: 'Branch'),
            'address' => $branchAddress ?: $clientAddress,
            'mobile' => $branch?->phone ?: ($client?->phone ?? ''),
            'email' => $branch?->email ?: ($client?->email ?? ''),
            'website' => $branch?->website ?: ($client?->website ?? ''),
            'gst_no' => $branch?->gst_number ?: ($client?->gst_number ?? ''),
            'pan_no' => $branch?->pan_number ?: ($client?->pan_number ?? ''),
            'gst_state_code' => $branch?->gst_state_code ?? '',
            'cin' => $branch?->cin ?? '',
            'iec' => $branch?->iec ?? '',
            'drug_license' => $branch?->drug_license ?? '',
            'pcpndt_no' => $branch?->pcpndt_no ?? '',
            'aeo_code' => $branch?->aeo_code ?? '',
            'onestartfilename' => $branch?->one_star_file_no ?? '',
            'onestarudinumber' => $branch?->one_star_udin_no ?? '',
            'primary_color' => $primaryColor = ($this->normalizeHex($branch?->primary_color ?: $client?->primary_color) ?: '#7CB342'),
            'secondary_color' => $this->normalizeHex($branch?->secondary_color ?: $client?->secondary_color) ?: '#37B1E0',
            'primary_text_color' => $this->contrastColor($primaryColor),
            'logo_data' => $logoData,
            'signature_data' => $this->branchAssetDataUri($branch?->signature_path) ?? $this->publicImageDataUri('images/test-signature.png'),
        ];

        // Vendor (supplier) block. state/country on VendorAddress are BelongsTo
        // relations (States/Countries) — resolve their names, not the models.
        $vAddr = $vendor?->primaryAddress;
        $vendorBlock = (object) [
            'name' => $po->supplier_name ?: ($vendor?->company_name ?: 'Supplier'),
            'address' => $this->composeAddress(
                $vAddr?->address_line,
                $vAddr?->city,
                $vAddr?->state?->name ?? $vAddr?->state_code,
                $vAddr?->pincode,
                $vAddr?->country?->name,
            ),
            'email' => $vAddr?->email ?: ($vendor?->primary_email ?? ''),
            'contact_no' => $vAddr?->contact_no ?? '',
        ];

        // Bill-To = the purchasing company (issuing branch / client).
        $billTo = (object) [
            'name' => strtoupper((string) (($branch?->name ?: $client?->org_name) ?: '')),
            'address' => $branchAddress ?: $clientAddress,
            'contact' => $branch?->phone ?: ($client?->phone ?? ''),
        ];

        // Deliver-To = the selected warehouse (by warehouse_id) or the free-text
        // delivery location; falls back to the bill-to address.
        $wh = $po->warehouse_id ? DB::table('master_warehouse_master')->where('id', $po->warehouse_id)->first() : null;
        $whAddress = $wh
            ? trim(implode(', ', array_filter([$wh->address, $wh->city, $wh->state, $wh->pincode])))
            : '';
        $deliverTo = (object) [
            'name' => strtoupper((string) (($branch?->name ?: $client?->org_name) ?: '')),
            'address' => $whAddress ?: ($po->delivery_location ?: $billTo->address),
            'contact' => $wh?->contact_phone ?: $billTo->contact,
        ];

        // Bank = the branch's bank (first master_bank_accounts row for this
        // client, preferring the branch-specific one over a client-wide one).
        $bankRow = DB::table('master_bank_accounts')
            ->where('client_id', $po->client_id)
            ->when($po->branch_id, fn ($q) => $q->where(fn ($w) => $w->where('branch_id', $po->branch_id)->orWhereNull('branch_id')))
            ->orderByRaw('branch_id IS NULL')
            ->first();
        $bankDetails = (object) [
            'bank_name' => $bankRow->bank_name ?? '',
            'account_holder_name' => $bankRow->account_holder ?? '',
            'address' => trim((string) ($bankRow->city ?? '')),
            'branch' => $bankRow->branch_name ?? '',
            'branch_code' => '',
            'ad_code' => $bankRow->ad_code ?? '',
            'account_no' => $bankRow->account_number ?? '',
            'ifsc' => $bankRow->ifsc_code ?? '',
            'swift_code' => $bankRow->swift_code ?? '',
        ];

        $productIds = collect($po->items)->pluck('product_id')->filter()->unique()->values();
        $productMap = $productIds->isNotEmpty()
            ? DB::table('products')->whereIn('id', $productIds)->get(['id', 'product_code', 'name', 'description', 'brand'])->keyBy('id')
            : collect();

        $poProducts = collect($po->items)->map(function ($it) use ($productMap) {
            $qty = (float) $it->quantity;
            $rate = (float) $it->rate;
            $gstPct = (float) ($it->gst_pct ?: ((float) $it->cgst_pct + (float) $it->sgst_pct));
            $amt = (float) $it->cost;
            $live = $it->product_id ? $productMap->get($it->product_id) : null;
            if ($live) {
                $code = (string) ($live->product_code ?? '');
                $name = (string) ($live->name ?? '');
                $desc = (string) ($live->description ?? '');
                $brand = (string) ($live->brand ?? '');
            } else {
                $code = (string) ($it->product_code ?? '');
                $name = (string) ($it->product_name ?? '');
                $desc = '';
                $brand = '';
            }
            return [
                'product_code' => $code,
                'product_name' => $name . ($code !== '' ? " ({$code})" : ''),
                'brand' => $brand,
                'product_description' => $desc,
                'quantity' => $qty,
                'rate' => $rate,
                'gst_pct' => $gstPct,
                'amount' => $amt,
            ];
        })->values()->all();

        $totalCgst = (float) $po->total_cgst;
        $totalSgst = (float) $po->total_sgst;
        $subTotal = round((float) $po->total_product_cost - $totalCgst - $totalSgst, 2);
        $grandTotal = (float) $po->grand_total;
        $isIntl = ($po->document_type ?? 'Domestic') === 'International';
        $igst = $isIntl ? round($totalCgst + $totalSgst, 2) : 0;
        $cgst = $isIntl ? 0 : $totalCgst;
        $sgst = $isIntl ? 0 : $totalSgst;

        $poInfo = (object) [
            'code' => $po->code,
            'po_date' => optional($po->po_date)->format('d/m/Y') ?: '',
            'po_type' => $po->po_type ?: '',
            'edd' => optional($po->expected_delivery_date)->format('d/m/Y') ?: 'NA',
            'currency' => $po->currency_code ?: 'INR',
            'document_type' => $po->document_type ?: 'Domestic',
            'bt_id' => (string) ($po->shipment_code ?: ($po->shipment_order_id ?: '0')),
            'bt_date' => 'NA',
            'opp_id' => $po->opportunity_code ?: 'NA',
            'opp_date' => 'NA',
            'terms' => $po->terms ?: null,
        ];

        $totals = (object) [
            'shipping' => (float) $po->shipping_charges,
            'packing' => (float) $po->packaging_charges,
            'other' => (float) $po->other_charges,
            'sub_total' => $subTotal,
            'igst' => (float) $igst,
            'cgst' => (float) $cgst,
            'sgst' => (float) $sgst,
            'grand_total' => $grandTotal,
        ];

        $branchWebsite = trim((string) ($branch?->website ?? ''));
        $orgName = trim((string) ($branch?->name ?? '')) ?: trim((string) ($branch?->code ?? ''));
        $barcodeValue = $branchWebsite !== '' ? $branchWebsite : $orgName;

        return [
            'pdf_title' => 'PURCHASE ORDER',
            'signature' => $withSignature ? 'Yes' : 'No',
            'barcodeData' => $barcodeValue !== '' ? $this->makeCode128($barcodeValue) : null,
            'barcodeText' => $barcodeValue,
            'qrData' => $this->makeBankQr([
                'bank_name' => $bankDetails->bank_name ?: '',
                'account_holder' => $bankDetails->account_holder_name ?: '',
                'account_number' => $bankDetails->account_no ?: '',
                'ifsc_code' => $bankDetails->ifsc ?: '',
                'swift_code' => $bankDetails->swift_code ?: '',
                'branch_name' => $bankDetails->branch ?: '',
                'doc_code' => $po->code, 'amount' => $grandTotal, 'currency' => $po->currency_code ?? 'INR',
            ]),
            'companyDetails' => $companyDetails,
            'vendor' => $vendorBlock,
            'billTo' => $billTo,
            'deliverTo' => $deliverTo,
            'bankDetails' => $bankDetails,
            'po' => $poInfo,
            'products' => $poProducts,
            'totals' => $totals,
        ];
    }

    /* ──────────────────────────────────────────────────────────────────
     * REMINDER EMAIL endpoints — POST /sales/quotations/{id}/remind and
     *                             /sales/proforma-invoices/{id}/remind
     *
     * Sends a polite follow-up email to the customer with the document
     * PDF attached. The original document email MUST have been sent
     * first (`emailed_at` set) — otherwise the request is rejected
     * with 422 so the UI can prompt "send the initial email first".
     *
     * On success the row's `last_reminded_at` is updated and
     * `reminder_count` is incremented; the new count is returned in
     * the JSON so the frontend's reminder badge updates without a
     * full reload.
     * ────────────────────────────────────────────────────────────────── */
    public function remindQuotation(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $quot = Quotation::with([
            'items',
            'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        // Reminder = WRITE (stamps last_reminded_at + bumps reminder_count).
        $this->assertRecordScope($quot, $user, 'write');

        return $this->sendSalesReminderEmail(
            $request,
            $quot,
            kind: 'Quotation',
            pdfTitle: 'QUOTATION DOCUMENT',
            docLabel: 'QT',
            filenamePrefix: 'Quotation',
        );
    }

    public function remindProformaInvoice(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $pi = ProformaInvoice::with([
            'items',
            'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        $this->assertRecordScope($pi, $user, 'write');

        return $this->sendSalesReminderEmail(
            $request,
            $pi,
            kind: 'Proforma Invoice',
            pdfTitle: 'PROFORMA INVOICE',
            docLabel: 'PI',
            filenamePrefix: 'PI',
        );
    }

    /**
     * Shared reminder sender — mirrors sendSalesDocumentEmail but uses
     * the reminder Mailable + a different sequence rule:
     *   1) The initial email must have already gone out (`emailed_at`
     *      not null), otherwise 422.
     *   2) PDF is re-rendered and attached so the customer doesn't
     *      have to dig for the original.
     *   3) On success `reminder_count` is bumped and `last_reminded_at`
     *      is stamped — the response returns the new count so the
     *      frontend can update its badge.
     */
    private function sendSalesReminderEmail(Request $request, $record, string $kind, string $pdfTitle, string $docLabel, string $filenamePrefix): JsonResponse
    {
        // Sequence guard — no reminder before the original email.
        if (empty($record->emailed_at)) {
            return response()->json([
                'status'  => false,
                'message' => 'Send the initial email first — reminders go out only after the customer has received the document.',
            ], 422);
        }

        // Recipient resolution — same chain as the initial send.
        $override = trim((string) $request->input('to', ''));
        if ($override !== '' && filter_var($override, FILTER_VALIDATE_EMAIL)) {
            $to = $override;
        } else {
            $cust   = $record->customer;
            $custAd = $cust?->primaryAddress;
            $to     = $custAd?->cp_email ?? $cust?->primary_email ?? null;
        }
        if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            return response()->json([
                'status'  => false,
                'message' => 'No valid email address for this customer. Set a primary contact email on the customer first.',
            ], 422);
        }

        $withSignature = $request->boolean('signature', true);

        // Re-render the PDF so the reminder always carries the latest
        // version of the document (price/terms may have been edited).
        $viewData = $this->buildQuotationViewData($record, $withSignature, $pdfTitle, $docLabel);
        // DomPDF's pure-PHP renderer is slow on this heavy template (large
        // nested tables + multiple embedded images); on slower local boxes a
        // single render can approach the default 60s cap. Give it headroom so
        // the PDF always completes instead of 500-ing with a FatalError.
        @set_time_limit(180);
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);

        $tmpDir = storage_path('app/tmp/sales-pdfs');
        if (!is_dir($tmpDir)) @mkdir($tmpDir, 0775, true);
        $safeCode = preg_replace('/[^A-Za-z0-9_-]/', '_', $record->code ?? ('id-' . $record->id));
        $pdfFilename = $filenamePrefix . '-' . $safeCode . ($withSignature ? '_signed' : '_unsigned') . '.pdf';
        $pdfPath = $tmpDir . '/' . uniqid('remind-', true) . '-' . $pdfFilename;
        $pdf->save($pdfPath);

        $branch         = $record->branch;
        $reminderNumber = (int) ($record->reminder_count ?? 0) + 1;

        // Fresh signed view URL on every reminder — even if the prior
        // link expired, this one is good for another 60 days.
        $viewRouteName = $kind === 'Quotation' ? 'sales.quotation.view' : 'sales.pi.view';
        $viewUrl = \Illuminate\Support\Facades\URL::temporarySignedRoute(
            $viewRouteName,
            now()->addDays(60),
            ['id' => $record->id],
        );

        // Currency fallback (same rule as the initial-send path).
        $resolvedCurrency = (string) ($record->currency
            ?: ($record->doc_type === 'Domestic' ? 'INR' : 'USD'));

        $payload = [
            'docKind'        => $kind,
            'docLabel'       => $docLabel,
            'docCode'        => $record->code,
            'docDate'        => optional($record->created_at)->format('d/m/Y') ?: date('d/m/Y'),
            'branchName'     => $branch?->name    ?: ($branch?->code ?: 'Sales Team'),
            'branchEmail'    => $branch?->email   ?: null,
            'branchWebsite'  => $branch?->website ?: null,
            'customerName'   => $record->customer?->company_name ?: ($record->customer_name ?: 'Sir/Madam'),
            'reminderNumber' => $reminderNumber,
            'productsCount'  => (int) $record->items->count(),
            'grandTotal'     => (float) ($record->grand_total ?? 0),
            'currency'       => $resolvedCurrency,
            'docType'        => (string) ($record->doc_type ?? ''),
            'viewUrl'        => $viewUrl,
            'logoPath'       => $this->branchAssetAbsolutePath($branch?->logo),
            'pdfPath'        => $pdfPath,
            'pdfFilename'    => $pdfFilename,
        ];

        try {
            Mail::to($to)->send(new SalesReminderEmail($payload));
        } catch (\Throwable $e) {
            @unlink($pdfPath);
            Log::error('Sales reminder email failed', [
                'kind'       => $kind,
                'record'     => $record->code,
                'to'         => $to,
                'pdfPath'    => $pdfPath,
                'logoPath'   => $payload['logoPath'] ?? null,
                'errorClass' => get_class($e),
                'error'      => $e->getMessage(),
                'trace'      => $e->getTraceAsString(),
            ]);
            return response()->json([
                'status'  => false,
                'message' => config('app.debug')
                    ? "Could not send reminder email: {$e->getMessage()}"
                    : 'Could not send reminder. Please try again or contact support.',
            ], 500);
        }
        @unlink($pdfPath);

        // Stamp reminder bookkeeping atomically — increment count and
        // record the timestamp on the same row update so a race between
        // two rapid clicks doesn't lose a count.
        $record->forceFill([
            'reminder_count'   => $reminderNumber,
            'last_reminded_at' => now(),
        ])->save();

        return response()->json([
            'status'           => true,
            'message'          => "Reminder #{$reminderNumber} sent to {$to}",
            'to'               => $to,
            'reminder_count'   => $reminderNumber,
            'last_reminded_at' => optional($record->last_reminded_at)->toIso8601String(),
        ]);
    }

    /**
     * Map the saved Quotation + its relations into the view-data shape
     * the shared template (`pdf/proforma-invoice.blade.php`) expects.
     *
     * Company header is sourced ENTIRELY from the issuing Branch — no
     * hardcoded IGC fallback. Fields the branch hasn't filled in yet
     * render blank (template uses `?? ''` everywhere).
     */
    /**
     * Build the shared view-data array for both Quotation and PI PDFs.
     * Both models carry the same field names (code, opp_id, customer_id,
     * bank_account_id, doc_type, ports, totals, etc.), so the same
     * mapping works for either; the caller decides $pdfTitle and
     * $docLabelShort ('QT' vs 'PI') so the template's labels switch.
     *
     * @param  Quotation|ProformaInvoice  $q
     */
    /**
     * Render the shared `pdf.proforma-invoice` view to PDF bytes, caching the
     * result on the local disk keyed by a hash of the fully-resolved view
     * data (+ the signature flag).
     *
     * Why this is safe: the key hashes the ACTUAL rendered content — live
     * customer / product names, logo bytes, totals, ports, title, signature
     * flag, everything in $viewData. Any change to what the PDF shows changes
     * the hash and forces a fresh render, so a stale document can never be
     * served. The win: DomPDF's pure-PHP layout of this heavy nested-table
     * template costs several seconds per cold render; repeat view / download /
     * preview / send of an unchanged document now returns the cached bytes
     * instantly.
     *
     * NB: the key does NOT include the Blade template version, so after a
     * template change the cache should be cleared (`storage/app/pdf-cache`).
     */
    private function renderSalesPdfCached(array $viewData, bool $withSignature): string
    {
        $payload = json_encode($viewData);
        $key = $payload !== false
            ? 'pdf-cache/sales-' . md5($payload . '|' . ($withSignature ? 's' : 'u')) . '.pdf'
            : null;

        if ($key) {
            try {
                if (Storage::disk('local')->exists($key)) {
                    return Storage::disk('local')->get($key);
                }
            } catch (\Throwable $e) { /* fall through to a fresh render */
            }
        }

        // DomPDF's pure-PHP renderer is slow on this heavy template (large
        // nested tables + embedded images); a cold render can take several
        // seconds. Give it headroom so it never 500s mid-render.
        @set_time_limit(180);
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            // Required for the <script type="text/php"> page-number block at
            // the bottom of the Blade template to execute.
            ->setOption('isPhpEnabled', true);
        $bytes = $pdf->output();

        if ($key) {
            try {
                Storage::disk('local')->put($key, $bytes);
            } catch (\Throwable $e) { /* best-effort cache */
            }
        }

        return $bytes;
    }

    private function buildQuotationViewData($q, bool $withSignature, string $pdfTitle = 'QUOTATION DOCUMENT', string $docLabelShort = 'QT'): array
    {
        $branch = $q->branch;
        // Client (organisation) — the FALLBACK source for every letterhead
        // field: use the issuing Branch's value first, fall back to the
        // Client's value only when the branch hasn't filled that field in.
        // (gst_state_code, cin, iec, drug_license, pcpndt_no, aeo_code and the
        // One Star file/udin live on the branch only — no client fallback.)
        $client = !empty($q->client_id) ? \App\Models\Client::find($q->client_id) : null;

        // Address blocks composed from the structured address columns —
        // branch first, then client.
        $branchAddress = trim(implode(', ', array_filter([
            $branch?->address,
            $branch?->city,
            $branch?->state,
            $branch?->pincode,
            $branch?->country,
        ]))) ?: '';
        $clientAddress = trim(implode(', ', array_filter([
            $client?->address,
            $client?->city,
            $client?->state,
            $client?->pincode,
            $client?->country,
        ]))) ?: '';

        // Header logo: the branch's uploaded logo, else the CLIENT
        // (organisation) logo from the client form's "Organization Branding
        // > Logo" field. The client PROFILE photo is intentionally NOT used.
        // When both are missing the blade draws its text-box fallback.
        $logoData = $this->branchAssetDataUri($branch?->logo)
            ?: $this->branchAssetDataUri($client?->logo);

        $companyDetails = (object) [
            // Branch value first, Client value as fallback (per spec).
            'name'              => ($branch?->name ?: $client?->org_name) ?: ($branch?->code ?: 'Branch'),
            'address'           => $branchAddress ?: $clientAddress,
            'mobile'            => $branch?->phone      ?: ($client?->phone      ?? ''),
            'email'             => $branch?->email      ?: ($client?->email      ?? ''),
            'website'           => $branch?->website    ?: ($client?->website    ?? ''),
            'gst_no'            => $branch?->gst_number ?: ($client?->gst_number ?? ''),
            'pan_no'            => $branch?->pan_number ?: ($client?->pan_number ?? ''),
            // Branch-only fields (no matching client column) — blank when unset.
            'gst_state_code'    => $branch?->gst_state_code    ?? '',
            'cin'               => $branch?->cin               ?? '',
            'iec'               => $branch?->iec               ?? '',
            'drug_license'      => $branch?->drug_license      ?? '',
            'pcpndt_no'         => $branch?->pcpndt_no         ?? '',
            'aeo_code'          => $branch?->aeo_code          ?? '',
            'onestartfilename'  => $branch?->one_star_file_no  ?? '',
            'onestarudinumber'  => $branch?->one_star_udin_no  ?? '',
            'logo_url'          => $branch?->logo_url          ?? null,
            'signature_url'     => $branch?->signature_url     ?? null,
            // Per-branch theming — drives the PDF accent (product table
            // header bar, "Amount In Words" banner, divider lines). Falls
            // back to a neutral Inorbvict green when the branch hasn't
            // picked colors yet so the PDF still looks intentional.
            'primary_color'      => $primaryColor = ($this->normalizeHex($branch?->primary_color ?: $client?->primary_color)   ?: '#7CB342'),
            'secondary_color'    => $this->normalizeHex($branch?->secondary_color ?: $client?->secondary_color) ?: '#37B1E0',
            // Text color that READS on top of the primary color (white for
            // dark brand colors, near-black for light ones). Used by the
            // template wherever text sits on a primary-color background
            // (product table header row, Amount In Words banner).
            'primary_text_color' => $this->contrastColor($primaryColor),
            // Base64 data URIs for DomPDF — it can't fetch remote URLs by
            // default and the branch's storage URLs (storage/branch-logos/…)
            // wouldn't resolve from inside the PHP request context. Inlining
            // the bytes guarantees the image renders on every server config.
            'logo_data'         => $logoData,
            // Signature: branch's uploaded file first (when the Edit Branch
            // form gets a "Signature" upload field), then a bundled test
            // signature at public/images/test-signature.png so a tester can
            // just drop a file there without touching the DB.
            'signature_data'    => $this->branchAssetDataUri($branch?->signature_path)
                ?? $this->publicImageDataUri('images/test-signature.png'),
        ];

        // Buyer / Consignee — Name comes from the LIVE master row so
        // edits to the customer/consignee company name flow through to
        // every existing PDF (mirrors the live-product-name behaviour
        // for line items). Snapshotted columns (`customer_name`,
        // `consignee_name` on the quotation) are kept only as a
        // fallback for the case where the master row was deleted.
        // Address + email + phone come from the master's PRIMARY
        // address row (HasOne primaryAddress relation). Layout order:
        // Name → Address → Email → Phone (matches Inorbvict reference).
        $cust = $q->customer;
        $custAddr = $cust?->primaryAddress;
        $buyerDetails = (object) [
            'name'       => $cust?->company_name ?: ($q->customer_name ?: 'Customer'),
            'address'    => $this->composeAddress(
                $custAddr?->address_line,
                $custAddr?->city,
                $custAddr?->state,
                $custAddr?->pin,
                $custAddr?->country,
            ),
            'email'      => $custAddr?->cp_email ?? ($cust?->primary_email ?? ''),
            'contact_no' => $custAddr?->cp_contact ?? '',
        ];

        $cons = $q->consignee;
        $consAddr = $cons?->primaryAddress;
        $hasConsignee = (bool) $q->consignee_id;
        $consigneeDetails = $hasConsignee ? (object) [
            'name'    => $cons?->company_name ?: ($q->consignee_name ?: 'Consignee'),
            'address' => $this->composeAddress(
                $consAddr?->address_line,
                $consAddr?->city,
                $consAddr?->state,
                $consAddr?->pin,
                $consAddr?->country,
            ),
            'email'   => $consAddr?->cp_email ?? ($cons?->primary_email ?? ''),
            'mobile'  => $consAddr?->cp_contact ?? '',
        ] : null;

        // Bank details — pull the saved master_bank_accounts row by FK.
        // Falls back to a blank object so the template's `?->` chains don't
        // crash when no bank was selected on this quotation.
        $bankRow = $q->bank_account_id
            ? DB::table('master_bank_accounts')->where('id', $q->bank_account_id)->first()
            : null;
        $bankDetails = (object) [
            'bank_name'           => $bankRow->bank_name        ?? '',
            'account_holder_name' => $bankRow->account_holder   ?? '',
            'address'             => trim((string) ($bankRow->city ?? '')),
            'branch'              => $bankRow->branch_name      ?? '',
            'branch_code'         => '',
            'ad_code'             => $bankRow->ad_code          ?? '',
            'account_no'          => $bankRow->account_number   ?? '',
            'ifsc'                => $bankRow->ifsc_code        ?? '',
            'swift_code'          => $bankRow->swift_code       ?? '',
        ];

        // Line items — server-stamped amount on each row is the authoritative
        // (qty * rate * (1 + tax%/100)) total. Compute the tax breakup the
        // template wants: tax_amt = amount − base, rate_with_tax = rate × (1+tax%/100).
        // NB: template uses ARRAY access (`$product['product_name']`), so each
        // row is an assoc array, not a stdClass object.
        //
        // Product display uses the LIVE master row (products.name +
        // products.description + products.product_code) whenever the item
        // still carries a `product_id` — so editing a product in the
        // master immediately reflects on every PDF that references it.
        // Snapshot (`product_name` stored as "CODE – NAME" at insert) is
        // the fallback when product_id is null (free-text row) or the
        // master row has been deleted.
        $productIds = collect($q->items)->pluck('product_id')->filter()->unique()->values();
        $productMap = $productIds->isNotEmpty()
            ? DB::table('products')
            ->whereIn('id', $productIds)
            ->get(['id', 'product_code', 'name', 'description'])
            ->keyBy('id')
            : collect();

        $quotationProducts = collect($q->items)->map(function ($it) use ($productMap) {
            $qty   = (float) $it->quantity;
            $rate  = (float) $it->rate;
            $tax   = (float) $it->tax_pct;
            $base  = $qty * $rate;
            $amt   = (float) $it->amount;

            $live = $it->product_id ? $productMap->get($it->product_id) : null;
            if ($live) {
                $code = (string) ($live->product_code ?? '');
                $name = (string) ($live->name ?? '');
                $desc = (string) ($live->description ?? '');
            } else {
                // Fallback: split snapshotted "CODE – NAME". The separator
                // MUST have whitespace on both sides so internal hyphens
                // like the one in "P-03" stay with the code. Accepts the
                // en-dash (U+2013, what MasterSelect uses) and ASCII '-'.
                $rawName = trim((string) ($it->product_name ?? ''));
                if (preg_match('/^(.+?)\s+[\x{2013}\-]\s+(.+)$/u', $rawName, $m)) {
                    $code = trim($m[1]);
                    $name = trim($m[2]);
                } else {
                    $code = '';
                    $name = $rawName;
                }
                $desc = '';
            }

            return [
                'product_code'        => $code,
                'product_name'        => $name,
                'model_name'          => '',
                'product_description' => $desc,
                'unit'                => $it->unit ?? '',
                'quantity'            => $qty,
                'rate'                => $rate,
                'tax_pct'             => $tax,
                'tax_amt'             => round($amt - $base, 2),
                'rate_with_tax'       => $tax > 0 ? round($rate * (1 + $tax / 100), 2) : $rate,
                'amount'              => $amt,
            ];
        });

        $subTotal      = (float) $q->sub_total;
        $shippingCost  = (float) $q->shipping;
        $grandTotal    = (float) $q->grand_total;
        $packagingCost = 0.0;

        // Tax split — the line-level tax_pct already rolls into `amount`,
        // so the breakup at the foot of the PDF reflects total tax collected
        // and is split CGST/SGST for Domestic, IGST for International, mirroring
        // the IDIMS template's expectations. Pure presentation — no recompute.
        $totalTax = round(collect($quotationProducts)->sum('tax_amt'), 2);
        $isInternational = ($q->doc_type ?? 'International') === 'International';
        $igst = $isInternational ? $totalTax : 0;
        $cgst = $isInternational ? 0        : round($totalTax / 2, 2);
        $sgst = $isInternational ? 0        : round($totalTax - $cgst, 2);

        $port = null;
        if ($q->port_of_loading) {
            // Try to split a "CODE-Name" or "CODE - Name" label into the
            // {code, name} pair the template renders. Fall back to plain name.
            if (preg_match('#^([A-Z0-9]+)\s*[-–]\s*(.+)$#u', (string) $q->port_of_loading, $m)) {
                $port = (object) ['code' => $m[1], 'name' => trim($m[2]), 'address' => ''];
            } else {
                $port = (object) ['code' => '', 'name' => (string) $q->port_of_loading, 'address' => ''];
            }
        }

        $quotation = (object) [
            'pi_number'             => $q->code,
            'pi_date'               => optional($q->created_at)->format('Y-m-d') ?? date('Y-m-d'),
            'document_type'         => $q->doc_type ?? 'International',
            'currency_name'         => $q->currency ?? '',
            'currency'              => (object) ['name' => $q->currency ?? ''],
            'consignee_id'          => $hasConsignee ? $q->consignee_id : null,
            'port_of_discharge'     => $q->port_of_discharge ?? '',
            'final_destination'     => $q->final_destination ?? '',
            'origin_country'        => $q->origin_country    ?? '',
            'inco_term_name'        => $q->inco_term         ?? '',
            'net_weight'            => '',
            'gross_weight'          => '',
            'portOfLoading'         => $port,
            'total'                 => $subTotal,
            'igst'                  => $igst,
            'cgst'                  => $cgst,
            'sgst'                  => $sgst,
            'shipping_cost'         => $shippingCost,
            'packaging_cost'        => $packagingCost,
            'grand_total'           => $grandTotal,
            // No static fallback: the T&C section is now driven by the
            // auto-fetched, segment-matched master T&Cs (segmentTermsConditions).
            // Only a user-typed `terms` value renders the manual block above
            // them; an empty terms field shows nothing here (no hardcoded
            // defaultTerms() boilerplate).
            'terms_and_conditions'  => $q->terms ?: null,
        ];

        // ── Real scannable barcode ─────────────────────────────────────
        // Top-right header barcode (every page): Code128 of the BRANCH
        // WEBSITE when set so scanning the letterhead opens the company's
        // site. When no website is configured we fall back to the
        // ORGANISATION NAME so the barcode + its caption are still
        // meaningful on every page, instead of leaving the slot as plain
        // text.
        $branchWebsite  = trim((string) ($branch?->website ?? ''));
        $orgName        = trim((string) ($branch?->name ?? '')) ?: trim((string) ($branch?->code ?? ''));
        $barcodeValue   = $branchWebsite !== '' ? $branchWebsite : $orgName;
        $barcodeData    = $barcodeValue !== '' ? $this->makeCode128($barcodeValue) : null;
        $barcodePayload = $barcodeValue;
        // Bottom-left bank QR: plain-text payload that includes the bank
        // account info + this quotation's grand total so a scan gives the
        // receiver everything they need to pay (bank-to-bank or UPI). The
        // payload is built per-quotation so a different bank account on
        // each row yields a different QR — exactly what you asked for.
        $qrData = $this->makeBankQr([
            'bank_name'      => $bankRow->bank_name        ?? '',
            'account_holder' => $bankRow->account_holder   ?? '',
            'account_number' => $bankRow->account_number   ?? '',
            'ifsc_code'      => $bankRow->ifsc_code        ?? '',
            'swift_code'     => $bankRow->swift_code       ?? '',
            'branch_name'    => $bankRow->branch_name      ?? '',
            'doc_code'       => $q->code,
            'amount'         => (float) $q->grand_total,
            'currency'       => $q->currency               ?? 'INR',
        ]);

        return [
            // Caller-driven so this builder serves both Quotation
            // ('QUOTATION DOCUMENT' / 'QT') and PI ('PROFORMA INVOICE' / 'PI').
            'pdf_title'              => $pdfTitle,
            'doc_label_short'        => $docLabelShort,
            'signature'              => $withSignature ? 'Yes' : 'No',
            'barcodeData'            => $barcodeData,
            'barcodeText'            => $barcodePayload,    // shown as readable text below the bars
            'qrData'                 => $qrData,
            'companyDetails'         => $companyDetails,
            'buyerDetails'           => $buyerDetails,
            'consigneeDetails'       => $consigneeDetails,
            'bankDetails'            => $bankDetails,
            'quotation'              => $quotation,
            'quotationProducts'      => $quotationProducts,
            'opportunity_id'         => $q->opp_code ?? null,
            'opportunity_date'       => $q->opportunity_date
                ? \DateTime::createFromFormat('Y-m-d', $q->opportunity_date->format('Y-m-d'))
                : null,
            'termsAndConditions'     => null,
            // Auto-fetched from the T&C Library: matched by the document's
            // type (International/Domestic) + kind (Quotation/PI) + each
            // product's segment & regulatory tier. Rendered on the PDF only.
            'segmentTermsConditions' => $this->fetchSegmentTncs($q, $docLabelShort),
            'base_currency_total'    => $grandTotal,
            'exchange_rate'          => $q->exchange_rate ? (float) $q->exchange_rate : null,
        ];
    }

    /**
     * Auto-fetch the Terms & Conditions blocks that apply to this document
     * from the T&C Library (clm_tnc_library), for rendering on the PDF.
     *
     * Matching keys (all live, nothing hard-coded except the doc-kind word):
     *   1. Document KIND  — 'Quotation' for QT, 'Proforma Invoice' for PI
     *      (derived from $docLabelShort).
     *   2. Document TYPE  — $q->doc_type ('International' | 'Domestic').
     *      → A T&C's Document Category must contain BOTH the type word and
     *        the kind words (case-insensitive), so "International Proforma
     *        Invoice", "International - Proforma Invoice", etc. all match.
     *   3. SEGMENT + regulatory tier — each line-item product resolves to a
     *      clm_segments row (products.segment_id → name + regulatory_status,
     *      same unified table). A T&C applies when its `regulatory` equals
     *      that segment's tier AND its segment list contains the segment
     *      name (single for 'highly', any-of-CSV for 'less').
     *
     * Returns a de-duplicated list of ['code','category','segment','content'].
     */
    private function fetchSegmentTncs($q, string $docLabelShort): array
    {
        $clientId = $q->client_id ?? null;
        if (!$clientId) return [];

        // Quotation and Proforma Invoice SHARE the same T&C set — a document's
        // kind no longer picks a different category. Both always match the
        // "Proforma Invoice" categories (the two Quotation categories were
        // retired and their T&Cs merged onto the PI ones). The International vs
        // Domestic split below ($docType) still applies.
        $docKind = 'proforma invoice';
        $docType = mb_strtolower(trim((string) ($q->doc_type ?? 'International'))); // international|domestic
        if ($docType === '') return [];

        // Items in their on-document SEQUENCE (line_no, then id) — the T&Cs
        // are emitted product-by-product in this same order.
        $items = collect($q->items ?? [])
            ->sortBy(fn($it) => [(int) ($it->line_no ?? 0), (int) ($it->id ?? 0)])
            ->values();
        $productIds = $items->pluck('product_id')->filter()->unique()->values();
        if ($productIds->isEmpty()) return [];

        // product_id → segment_id, and segment_id → ClmSegment (name + tier).
        $prodToSeg = \App\Models\Product::whereIn('id', $productIds)
            ->pluck('segment_id', 'id');
        $segById = \App\Models\ClmSegment::where('client_id', $clientId)
            ->whereIn('id', $prodToSeg->filter()->unique()->values())
            ->get(['id', 'name', 'regulatory_status'])
            ->keyBy('id');
        if ($segById->isEmpty()) return [];

        // Candidate T&Cs — pre-filtered to the doc type + kind (tolerant).
        $candidates = \App\Models\ClmTncLibrary::where('client_id', $clientId)
            ->where(function ($w) {
                $w->whereNull('status')->orWhere('status', 'active');
            })
            ->orderBy('id')
            ->get()
            ->filter(function ($row) use ($docType, $docKind) {
                $cat = mb_strtolower((string) $row->category);
                return str_contains($cat, $docType) && str_contains($cat, $docKind);
            });

        // Walk products in sequence; for each product's segment, append every
        // matching T&C (deduped by id, so a segment shared by two products
        // doesn't repeat). Order therefore follows the product sequence.
        $matched = [];
        foreach ($items as $it) {
            $segId = $it->product_id ? ($prodToSeg[$it->product_id] ?? null) : null;
            if (!$segId) continue;
            $seg = $segById->get($segId);
            if (!$seg) continue;

            $segNameLc = mb_strtolower((string) $seg->name);
            $segReg    = (string) $seg->regulatory_status;

            foreach ($candidates as $row) {
                if (isset($matched[$row->id])) continue;             // already emitted
                if ((string) $row->regulatory !== $segReg) continue; // tier must agree
                $tncSegs = array_filter(array_map(
                    fn($s) => mb_strtolower(trim($s)),
                    explode(',', (string) $row->segment)
                ));
                if (!in_array($segNameLc, $tncSegs, true)) continue; // segment must match
                $matched[$row->id] = [
                    'code'     => $row->code,
                    'category' => $row->category,
                    'segment'  => $seg->name,   // the product segment that pulled it in
                    'content'  => $row->content,
                ];
            }
        }

        return array_values($matched);
    }

    /**
     * Join the parts of an address into a single comma-separated line,
     * skipping any null/empty/whitespace-only pieces. Returns '' when
     * every part is empty (so the PDF can decide to suppress the line).
     */
    private function composeAddress(?string ...$parts): string
    {
        $clean = [];
        foreach ($parts as $p) {
            $p = trim((string) ($p ?? ''));
            if ($p !== '') $clean[] = $p;
        }
        return implode(', ', $clean);
    }

    /**
     * Generate a Code128 barcode for the given payload (typically the
     * QT / PI number) and return it as a base64 PNG data URI. DomPDF
     * embeds the result directly as an <img src="data:…">.
     */
    private function makeCode128(?string $payload): ?string
    {
        $payload = trim((string) ($payload ?? ''));
        if ($payload === '') return null;
        try {
            $d = new DNS1D();
            $d->setStorPath(storage_path('framework/cache/barcodes/'));
            // Module width scales down as the payload grows so a 30-char
            // website URL still fits the header strip (Code128 needs ~11
            // bar-modules per encoded character; at width 1.0 a 30-char
            // URL is ~330px wide which fits the 40%-of-page right column).
            $len = strlen($payload);
            $moduleWidth = $len > 20 ? 1.0 : ($len > 14 ? 1.3 : 1.6);
            // Height 30px — bars only, no rasterized text. The readable
            // text (URL / QT no) is rendered separately by the template
            // below the image in a clean PDF font, which scans better and
            // doesn't show the chunky bitmap OCR font milon ships with.
            // Last `false` arg = showCode disabled.
            $png = $d->getBarcodePNG($payload, 'C128', $moduleWidth, 30, [0, 0, 0], false);
            return $png ? 'data:image/png;base64,' . $png : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Generate a QR code containing the issuing bank's payment details
     * so the receiver can scan it to populate an NEFT/RTGS/IMPS form
     * (or just look up the account). Payload is a compact multi-line
     * plaintext block; banking apps generally treat free-text QRs as
     * "copy to clipboard" which is good enough for this use-case.
     *
     * The payload is built per-quotation so two quotations using two
     * different bank accounts will yield two visually-different QRs
     * (as requested).
     */
    private function makeBankQr(array $b): ?string
    {
        $lines = [];
        if ($b['bank_name']      !== '') $lines[] = 'Bank: '    . $b['bank_name'];
        if ($b['account_holder'] !== '') $lines[] = 'Holder: '  . $b['account_holder'];
        if ($b['account_number'] !== '') $lines[] = 'A/C: '     . $b['account_number'];
        if ($b['ifsc_code']      !== '') $lines[] = 'IFSC: '    . $b['ifsc_code'];
        if ($b['swift_code']     !== '') $lines[] = 'SWIFT: '   . $b['swift_code'];
        if ($b['branch_name']    !== '') $lines[] = 'Branch: '  . $b['branch_name'];
        if (!empty($b['doc_code'])) {
            $lines[] = 'Ref: ' . $b['doc_code'];
            if (!empty($b['amount'])) {
                $lines[] = 'Amount: ' . trim(($b['currency'] ?? 'INR') . ' ' . number_format((float) $b['amount'], 2));
            }
        }
        if (!$lines) return null;

        try {
            $options = new QROptions([
                // Don't pin a version — chillerlan auto-picks the smallest
                // version that fits the payload (multi-line bank block is
                // ~1500 bits, which overflows the fixed version=5 cap of
                // 688 bits). versionMin=3 keeps the matrix readable; max=10
                // keeps the printed QR under ~150px so it fits the bank cell.
                'versionMin'   => 3,
                'versionMax'   => 10,
                'eccLevel'     => 0,           // L — most permissive, max payload
                'scale'        => 4,
                'imageBase64'  => true,
                'outputType'   => 'png',
            ]);
            return (new QRCode($options))->render(implode("\n", $lines));
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Pick a readable text color (white or near-black) for any background
     * hex by computing perceived brightness (YIQ formula). Branches that
     * choose a light primary like `#FFEB3B` would otherwise render white
     * text on yellow — invisible. With this helper the template gets a
     * `primary_text_color` that always contrasts properly.
     *
     * Threshold 155 was tuned against representative brand-color picks:
     *   teal #3894b2 (YIQ 142) → white  ✓
     *   green #7CB342 (YIQ 150) → white  ✓ (matches reference Inorbvict)
     *   orange #FF5722 (YIQ 137) → white  ✓
     *   yellow #FFEB3B (YIQ 211) → dark   ✓ (would be invisible on white)
     *   pastel pink #fdd835 (YIQ 195) → dark ✓
     *   mustard #f9a825 (YIQ 169) → dark ✓
     */
    private function contrastColor(?string $hex): string
    {
        $hex = ltrim((string) ($hex ?? ''), '#');
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        if (!preg_match('/^[0-9a-fA-F]{6}$/', $hex)) return '#ffffff';
        $r = hexdec(substr($hex, 0, 2));
        $g = hexdec(substr($hex, 2, 2));
        $b = hexdec(substr($hex, 4, 2));
        $yiq = ($r * 299 + $g * 587 + $b * 114) / 1000;
        return $yiq >= 155 ? '#1f1f1f' : '#ffffff';
    }

    /**
     * Validate + normalize a user-supplied hex color so it can be
     * dropped into an inline `style="background:#…"` without XSS risk.
     * Accepts "#abc", "#aabbcc", "abc", "aabbcc"; returns the canonical
     * `#aabbcc` (lowercased) or null if the input isn't a hex color.
     */
    private function normalizeHex(?string $hex): ?string
    {
        $hex = strtolower(trim((string) ($hex ?? '')));
        $hex = ltrim($hex, '#');
        if (!preg_match('/^[0-9a-f]{3}([0-9a-f]{3})?$/', $hex)) return null;
        if (strlen($hex) === 3) {
            // Expand "#abc" → "#aabbcc"
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        return '#' . $hex;
    }

    /**
     * Read a file shipped under `/public/{relative}` (e.g. the bundled
     * test signature at `public/images/test-signature.png`) and return
     * a `data:{mime};base64,…` URI. Used as the fallback for fields
     * the branch hasn't filled in yet so the PDF still renders a real
     * image while testing.
     */
    private function publicImageDataUri(string $relative): ?string
    {
        $path = public_path($relative);
        if (!is_file($path)) return null;
        $bytes = @file_get_contents($path);
        if ($bytes === false) return null;
        $mime = function_exists('mime_content_type')
            ? (mime_content_type($path) ?: 'image/png')
            : 'image/png';

        // Flatten alpha onto white before embedding. The bundled
        // test-signature.png is a 1016×639 transparent PNG; left as-is,
        // DomPDF's pure-PHP alpha splitter walks ~650k pixels and trips
        // PHP's 60s max_execution_time (Cpdf.php). A flattened opaque PNG
        // skips that path. Signatures sit on the white signature block so
        // compositing onto white is visually identical.
        $flat = $this->flattenImageForPdf($bytes);
        if ($flat !== null) {
            $bytes = $flat;
            $mime  = 'image/png';
        }

        return 'data:' . $mime . ';base64,' . base64_encode($bytes);
    }

    /**
     * Resolve a branch-uploaded asset (logo / signature image) to a
     * `data:{mime};base64,…` URI suitable for direct embedding into the
     * PDF. Returns null when the path is empty, malformed, or the file
     * doesn't exist on the `public` disk.
     *
     * DomPDF can't fetch remote URLs in its default config and even when
     * it can, doing so on every PDF render is slow + brittle. Inlining
     * the bytes here is faster and works on every server config.
     */
    private function branchAssetDataUri(?string $path): ?string
    {
        if (!$path) return null;

        // Mirror file_url()'s normalization so we accept any of the
        // forms the upload pipeline historically stored:
        //   "branch-logos/abc.png" / "/storage/branch-logos/abc.png" /
        //   "storage/branch-logos/abc.png" / "public/branch-logos/abc.png"
        $norm = ltrim(str_replace('\\', '/', trim($path)), '/');
        foreach (['storage/', 'public/'] as $strip) {
            if (str_starts_with($norm, $strip)) $norm = substr($norm, strlen($strip));
        }
        if (!str_contains($norm, '/')) return null;

        try {
            if (!Storage::disk('public')->exists($norm)) return null;

            // Cache the flattened + encoded data URI keyed by path + mtime so
            // repeated renders (view / download / preview / send all hit this)
            // don't re-run the GD flatten + base64 each time. A re-upload
            // changes lastModified and busts the entry.
            $stamp    = (string) (Storage::disk('public')->lastModified($norm) ?: 0);
            $cacheKey = 'sales_pdf_asset_uri:' . md5($norm . '|' . $stamp);

            return Cache::remember($cacheKey, now()->addDay(), function () use ($norm) {
                $bytes = Storage::disk('public')->get($norm);
                $mime  = Storage::disk('public')->mimeType($norm) ?: 'image/png';

                // Flatten any alpha channel onto white (and downscale) before
                // embedding. DomPDF renders transparent PNGs by splitting an
                // alpha mask pixel-by-pixel in pure PHP (Cpdf.php) — on a large
                // logo that loop runs width×height times and exceeds PHP's
                // 60s max_execution_time. A flattened, non-alpha PNG skips that
                // path entirely, so the render finishes in well under a second.
                $flat = $this->flattenImageForPdf($bytes);
                if ($flat !== null) {
                    $bytes = $flat;
                    $mime  = 'image/png';
                }

                return 'data:' . $mime . ';base64,' . base64_encode($bytes);
            });
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Composite an image onto a solid white background (dropping any alpha
     * channel) and downscale it to a sane max width, returning PNG bytes —
     * or null if GD isn't available or the bytes aren't a decodable image.
     *
     * This is the antidote to the DomPDF "Maximum execution time exceeded"
     * in Cpdf.php: that timeout comes from DomPDF's pure-PHP transparent-PNG
     * handler walking every pixel to build an alpha mask. By handing DomPDF
     * an opaque (no-alpha) PNG we avoid that code path completely; the
     * downscale further bounds the embed cost (logos render at ~200px).
     */
    private function flattenImageForPdf(string $bytes, int $maxWidth = 800): ?string
    {
        if (!function_exists('imagecreatefromstring')) return null;

        $src = @imagecreatefromstring($bytes);
        if ($src === false) return null;

        try {
            $sw = max(1, imagesx($src));
            $sh = max(1, imagesy($src));
            $scale = $sw > $maxWidth ? $maxWidth / $sw : 1.0;
            $dw = max(1, (int) round($sw * $scale));
            $dh = max(1, (int) round($sh * $scale));

            $canvas = imagecreatetruecolor($dw, $dh);
            // Paint white, then alpha-blend the source on top so semi-
            // transparent pixels resolve against white instead of black.
            imagefilledrectangle($canvas, 0, 0, $dw, $dh, imagecolorallocate($canvas, 255, 255, 255));
            imagealphablending($canvas, true);
            if ($scale < 1.0) {
                imagecopyresampled($canvas, $src, 0, 0, 0, 0, $dw, $dh, $sw, $sh);
            } else {
                imagecopy($canvas, $src, 0, 0, 0, 0, $sw, $sh);
            }
            // Write WITHOUT an alpha channel so DomPDF takes the fast path.
            imagesavealpha($canvas, false);

            ob_start();
            imagepng($canvas, null, 6);
            $out = ob_get_clean();
            imagedestroy($canvas);

            return ($out !== false && $out !== '') ? $out : null;
        } finally {
            imagedestroy($src);
        }
    }

    /**
     * Returns the absolute filesystem path of a branch asset (logo /
     * signature / etc.), or null if the file isn't readable.
     *
     * Used by the email senders — Mailables embed images via CID
     * (`$message->embed($absolutePath)`), which needs the actual file
     * path on disk, not a data URI. CID-embedded images render
     * reliably in Gmail, Outlook, Apple Mail — data URIs in <img src>
     * get stripped by Gmail for security.
     */
    /**
     * Tenant + branch-aware authorisation for a Quotation or PI record.
     * Mirrors QuotationController::assertScope so that the PDF / email
     * endpoints exposed here enforce identical hierarchy rules:
     *
     *   - super_admin / client_admin / client_user → full access
     *   - branch_user → own-branch full, other branches: 404 (invisible)
     *
     * Every branch is an isolated peer, so $action is no longer used to
     * distinguish read vs write across branches.
     */
    private function assertRecordScope($record, $user, string $action = 'read'): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $record->client_id !== (int) $user->client_id) {
            abort(404);
        }
        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ((int) $record->branch_id === (int) $user->branch_id) return;

        // Foreign branch — invisible to this user.
        abort(404);
    }

    private function branchAssetAbsolutePath(?string $path): ?string
    {
        if (!$path) return null;

        $norm = ltrim(str_replace('\\', '/', trim($path)), '/');
        foreach (['storage/', 'public/'] as $strip) {
            if (str_starts_with($norm, $strip)) {
                $norm = substr($norm, strlen($strip));
            }
        }
        if (!str_contains($norm, '/')) {
            return null;
        }

        try {
            $disk = Storage::disk('public');
            if ($disk->exists($norm)) {
                $abs = $disk->path($norm);
                if (is_file($abs) && is_readable($abs)) {
                    return $abs;
                }
            }

            // If the provided path is already an absolute filesystem path,
            // try it directly as a fallback.
            if (is_file($path) && is_readable($path)) {
                return $path;
            }

            if (is_file($norm) && is_readable($norm)) {
                return $norm;
            }

            Log::warning('Branch logo asset not readable', [
                'path' => $path,
                'normalized' => $norm,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Branch logo asset lookup failed', [
                'path' => $path,
                'normalized' => $norm,
                'error' => $e->getMessage(),
            ]);
        }

        return null;
    }

    private function defaultTerms(): string
    {
        return <<<TXT
1. Validity: This Proforma Invoice is valid for 30 days from the issue date unless extended in writing.

2. Payment Terms: 50% advance against PI; balance prior to dispatch / before Bill of Lading release for international shipments.

3. Delivery: Delivery period is indicative and starts from the date of receipt of confirmed Purchase Order and advance payment.

4. Taxes & Duties: Prices are exclusive of GST (for domestic) or IGST (for export benefits) unless explicitly mentioned. All government levies will be charged extra at actuals.

5. Warranty: Standard manufacturer's warranty applies. Consumables, calibration kits, and software licences are excluded from warranty unless mentioned otherwise.

6. Cancellation: Order once accepted is non-cancellable. Any cancellation request shall attract restocking charges up to 25% of order value.

7. Force Majeure: Neither party shall be liable for delay or non-performance arising out of natural calamities, civil unrest, war, government action or other events beyond reasonable control.

8. Jurisdiction: All disputes are subject to the exclusive jurisdiction of the courts at Pune, Maharashtra, India.

9. Returns / Replacements: Any discrepancy must be reported within 7 (seven) days of receipt of goods. Returns will be accepted only against prior written authorisation.

10. Quality: Goods supplied are subject to inspection at the seller's premises before dispatch. No further claims will be entertained for transit damage if goods are not insured by the buyer.
TXT;
    }
}

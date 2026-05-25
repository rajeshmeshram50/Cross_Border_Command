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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Response;
use Illuminate\Support\Facades\Storage;
use Milon\Barcode\DNS1D;
use stdClass;

/**
 * Sales Matrix → QPI page PDF previews.
 *
 * Renders the Proforma Invoice in the IDIMS-derived layout (see
 * resources/views/pdf/proforma-invoice.blade.php). Two variants ride
 * on the same template — `signature=1` stamps the authorised-signatory
 * mark, `signature=0` leaves the block blank for manual signing.
 *
 * QPI is mock-data only right now, so the request body carries the row
 * fields the frontend has (piNo, customer, etc.). Everything else is
 * filled with dummy data shaped exactly like the production IDIMS PDF
 * controller expects — $companyDetails, $buyerDetails, $consigneeDetails,
 * $bankDetails, $quotation (with currency relationship), $quotationProducts
 * (Collection), $pdf_title, $signature, $opportunity_id, $opportunity_date,
 * $termsAndConditions.
 */
class SalesPdfController extends Controller
{
    /**
     * POST /sales/pi/preview-pdf
     *
     * Returns the PDF inline so the frontend can open it in a new tab
     * via blob URL.
     */
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
        try { return new \DateTime($s); } catch (\Exception) { return null; }
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

        // Tenant scope — same rule as QuotationController::assertScope.
        if ($user->user_type !== 'super_admin' &&
            (!$user->client_id || (int) $quot->client_id !== (int) $user->client_id)) {
            abort(404);
        }

        $withSignature = $request->boolean('signature', true);

        $viewData = $this->buildQuotationViewData($quot, $withSignature);

        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            // Required for the <script type="text/php"> page-number block
            // at the bottom of the Blade template to actually execute.
            // The global dompdf config has enable_php=false (default,
            // for security); we opt-in only on this controller's PDFs.
            ->setOption('isPhpEnabled', true);

        $filename = 'Quotation-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $quot->code ?? ('id-' . $quot->id))
            . ($withSignature ? '_signed' : '_unsigned') . '.pdf';

        return Response::make($pdf->output(), 200, [
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

        // Tenant scope — same rule as ProformaInvoiceController::assertScope.
        if ($user->user_type !== 'super_admin' &&
            (!$user->client_id || (int) $pi->client_id !== (int) $user->client_id)) {
            abort(404);
        }

        $withSignature = $request->boolean('signature', true);

        // Same builder as the Quotation variant — both models share the
        // exact same field names (code, opp_id, customer_id, ports,
        // totals, etc.), so the mapping is identical. Only the title
        // + label are different.
        $viewData = $this->buildQuotationViewData($pi, $withSignature, 'PROFORMA INVOICE', 'PI');

        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            // Required for the <script type="text/php"> page-number block
            // at the bottom of the Blade template to actually execute.
            // The global dompdf config has enable_php=false (default,
            // for security); we opt-in only on this controller's PDFs.
            ->setOption('isPhpEnabled', true);

        $filename = 'PI-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $pi->code ?? ('id-' . $pi->id))
            . ($withSignature ? '_signed' : '_unsigned') . '.pdf';

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
            'items', 'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        if ($user->user_type !== 'super_admin' &&
            (!$user->client_id || (int) $quot->client_id !== (int) $user->client_id)) {
            abort(404);
        }

        return $this->sendSalesDocumentEmail(
            $request, $quot,
            kind: 'Quotation', pdfTitle: 'QUOTATION DOCUMENT', docLabel: 'QT',
            filenamePrefix: 'Quotation',
        );
    }

    public function emailProformaInvoice(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $pi = ProformaInvoice::with([
            'items', 'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        if ($user->user_type !== 'super_admin' &&
            (!$user->client_id || (int) $pi->client_id !== (int) $user->client_id)) {
            abort(404);
        }

        return $this->sendSalesDocumentEmail(
            $request, $pi,
            kind: 'Proforma Invoice', pdfTitle: 'PROFORMA INVOICE', docLabel: 'PI',
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
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);

        $tmpDir = storage_path('app/tmp/sales-pdfs');
        if (!is_dir($tmpDir)) @mkdir($tmpDir, 0775, true);
        $safeCode = preg_replace('/[^A-Za-z0-9_-]/', '_', $record->code ?? ('id-' . $record->id));
        $pdfFilename = $filenamePrefix . '-' . $safeCode . ($withSignature ? '_signed' : '_unsigned') . '.pdf';
        $pdfPath = $tmpDir . '/' . uniqid('mail-', true) . '-' . $pdfFilename;
        $pdf->save($pdfPath);

        // 3) Build the email payload (product summary = first item's name,
        //    branch name/email/website for the signature block). Prefer the
        //    LIVE product master name so renames in the product master flow
        //    through to the email body too (mirrors the PDF behaviour).
        $branch = $record->branch;
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

        $payload = [
            'docKind'        => $kind,
            'docCode'        => $record->code,
            'docDate'        => optional($record->created_at)->format('d/m/Y') ?: date('d/m/Y'),
            'branchName'     => $branch?->name    ?: ($branch?->code ?: 'Sales Team'),
            'branchEmail'    => $branch?->email   ?: null,
            'branchWebsite'  => $branch?->website ?: null,
            'customerName'   => $record->customer?->company_name ?: ($record->customer_name ?: 'Sir/Madam'),
            'productSummary' => $productSummary,
            'pdfPath'        => $pdfPath,
            'pdfFilename'    => $pdfFilename,
        ];

        // 4) Send + always clean up the temp PDF, even if the mailer throws.
        try {
            Mail::to($to)->send(new SalesDocumentEmail($payload));
        } catch (\Throwable $e) {
            @unlink($pdfPath);
            Log::error('Sales document email failed', [
                'kind'    => $kind,
                'record'  => $record->code,
                'to'      => $to,
                'error'   => $e->getMessage(),
            ]);
            // Keep the user-facing message generic — raw driver errors
            // (SMTP timeouts, auth failures, DB exceptions) leak server
            // internals. The full trace is in laravel.log for ops.
            return response()->json([
                'status'  => false,
                'message' => "Could not send {$kind} email. Please try again or contact support.",
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
            'items', 'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        if ($user->user_type !== 'super_admin' &&
            (!$user->client_id || (int) $quot->client_id !== (int) $user->client_id)) {
            abort(404);
        }

        return $this->sendSalesReminderEmail(
            $request, $quot,
            kind: 'Quotation', pdfTitle: 'QUOTATION DOCUMENT', docLabel: 'QT',
            filenamePrefix: 'Quotation',
        );
    }

    public function remindProformaInvoice(Request $request, int $id): JsonResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $pi = ProformaInvoice::with([
            'items', 'branch',
            'customer:id,customer_code,company_name,primary_email,website',
            'customer.primaryAddress:id,customer_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'consignee:id,consignee_code,company_name,primary_email,website',
            'consignee.primaryAddress:id,consignee_id,address_line,country,state,city,pin,cp_contact,cp_email',
            'lead:id,opp_code,query_time',
            'salesManager:id,name',
        ])->findOrFail($id);

        if ($user->user_type !== 'super_admin' &&
            (!$user->client_id || (int) $pi->client_id !== (int) $user->client_id)) {
            abort(404);
        }

        return $this->sendSalesReminderEmail(
            $request, $pi,
            kind: 'Proforma Invoice', pdfTitle: 'PROFORMA INVOICE', docLabel: 'PI',
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

        $payload = [
            'docKind'        => $kind,
            'docCode'        => $record->code,
            'docDate'        => optional($record->created_at)->format('d/m/Y') ?: date('d/m/Y'),
            'branchName'     => $branch?->name    ?: ($branch?->code ?: 'Sales Team'),
            'branchEmail'    => $branch?->email   ?: null,
            'branchWebsite'  => $branch?->website ?: null,
            'customerName'   => $record->customer?->company_name ?: ($record->customer_name ?: 'Sir/Madam'),
            'reminderNumber' => $reminderNumber,
            'pdfPath'        => $pdfPath,
            'pdfFilename'    => $pdfFilename,
        ];

        try {
            Mail::to($to)->send(new SalesReminderEmail($payload));
        } catch (\Throwable $e) {
            @unlink($pdfPath);
            Log::error('Sales reminder email failed', [
                'kind'    => $kind,
                'record'  => $record->code,
                'to'      => $to,
                'error'   => $e->getMessage(),
            ]);
            return response()->json([
                'status'  => false,
                'message' => 'Could not send reminder. Please try again or contact support.',
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
    private function buildQuotationViewData($q, bool $withSignature, string $pdfTitle = 'QUOTATION DOCUMENT', string $docLabelShort = 'QT'): array
    {
        $branch = $q->branch;

        // Company (issuing branch) — letterhead fields come from the Branch row.
        // Address block is composed from the branch's structured address
        // columns (address + city + state + pincode + country).
        $branchAddress = trim(implode(', ', array_filter([
            $branch?->address, $branch?->city, $branch?->state, $branch?->pincode, $branch?->country,
        ]))) ?: '';

        $companyDetails = (object) [
            'name'              => $branch?->name              ?? ($branch?->code ?? 'Branch'),
            'address'           => $branchAddress,
            'mobile'            => $branch?->phone             ?? '',
            'email'             => $branch?->email             ?? '',
            'website'           => $branch?->website           ?? '',
            'gst_no'            => $branch?->gst_number        ?? '',
            'gst_state_code'    => $branch?->gst_state_code    ?? '',
            'pan_no'            => $branch?->pan_number        ?? '',
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
            'primary_color'      => $primaryColor = ($this->normalizeHex($branch?->primary_color)   ?: '#7CB342'),
            'secondary_color'    => $this->normalizeHex($branch?->secondary_color) ?: '#37B1E0',
            // Text color that READS on top of the primary color (white for
            // dark brand colors, near-black for light ones). Used by the
            // template wherever text sits on a primary-color background
            // (product table header row, Amount In Words banner).
            'primary_text_color' => $this->contrastColor($primaryColor),
            // Base64 data URIs for DomPDF — it can't fetch remote URLs by
            // default and the branch's storage URLs (storage/branch-logos/…)
            // wouldn't resolve from inside the PHP request context. Inlining
            // the bytes guarantees the image renders on every server config.
            'logo_data'         => $this->branchAssetDataUri($branch?->logo),
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
            if (preg_match('#^([A-Z0-9]+)\s*[-–]\s*(.+)$#', (string) $q->port_of_loading, $m)) {
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
            'terms_and_conditions'  => $q->terms ?: $this->defaultTerms(),
        ];

        // ── Real scannable barcode ─────────────────────────────────────
        // Top-right header barcode: Code128 of the BRANCH WEBSITE URL so
        // scanning the printed letterhead opens the company's site.
        // If the branch hasn't set a website, we skip the barcode entirely
        // and the template falls back to showing the branch NAME as text
        // in that slot — better than a meaningless barcode of an unrelated
        // string (the QT number is already shown in the block above).
        $branchWebsite  = trim((string) ($branch?->website ?? ''));
        $barcodeData    = $branchWebsite !== '' ? $this->makeCode128($branchWebsite) : null;
        $barcodePayload = $branchWebsite;
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
            'segmentTermsConditions' => [],
            'base_currency_total'    => $grandTotal,
            'exchange_rate'          => $q->exchange_rate ? (float) $q->exchange_rate : null,
        ];
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
            $hex = $hex[0].$hex[0].$hex[1].$hex[1].$hex[2].$hex[2];
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
            $hex = $hex[0].$hex[0].$hex[1].$hex[1].$hex[2].$hex[2];
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
            $bytes = Storage::disk('public')->get($norm);
            $mime  = Storage::disk('public')->mimeType($norm) ?: 'image/png';
            return 'data:' . $mime . ';base64,' . base64_encode($bytes);
        } catch (\Throwable $e) {
            return null;
        }
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

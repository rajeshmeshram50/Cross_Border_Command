<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\SalesDocumentEmail;
use App\Mail\SalesReminderEmail;
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

        @set_time_limit(180);
        @ini_set('memory_limit', '1024M');
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);

        $filename = 'PI-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $payload['piNo'] ?? 'preview') . '.pdf';

        return Response::make($pdf->output(), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
        ]);
    }

    public function sharedPriceQuotation(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $entry = \App\Models\LeadProductSharedPrice::with([
            'lead:id,opp_code,unique_query_id,customer_id,created_at,sender_name,sender_email,sender_mobile',
            'leadProduct:id,product_id,currency,quantity,target_price',
            'leadProduct.product:id,product_code,name,gst_id',
        ])->where('client_id', $user->client_id)->findOrFail($id);

        $lp       = $entry->leadProduct;
        $product  = $lp?->product;
        $qty      = $lp?->quantity !== null ? (float) $lp->quantity : 1;
        $rate     = (float) $entry->quoted_price;
        $amount   = round($rate * $qty, 2);
        $currency = $lp?->currency ?: 'INR';
        $quoteCode = 'Q-' . str_pad((string) $entry->id, 5, '0', STR_PAD_LEFT);

        $isInr   = strtoupper(trim((string) $currency)) === 'INR';
        $taxPct  = 0.0;
        if ($isInr && $product?->gst_id) {
            $taxPct = (float) (optional(
                \App\Models\Masters\GstPercentage::find($product->gst_id)
            )->percentage ?? 0);
        }
        $taxAmount = round($amount * $taxPct / 100, 2);

        $cust = $entry->lead?->customer_id
            ? \App\Models\Customer::withoutGlobalScopes()
                ->where('client_id', $user->client_id)
                ->with('primaryAddress')
                ->find($entry->lead->customer_id)
            : null;
        $addr = $cust?->primaryAddress;

        $vd = $this->buildViewData([
            'customer' => $cust?->legal_name ?: ($cust?->company_name ?? $entry->lead?->sender_name),
            'consignee' => null,
            'piNo'     => $quoteCode,
            'piDate'   => \Carbon\Carbon::parse($entry->shared_at)->format('Y-m-d'),
            'oppId'    => $entry->lead?->opp_code ?? $entry->lead?->unique_query_id,
            'oppDate'  => null,
        ], $currency, 'Domestic', false);

        $gstOn = filter_var($cust?->gst_applicable, FILTER_VALIDATE_BOOLEAN)
            || strtolower((string) $cust?->gst_applicable) === 'yes';
        $vd['buyerDetails'] = (object) [
            'name'         => $cust?->legal_name ?: ($cust?->company_name ?? ($entry->lead?->sender_name ?? '—')),
            'gst_no'       => ($gstOn && !empty($cust?->gst_number)) ? $cust->gst_number : null,
            'address_line' => $addr?->address_line,
            'region'       => trim(implode(', ', array_filter([
                $addr?->city, $addr?->state, $addr?->country,
                $addr?->pin ? '- ' . $addr->pin : null,
            ]))),
            'email'        => $addr?->cp_email ?: ($cust?->primary_email ?: $entry->lead?->sender_email),
            'contact_no'   => $addr?->cp_contact ?: $entry->lead?->sender_mobile,
        ];

        $branchColor = $user->branch_id
            ? \App\Models\Branch::whereKey($user->branch_id)->value('primary_color')
            : null;
        $vd['companyDetails']->primary_color = $branchColor ?: '#7CB342';
        $vd['companyDetails']->primary_text_color = '#ffffff';

        try {
            $igc = public_path('images/igc-logo-invoice.png');
            if (is_file($igc)) {
                $vd['companyDetails']->logo_data = 'data:image/png;base64,' . base64_encode(file_get_contents($igc));
            }
        } catch (\Throwable $e) { }

        $vd['barcodeHtml'] = '';
        try {
            $vd['barcodeHtml'] = (new \Milon\Barcode\DNS1D())->getBarcodeHTML($quoteCode, 'C128', 1.6, 28);
        } catch (\Throwable $e) { }

        $vd['quotationProducts'] = collect([[
            'product_code'        => $product?->product_code ?? '',
            'product_name'        => $product?->name ?? '—',
            'model_name'          => $product?->product_code ?? '',
            'product_description' => '',
            'quantity'            => $qty,
            'rate'                => $rate,
            'rate_with_tax'       => $rate,
            'amount'              => $amount,
            'tax_pct'             => $taxPct,
            'tax_amount'          => $taxAmount,
        ]]);
        $q = $vd['quotation'];
        $q->total = $amount;
        $q->tax_amount = $taxAmount;
        $q->igst = 0; $q->cgst = 0; $q->sgst = 0;
        $q->shipping_cost = 0; $q->packaging_cost = 0;
        $q->grand_total = round($amount + $taxAmount, 2);
        $q->pi_number = $quoteCode;
        $vd['pdf_title'] = 'QUOTATION';
        $vd['doc_label_short'] = 'Q';
        $vd['base_currency_total'] = $amount;
        $vd['opportunity_date'] = $entry->lead?->created_at
            ? \Carbon\Carbon::parse($entry->lead->created_at) : null;

        $pdf = Pdf::loadView('pdf.shared_price_quotation', $vd)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);
        $filename = 'quotation_' . str_pad((string) $entry->id, 5, '0', STR_PAD_LEFT) . '.pdf';

        return $request->boolean('inline')
            ? $pdf->stream($filename)
            : $pdf->download($filename);
    }

    private function buildViewData(array $p, string $currencyCode, string $docType, bool $withSignature): array
    {
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

        $items = [
            ['product_name' => 'BIOMÉRIEUX - VITEK 2 Compact 30 Analyser', 'model_name' => 'VITEK® 2 COMPACT 30', 'product_description' => 'With Standard Accessories — Pipette Tips (100–1000 µL, 0.5–250 µL), Unsensitized Tubes (1×2000), KIT V2S 9.04 PC Media, Small Dispenser, Pipette 145 MCL Fixed, Pipette 280 MCL Fixed, CD Densicheck User Manual, McFarland Ref Kit, Densicheck Display Base Kit, Densicheck POD, Saline Solution, Barcode Scanner (Honeywell 1400G), HP V20 HD Monitor, HP Printer M208DW, Keyboard PC AZERTY USB.', 'quantity' => 1, 'rate' => 1725000.00, 'amount' => 1725000.00],
            ['product_name' => 'Reagent Kit — VITEK 2 GN ID',                   'model_name' => 'V2S-GN-ID',          'product_description' => 'Gram-negative bacterial identification cards, pack of 20. Includes calibration and validation media.',                                                                                                                                                                                                                                                                                                            'quantity' => 2, 'rate' => 32500.00,   'amount' => 65000.00],
            ['product_name' => 'Annual Maintenance Contract (AMC)',              'model_name' => 'AMC-Y1',             'product_description' => 'Comprehensive maintenance contract — 4 preventive visits, unlimited breakdown calls, original spare parts excluded.',                                                                                                                                                                                                                                                                                            'quantity' => 1, 'rate' => 145000.00,  'amount' => 145000.00],
        ];
        $quotationProducts = collect($items);

        $subTotal = array_sum(array_column($items, 'amount'));

        $shippingCost  = $docType === 'International' ? 12500.00 : 0.00;
        $packagingCost = $docType === 'International' ?  4500.00 : 0.00;
        $gstBase       = $subTotal + $shippingCost + $packagingCost;
        $igst = $docType === 'International' ? round($gstBase * 0.05, 2) : 0;
        $cgst = $docType === 'Domestic'      ? round($gstBase * 0.025, 2) : 0;
        $sgst = $docType === 'Domestic'      ? round($gstBase * 0.025, 2) : 0;
        $grandTotal = round($gstBase + $igst + $cgst + $sgst, 2);

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
            'termsAndConditions'  => null,
            'segmentTermsConditions' => [],
            'base_currency_total' => $grandTotal,
            'exchange_rate'       => null,
        ];
    }

    private function normalizeDate(?string $s): string
    {
        if (!$s) return date('Y-m-d');
        if (preg_match('#^(\d{2})/(\d{2})/(\d{4})$#', $s, $m)) {
            return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
        }
        $t = strtotime($s);
        return $t ? date('Y-m-d', $t) : date('Y-m-d');
    }

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

    public function previewQuotation(Request $request, int $id)
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

        $this->assertRecordScope($pi, $user, 'read');

        $withSignature = $request->boolean('signature', true);

        $viewData = $this->buildQuotationViewData($pi, $withSignature, 'PROFORMA INVOICE', 'PI');

        $bytes = $this->renderSalesPdfCached($viewData, $withSignature);

        $filename = 'PI-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $pi->code ?? ('id-' . $pi->id))
            . ($withSignature ? '_signed' : '_unsigned') . '.pdf';

        return Response::make($bytes, 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
        ]);
    }

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

        $this->assertRecordScope($record, $user, 'read');

        @set_time_limit(180);
        @ini_set('memory_limit', '1024M');
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
        @set_time_limit(180);
        @ini_set('memory_limit', '1024M');
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
        @set_time_limit(180);
        @ini_set('memory_limit', '1024M');
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);

        $filename = 'PI-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $pi->code ?? ('id-' . $pi->id)) . '.pdf';
        return Response::make($pdf->output(), 200, [
            'Content-Type'        => 'application/pdf',
            'Content-Disposition' => 'inline; filename="' . $filename . '"',
        ]);
    }

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

    private function sendSalesDocumentEmail(Request $request, $record, string $kind, string $pdfTitle, string $docLabel, string $filenamePrefix): JsonResponse
    {
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

        $viewData = $this->buildQuotationViewData($record, $withSignature, $pdfTitle, $docLabel);
        @set_time_limit(180);
        @ini_set('memory_limit', '1024M');
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);

        $tmpDir = storage_path('app/tmp/sales-pdfs');
        if (!is_dir($tmpDir)) @mkdir($tmpDir, 0775, true);
        $safeCode = preg_replace('/[^A-Za-z0-9_-]/', '_', $record->code ?? ('id-' . $record->id));
        $pdfFilename = $filenamePrefix . '-' . $safeCode . ($withSignature ? '_signed' : '_unsigned') . '.pdf';
        $pdfPath = $tmpDir . '/' . uniqid('mail-', true) . '-' . $pdfFilename;
        $pdf->save($pdfPath);

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
                if (preg_match('/^.+?\s+[\x{2013}\-]\s+(.+)$/u', $productSummary, $m)) {
                    $productSummary = trim($m[1]);
                }
            }
        }
        if ($record->items->count() > 1) {
            $productSummary .= ' (+' . ($record->items->count() - 1) . ' more)';
        }

        $viewRouteName = $kind === 'Quotation' ? 'sales.quotation.view' : 'sales.pi.view';
        $viewUrl = \Illuminate\Support\Facades\URL::temporarySignedRoute(
            $viewRouteName,
            now()->addDays(60),
            ['id' => $record->id],
        );

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

    public function streamPoPdf($po, bool $withSignature = true, $vendor = null)
    {
        $vendor = $vendor ?: ($po->vendor_id ? \App\Models\Vendor::with('primaryAddress')->find($po->vendor_id) : null);
        $viewData = $this->buildPurchaseOrderViewData($po, $withSignature, $vendor);
        @set_time_limit(180);
        @ini_set('memory_limit', '1024M');
        $pdf = Pdf::loadView('pdf.purchase-order', $viewData)->setPaper('A4', 'portrait')->setOption('isPhpEnabled', true);
        $ref = $po->code ?: ('id-' . ($po->id ?? 'draft'));
        $name = 'PO-' . preg_replace('/[^A-Za-z0-9_-]/', '_', $ref) . ($withSignature ? '_signed' : '_unsigned') . '.pdf';
        return $pdf->stream($name);
    }

    public function renderPoPdfBytes($po, bool $withSignature = false, $vendor = null): string
    {
        $vendor = $vendor ?: ($po->vendor_id ? \App\Models\Vendor::with('primaryAddress')->find($po->vendor_id) : null);
        $viewData = $this->buildPurchaseOrderViewData($po, $withSignature, $vendor);
        @set_time_limit(180);
        return Pdf::loadView('pdf.purchase-order', $viewData)->setPaper('A4', 'portrait')->setOption('isPhpEnabled', true)->output();
    }

    public function renderPoPdfBytesCached($po, bool $withSignature = false, $vendor = null): string
    {
        if (empty($po->id)) {
            return $this->renderPoPdfBytes($po, $withSignature, $vendor);
        }
        $rel   = 'po-system-pdf/' . $po->id . '-' . ($withSignature ? 'signed' : 'unsigned') . '.pdf';
        $key   = 'po_pdf_stamp:' . $po->id . ':' . ($withSignature ? 's' : 'u');
        $stamp = (string) optional($po->updated_at)->timestamp;

        if (\Illuminate\Support\Facades\Cache::get($key) === $stamp
            && \Illuminate\Support\Facades\Storage::disk('local')->exists($rel)) {
            return \Illuminate\Support\Facades\Storage::disk('local')->get($rel);
        }

        $bytes = $this->renderPoPdfBytes($po, $withSignature, $vendor);
        try {
            \Illuminate\Support\Facades\Storage::disk('local')->put($rel, $bytes);
            \Illuminate\Support\Facades\Cache::forever($key, $stamp);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('PO PDF cache write failed', ['po' => $po->id, 'err' => $e->getMessage()]);
        }
        return $bytes;
    }

    public function publicViewPurchaseOrder(int $id)
    {
        $po = \App\Models\PurchaseOrder::with('items')->findOrFail($id);
        return $this->streamPoPdf($po, true);
    }

    private function assertPoTenantScope(\App\Models\PurchaseOrder $po, $user): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $po->client_id !== (int) $user->client_id) abort(404);
        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ((int) $po->branch_id !== (int) $user->branch_id) abort(404);
    }

    public function viewPurchaseOrderPdf(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $po = \App\Models\PurchaseOrder::with('items')->findOrFail($id);
        $this->assertPoTenantScope($po, $user);
        return $this->streamPoPdf($po, $request->boolean('signature', true));
    }

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
        @ini_set('memory_limit', '1024M');
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

    private function buildPurchaseOrderViewData($po, bool $withSignature, $vendor = null): array
    {
        $branch = \App\Models\Branch::find($po->branch_id);
        $client = !empty($po->client_id) ? \App\Models\Client::find($po->client_id) : null;

        $companyDetails = $this->letterheadFrom($branch, $client);

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
            'state_code' => (string) ($vAddr?->state_code ?? ''),
            'email' => $vAddr?->email ?: ($vendor?->primary_email ?? ''),
            'contact_no' => $vAddr?->contact_no ?? '',
        ];

        $billTo = (object) [
            'name' => 'INORBVICT HEALTHCARE INDIA PRIVATE LIMITED',
            'address' => 'Office No 821, 8th Flr, Solitaire Business Hub, Balewadi Highstreet Baner, Pune, Maharashtra - 411045, India',
            'contact' => '+91 9850558881',
        ];
        $deliverTo = (object) [
            'name' => 'INORBVICT HEALTHCARE INDIA PRIVATE LIMITED',
            'address' => 'At post Jambe, Sarvhe no.146/1, Near Datta mandir, Jambe-Sangawade road, Taluka-Mulshi, District-Pune MH-411033',
            'contact' => '+91 9850558881',
        ];

        $bankDetails = (object) [
            'bank_name'           => 'HDFC BANK LTD',
            'account_holder_name' => 'INORBVICT HEALTHCARE INDIA PRIVATE LIMITED',
            'address'             => 'HDFC BANK, SR NO. 244/3-5, OPP INDIAN OIL PETROL PUMP, RAJIV GANDHI IT PARK, HINJEWADI, PUNE, MAHARASHTRA 411057 INDIA SWIFT : HDFCINBB',
            'branch'              => 'HINJEWADI, PUNE',
            'branch_code'         => '794',
            'ad_code'             => '0510573',
            'account_no'          => '59209850100030',
            'ifsc'                => 'HDFC0000794',
            'swift_code'          => 'HDFCINBB',
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

        $homeStateCode = trim((string) ($companyDetails->gst_state_code ?? '')) ?: '27';
        $supStateCode = trim((string) ($vendorBlock->state_code ?? ''));
        $isInterState = $supStateCode !== '' && $supStateCode !== $homeStateCode;

        $totalCgst = (float) $po->total_cgst;
        $totalSgst = (float) $po->total_sgst;
        $subTotal = round((float) $po->total_product_cost - $totalCgst - $totalSgst, 2);
        $grandTotal = (float) $po->grand_total;
        $igst = $isInterState ? round($totalCgst + $totalSgst, 2) : 0;
        $cgst = $isInterState ? 0 : $totalCgst;
        $sgst = $isInterState ? 0 : $totalSgst;

        $poInfo = (object) [
            'code' => $po->code,
            'po_date' => optional($po->po_date)->format('d/m/Y') ?: '',
            'po_type' => $po->po_type ?: '',
            'edd' => optional($po->expected_delivery_date)->format('d/m/Y') ?: 'NA',
            'currency' => $po->currency_code ?: 'INR',
            'document_type' => $po->document_type ?: 'Domestic',
            'bt_id' => (string) ($po->shipment_code ?: ($po->shipment_order_id ?: 'NA')),
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

        [$poTncGlobal, $poTncSegment] = $this->dedupeTncLayers(
            $po->terms ?? null,
            $this->fetchGlobalTncs($po->client_id, $po->branch_id, $this->poTncCategory($po)),
            $this->fetchPoTncs($po),
        );

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
            'interState' => $isInterState,
            'totals' => $totals,
            'globalTermsConditions'  => $poTncGlobal,
            'segmentTermsConditions' => $poTncSegment,
        ];
    }

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

    private function sendSalesReminderEmail(Request $request, $record, string $kind, string $pdfTitle, string $docLabel, string $filenamePrefix): JsonResponse
    {
        if (empty($record->emailed_at)) {
            return response()->json([
                'status'  => false,
                'message' => 'Send the initial email first — reminders go out only after the customer has received the document.',
            ], 422);
        }

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

        $viewData = $this->buildQuotationViewData($record, $withSignature, $pdfTitle, $docLabel);
        @set_time_limit(180);
        @ini_set('memory_limit', '1024M');
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

        $viewRouteName = $kind === 'Quotation' ? 'sales.quotation.view' : 'sales.pi.view';
        $viewUrl = \Illuminate\Support\Facades\URL::temporarySignedRoute(
            $viewRouteName,
            now()->addDays(60),
            ['id' => $record->id],
        );

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
            } catch (\Throwable $e) {
            }
        }

        @set_time_limit(180);
        @ini_set('memory_limit', '1024M');
        $pdf = Pdf::loadView('pdf.proforma-invoice', $viewData)
            ->setPaper('A4', 'portrait')
            ->setOption('isPhpEnabled', true);
        $bytes = $pdf->output();

        if ($key) {
            try {
                Storage::disk('local')->put($key, $bytes);
            } catch (\Throwable $e) {
            }
        }

        return $bytes;
    }

    private function buildQuotationViewData($q, bool $withSignature, string $pdfTitle = 'QUOTATION DOCUMENT', string $docLabelShort = 'QT'): array
    {
        $branch = $q->branch;
        $client = !empty($q->client_id) ? \App\Models\Client::find($q->client_id) : null;

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

        $logoData = $this->branchAssetDataUri($branch?->logo)
            ?: $this->branchAssetDataUri($client?->logo);

        $companyDetails = (object) [
            'name'              => ($branch?->name ?: $client?->org_name) ?: ($branch?->code ?: 'Branch'),
            'address'           => $branchAddress ?: $clientAddress,
            'mobile'            => $branch?->phone      ?: ($client?->phone      ?? ''),
            'email'             => $branch?->email      ?: ($client?->email      ?? ''),
            'website'           => $branch?->website    ?: ($client?->website    ?? ''),
            'gst_no'            => $branch?->gst_number ?: ($client?->gst_number ?? ''),
            'pan_no'            => $branch?->pan_number ?: ($client?->pan_number ?? ''),
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
            'primary_color'      => $primaryColor = ($this->normalizeHex($branch?->primary_color ?: $client?->primary_color)   ?: '#7CB342'),
            'secondary_color'    => $this->normalizeHex($branch?->secondary_color ?: $client?->secondary_color) ?: '#37B1E0',
            'primary_text_color' => $this->contrastColor($primaryColor),
            'logo_data'         => $logoData,
            'signature_data'    => $this->branchAssetDataUri($branch?->signature_path)
                ?? $this->publicImageDataUri('images/test-signature.png'),
        ];

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

        $subTotal      = round($quotationProducts->sum(fn ($it) => $it['quantity'] * $it['rate']), 2);
        $shippingCost  = (float) $q->shipping;
        $grandTotal    = (float) $q->grand_total;
        $packagingCost = 0.0;

        $totalTax = round(collect($quotationProducts)->sum('tax_amt'), 2);
        $isInternational = ($q->doc_type ?? 'International') === 'International';
        $normState = static function ($label): string {
            $s = trim((string) $label);
            return preg_match('/^(\d{1,2})(?!\d)/', $s, $m) ? (string) (int) $m[1] : '';
        };
        $homeStateCode  = $normState($companyDetails->gst_state_code ?? '')
            ?: $normState($companyDetails->gst_no ?? '')
            ?: '27';
        $partyStateCode = $normState($q->state_code ?? '');
        $useIgst = $isInternational || ($partyStateCode !== '' && $partyStateCode !== $homeStateCode);
        $igst = $useIgst ? $totalTax : 0;
        $cgst = $useIgst ? 0 : round($totalTax / 2, 2);
        $sgst = $useIgst ? 0 : round($totalTax - $cgst, 2);

        $port = null;
        if ($q->port_of_loading) {
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
            'dispatch_from'         => $q->dispatch_from   ?? '',
            'deliver_to'            => $q->deliver_to      ?? '',
            'state_code'            => $q->state_code      ?? '',
            'customer_gst_no'       => $q->customer_gst_no ?? '',
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
            'terms_and_conditions'  => $q->terms ?: null,
        ];

        $branchWebsite  = trim((string) ($branch?->website ?? ''));
        $orgName        = trim((string) ($branch?->name ?? '')) ?: trim((string) ($branch?->code ?? ''));
        $barcodeValue   = $branchWebsite !== '' ? $branchWebsite : $orgName;
        $barcodeData    = $barcodeValue !== '' ? $this->makeCode128($barcodeValue) : null;
        $barcodePayload = $barcodeValue;
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

        [$tncGlobal, $tncSegment] = $this->dedupeTncLayers(
            $q->terms_and_conditions ?? null,
            $this->fetchGlobalTncs($q->client_id ?? null, $q->branch_id ?? null, $this->salesTncCategory($q)),
            $this->fetchSegmentTncs($q, $docLabelShort),
        );

        return [
            'pdf_title'              => $pdfTitle,
            'doc_label_short'        => $docLabelShort,
            'signature'              => $withSignature ? 'Yes' : 'No',
            'barcodeData'            => $barcodeData,
            'barcodeText'            => $barcodePayload,
            'qrData'                 => $qrData,
            'companyDetails'         => $companyDetails,
            'buyerDetails'           => $buyerDetails,
            'consigneeDetails'       => $consigneeDetails,
            'bankDetails'            => $bankDetails,
            'quotation'              => $quotation,
            'quotationProducts'      => $quotationProducts,
            'opportunity_id'         => $q->opp_code ?? null,
            'opportunity_date'       => $q->opportunity_date
                ? \DateTime::createFromFormat('!Y-m-d', $q->opportunity_date->format('Y-m-d'))
                : null,
            'termsAndConditions'     => null,
            'globalTermsConditions'  => $tncGlobal,
            'segmentTermsConditions' => $tncSegment,
            'base_currency_total'    => $grandTotal,
            'exchange_rate'          => $q->exchange_rate ? (float) $q->exchange_rate : null,
        ];
    }

    private function dedupeTncLayers(?string $typed, array $global, array $segment): array
    {
        $key = static function (?string $html): string {
            $text = html_entity_decode(strip_tags((string) $html), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $text = preg_replace('/[\s\x{00A0}]+/u', ' ', $text) ?? $text;
            return mb_strtolower(trim($text));
        };

        $seen = [];
        $t = $key($typed);
        if ($t !== '') $seen[$t] = true;

        $keptGlobal = [];
        foreach ($global as $g) {
            $k = $key($g);
            if ($k === '' || isset($seen[$k])) continue;
            $seen[$k] = true;
            $keptGlobal[] = $g;
        }

        $keptSegment = [];
        foreach ($segment as $row) {
            $k = $key($row['content'] ?? null);
            if ($k === '' || isset($seen[$k])) continue;
            $seen[$k] = true;
            $keptSegment[] = $row;
        }

        return [$keptGlobal, $keptSegment];
    }

    public function poTncLayers($po): array
    {
        [$global, $segment] = $this->dedupeTncLayers(
            $po->terms ?? null,
            $this->fetchGlobalTncs($po->client_id, $po->branch_id, $this->poTncCategory($po)),
            $this->fetchPoTncs($po),
        );

        return [
            'typed'   => trim((string) ($po->terms ?? '')),
            'global'  => $global,
            'segment' => $segment,
        ];
    }

    private function fetchGlobalTncs(?int $clientId, ?int $branchId, string $category): array
    {
        if (!$clientId || $category === '') return [];

        return \App\Models\ClmTncLibrary::query()
            ->withoutGlobalScope('tenant')
            ->where('scope', \App\Models\ClmTncLibrary::SCOPE_GLOBAL)
            ->whereRaw('LOWER(TRIM(category)) = ?', [mb_strtolower(trim($category))])
            ->whereRaw("LOWER(TRIM(COALESCE(status, 'active'))) = 'active'")
            ->where(fn ($w) => $w->whereNull('client_id')->orWhere('client_id', $clientId))
            ->where(fn ($w) => $w->whereNull('branch_id')->orWhere('branch_id', $branchId))
            ->orderBy('id')
            ->pluck('content')
            ->map(fn ($c) => trim((string) $c))
            ->filter(fn ($c) => $c !== '')
            ->values()
            ->all();
    }

    private function poTncCategory($po): string
    {
        $intl = str_contains(mb_strtolower(trim((string) ($po->document_type ?? ''))), 'international');
        return ($intl ? 'International' : 'Domestic') . ' Purchase Order';
    }

    private function salesTncCategory($q): string
    {
        $intl = str_contains(mb_strtolower(trim((string) ($q->doc_type ?? 'International'))), 'international');
        return ($intl ? 'International' : 'Domestic') . ' Proforma Invoice';
    }

    private function fetchSegmentTncs($q, string $docLabelShort): array
    {
        $clientId = $q->client_id ?? null;
        if (!$clientId) return [];

        $docKind = 'proforma invoice';
        $docType = mb_strtolower(trim((string) ($q->doc_type ?? 'International')));
        if ($docType === '') return [];

        $items = collect($q->items ?? [])
            ->sortBy(fn($it) => [(int) ($it->line_no ?? 0), (int) ($it->id ?? 0)])
            ->values();
        $productIds = $items->pluck('product_id')->filter()->unique()->values();
        if ($productIds->isEmpty()) return [];

        $prodToSeg = \App\Models\Product::whereIn('id', $productIds)
            ->pluck('segment_id', 'id');
        $segById = \App\Models\ClmSegment::where('client_id', $clientId)
            ->whereIn('id', $prodToSeg->filter()->unique()->values())
            ->get(['id', 'name', 'regulatory_status'])
            ->keyBy('id');
        if ($segById->isEmpty()) return [];

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

        $matched = [];
        foreach ($items as $it) {
            $segId = $it->product_id ? ($prodToSeg[$it->product_id] ?? null) : null;
            if (!$segId) continue;
            $seg = $segById->get($segId);
            if (!$seg) continue;

            foreach ($candidates as $row) {
                if (isset($matched[$row->id])) continue;
                if (!\App\Support\SegmentGuard::tncMatches($row, $seg)) continue;
                $matched[$row->id] = [
                    'code'     => $row->code,
                    'category' => $row->category,
                    'segment'  => $seg->name,
                    'content'  => $row->content,
                ];
            }
        }

        return array_values($matched);
    }

    private function fetchPoTncs($po): array
    {
        $clientId = $po->client_id ?? null;
        if (!$clientId) return [];

        $docTypeLc = mb_strtolower(trim((string) ($po->document_type ?? 'Domestic')));
        $docType   = str_contains($docTypeLc, 'international') ? 'international' : 'domestic';
        $docKind   = 'purchase order';

        $items = collect($po->items ?? [])
            ->sortBy(fn($it) => [(int) ($it->line_no ?? 0), (int) ($it->id ?? 0)])
            ->values();
        $productIds = $items->pluck('product_id')->filter()->unique()->values();
        if ($productIds->isEmpty()) return [];

        $prodToSeg = \App\Models\Product::whereIn('id', $productIds)->pluck('segment_id', 'id');
        $segById = \App\Models\ClmSegment::where('client_id', $clientId)
            ->whereIn('id', $prodToSeg->filter()->unique()->values())
            ->get(['id', 'name', 'regulatory_status'])
            ->keyBy('id');
        if ($segById->isEmpty()) return [];

        $candidates = \App\Models\ClmTncLibrary::withoutGlobalScope('tenant')
            ->where('client_id', $clientId)
            ->where(fn ($w) => $w->whereNull('status')->orWhere('status', 'active'))
            ->orderBy('id')
            ->get()
            ->filter(function ($row) use ($docType, $docKind) {
                $cat = mb_strtolower((string) $row->category);
                return str_contains($cat, $docType) && str_contains($cat, $docKind);
            });

        $matched = [];
        foreach ($items as $it) {
            $segId = $it->product_id ? ($prodToSeg[$it->product_id] ?? null) : null;
            if (!$segId) continue;
            $seg = $segById->get($segId);
            if (!$seg) continue;

            foreach ($candidates as $row) {
                if (isset($matched[$row->id])) continue;
                if (!\App\Support\SegmentGuard::tncMatches($row, $seg)) continue;
                $matched[$row->id] = [
                    'code'     => $row->code,
                    'category' => $row->category,
                    'segment'  => $seg->name,
                    'content'  => $row->content,
                ];
            }
        }

        return array_values($matched);
    }

    public function letterheadFrom($branch, $client): object
    {
        $branchAddress = trim(implode(', ', array_filter([$branch?->address, $branch?->city, $branch?->state, $branch?->pincode, $branch?->country]))) ?: '';
        $clientAddress = trim(implode(', ', array_filter([$client?->address, $client?->city, $client?->state, $client?->pincode, $client?->country]))) ?: '';
        $logoData = $this->branchAssetDataUri($branch?->logo) ?: $this->branchAssetDataUri($client?->logo);

        return (object) [
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
    }

    public function barcodeFor(?string $value): ?string
    {
        return $this->makeCode128($value);
    }

    public function vendorBlockFor($vendor): object
    {
        $a = $vendor?->primaryAddress;
        return (object) [
            'name' => $vendor?->company_name ?: ($vendor?->legal_name ?: 'Supplier'),
            'address' => $this->composeAddress($a?->address_line, $a?->city, $a?->state?->name ?? $a?->state_code, $a?->pincode, $a?->country?->name),
            'state_code' => (string) ($a?->state_code ?? ''),
            'email' => $a?->email ?: ($vendor?->primary_email ?? ''),
            'contact_no' => $a?->contact_no ?? '',
            'gst_no' => (string) ($vendor?->gst_number ?? ''),
        ];
    }

    private function composeAddress(?string ...$parts): string
    {
        $clean = [];
        foreach ($parts as $p) {
            $p = trim((string) ($p ?? ''));
            if ($p !== '') $clean[] = $p;
        }
        return implode(', ', $clean);
    }

    private function makeCode128(?string $payload): ?string
    {
        $payload = trim((string) ($payload ?? ''));
        if ($payload === '') return null;
        try {
            $d = new DNS1D();
            $d->setStorPath(storage_path('framework/cache/barcodes/'));
            $len = strlen($payload);
            $moduleWidth = $len > 20 ? 1.0 : ($len > 14 ? 1.3 : 1.6);
            $png = $d->getBarcodePNG($payload, 'C128', $moduleWidth, 30, [0, 0, 0], false);
            return $png ? 'data:image/png;base64,' . $png : null;
        } catch (\Throwable $e) {
            return null;
        }
    }

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
                'versionMin'   => 3,
                'versionMax'   => 10,
                'eccLevel'     => 0,
                'scale'        => 4,
                'imageBase64'  => true,
                'outputType'   => 'png',
            ]);
            return (new QRCode($options))->render(implode("\n", $lines));
        } catch (\Throwable $e) {
            return null;
        }
    }

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

    private function normalizeHex(?string $hex): ?string
    {
        $hex = strtolower(trim((string) ($hex ?? '')));
        $hex = ltrim($hex, '#');
        if (!preg_match('/^[0-9a-f]{3}([0-9a-f]{3})?$/', $hex)) return null;
        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }
        return '#' . $hex;
    }

    private function publicImageDataUri(string $relative): ?string
    {
        $path = public_path($relative);
        if (!is_file($path)) return null;
        $bytes = @file_get_contents($path);
        if ($bytes === false) return null;
        $mime = function_exists('mime_content_type')
            ? (mime_content_type($path) ?: 'image/png')
            : 'image/png';

        $flat = $this->flattenImageForPdf($bytes);
        if ($flat !== null) {
            $bytes = $flat;
            $mime  = 'image/png';
        }

        return 'data:' . $mime . ';base64,' . base64_encode($bytes);
    }

    private function branchAssetDataUri(?string $path): ?string
    {
        if (!$path) return null;

        $norm = ltrim(str_replace('\\', '/', trim($path)), '/');
        foreach (['storage/', 'public/'] as $strip) {
            if (str_starts_with($norm, $strip)) $norm = substr($norm, strlen($strip));
        }
        if (!str_contains($norm, '/')) return null;

        try {
            if (!Storage::disk('public')->exists($norm)) return null;

            $stamp    = (string) (Storage::disk('public')->lastModified($norm) ?: 0);
            $cacheKey = 'sales_pdf_asset_uri:' . md5($norm . '|' . $stamp);

            return Cache::remember($cacheKey, now()->addDay(), function () use ($norm) {
                $bytes = Storage::disk('public')->get($norm);
                $mime  = Storage::disk('public')->mimeType($norm) ?: 'image/png';

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
            imagefilledrectangle($canvas, 0, 0, $dw, $dh, imagecolorallocate($canvas, 255, 255, 255));
            imagealphablending($canvas, true);
            if ($scale < 1.0) {
                imagecopyresampled($canvas, $src, 0, 0, 0, 0, $dw, $dh, $sw, $sh);
            } else {
                imagecopy($canvas, $src, 0, 0, 0, 0, $sw, $sh);
            }
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

    private function assertRecordScope($record, $user, string $action = 'read'): void
    {
        if ($user->user_type === 'super_admin') return;
        if (!$user->client_id || (int) $record->client_id !== (int) $user->client_id) {
            abort(404);
        }
        if ($user->user_type !== 'branch_user' || !$user->branch_id) return;
        if ((int) $record->branch_id === (int) $user->branch_id) return;

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

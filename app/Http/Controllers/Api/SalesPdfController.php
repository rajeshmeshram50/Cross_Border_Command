<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Response;
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
            ->setPaper('A4', 'portrait');

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

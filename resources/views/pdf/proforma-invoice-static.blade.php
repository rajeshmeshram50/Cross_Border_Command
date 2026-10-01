{{--
    STATIC Proforma Invoice — a hand-editable copy of the rendered PI.

    Every value here is HARDCODED from the sample document; nothing is bound to
    a model. It exists to be edited directly (copy, layout, wording, styling)
    without touching proforma-invoice.blade.php, which is the live, data-driven
    template the app actually sends.

    Render it from a throwaway route while working on it, e.g.

        Route::get('/pi-static', fn () => Pdf::loadView('pdf.proforma-invoice-static')
            ->setPaper('a4')->stream('pi.pdf'));

    DOMPDF NOTES (the renderer this project uses):
      - Lay out with tables, not flexbox/grid — neither is supported.
      - Images need an absolute path or a data URI; a relative src renders blank.
      - `page-break-before: always` on a block starts a new page.
      - Keep a bottom @page margin so the fixed footer never sits over content.
--}}
<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8" />
    <title>PROFORMA INVOICE — PI/2026-27/1254</title>
    <style>
        /* Bottom band reserved for the fixed footer. */
        @page { margin: 26px 26px 48px 26px; }

        body {
            font-family: Helvetica, Arial, sans-serif;
            font-size: 10px;
            color: #1f2937;
            margin: 0;
        }

        table { border-collapse: collapse; width: 100%; }
        td, th { vertical-align: top; }

        /* ── Masthead ─────────────────────────────────────────────────────── */
        .masthead {
            background: #f3f4f6;
            border-radius: 14px;
            padding: 16px 20px;
            margin-bottom: 22px;
        }
        .masthead-logo { width: 78px; }
        .masthead-name {
            font-size: 20px;
            font-weight: bold;
            letter-spacing: 0.5px;
            color: #111827;
        }
        .masthead-kind {
            font-size: 11px;
            font-weight: bold;
            color: #374151;
            padding-top: 6px;
        }

        /* ── Seller block + QR ────────────────────────────────────────────── */
        .seller { font-size: 10px; line-height: 1.55; }
        .seller-name { font-weight: bold; font-size: 11px; }
        .qr { width: 96px; height: 96px; }

        /* ── Section headings ─────────────────────────────────────────────── */
        .section-title {
            font-size: 11.5px;
            font-weight: bold;
            color: #111827;
            padding: 18px 0 6px 2px;
        }

        /* ── Bordered label / value grid ──────────────────────────────────── */
        .grid td {
            border: 1px solid #d1d5db;
            padding: 7px 9px;
            font-size: 9.5px;
        }
        .grid .k { width: 17%; color: #4b5563; }
        .grid .v { width: 33%; color: #111827; }

        /* ── Buyer / consignee ────────────────────────────────────────────── */
        .party td {
            border: 1px solid #d1d5db;
            padding: 8px 9px;
            font-size: 9px;
            line-height: 1.5;
            width: 50%;
        }
        .party b { color: #111827; }
        .party a { color: #2563eb; }

        /* ── Line items ───────────────────────────────────────────────────── */
        .items th {
            background: #fde68a;
            border: 1px solid #d1d5db;
            padding: 7px 8px;
            font-size: 9.5px;
            font-weight: bold;
            color: #1f2937;
            text-align: left;
        }
        .items td {
            border: 1px solid #d1d5db;
            padding: 8px;
            font-size: 9.5px;
        }
        .items .num { text-align: center; width: 34px; }
        .items .qty { text-align: center; width: 48px; }
        .items .rate,
        .items .amt { text-align: right; width: 90px; }

        /* ── Totals ───────────────────────────────────────────────────────── */
        /* Right-aligned by an empty spacer cell — dompdf honours no
           margin-left:auto on tables. */
        .totals td {
            border: 1px solid #d1d5db;
            padding: 9px 12px;
            font-size: 10px;
        }
        .totals .label { width: 200px; color: #374151; }
        .totals .value { width: 150px; }
        .totals .grand td {
            background: #f3f4f6;
            font-weight: bold;
            font-size: 11px;
            color: #111827;
        }

        /* ── Bank / signatory ─────────────────────────────────────────────── */
        .foot-box td {
            border: 1px solid #d1d5db;
            padding: 11px 12px;
            font-size: 9.5px;
            line-height: 1.6;
        }
        .foot-box .bank { width: 55%; }
        .bank-title { font-weight: bold; font-size: 10.5px; padding-bottom: 3px; }
        .words { font-weight: bold; font-size: 10.5px; padding-bottom: 14px; }
        .sign-for { font-weight: bold; padding-bottom: 26px; }

        /* ── Fixed page footer ────────────────────────────────────────────── */
        .pdf-footer {
            position: fixed;
            left: 0; right: 0; bottom: 0;
            height: 34px;
            border-top: 1px solid #c2410c;
            padding-top: 6px;
            font-size: 8.5px;
            color: #6b7280;
        }

        /* ── Terms & conditions pages ─────────────────────────────────────── */
        .tnc-page { page-break-before: always; }
        .tnc-title {
            text-align: center;
            font-weight: bold;
            font-size: 12px;
            text-decoration: underline;
            padding-bottom: 14px;
        }
        .tnc p {
            font-size: 9.5px;
            line-height: 1.65;
            text-align: justify;
            margin: 0 0 11px 0;
        }
        .tnc .lead { font-weight: bold; }
    </style>
</head>

<body>

    {{-- Repeats on every page. Swap in a barcode / page counter if needed. --}}
    <div class="pdf-footer">Purvee Enterprises &bull; Proforma Invoice</div>

    {{-- ══ Masthead ═══════════════════════════════════════════════════════ --}}
    <div class="masthead">
        <table>
            <tr>
                <td style="width:96px;">
                    {{-- Absolute path or data URI only. --}}
                    <img class="masthead-logo" src="{{ public_path('images/logo-purvee.png') }}" alt="" />
                </td>
                <td>
                    <div class="masthead-name">PURVEE ENTERPRISES</div>
                    <div class="masthead-kind">PROFORMA INVOICE</div>
                </td>
            </tr>
        </table>
    </div>

    {{-- ══ Seller + QR ════════════════════════════════════════════════════ --}}
    <table>
        <tr>
            <td class="seller">
                <div class="seller-name">Purvee Enterprises</div>
                <div>Office No 822, 8th Floor, Solitaire Business Hub, Balewadi Highstreet</div>
                <div>Baner, Pune, Maharashtra - 411045, India</div>
                <div>+91 9850880070 &nbsp;|&nbsp; purveeenterprises3500@gmail.com</div>
                <div>
                    GST No: <b>27AKSPT4532C1ZW</b>
                    GST Code: <b><u>27</u></b>
                    PAN: <b>AKSPT4532C</b>
                    IEC: <b>AKSPT4532C</b>
                </div>
            </td>
            <td style="width:110px; text-align:right;">
                <img class="qr" src="{{ public_path('images/pi-qr.png') }}" alt="" />
            </td>
        </tr>
    </table>

    {{-- ══ Transaction details ════════════════════════════════════════════ --}}
    <div class="section-title">Transaction Details</div>
    <table class="grid">
        <tr>
            <td class="k">PI No:</td>
            <td class="v">PI/2026-27/1254</td>
            <td class="k">PI Date:</td>
            <td class="v">11/09/2026</td>
        </tr>
        <tr>
            <td class="k">Currency:</td>
            <td class="v">USD</td>
            <td class="k">Port of Loading:</td>
            <td class="v">Mumbai AIR CARGO COMPLEX, SAHAR, ANDHERI(E)</td>
        </tr>
        <tr>
            <td class="k">Port of Discharge:</td>
            <td class="v">Muscat International Airport, Oman</td>
            <td class="k">Final Destination:</td>
            <td class="v">Oman</td>
        </tr>
        <tr>
            <td class="k">Country of Origin:</td>
            <td class="v">India</td>
            <td class="k">INCO Term:</td>
            <td class="v">C &amp; F</td>
        </tr>
        <tr>
            <td class="k">Net Weight (kg):</td>
            <td class="v">30 Kg</td>
            <td class="k">Gross Weight (kg):</td>
            <td class="v">50 Kg</td>
        </tr>
    </table>

    {{-- ══ Buyer / consignee ══════════════════════════════════════════════ --}}
    <div class="section-title">Buyer / Consignee</div>
    <table class="party">
        <tr>
            <td>
                <b>Buyer Name:</b> Golden Medical Supplies SPC is located at Office No. 106,
                Menaz Tower (Spar Building), Building No. 687, Way Number 5007, Ghala,
                Muscat, Sultanate of Oman<br />
                <a href="mailto:info@goldenmedicaloman.com">info@goldenmedicaloman.com</a><br />
                +968 9910 3855
            </td>
            <td>
                <b>Consignee Name:</b> Golden Medical Supplies SPC is located at Office No.
                106, Menaz Tower (Spar Building), Building No. 687, Way Number 5007,
                Ghala, Muscat, Sultanate of Oman<br />
                <a href="mailto:info@goldenmedicaloman.com">info@goldenmedicaloman.com</a><br />
                +968 9910 3855
            </td>
        </tr>
    </table>

    {{-- ══ Line items ═════════════════════════════════════════════════════ --}}
    <div class="section-title">Product / Service Details</div>
    <table class="items">
        <tr>
            <th class="num">Sr No</th>
            <th>Product Name</th>
            <th style="width:80px;">Brand</th>
            <th>Description</th>
            <th class="qty">Qty</th>
            <th class="rate">Rate</th>
            <th class="amt">Amount</th>
        </tr>
        {{-- One <tr> per line. Duplicate this block to add rows. --}}
        <tr>
            <td class="num">1</td>
            <td>QuantiFERON-TB Gold Plus(QFT- Plus)</td>
            <td>Qiagen</td>
            <td>Blood Collection Tubes</td>
            <td class="qty">30</td>
            <td class="rate">500USD/Box</td>
            <td class="amt">$15000</td>
        </tr>
    </table>

    {{-- ══ Totals ═════════════════════════════════════════════════════════ --}}
    <table style="margin-top:14px;">
        <tr>
            {{-- Spacer pushes the totals to the right edge. --}}
            <td style="border:0;"></td>
            <td style="width:350px; border:0;">
                <table class="totals">
                    <tr>
                        <td class="label">Sub Total</td>
                        <td class="value">$15000</td>
                    </tr>
                    <tr>
                        <td class="label">Shipping Cost</td>
                        <td class="value">$500</td>
                    </tr>
                    <tr class="grand">
                        <td class="label">Grand Total</td>
                        <td class="value">$15500</td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>

    {{-- ══ Bank details / signatory ═══════════════════════════════════════ --}}
    <table class="foot-box" style="margin-top:16px;">
        <tr>
            <td class="bank">
                <div class="bank-title">Bank Details</div>
                <b>Bank Name :</b> ICICI BANK LTD<br />
                <b>Account Holder Name :</b> PURVEE ENTERPRISES<br />
                <b>Address :</b> Showroom No.1, 1st Floor CTS 811, Aishwarya,
                ICICI Bank Ltd, Law College Rd, Deccan Gymkhana, Pune, Maharashtra- 411004<br />
                <b>Branch:-</b> Bhandarkar Road Branch<br />
                <b>Branch Code:</b> 006240<br />
                <b>Account No :</b> 624005030808<br />
                <b>AD Code:</b> 6390279<br />
                <b>IFSC :</b> ICIC0006240 &nbsp; <b>Swift Code :</b> 6390279
            </td>
            <td>
                <div class="words">Amount in Words- USD Fifteen Thousand Five Hundred</div>
                <div class="sign-for">For Purvee Enterprises</div>
                {{-- Signature image goes here, above the caption. --}}
                <div>Authorized Signatory</div>
            </td>
        </tr>
    </table>

    {{-- ══ Terms &amp; conditions — page 2 ════════════════════════════════ --}}
    <div class="tnc-page tnc">
        <div class="tnc-title">TERMS AND CONDITIONS:</div>

        <p><span class="lead">1. Duties, Taxes, and Ancillary Charges:</span> All customs duties, taxes, clearance
            charges, storage or demurrage costs, inland transportation, and any other governmental levy including octroi
            or entry tax are excluded from the invoice value and shall be borne and paid directly by the Purchaser to the
            concerned authority, in the invoice currency. All costs of insurance, consultation, and installation of the
            purchased goods shall likewise be borne by the Purchaser.</p>

        <p><span class="lead">2. Dispatch and Delivery:</span> The Company shall dispatch goods by consolidated sea or
            air freight through a freight forwarder of its sole choosing, on a best-efforts basis. Delivery timelines
            communicated by the Company are indicative only and are not binding. The Company reserves the unrestricted
            right to extend any delivery period for any hindrance whatsoever, whether or not within its control, without
            liability of any kind to the Purchaser. No penalty clause, liquidated damages claim, or compensation of any
            nature shall be entertained under any circumstance, whether or not such a clause is stipulated in the
            Purchaser's own purchase order.</p>

        <p>The Purchaser is unconditionally bound to accept delivery once goods have been dispatched, and refusal to
            accept delivery shall not relieve the Purchaser of its payment obligations. Where a third party is named as
            consignee, the Company's obligation to invoice that party is conditional upon prior execution of a Tripartite
            Agreement in a form satisfactory to the Company, and the Company may withhold dispatch until such agreement
            is executed to its satisfaction.</p>

        <p><span class="lead">3. Payment:</span> Payment shall be made in advance by way of telegraphic transfer (TT) or
            foreign demand draft. All banking charges, whether arising within India or abroad, shall be borne by the
            Purchaser.</p>

        <p><span class="lead">4. Cancellation of Orders:</span> The Seller reserves the sole discretion to accept or
            decline any request for cancellation of an order, for any reason whatsoever. Where the Seller approves a
            cancellation, such cancellation shall be without any liability to the Seller, and all resulting costs shall
            be borne solely by the Purchaser.</p>

        <p><span class="lead">5. Errors and Omissions:</span> The Seller reserves the right to correct any clerical or
            typographical error or omission in its documentation. The Seller shall bear no responsibility for errors
            contained in the Purchaser's own purchase order.</p>

        <p><span class="lead">6. Validity of Quoted Rates:</span> Shipping costs quoted herein remain valid for ten (10)
            days, and product pricing remains valid for thirty (30) days, from the date of this invoice.</p>

        <p><span class="lead">7. Intellectual Property:</span> All trademarks, brand names, service marks, and logos
            referenced in any quotation, invoice, or marketing material are the property of their respective owners. The
            Company operates solely as a trading and reselling entity and expressly disclaims any association,
            affiliation, sponsorship, or endorsement by any such mark owner. Any abbreviation or classification used in a
            product listing (including but not limited to designations for refurbished, pre-owned, used,
            own-manufactured, or authorised-dealer status) carries the meaning assigned to it by the Company, and the
            Purchaser accepts such classification as final and binding absent a written objection raised strictly within
            the timeline prescribed under Clause 14.</p>

        <p><span class="lead">8. Limitation of Liability After Shipment:</span> The Seller shall bear no liability for
            any loss, damage, or delay arising after the goods have been handed over to the carrier for shipment. As the
            Seller is a trading entity and not the manufacturer, all liability for manufacturing defects shall rest
            exclusively with the manufacturer.</p>

        <p><span class="lead">9. Force Majeure:</span> The Seller shall bear no liability for loss, damage, or delay
            occurring after goods have been accepted for shipment by the carrier, nor for any delay resulting from
            circumstances beyond its reasonable control including regulatory or governmental orders, acts of God,
            strikes, factory shutdowns, embargoes, war, riots, transport disruption, or labour unrest, including delays
            in procuring bought-out components. Delivery timelines shall be extended proportionately to account for such
            delay. Goods once sold shall not be liable to return or exchange.</p>

        <p><span class="lead">10. Export Restrictions and Regulatory Prohibitions:</span> If the Government of India
            (including any state authority) or any foreign government bans, restricts, or prohibits export of the goods
            covered herein (a "Restriction"), the Seller's obligations under this invoice shall stand suspended, without
            liability, until the Restriction is lifted or expires. The Purchaser bears sole responsibility for
            ascertaining any such Restriction; the Seller bears none. Where the Seller is thereby unable to supply the
            goods, the Purchaser shall have no right to refund or damages, and the goods shall be dispatched once the
            Restriction is lifted, subject to continued availability.</p>
    </div>

    {{-- ══ Terms &amp; conditions — page 3 ════════════════════════════════ --}}
    <div class="tnc-page tnc">
        <p><span class="lead">11. Indemnification:</span> The Purchaser shall unconditionally defend, indemnify, and hold
            harmless the Company, its affiliates, successors, assigns, directors, officers, shareholders, and employees
            against any and all losses, claims, damages, liabilities, penalties, fines, costs, and expenses (including
            full legal and professional fees) arising out of or in any way connected with:</p>

        <p>(a) any claim of intellectual-property infringement or misappropriation relating to the Products;</p>

        <p>(b) any loss, damage, or shortfall relating to equipment loaned to the Purchaser for repair or job-work,
            however arising, including spoilage, mishandling, improper use, pilferage, wrong processing, transit loss,
            theft, negligence, unauthorised use, or non-compliant return, including any shortfall against the agreed
            equipment weight or scrap norms; and</p>

        <p>(c) any claim whatsoever relating to the condition, quality, completeness, or description of the goods once
            dispatched.</p>

        <p>The Purchaser bears sole and non-delegable responsibility for conducting a complete pre-dispatch inspection of
            the consignment verifying condition, completeness of accessories, and conformity with agreed specifications
            and any defect, discrepancy, or deficiency not raised in strict compliance with Clause 14 shall be
            conclusively deemed waived. The Company retains an absolute right to cancel any order at any time without
            notice or liability, and such cancellation shall not diminish or discharge the Purchaser's indemnity
            obligations under this Clause.</p>

        <p><span class="lead">12. Governing Law:</span> This invoice and all transactions hereunder shall be governed by
            the laws of India. Errors and omissions excepted (E&amp;OE).</p>

        <p><span class="lead">13. Precedence of Terms:</span> Any terms contained in the Purchaser's Purchase Order —
            including those relating to product approval, shelf life, refund, warranty, rejection, or claims — shall bind
            the Seller only to the extent expressly accepted by the Seller in writing. This Proforma Invoice and the
            Seller's Terms shall prevail over any conflicting or additional terms proposed by the Purchaser.</p>

        <p><span class="lead">14. Pre-Dispatch Approval:</span> Prior to shipment, the Seller may share available product
            documentation, photographs, videos, serial numbers, and packing images. The Purchaser shall review and either
            approve or raise a written objection within three (3) working days of such sharing, and in any event before
            dispatch from the Seller's warehouse. Failure to respond within this period shall constitute deemed approval
            for dispatch.</p>

        <p><span class="lead">15. Shelf-Life Applicability:</span> Shelf-life provisions apply solely to consumables and
            reagents and do not extend to equipment, instruments, analyzers, systems, hardware, accessories, or other
            non-consumable items, unless expressly stated against the relevant product line item.</p>

        <p><span class="lead">16. "Brand New" Condition:</span> Where a product is described as "Brand New," the Seller
            shall supply a new, unused unit as per available manufacturer or source documentation. No refund,
            replacement, rejection, chargeback, or set-off shall arise merely on the basis of the Purchaser's
            unsubstantiated allegation. Any claim disputing the condition, originality, or description of the goods must
            be raised before dispatch to the transporter; such claims are barred thereafter. Physical or virtual
            inspection, together with deemed approval prior to dispatch, remains the Purchaser's responsibility.</p>

        <p><span class="lead">17. Limitation of Liability:</span> Notwithstanding anything to the contrary contained
            herein, the Company's aggregate liability arising out of or in connection with any transaction, howsoever
            arising, shall in no event exceed the invoice value of the specific goods giving rise to the claim. The
            Company shall in no circumstance be liable for any indirect, incidental, consequential, special, or punitive
            damages, including loss of profit, loss of business, or loss of goodwill, even if advised of the possibility
            of such damages.</p>

        <p><span class="lead">18. Destination-Country Regulatory Compliance and Registration:</span> The Purchaser is
            solely responsible for ascertaining and obtaining any registration, license, certification, or regulatory
            approval required under the laws of the destination country for the import, sale, or use of the goods,
            including but not limited to medical device registration, quality certification, or end-use permits. The
            Seller makes no representation that the goods are pre-approved, registered, or certified for use in any
            jurisdiction other than India, and shall bear no liability for any delay, loss, or claim arising from the
            Purchaser's failure to obtain such registration or approval.</p>

        <p><span class="lead">19. Dispute Resolution:</span> Any dispute, controversy, or claim arising out of or in
            connection with this invoice, including any question regarding its existence, validity, or termination, shall
            be referred to and finally resolved by arbitration under the Arbitration and Conciliation Act, 1996, as
            amended. The seat and venue of arbitration shall be Pune, Maharashtra, India, and the arbitration shall be
            conducted by a sole arbitrator appointed by the Seller, in the English language. The award rendered shall be
            final and binding on both parties. Nothing in this clause shall prevent either party from seeking interim or
            injunctive relief before a court of competent jurisdiction at Pune, Maharashtra.</p>

        <p><span class="lead">20. AMENDMENT:</span> The Company may amend, update, or supersede these Terms at any time
            by issuing a revised version with a new effective date. No amendment, modification, or waiver proposed by the
            Purchaser shall be effective unless expressly agreed to in writing by an authorised signatory of the
            Company.</p>
    </div>

    {{-- ══ Acknowledgement — page 4 ═══════════════════════════════════════ --}}
    <div class="tnc-page tnc">
        <p style="font-weight:bold;">ACKNOWLEDGEMENT</p>
        <p>By accepting the Company's quotation or Proforma Invoice whether by signature, stamp, email confirmation,
            part-payment, or conduct the Purchaser confirms that it has read, understood, and unconditionally agrees to
            be bound by these Terms and Conditions of Sale in their entirety.</p>
    </div>

</body>

</html>

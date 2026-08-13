<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
    @page { margin: 30px 34px; }
    * { box-sizing: border-box; }
    body {
        /* Match the shared payslip PDF — narrow, clean Helvetica/Arial (dompdf
         * ships Helvetica as a core font). Payslip has no ₹/unicode glyphs. */
        font-family: Helvetica, Arial, sans-serif;
        color: #1f2937;
        font-size: 11px;
        margin: 0;
    }
    .muted   { color: #8a93a4; }
    .bold    { font-weight: bold; }

    /* ── Header ── */
    .hdr { width: 100%; border-collapse: collapse; }
    .hdr td { vertical-align: top; }
    .hdr-logo img { max-height: 60px; max-width: 190px; }
    .hdr-logo .brandword { font-size: 22px; font-weight: bold; color: {{ $accent }}; }
    .hdr-right { text-align: right; }
    .pay-title { font-size: 22px; font-weight: bold; color: #111827; }
    .pay-title span { font-weight: normal; color: #6b7280; }
    .co-name { font-size: 11.5px; font-weight: bold; margin-top: 10px; color: #111827; }
    .co-addr { font-size: 9px; color: #6b7280; line-height: 1.55; margin-top: 3px; }

    /* Dark rule under the employee name; soft rule elsewhere. */
    .rule { border: 0; border-top: 1.5px solid #111827; margin: 8px 0 0; }
    .rule-soft { border: 0; border-top: 1px solid #d7dce8; margin: 0; }

    .emp-name { font-size: 13px; font-weight: bold; color: #111827; margin: 26px 0 0; }

    /* ── Details grid ── */
    .grid { width: 100%; border-collapse: collapse; }
    .grid td { padding: 11px 4px; width: 25%; vertical-align: top; border-bottom: 1px solid #eef1f5; }
    .grid .lbl { font-size: 9px; color: #9aa2b1; text-transform: none; letter-spacing: 0.01em; }
    .grid .val { font-size: 11px; color: #111827; margin-top: 4px; }

    .section-title { font-size: 12px; font-weight: bold; color: #111827; margin: 26px 0 6px; }

    /* ── Salary details strip ── */
    .sd td { padding: 11px 4px; width: 25%; border-bottom: 0; }

    /* ── Earnings / deductions ── */
    .ed { width: 100%; border-collapse: collapse; margin-top: 18px; }
    .ed > tbody > tr > td { vertical-align: top; width: 50%; }
    .ed-col { padding: 0 16px 0 0; }
    .ed-col.right-col { padding: 0 0 0 16px; border-left: 1px solid #e5e7eb; }
    .ed-head { font-size: 11px; font-weight: bold; color: #111827; padding-bottom: 8px; }
    .ed-line { width: 100%; border-collapse: collapse; }
    .ed-line td { padding: 6px 0; font-size: 11px; }
    .ed-line td.amt { text-align: right; }
    .ed-total td { font-weight: bold; padding-top: 8px; }

    /* ── Net pay ── */
    .net { width: 100%; border-collapse: collapse; background: #f6f7f9; margin-top: 22px; }
    .net td { padding: 13px 14px; vertical-align: middle; }
    .net .net-lbl { font-size: 11px; color: #1f2937; }
    .net .net-val { font-size: 12px; }
    .net .words { font-size: 11px; font-weight: bold; color: #111827; }

    .note { font-size: 9px; color: #4b5563; margin-top: 16px; }
    .note .star { color: #111827; font-weight: bold; }
    .note .desc { font-style: italic; }
    .provisional {
        display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 10px;
        background: #fdf3d6; border: 1px solid #f0d990; color: #a06f00;
        font-size: 9px; font-weight: bold; letter-spacing: 0.06em; vertical-align: middle;
    }
</style>
</head>
<body>

    {{-- ── Header (logo LEFT, PAYSLIP + company RIGHT) ── --}}
    <table class="hdr">
        <tr>
            <td class="hdr-logo" style="width: 42%;">
                @if(!empty($logo))
                    <img src="{{ $logo }}" alt="logo">
                @else
                    <div class="brandword">{{ $company['name'] }}</div>
                @endif
            </td>
            <td class="hdr-right" style="width: 58%;">
                <div class="pay-title">PAYSLIP <span>{{ $periodLabelUpper }}</span></div>
                <div class="co-addr">FY {{ $financialYear ?? '—' }}</div>
                <div class="co-name">{{ strtoupper($company['name']) }}</div>
                <div class="co-addr">{{ $company['address'] }}</div>
            </td>
        </tr>
    </table>

    {{-- ── Employee name + dark rule under it ── --}}
    <div class="emp-name">
        {{ strtoupper($employee['name']) }}
        @if(!$isFinal)<span class="provisional">PROVISIONAL</span>@endif
    </div>
    <hr class="rule">

    {{-- ── Details grid ── --}}
    <table class="grid">
        <tr>
            <td><div class="lbl">Employee Number</div><div class="val">{{ $employee['code'] }}</div></td>
            <td><div class="lbl">Date Joined</div><div class="val">{{ $employee['date_joined'] }}</div></td>
            <td><div class="lbl">Department</div><div class="val">{{ $employee['department'] }}</div></td>
            <td><div class="lbl">Sub Department</div><div class="val">{{ $employee['sub_department'] }}</div></td>
        </tr>
        <tr>
            <td><div class="lbl">Designation</div><div class="val">{{ $employee['designation'] }}</div></td>
            <td><div class="lbl">Payment Mode</div><div class="val">{{ $employee['payment_mode'] }}</div></td>
            <td><div class="lbl">UAN</div><div class="val">{{ $employee['uan'] }}</div></td>
            <td><div class="lbl">PF Number</div><div class="val">{{ $employee['pf_number'] }}</div></td>
        </tr>
        <tr>
            <td><div class="lbl">PAN Number</div><div class="val">{{ $employee['pan'] }}</div></td>
            <td><div class="lbl">Location</div><div class="val">{{ $employee['location'] }}</div></td>
            <td colspan="2"><div class="lbl">Bank Name</div><div class="val">{{ $employee['bank_name'] }}</div></td>
        </tr>
    </table>

    {{-- ── Salary details strip ── --}}
    <div class="section-title">SALARY DETAILS</div>
    <hr class="rule-soft">
    <table class="grid sd">
        <tr>
            <td><div class="lbl">Actual Payable Days</div><div class="val">{{ $days['payable'] }}</div></td>
            <td><div class="lbl">Total Working Days</div><div class="val">{{ $days['working'] }}</div></td>
            <td><div class="lbl">Loss Of Pay Days</div><div class="val">{{ $days['lop'] }}</div></td>
            <td><div class="lbl">Days Payable</div><div class="val">{{ $days['payable_int'] }}</div></td>
        </tr>
    </table>

    {{-- ── Earnings / Deductions ── --}}
    <table class="ed">
        <tr>
            <td class="ed-col">
                <div class="ed-head">EARNINGS</div>
                <table class="ed-line">
                    @foreach($earnings as $e)
                        <tr><td>{{ $e['label'] }}</td><td class="amt">{{ number_format($e['amount'], 2) }}</td></tr>
                    @endforeach
                    <tr class="ed-total"><td>Total Earnings (A)</td><td class="amt">{{ number_format($totalEarnings, 2) }}</td></tr>
                </table>
            </td>
            <td class="ed-col right-col">
                <div class="ed-head">TAXES &amp; DEDUCTIONS</div>
                <table class="ed-line">
                    @forelse($deductions as $d)
                        <tr><td>{{ $d['label'] }}</td><td class="amt">{{ number_format($d['amount'], 2) }}</td></tr>
                    @empty
                        <tr><td class="muted">No deductions</td><td class="amt">0.00</td></tr>
                    @endforelse
                    <tr class="ed-total"><td>Total Taxes &amp; Deductions (B)</td><td class="amt">{{ number_format($totalDeductions, 2) }}</td></tr>
                </table>
            </td>
        </tr>
    </table>

    {{-- ── Net pay ── --}}
    <table class="net">
        <tr>
            <td style="width: 38%;"><span class="net-lbl">Net Salary Payable ( A - B )</span></td>
            <td style="width: 62%;"><span class="net-val">{{ number_format($netPay, 2) }}</span></td>
        </tr>
        <tr>
            <td><span class="net-lbl">Net Salary in words</span></td>
            <td><span class="words">{{ $netWords }}</span></td>
        </tr>
    </table>

    <div class="note">
        <span class="star">**Note :</span> <span class="desc">All amounts displayed in this payslip are in <span class="bold">INR</span></span>
    </div>
    <div class="note desc">
        <span class="star">*</span> This is computer generated statement, does not require signature.
    </div>

</body>
</html>

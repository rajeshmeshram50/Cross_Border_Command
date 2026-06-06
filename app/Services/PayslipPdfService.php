<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Employee;
use App\Models\Payslip;
use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Renders a Payslip into a PDF that matches the house payslip layout
 * (resources/views/pdf/payslip.blade.php). The company header is resolved
 * from the employee's BRANCH first (name/address/logo/accent), falling back
 * to the parent CLIENT org — so each branch's payslips carry their own
 * letterhead.
 *
 * The financial figures come from the stored Payslip snapshot (reproducible);
 * only the descriptive header/identity fields are resolved live.
 */
class PayslipPdfService
{
    /** Render a single payslip to raw PDF bytes. */
    public function render(Payslip $slip): string
    {
        @set_time_limit(120);
        $pdf = Pdf::loadView('pdf.payslip', $this->viewData($slip))
            ->setPaper('A4', 'portrait');

        // dompdf embeds the branch logo via GD; some logo PNGs carry a
        // non-standard sRGB/iCCP colour profile that makes libpng emit harmless
        // E_WARNINGs. The PDF renders fine either way — swallow just those
        // warnings so they don't flood the application log on every render.
        set_error_handler(function ($severity, $message) {
            if (stripos($message, 'libpng') !== false || stripos($message, 'iccp') !== false
                || stripos($message, 'imagecreatefrompng') !== false) {
                return true; // handled / ignored
            }
            return false; // let everything else bubble up normally
        }, E_WARNING | E_NOTICE);
        try {
            return $pdf->output();
        } finally {
            restore_error_handler();
        }
    }

    /** A safe, descriptive filename for a payslip PDF. */
    public function filename(Payslip $slip): string
    {
        $name = preg_replace('/[^A-Za-z0-9]+/', '_', (string) ($slip->employee_name ?: 'Employee'));
        $label = preg_replace('/[^A-Za-z0-9]+/', '_', (string) $this->periodLabel($slip));
        return trim($name, '_') . '_Payslip_' . $label . '.pdf';
    }

    /* ───────────────────────── view data ───────────────────────── */

    public function viewData(Payslip $slip): array
    {
        $slip->loadMissing('run:id,status');
        $employee = Employee::find($slip->employee_id);
        $company  = $this->resolveCompany($slip, $employee);

        $label = $this->periodLabel($slip);

        $earnings   = $this->lines($slip->earnings, $slip->gross_earnings, 'Earnings');
        $deductions = $this->deductionLines($slip);

        $isFinal = in_array(optional($slip->run)->status, ['approved', 'paid'], true)
            || $slip->status === 'Paid';

        return [
            'accent'           => $company['accent'],
            'logo'             => $company['logo'],
            'company'          => $company,
            'periodLabelUpper' => strtoupper($label),
            'isFinal'          => $isFinal,
            'employee' => [
                'name'           => $slip->employee_name ?: '—',
                'code'           => $slip->employee_code ?: ('EMP-' . $slip->employee_id),
                'date_joined'    => $employee && $employee->date_of_joining
                    ? Carbon::parse($employee->date_of_joining)->format('d M Y') : 'N/A',
                'department'     => $slip->department ?: 'N/A',
                'sub_department' => 'N/A',
                'designation'    => $slip->designation ?: 'N/A',
                'payment_mode'   => $this->paymentMode($employee),
                'uan'            => $employee->uan_number ?: 'N/A',
                // No dedicated PF-account-number column on employees yet; the
                // pf_deduction field is a config flag, not an account number.
                'pf_number'      => 'N/A',
                'pan'            => $employee->pan_number ?: 'N/A',
                'location'       => $employee->location ?: $company['city'] ?: 'N/A',
                'bank_name'      => $employee->bank_name ?: 'N/A',
            ],
            'days' => [
                'payable'     => $this->num($slip->paid_days),
                'payable_int' => (int) round((float) $slip->paid_days),
                'working'     => $this->num($slip->working_days),
                'lop'         => $this->num($slip->lop_days),
            ],
            'earnings'        => $earnings,
            'deductions'      => $deductions,
            'totalEarnings'   => (float) $slip->gross_earnings,
            'totalDeductions' => (float) $slip->total_deductions,
            'netPay'          => (float) $slip->net_pay,
            'netWords'        => $this->amountInWords((float) $slip->net_pay),
        ];
    }

    /** Normalised earnings/deductions component lists. */
    private function lines($components, $fallbackTotal, string $fallbackLabel): array
    {
        $out = [];
        foreach ((array) $components as $c) {
            $out[] = ['label' => $c['label'] ?? 'Component', 'amount' => (float) ($c['amount'] ?? 0)];
        }
        if (empty($out) && (float) $fallbackTotal > 0) {
            $out[] = ['label' => $fallbackLabel, 'amount' => (float) $fallbackTotal];
        }
        return $out;
    }

    /**
     * Deduction lines straight from the stored JSON (already broken into PT /
     * PF / ESI / TDS / LOP / Advance heads by the engine).
     */
    private function deductionLines(Payslip $slip): array
    {
        $out = [];
        foreach ((array) $slip->deductions as $c) {
            $out[] = ['label' => $c['label'] ?? 'Deduction', 'amount' => (float) ($c['amount'] ?? 0)];
        }
        return $out;
    }

    /* ───────────────────────── company header ───────────────────────── */

    /**
     * Resolve the payslip letterhead: branch first, client org as fallback.
     * Returns name / address / city / logo (base64 data-uri) / accent colour.
     */
    private function resolveCompany(Payslip $slip, ?Employee $employee): array
    {
        $branch = $employee && $employee->branch_id ? Branch::find($employee->branch_id)
            : ($slip->branch_id ? Branch::find($slip->branch_id) : null);
        $client = ($slip->client_id ?? ($employee->client_id ?? null))
            ? Client::find($slip->client_id ?? $employee->client_id) : null;

        $name = $branch?->name
            ?: $client?->org_name
            ?: 'Company';

        $address = $this->joinAddress([
            $branch?->address ?? $client?->address,
            $branch?->city ?? $client?->city,
            $branch?->state ?? $client?->state,
            $branch?->pincode ?? $client?->pincode,
            $branch?->country ?? $client?->country,
        ]);

        $accent = $branch?->primary_color ?: ($client?->primary_color ?: '#2563eb');
        $logo   = $this->resolveLogo($branch?->logo ?? $client?->logo);

        return [
            'name'     => $name,
            'address'  => $address ?: '—',
            'city'     => $branch?->city ?: $client?->city ?: '',
            'accent'   => $accent,
            'logo'     => $logo,
            'hr_email' => $branch?->email ?: ($client?->email ?: null),
        ];
    }

    /** Public letterhead resolver (name / address / HR email / initials) for
     *  the mailer and the on-screen payslip viewer. */
    public function letterhead(Payslip $slip): array
    {
        $employee = Employee::find($slip->employee_id);
        $c = $this->resolveCompany($slip, $employee);
        $name = (string) $c['name'];
        $words = preg_split('/\s+/', trim($name));
        $initials = strtoupper(substr($words[0] ?? '', 0, 1) . substr($words[1] ?? ($words[0] ?? ''), 0, 1));
        return [
            'name'     => $name,
            'address'  => $c['address'],
            'hr_email' => $c['hr_email'],
            'initials' => $initials ?: 'CO',
        ];
    }

    private function joinAddress(array $parts): string
    {
        $clean = array_values(array_filter(array_map(fn ($p) => trim((string) $p), $parts), fn ($p) => $p !== ''));
        return implode(', ', $clean);
    }

    /**
     * Turn a stored logo path into a base64 data-URI dompdf can embed offline.
     * Returns null if the file can't be found locally (template shows the name).
     */
    private function resolveLogo(?string $logo): ?string
    {
        if (!$logo) return null;
        foreach ([
            public_path('storage/' . ltrim($logo, '/')),
            storage_path('app/public/' . ltrim(preg_replace('#^/?storage/#', '', $logo), '/')),
            public_path(ltrim($logo, '/')),
        ] as $path) {
            if (is_file($path)) {
                $data = @file_get_contents($path);
                if ($data === false) continue;
                $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION)) ?: 'png';
                $mime = $ext === 'svg' ? 'image/svg+xml' : ($ext === 'jpg' ? 'image/jpeg' : "image/$ext");
                return 'data:' . $mime . ';base64,' . base64_encode($data);
            }
        }
        return null;
    }

    private function paymentMode(?Employee $e): string
    {
        $mode = $e?->salary_payment_mode;
        if (!$mode) return $e?->bank_account_number ? 'Bank Transfer' : 'N/A';
        return ucwords(str_replace('_', ' ', (string) $mode));
    }

    /* ───────────────────────── helpers ───────────────────────── */

    private function periodLabel(Payslip $slip): string
    {
        $p = DB::table('payroll_periods')->where('id', $slip->payroll_period_id)->first();
        return $p?->label ?: now()->format('M Y');
    }

    private function num($v): string
    {
        $f = (float) $v;
        return rtrim(rtrim(number_format($f, 2, '.', ''), '0'), '.') ?: '0';
    }

    /** Indian-style "Rupees …" words for a payslip net amount. */
    public function amountInWords(float $amount): string
    {
        $rupees = (int) floor($amount);
        $paise  = (int) round(($amount - $rupees) * 100);

        $words = $rupees === 0 ? 'Zero' : $this->numberToWords($rupees);
        $out = $words . ' Rupees';
        if ($paise > 0) {
            $out .= ' and ' . $this->numberToWords($paise) . ' Paise';
        }
        return $out . ' only';
    }

    /** Integer → Indian-system words (crore/lakh/thousand). */
    private function numberToWords(int $n): string
    {
        if ($n < 0) return 'Minus ' . $this->numberToWords(-$n);
        $ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
            'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
        $tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

        $twoDigits = function (int $num) use ($ones, $tens): string {
            if ($num < 20) return $ones[$num];
            return trim($tens[intdiv($num, 10)] . ' ' . $ones[$num % 10]);
        };

        $words = '';
        $crore = intdiv($n, 10000000); $n %= 10000000;
        $lakh  = intdiv($n, 100000);   $n %= 100000;
        $thou  = intdiv($n, 1000);     $n %= 1000;
        $hund  = intdiv($n, 100);      $n %= 100;

        if ($crore) $words .= $this->numberToWords($crore) . ' Crore ';
        if ($lakh)  $words .= $twoDigits($lakh) . ' Lakh ';
        if ($thou)  $words .= $twoDigits($thou) . ' Thousand ';
        if ($hund)  $words .= $ones[$hund] . ' Hundred ';
        if ($n)     $words .= ($words !== '' ? 'and ' : '') . $twoDigits($n);

        return trim($words);
    }
}

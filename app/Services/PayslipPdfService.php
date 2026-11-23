<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Employee;
use App\Models\Payslip;
use App\Models\User;
use Barryvdh\DomPDF\Facade\Pdf;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class PayslipPdfService
{
    public function render(Payslip $slip): string
    {
        @set_time_limit(120);
        $pdf = Pdf::loadView('pdf.payslip', $this->viewData($slip))
            ->setPaper('A4', 'portrait');

        set_error_handler(function ($severity, $message) {
            if (stripos($message, 'libpng') !== false || stripos($message, 'iccp') !== false
                || stripos($message, 'imagecreatefrompng') !== false) {
                return true;
            }
            return false;
        }, E_WARNING | E_NOTICE);
        try {
            return $pdf->output();
        } finally {
            restore_error_handler();
        }
    }

    public function filename(Payslip $slip): string
    {
        $name = preg_replace('/[^A-Za-z0-9]+/', '_', (string) ($slip->employee_name ?: 'Employee'));
        $label = preg_replace('/[^A-Za-z0-9]+/', '_', (string) $this->periodLabel($slip));
        return trim($name, '_') . '_Payslip_' . $label . '.pdf';
    }

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
            'financialYear'    => $this->financialYear($slip),
            'isFinal'          => $isFinal,
            'employee' => [
                'name'           => $slip->employee_name ?: '—',
                'code'           => $slip->employee_code ?: ('EMP-' . $slip->employee_id),
                'date_joined'    => $employee && $employee->date_of_joining
                    ? Carbon::parse($employee->date_of_joining)->format('d M Y') : 'N/A',
                'department'     => $slip->department ?: 'N/A',
                'designation'    => $slip->designation ?: 'N/A',
                'payment_mode'   => $this->paymentMode($employee),
                'uan'            => $employee->uan_number ?: 'N/A',
                'pan'            => $employee->pan_number ?: 'N/A',
                'location'       => $employee->location ?: $company['city'] ?: 'N/A',
                'bank_name'      => $employee->bank_name ?: 'N/A',
            ],
            'days' => [
                'payable'     => $this->num($slip->paid_days),
                'payable_int' => (int) round((float) $slip->paid_days),
                'working'     => $this->num($slip->working_days),
                'lop'         => $this->num($slip->lop_days),
                'late_lop'    => $slip->late_lop_days !== null && (float) $slip->late_lop_days > 0
                    ? $this->num($slip->late_lop_days)
                    : null,
                'in_month'    => optional($slip->period)->period_start
                    ? \Carbon\Carbon::parse($slip->period->period_start)->daysInMonth
                    : null,
            ],
            'earnings'        => $earnings,
            'deductions'      => $deductions,
            'totalEarnings'   => (float) $slip->gross_earnings,
            'perDaySalary'    => (float) $slip->working_days > 0
                ? round(max(0, (float) $slip->gross_earnings
                    - (float) ($slip->overtime_amount ?? 0)
                    - (float) ($slip->bonus_amount ?? 0)) / (float) $slip->working_days, 2)
                : null,
            'payableDays'     => (float) $slip->working_days,
            'totalDeductions' => (float) $slip->total_deductions,
            'netPay'          => (float) $slip->net_pay,
            'netWords'        => $this->amountInWords((float) $slip->net_pay),
        ];
    }

    private function lines($components, $fallbackTotal, string $fallbackLabel): array
    {
        $lines = \App\Support\PayslipLines::reconciledTo(
            \App\Support\PayslipLines::withoutUnfunded((array) $components),
            (float) $fallbackTotal,
        );

        $out = [];
        foreach ($lines as $c) {
            $out[] = ['label' => $c['label'] ?? 'Component', 'amount' => (float) ($c['amount'] ?? 0)];
        }
        if (empty($out) && (float) $fallbackTotal > 0) {
            $out[] = ['label' => $fallbackLabel, 'amount' => (float) $fallbackTotal];
        }
        return $out;
    }

    private function deductionLines(Payslip $slip): array
    {
        $out = [];
        foreach ((array) $slip->deductions as $c) {
            $out[] = ['label' => $c['label'] ?? 'Deduction', 'amount' => (float) ($c['amount'] ?? 0)];
        }
        return $out;
    }

    private function branchUserEmail(?int $branchId): ?string
    {
        if (!$branchId) return null;
        return User::query()
            ->where('branch_id', $branchId)
            ->where('user_type', 'branch_user')
            ->whereNotNull('email')
            ->orderBy('id')
            ->value('email');
    }

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
            'hr_email' => $this->branchUserEmail($branch?->id) ?: ($branch?->email ?: ($client?->email ?: null)),
        ];
    }

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

                $scaled = $this->downscaleLogo($path, $data, $ext);
                if ($scaled !== null) {
                    return 'data:image/png;base64,' . base64_encode($scaled);
                }

                return 'data:' . $mime . ';base64,' . base64_encode($data);
            }
        }
        return null;
    }

    private const LOGO_MAX_W = 380;
    private const LOGO_MAX_H = 120;
    private const LOGO_PASSTHROUGH_BYTES = 40960;

    private function downscaleLogo(string $path, string $data, string $ext): ?string
    {
        if ($ext === 'svg' || strlen($data) <= self::LOGO_PASSTHROUGH_BYTES) {
            return null;
        }
        if (!function_exists('imagecreatefromstring') || !function_exists('imagescale')) {
            return null;
        }

        $cacheDir = storage_path('app/payslip-logo-cache');
        $key      = sha1($path . '|' . @filemtime($path) . '|' . self::LOGO_MAX_W . 'x' . self::LOGO_MAX_H);
        $cacheFile = $cacheDir . DIRECTORY_SEPARATOR . $key . '.png';
        if (is_file($cacheFile)) {
            $cached = @file_get_contents($cacheFile);
            if ($cached !== false && $cached !== '') {
                return $cached;
            }
        }

        try {
            $src = @imagecreatefromstring($data);
            if ($src === false) {
                return null;
            }
            $w = imagesx($src);
            $h = imagesy($src);
            if ($w < 1 || $h < 1) {
                imagedestroy($src);
                return null;
            }
            if ($w <= self::LOGO_MAX_W && $h <= self::LOGO_MAX_H) {
                imagedestroy($src);
                return null;
            }

            $ratio = min(self::LOGO_MAX_W / $w, self::LOGO_MAX_H / $h);
            $newW  = max(1, (int) round($w * $ratio));
            $newH  = max(1, (int) round($h * $ratio));

            $dst = imagecreatetruecolor($newW, $newH);
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
            imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $w, $h);

            ob_start();
            imagepng($dst, null, 6);
            $out = (string) ob_get_clean();

            imagedestroy($src);
            imagedestroy($dst);

            if ($out === '') {
                return null;
            }

            if (!is_dir($cacheDir)) {
                @mkdir($cacheDir, 0775, true);
            }
            @file_put_contents($cacheFile, $out);

            return $out;
        } catch (\Throwable $e) {
            return null;
        }
    }

    private function paymentMode(?Employee $e): string
    {
        $mode = $e?->salary_payment_mode;
        if (!$mode) return $e?->bank_account_number ? 'Bank Transfer' : 'N/A';
        return ucwords(str_replace('_', ' ', (string) $mode));
    }

    private function periodLabel(Payslip $slip): string
    {
        $p = $this->period($slip);
        if ($p?->label) return $p->label;
        if ($p && $p->month && $p->year) {
            return Carbon::create((int) $p->year, (int) $p->month, 1)->format('M Y');
        }
        return '—';
    }

    private function financialYear(Payslip $slip): string
    {
        $p = $this->period($slip);
        return ($p && $p->month && $p->year)
            ? \App\Models\PayrollPeriod::financialYearFor((int) $p->month, (int) $p->year)
            : '—';
    }

    private function period(Payslip $slip)
    {
        $id = (int) $slip->payroll_period_id;
        return $this->periodCache[$id] ??= DB::table('payroll_periods')
            ->where('id', $id)->first();
    }

    private array $periodCache = [];

    private function num($v): string
    {
        $f = (float) $v;
        return rtrim(rtrim(number_format($f, 2, '.', ''), '0'), '.') ?: '0';
    }

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

<?php

namespace App\Console\Commands;

use App\Mail\ProbationCompletedMail;
use App\Models\Client;
use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class SendProbationCompletionEmails extends Command
{
    protected $signature = 'hr:send-probation-emails
                            {--days=7 : Catch-up window — only probations that ended within the last N days}
                            {--employee= : Force-send for one employee id/code (ignores the window; for testing)}
                            {--dry : List who would be emailed without sending}';

    protected $description = 'Email employees whose probation period has completed (work + personal).';

    public function handle(): int
    {
        $today  = Carbon::today();
        $window = (int) $this->option('days');
        $only   = $this->option('employee');
        $dry    = (bool) $this->option('dry');

        $q = Employee::query()
            ->with(['designation:id,name', 'department:id,name'])
            ->whereNull('probation_completion_emailed_at')
            ->whereNotNull('probation_end_date')
            ->where(function ($w) {
                $w->whereNull('status')
                  ->orWhereNotIn(
                      \Illuminate\Support\Facades\DB::raw('LOWER(status)'),
                      Employee::DISABLED_STATUSES
                  );
            });

        if ($only) {
            $q->where(function ($w) use ($only) {
                $w->where('emp_code', $only);
                if (ctype_digit((string) $only)) {
                    $w->orWhere('id', (int) $only);
                }
            });
        } else {
            $q->whereDate('probation_end_date', '<', $today)
              ->whereDate('probation_end_date', '>=', $today->copy()->subDays($window));
        }

        $sent = 0; $skipped = 0;

        foreach ($q->cursor() as $emp) {
            $end = $emp->probation_end_date instanceof Carbon
                ? $emp->probation_end_date->copy()->startOfDay()
                : Carbon::parse($emp->probation_end_date)->startOfDay();

            $work     = trim((string) $emp->official_email);
            $personal = trim((string) $emp->email);
            $to = array_values(array_unique(array_filter([$work, $personal])));
            if (empty($to)) { $skipped++; $this->warn("· {$emp->emp_code}: no email on file — skipped"); continue; }

            $name = $emp->display_name ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''));
            $org  = Client::find($emp->client_id)?->org_name ?: config('mail.from.name', 'Our Company');

            $payload = [
                'org_name'       => $org,
                'employee_name'  => $name ?: 'Employee',
                'designation'    => $emp->designation->name ?? '',
                'department'     => $emp->department->name ?? '',
                'effective_date' => $end->format('jS M Y'),
                'gender'         => (string) ($emp->gender ?? ''),
                'hr_name'        => 'Human Resources',
                'hr_email'       => config('mail.from.address', 'hr@company.com'),
            ];

            if ($dry) {
                $this->line("· would email {$emp->emp_code} ({$name}) → " . implode(', ', $to) . " · ended {$end->toDateString()}");
                $sent++;
                continue;
            }

            try {
                Mail::to($to)->send(new ProbationCompletedMail($payload));
                $emp->forceFill(['probation_completion_emailed_at' => now()])->save();
                $sent++;
                $this->info("✓ {$emp->emp_code} ({$name}) → " . implode(', ', $to));
            } catch (\Throwable $e) {
                $skipped++;
                Log::warning('Probation completion email failed: ' . $e->getMessage(), ['employee_id' => $emp->id]);
                $this->error("✗ {$emp->emp_code}: {$e->getMessage()}");
            }
        }

        $this->newLine();
        $this->info(($dry ? 'DRY RUN — ' : '') . "Probation emails: {$sent} sent" . ($skipped ? ", {$skipped} skipped" : '') . '.');
        return self::SUCCESS;
    }
}

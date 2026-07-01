<?php

namespace App\Console\Commands;

use App\Mail\ProbationCompletedMail;
use App\Models\Client;
use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Daily job — sends the "Probation Successfully Completed" email to every
 * employee whose probation period has just ended.
 *
 * Probation end date = date_of_joining + probation_months (there's no stored
 * end column). When that date has passed (e.g. it ended YESTERDAY), the next
 * morning's run mails the employee on BOTH their work + personal address, then
 * stamps `probation_completion_emailed_at` so it never sends twice.
 *
 * A short catch-up window (default 7 days) covers any morning the scheduler
 * didn't run, without spamming long-confirmed staff on first deployment.
 */
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
            // probation_end_date is stored on the employee (computed on the
            // frontend from joining date + probation policy); it's NULL unless
            // there's a real probation, so this one check replaces the old
            // joining-date / probation_months guards and the per-row date maths.
            ->whereNotNull('probation_end_date')
            // Active employees only — never mail someone who has been disabled
            // (Inactive/Resigned/Terminated) or exited (the exit flow stamps
            // status Resigned/Terminated). Mirrors Employee::isDisabled(). A
            // NULL/blank status still counts as active. Soft-deleted (Removed)
            // rows are already excluded by the default SoftDeletes scope.
            ->where(function ($w) {
                $w->whereNull('status')
                  ->orWhereNotIn(
                      \Illuminate\Support\Facades\DB::raw('LOWER(status)'),
                      Employee::DISABLED_STATUSES
                  );
            });

        if ($only) {
            // Match on emp_code, or on numeric id only — comparing the bigint
            // id column against a non-numeric code (e.g. "EMP-004") trips a
            // Postgres cast error.
            $q->where(function ($w) use ($only) {
                $w->where('emp_code', $only);
                if (ctype_digit((string) $only)) {
                    $w->orWhere('id', (int) $only);
                }
            });
        } else {
            // Catch-up window done in SQL against the indexed generated column:
            // ended yesterday or earlier, but not older than N days.
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

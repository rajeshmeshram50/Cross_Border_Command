<?php

namespace App\Console\Commands;

use App\Mail\SubscriptionExpiryReminderMail;
use App\Models\IntegrationSubscription;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Daily expiry-reminder engine for tracked third-party subscriptions.
 *
 * The scheduler runs this once a day (see routes/console.php). For every
 * 'active' subscription it works out how many days are left until the renewal
 * date, then — for each per-service `reminder_days` threshold that has been
 * reached but NOT yet mailed for the current expires_at — sends the owner one
 * reminder and records the threshold in `reminders_sent`.
 *
 * Idempotency: `reminders_sent` is keyed to the current expires_at (the
 * controller clears it whenever the date changes), so re-running the command on
 * the same day, or missing a day and catching up, never double-mails a
 * milestone. A special threshold value 0 covers "on/after the expiry day".
 */
class SendSubscriptionExpiryReminders extends Command
{
    protected $signature = 'subscriptions:send-expiry-reminders
                            {--dry : List what would be sent without emailing}
                            {--id= : Only evaluate this subscription id (useful for a manual test)}';

    protected $description = 'Email each service owner when a tracked third-party subscription is approaching its renewal date.';

    public function handle(): int
    {
        $dry = (bool) $this->option('dry');

        $query = IntegrationSubscription::where('status', 'active');
        if ($id = $this->option('id')) {
            $query->where('id', (int) $id);
        }
        $subs = $query->get();

        $sent = 0;

        foreach ($subs as $sub) {
            $daysLeft   = $sub->daysLeft();                 // negative once past due
            $thresholds = collect($sub->reminder_days ?? [])->map(fn ($d) => (int) $d);
            $already    = collect($sub->reminders_sent ?? [])->map(fn ($d) => (int) $d);

            // Which configured milestones have now been reached and not yet mailed.
            // "Reached" = days-left has fallen to or below the threshold.
            $due = $thresholds
                ->filter(fn ($t) => $daysLeft <= $t && !$already->contains($t))
                ->sort()                    // smallest (most urgent) first
                ->values();

            // Once past due, also fire a single "expired" reminder (threshold 0)
            // if it wasn't one of the configured milestones already handled.
            if ($daysLeft < 0 && !$already->contains(0) && !$due->contains(0)) {
                $due->push(0);
            }

            if ($due->isEmpty()) {
                continue;
            }

            // Only the MOST-URGENT reached milestone needs an email this run; the
            // rest are still marked sent so a later run doesn't re-fire them.
            $mailThreshold = $due->first();

            $this->line(sprintf(
                '#%d %s — %d day(s) left → remind owner %s at milestone %d%s',
                $sub->id, $sub->name, $daysLeft, $sub->owner_email, $mailThreshold, $dry ? ' [dry]' : ''
            ));

            if (!$dry) {
                try {
                    Mail::to($sub->owner_email)->send(new SubscriptionExpiryReminderMail($sub, $daysLeft));

                    $sub->reminders_sent = $already->merge($due)->unique()->values()->all();
                    $sub->last_reminded_on = now()->toDateString();
                    $sub->save();
                    $sent++;
                } catch (\Throwable $e) {
                    Log::error('Subscription expiry reminder failed', [
                        'subscription_id' => $sub->id,
                        'error'           => $e->getMessage(),
                    ]);
                    $this->error("  ! failed to email #{$sub->id}: {$e->getMessage()}");
                }
            }
        }

        $this->info($dry
            ? "Dry run complete — evaluated {$subs->count()} active subscription(s)."
            : "Done — {$sent} reminder email(s) sent from {$subs->count()} active subscription(s).");

        return self::SUCCESS;
    }
}

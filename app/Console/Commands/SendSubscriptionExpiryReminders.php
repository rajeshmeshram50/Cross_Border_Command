<?php

namespace App\Console\Commands;

use App\Mail\SubscriptionExpiryReminderMail;
use App\Models\IntegrationSubscription;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

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
            $daysLeft   = $sub->daysLeft();
            $thresholds = collect($sub->reminder_days ?? [])->map(fn ($d) => (int) $d);
            $already    = collect($sub->reminders_sent ?? [])->map(fn ($d) => (int) $d);

            $due = $thresholds
                ->filter(fn ($t) => $daysLeft <= $t && !$already->contains($t))
                ->sort()
                ->values();

            if ($daysLeft < 0 && !$already->contains(0) && !$due->contains(0)) {
                $due->push(0);
            }

            if ($due->isEmpty()) {
                continue;
            }

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

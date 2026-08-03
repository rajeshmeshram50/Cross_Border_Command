<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Every morning at 9:40 AM: email employees whose probation period has just
// completed (e.g. it ended yesterday) on their work + personal address.
Schedule::command('hr:send-probation-emails')
    ->dailyAt('09:40')
    ->withoutOverlapping();

// Automatic database backup. The scheduler invokes this daily, but the command
// self-gates to a real 15-day interval (marker file), so a backup is generated
// and emailed only once every 15 days — no manual click required. Recipients
// come from BACKUP_EMAIL_RECIPIENTS in .env.
Schedule::command('backup:email')
    ->dailyAt('02:00')
    ->withoutOverlapping();

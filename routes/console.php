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

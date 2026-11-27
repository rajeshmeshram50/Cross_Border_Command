<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('hr:send-probation-emails')
    ->dailyAt('09:40')
    ->withoutOverlapping();

Schedule::command('backup:email')
    ->dailyAt('02:00')
    ->withoutOverlapping();

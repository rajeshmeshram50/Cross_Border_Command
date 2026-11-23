<?php

namespace App\Providers;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        if ($this->app->environment('local') && class_exists(\Laravel\Telescope\Telescope::class)) {
            $this->app->register(\Laravel\Telescope\TelescopeServiceProvider::class);
        }
    }

    public function boot(): void
    {
        $this->loadMigrationsFrom(database_path('migrations/credvault'));

        $byUser = fn (string $bucket) => fn (\Illuminate\Http\Request $r) => $bucket . ':' . ($r->user()?->id ?: $r->ip());
        \Illuminate\Support\Facades\RateLimiter::for('credvault', fn ($r) => \Illuminate\Cache\RateLimiting\Limit::perMinute(240)->by($byUser('cv')($r)));
        \Illuminate\Support\Facades\RateLimiter::for('credvault-otp', fn ($r) => \Illuminate\Cache\RateLimiting\Limit::perMinute(10)->by($byUser('cv-otp')($r)));
        \Illuminate\Support\Facades\RateLimiter::for('credvault-reveal', fn ($r) => \Illuminate\Cache\RateLimiting\Limit::perMinute(60)->by($byUser('cv-reveal')($r)));

        $fontDir = config('dompdf.options.font_dir');
        if ($fontDir && ! is_dir($fontDir)) {
            @mkdir($fontDir, 0777, true);
            @chmod($fontDir, 0777);
        }

        \Illuminate\Support\Facades\Mail::extend('zeptomail', function (array $config) {
            return new \App\Mail\Transport\ZeptoMailTransport(
                (string) ($config['token'] ?? ''),
                (string) ($config['endpoint'] ?? 'https://api.zeptomail.in/v1.1/email'),
                (int) ($config['timeout'] ?? 20),
            );
        });

        if (str_starts_with((string) config('app.url'), 'https://')) {
            URL::forceScheme('https');
        }

        Validator::extend('magic_mime', function ($attribute, $value, $parameters, $validator) {
            if (!$value instanceof UploadedFile)        return false;
            if (!$value->isValid())                     return false;
            if (!function_exists('finfo_open'))         return true;
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo === false)                       return true;
            $mime  = finfo_file($finfo, $value->getRealPath());
            finfo_close($finfo);
            $allowed = [];
            $map = [
                'jpg'  => ['image/jpeg'],
                'jpeg' => ['image/jpeg'],
                'png'  => ['image/png'],
                'webp' => ['image/webp'],
                'gif'  => ['image/gif'],
                'pdf'  => ['application/pdf'],
                'doc'  => ['application/msword', 'application/x-cfb', 'application/CDFV2'],
                'docx' => ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
                'xls'  => ['application/vnd.ms-excel', 'application/x-cfb', 'application/CDFV2'],
                'xlsx' => ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
            ];
            foreach ($parameters as $ext) {
                foreach (($map[strtolower($ext)] ?? []) as $m) $allowed[] = $m;
            }
            return in_array($mime, $allowed, true);
        }, 'The :attribute has an unexpected file signature — pick a real document.');
    }
}

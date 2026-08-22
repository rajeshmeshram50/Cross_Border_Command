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
        /* Telescope — local only, and only if actually installed.
         *
         * It is a `--dev` dependency, so `composer install --no-dev` on the
         * server leaves no vendor/laravel/telescope at all. Both guards
         * matter and neither is redundant:
         *
         *   environment('local')  → never exposes the dashboard (which shows
         *                           request payloads, including auth tokens)
         *                           on a deployed environment, even if a dev
         *                           dependency did get installed there.
         *   class_exists(...)     → keeps this line harmless when the package
         *                           is missing. It also stops PHP ever
         *                           autoloading App\Providers\
         *                           TelescopeServiceProvider, which extends a
         *                           vendor class and would fatal on its own —
         *                           that is what makes the provider file safe
         *                           to leave out of git entirely.
         *
         * Registered here rather than in bootstrap/providers.php because that
         * file is committed and deployed; a hard reference there takes the
         * whole app down on a server without the package.
         */
        if ($this->app->environment('local') && class_exists(\Laravel\Telescope\Telescope::class)) {
            $this->app->register(\Laravel\Telescope\TelescopeServiceProvider::class);
            $this->app->register(TelescopeServiceProvider::class);
        }
    }

    public function boot(): void
    {
        // Auto-force https on every generated URL the moment APP_URL is set
        // to an https:// origin (real cert or Cloudflare Flexible SSL).
        //
        // Why this matters for the face features:
        //   navigator.mediaDevices.getUserMedia() refuses to open the camera
        //   on plain http://. Even with SSL on the server, a stray http://
        //   asset / link on a page can downgrade the document context. This
        //   ensures every URL Laravel generates (assets, routes, redirects)
        //   is https when the deploy is https — no manual hunt for http://
        //   leftovers, no Cloudflare Flexible-SSL infinite-redirect loops.
        //
        // Behaviour:
        //   APP_URL=https://cbc.idims.in  → URL::forceScheme('https') fires
        //   APP_URL=http://localhost/...   → no-op (dev stays http)
        if (str_starts_with((string) config('app.url'), 'https://')) {
            URL::forceScheme('https');
        }

        /* B36: register a custom `magic_mime` validator that inspects
         *  the file's actual magic bytes (via finfo_*) rather than the
         *  client-supplied Content-Type. Laravel's built-in `mimes:`
         *  rule trusts the upload's Content-Type, which an attacker can
         *  forge — a .pdf-named binary still passes "mimes:pdf".
         *
         *  Usage:  'attachment' => 'file|magic_mime:jpg,jpeg,png,pdf,doc,docx|max:5120'
         *
         *  Accepts the SAME extension list `mimes:` does so callers can
         *  swap in-place. The map below covers the documents we expect
         *  in this app — extend as new extensions are needed. */
        Validator::extend('magic_mime', function ($attribute, $value, $parameters, $validator) {
            if (!$value instanceof UploadedFile)        return false;
            if (!$value->isValid())                     return false;
            if (!function_exists('finfo_open'))         return true; // graceful degrade
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo === false)                       return true; // graceful degrade
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

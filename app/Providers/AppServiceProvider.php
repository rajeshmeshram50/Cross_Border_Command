<?php

namespace App\Providers;

use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
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
    }
}

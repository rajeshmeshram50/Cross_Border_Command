<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    @php
        $cbcBranding = ['platform_name' => 'Kryptone AI', 'favicon_url' => '/images/igc-logo.png'];
        try {
            $general = \App\Models\PlatformSetting::getSection('general');
            $appearance = \App\Models\PlatformSetting::getSection('appearance');
            if (!empty($general['platform_name'])) {
                $cbcBranding['platform_name'] = $general['platform_name'];
            }
            if (!empty($appearance['favicon_path'])) {
                $cbcBranding['favicon_url'] = file_url($appearance['favicon_path']);
            }
        } catch (\Throwable $e) {
        }
    @endphp
    <title>{{ $cbcBranding['platform_name'] }}</title>
    <link rel="icon" href="{{ $cbcBranding['favicon_url'] }}">
    {{-- PWA — SCANNER PAGE ONLY. The manifest and service worker exist so the
         put-away scanner can be installed as an app. They must NOT load on the
         rest of the ERP: a registered service worker intercepts every request
         and shows it twice in DevTools (the page's call + the worker's fetch),
         and a service worker is sticky — once registered it keeps controlling
         the whole site until explicitly unregistered. So: manifest + register
         only under the scanner path, and actively UNREGISTER anywhere else to
         clean up browsers that picked it up while it was site-wide. --}}
    @php $isScannerPwa = request()->is('putaway-scan*') || request()->is('ps/*'); @endphp
    @if ($isScannerPwa)
        <link rel="manifest" href="/manifest.json">
        <meta name="theme-color" content="#0b1220">
        <meta name="mobile-web-app-capable" content="yes">
    @endif
    <script>
        (function () {
            if (!('serviceWorker' in navigator)) return;
            var onScanner = {{ $isScannerPwa ? 'true' : 'false' }};
            if (onScanner && location.protocol === 'https:') {
                window.addEventListener('load', function () {
                    navigator.serviceWorker.register('/sw.js').catch(function () { /* not fatal */ });
                });
            } else {
                // Everywhere else: remove any worker a previous site-wide
                // registration left behind, so the ERP stops going through it.
                navigator.serviceWorker.getRegistrations().then(function (rs) {
                    rs.forEach(function (r) { r.unregister(); });
                }).catch(function () {});
            }
        })();
    </script>
    <script>window.__CBC_BRANDING__ = @json($cbcBranding);</script>
    {{-- Host for printed labels and the device-enrollment QR. A handheld scans
         these off someone else's screen, so window.location.origin is wrong
         whenever that screen says localhost. Same value the PDFs use. --}}
    <script>window.__CBC_STICKER_URL__ = @json(rtrim((string) (config('inventory.sticker_url') ?: config('app.url')), '/'));</script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" media="print" onload="this.media='all'"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300..800&family=JetBrains+Mono:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700;800&display=swap">
    <noscript>
        <link rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300..800&family=JetBrains+Mono:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700;800&display=swap">
    </noscript>

    <script>
        try {
            var m = localStorage.getItem('cbc-layout-mode');
            if (m === 'dark') {
                document.documentElement.setAttribute('data-bs-theme', 'dark');
                document.documentElement.style.backgroundColor = '#0b1220';
            }
        } catch (e) { }
    </script>
    @viteReactRefresh
    @vite(['resources/css/app.css', 'resources/js/app.tsx'])
</head>

<body>
    <div id="app"></div>
</body>

</html>
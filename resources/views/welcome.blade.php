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
    <script>window.__CBC_BRANDING__ = @json($cbcBranding);</script>
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
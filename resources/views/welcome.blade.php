<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cross Border Command — IGC Group</title>
    <link rel="icon" type="image/png" href="/images/igc-logo.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    {{-- Load the Google Fonts stylesheet WITHOUT render-blocking: media="print"
         makes the browser fetch it at low priority off the critical path, then
         the onload handler flips it to "all" to apply it. `display=swap`
         already shows text in the system fallback until Inter/DM Sans arrive,
         so there's no invisible-text (FOIT) wait. <noscript> keeps it working
         when JS is disabled. (Was render-blocking at Highest priority.) --}}
    <link rel="stylesheet" media="print" onload="this.media='all'"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap">
    <noscript>
        <link rel="stylesheet"
              href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap">
    </noscript>
    {{-- Apply the saved theme to <html> + paint a matching background BEFORE
         any CSS/JS loads, so a dark-mode user never sees a white flash while
         the bundle + splash loader boot. Mirrors the seed in app.tsx. --}}
    <script>
        try {
            var m = localStorage.getItem('cbc-layout-mode');
            if (m === 'dark') {
                document.documentElement.setAttribute('data-bs-theme', 'dark');
                document.documentElement.style.backgroundColor = '#0b1220';
            }
        } catch (e) {}
    </script>
    @viteReactRefresh
    @vite(['resources/css/app.css', 'resources/js/app.tsx'])
    {{-- Razorpay checkout.js is NOT loaded here anymore. It's a render-blocking
         third-party script that only the Plan Selection page needs, yet it was
         downloading (and spinning up a checkout iframe) on every page. It's now
         lazy-loaded on demand from PlanSelection.tsx when the user actually
         starts a payment. --}}
</head>
<body>
    <div id="app"></div>
</body>
</html>

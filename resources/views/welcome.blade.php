<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cross Border Command — IGC Group</title>
    <link rel="icon" type="image/png" href="/images/igc-logo.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
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
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body>
    <div id="app"></div>
</body>
</html>

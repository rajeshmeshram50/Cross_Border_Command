<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Cross Border Command — IGC Group</title>
    <link rel="icon" type="image/png" href="/images/igc-logo.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    @viteReactRefresh
    @vite(['resources/css/app.css', 'resources/js/app.tsx'])
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body>
    <div id="app"></div>
</body>
</html>

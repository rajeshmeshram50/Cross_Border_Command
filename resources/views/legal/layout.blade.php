<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@yield('title') — Kryptone.AI</title>
<style>
  :root { --ink:#0f172a; --muted:#475569; --line:#e2e8f0; --brand:#4f46e5; }
  * { box-sizing:border-box; }
  body { margin:0; background:#f8fafc; color:var(--ink);
         font:16px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; }
  header { background:#0b1220; padding:22px 16px; }
  header .in { max-width:820px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; }
  header a.brand { color:#fff; font-weight:800; letter-spacing:.5px; text-decoration:none; font-size:18px; }
  header nav a { color:#94a3b8; text-decoration:none; font-size:14px; margin-left:18px; }
  header nav a:hover { color:#fff; }
  main { max-width:820px; margin:0 auto; padding:40px 16px 72px; }
  h1 { font-size:30px; line-height:1.25; margin:0 0 6px; }
  .updated { color:var(--muted); font-size:14px; margin:0 0 32px; }
  h2 { font-size:19px; margin:34px 0 10px; padding-top:18px; border-top:1px solid var(--line); }
  h3 { font-size:16px; margin:22px 0 6px; }
  p, li { color:#1e293b; }
  ul { padding-left:22px; }
  li { margin:6px 0; }
  a { color:var(--brand); }
  table { width:100%; border-collapse:collapse; margin:14px 0; font-size:14.5px; }
  th, td { text-align:left; border:1px solid var(--line); padding:9px 11px; vertical-align:top; }
  th { background:#f1f5f9; font-weight:600; }
  footer { border-top:1px solid var(--line); margin-top:48px; padding-top:20px; color:var(--muted); font-size:14px; }
  @media (max-width:560px){ h1{font-size:25px;} table,thead,tbody,th,td,tr{display:block;} th{display:none;} td{border:0;border-bottom:1px solid var(--line);} }
</style>
</head>
<body>
<header>
  <div class="in">
    <a class="brand" href="/">KRYPTONE.AI</a>
    <nav>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/login">Sign in</a>
    </nav>
  </div>
</header>
<main>
  <h1>@yield('title')</h1>
  <p class="updated">Last updated: {{ $updated }}</p>
  @yield('body')
  <footer>
    <p>Kryptone.AI is operated by Inorbvict Group of Companies.<br>
    Questions about this page: <a href="mailto:{{ $contact }}">{{ $contact }}</a></p>
  </footer>
</main>
</body>
</html>

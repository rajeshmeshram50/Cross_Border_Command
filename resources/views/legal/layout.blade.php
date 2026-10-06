<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@yield('title') — Kryptone.AI</title>
<meta name="description" content="@yield('title') for Kryptone.AI, the unified enterprise operations platform by Inorbvict Group of Companies.">
<link rel="icon" type="image/png" href="/images/kryptone/logo.png">
<style>
  :root{
    --ink:#0f172a; --body:#1e293b; --muted:#64748b; --line:#e5e7eb;
    --brand:#5A51E8; --brand2:#8b5cf6; --cyan:#22d3ee; --dark:#0b0f1e;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%; scroll-behavior:smooth; scroll-padding-top:90px}
  body{margin:0; background:#f6f7fb; color:var(--ink);
       font:16px/1.75 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}

  /* Sticky site bar */
  .nav{position:sticky; top:0; z-index:20; background:rgba(11,15,30,.92);
       backdrop-filter:saturate(180%) blur(10px); border-bottom:1px solid rgba(255,255,255,.08)}
  .nav .in{max-width:1120px; margin:0 auto; padding:13px 20px;
           display:flex; align-items:center; justify-content:space-between; gap:16px}
  .nav img{height:26px; width:auto; display:block}
  .nav a.lnk{color:#a5b4fc; text-decoration:none; font-size:14px; font-weight:500; margin-left:22px}
  .nav a.lnk:hover{color:#fff}
  .nav a.cta{display:inline-block; margin-left:22px; padding:8px 18px; border-radius:999px;
             background:linear-gradient(135deg,var(--brand),var(--brand2)); color:#fff;
             font-size:14px; font-weight:600; text-decoration:none}

  /* Hero */
  .hero{background:linear-gradient(135deg,#0b0f1e 0%,#1e1b4b 35%,#350d72 70%,#251541 100%);
        position:relative; overflow:hidden}
  .hero::after{content:""; position:absolute; inset:0;
        background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),
                         linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);
        background-size:44px 44px}
  .hero .in{position:relative; z-index:1; max-width:1120px; margin:0 auto; padding:52px 20px 58px}
  .eyebrow{display:inline-block; font-size:12px; font-weight:700; letter-spacing:1.4px;
           text-transform:uppercase; color:var(--cyan); margin:0 0 12px}
  .hero h1{color:#fff; font-size:38px; line-height:1.15; letter-spacing:-.6px; margin:0 0 10px; font-weight:800}
  .hero p{color:#94a3b8; font-size:14.5px; margin:0}
  .rule{height:3px; background:linear-gradient(90deg,var(--cyan),var(--brand) 45%,var(--brand2))}

  /* Layout */
  .wrap{max-width:1120px; margin:-22px auto 0; padding:0 20px 72px;
        display:grid; grid-template-columns:232px 1fr; gap:30px; align-items:start}
  .toc{position:sticky; top:86px; background:#fff; border:1px solid var(--line);
       border-radius:14px; padding:18px 18px 20px; box-shadow:0 6px 20px rgba(15,23,42,.05)}
  .toc h4{margin:0 0 12px; font-size:11.5px; letter-spacing:1.1px; text-transform:uppercase; color:var(--muted)}
  .toc ol{list-style:none; margin:0; padding:0}
  .toc li{margin:0}
  .toc a{display:block; padding:6px 0 6px 10px; font-size:13.5px; line-height:1.45;
         color:#475569; text-decoration:none; border-left:2px solid transparent}
  .toc a:hover{color:var(--brand)}
  .toc a.on{color:var(--brand); font-weight:600; border-left-color:var(--brand)}

  /* The document itself is set in a serif — it reads as a legal instrument,
     while the nav, index and footer stay in the UI sans. */
  .card{background:#fff; border:1px solid var(--line); border-radius:16px;
        box-shadow:0 8px 28px rgba(15,23,42,.06); padding:40px 48px 46px;
        font-family:"Times New Roman",Times,Georgia,serif;
        font-size:17.5px; line-height:1.72}
  .card > p:first-child{font-size:18.5px; color:#334155}
  h2{font-size:22px; font-weight:700; margin:38px 0 10px; padding-top:24px;
     border-top:1px solid var(--line); letter-spacing:.1px}
  h2:first-of-type{border-top:0; padding-top:6px; margin-top:26px}
  h3{font-size:18.5px; margin:22px 0 6px}
  p,li{color:var(--body)}
  p{margin:0 0 14px}
  ul{padding-left:26px} li{margin:7px 0}
  a{color:var(--brand)}
  strong{color:var(--ink)}
  table{width:100%; border-collapse:collapse; margin:18px 0; font-size:16px}
  th,td{text-align:left; border:1px solid var(--line); padding:10px 13px; vertical-align:top}
  th{background:#f8fafc; font-weight:700; color:#334155}

  .sig{margin-top:38px; padding-top:22px; border-top:1px solid var(--line); color:var(--muted); font-size:14px}

  /* Site footer */
  .foot{background:var(--dark); color:#94a3b8}
  .foot .in{max-width:1120px; margin:0 auto; padding:40px 20px 30px;
            display:flex; gap:28px; justify-content:space-between; flex-wrap:wrap}
  .foot img{height:26px; margin-bottom:12px}
  .foot p{margin:0; font-size:13.5px; line-height:1.7; max-width:360px; color:#94a3b8}
  .foot h5{color:#fff; font-size:13px; margin:0 0 10px; letter-spacing:.3px}
  .foot a{display:block; color:#94a3b8; text-decoration:none; font-size:13.5px; padding:4px 0}
  .foot a:hover{color:#fff}
  .foot .bottom{border-top:1px solid rgba(255,255,255,.08); margin-top:6px}
  .foot .bottom .in{padding:16px 20px 26px; font-size:13px; color:#64748b}

  @media (max-width:900px){
    .wrap{grid-template-columns:1fr}
    .toc{position:static; order:-1}
    .toc ol{columns:2; column-gap:18px}
  }
  @media (max-width:620px){
    .hero .in{padding:38px 20px 44px}
    .hero h1{font-size:28px}
    .card{padding:24px 20px 30px; border-radius:12px; font-size:16.5px; line-height:1.68}
    .toc ol{columns:1}
    .nav a.lnk{margin-left:14px; font-size:13px}
    .nav a.cta{display:none}
    table,thead,tbody,th,td,tr{display:block}
    th{display:none}
    td{border:0; border-bottom:1px solid var(--line); padding:8px 0}
    td:first-child{font-weight:700; color:var(--ink); padding-top:14px}
  }
</style>
</head>
<body>

<div class="nav"><div class="in">
  <a href="/"><img src="/images/kryptone/logo.png" alt="Kryptone.AI"></a>
  <div>
    <a class="lnk" href="/privacy">Privacy</a>
    <a class="lnk" href="/terms">Terms</a>
    <a class="cta" href="/login">Sign in</a>
  </div>
</div></div>

<div class="hero"><div class="in">
  <span class="eyebrow">Legal</span>
  <h1>@yield('title')</h1>
  <p>Last updated: {{ $updated }}</p>
</div></div>
<div class="rule"></div>

<div class="wrap">
  <aside class="toc" id="toc" hidden>
    <h4>On this page</h4>
    <ol id="toclist"></ol>
  </aside>
  <main class="card" id="doc">
    @yield('body')
    <div class="sig">
      <p>Kryptone.AI is operated by Inorbvict Group of Companies.<br>
      Questions about this page: <a href="mailto:{{ $contact }}">{{ $contact }}</a></p>
    </div>
  </main>
</div>

<div class="foot">
  <div class="in">
    <div>
      <img src="/images/kryptone/logo.png" alt="Kryptone.AI">
      <p>Unified enterprise operations — HRMS, sales, contracts, procurement and
         trade finance on one platform.</p>
    </div>
    <div>
      <h5>Legal</h5>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
    </div>
    <div>
      <h5>Platform</h5>
      <a href="/login">Sign in</a>
      <a href="mailto:{{ $contact }}">Contact</a>
    </div>
  </div>
  <div class="bottom"><div class="in">
    &copy; {{ date('Y') }} Inorbvict Group of Companies. All rights reserved.
  </div></div>
</div>

<script>
// Section index is built from the headings so the policy text stays plain prose.
(function () {
  var doc = document.getElementById('doc');
  var list = document.getElementById('toclist');
  var heads = doc.querySelectorAll('h2');
  if (!heads.length) return;

  var links = [];
  heads.forEach(function (h, i) {
    var id = 'sec-' + (i + 1);
    h.id = id;
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = '#' + id;
    a.textContent = h.textContent.replace(/^\d+\.\s*/, '');
    li.appendChild(a);
    list.appendChild(li);
    links.push(a);
  });
  document.getElementById('toc').hidden = false;

  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var i = Array.prototype.indexOf.call(heads, e.target);
      links.forEach(function (a, n) { a.classList.toggle('on', n === i); });
    });
  }, { rootMargin: '-90px 0px -70% 0px' });
  heads.forEach(function (h) { io.observe(h); });
})();
</script>
</body>
</html>

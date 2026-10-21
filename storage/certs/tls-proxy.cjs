/**
 * HTTPS front door for the local dev server, on the SAME port as before.
 *
 * `php artisan serve` speaks plain HTTP only, and Chrome refuses to INSTALL a
 * PWA from a non-secure origin — localhost is exempt, a LAN IP is not. This
 * terminates TLS with the mkcert certificate and forwards everything to the
 * PHP server behind it.
 *
 * IT ALSO ANSWERS PLAIN HTTP ON THE SAME PORT, with a redirect.
 *
 * Chrome assumes http:// when you type a bare `192.168.1.84:8000`, and every
 * bookmark and printed label made before this change says http. Those all hit
 * a TLS socket, which reads the request as a broken handshake and closes —
 * ERR_EMPTY_RESPONSE, with nothing to suggest the fix. So the first byte is
 * peeked instead: 0x16 is the TLS handshake record type, anything else is
 * someone speaking HTTP who should be sent to the https URL.
 *
 * No dependencies: node's own net/tls/http are enough, and adding a package
 * for a proxy this small would be the larger change.
 *
 *   node tls-proxy.cjs    →  :8000 (tls + redirect)  →  127.0.0.1:8001
 */
const net = require('net');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const LISTEN = Number(process.env.TLS_PORT || 8000);
const TARGET = Number(process.env.TARGET_PORT || 8001);

/* REQUIRE_DEVICE_CERT=0 lets a cert-less handheld onto the scanner pages while
   styling them. Local only, and never the default — prod is Apache anyway. */
const ENFORCE = process.env.REQUIRE_DEVICE_CERT !== '0';

/* Scanner surface that MUST present a device certificate: the scan API and the
   handheld pages. Everything else (the whole ERP) is left alone. Deliberately
   NOT /api/scan-devices — that is admin enrolment, done logged-in on a PC. */
const needsDeviceCert = (url) => {
  const p = (url || '').split('?')[0];
  return p.startsWith('/api/scan/putaway')
      || p.startsWith('/api/scan/device-check')
      || p === '/ps' || p.startsWith('/ps/')
      || p.startsWith('/putaway-scan');
};

/* TLS front door, now with MUTUAL TLS on the scanner paths. `requestCert` asks
   every client for a cert and `ca` checks it against the CBC Device CA, but
   `rejectUnauthorized:false` still lets cert-less clients (the laptop) in — we
   only REFUSE when a scanner path is hit without a valid device cert. So the
   scanner URL is useless on a phone that has not installed the cert. */
const secure = https.createServer(
  {
    cert: fs.readFileSync(path.join(HERE, 'cbc.pem')),
    key: fs.readFileSync(path.join(HERE, 'cbc-key.pem')),
    ca: [fs.readFileSync(path.join(HERE, 'device-ca.pem'))],
    requestCert: true,
    rejectUnauthorized: false,
  },
  (req, res) => {
    const peer = req.socket.getPeerCertificate();
    const hasDeviceCert = req.socket.authorized && peer && peer.subject && peer.subject.CN;

    if (ENFORCE && needsDeviceCert(req.url) && !hasDeviceCert) {
      res.writeHead(403, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end('This device is not authorised to scan — install the device certificate.\n');
      return;
    }

    // Trusted header for Laravel: the enrolled device's cert CN, stripped from
    // the incoming request first so a client can never forge it.
    const headers = { ...req.headers };
    delete headers['x-scan-cert-cn'];
    if (hasDeviceCert) headers['x-scan-cert-cn'] = peer.subject.CN;

    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: TARGET,
        method: req.method,
        path: req.url,
        headers: {
          ...headers,
          // Laravel builds absolute URLs from these. Without them it reads the
          // scheme off the connection it can see — plain HTTP from this proxy —
          // and signs URLs against an address that will never validate.
          'x-forwarded-proto': 'https',
          'x-forwarded-port': String(LISTEN),
        },
      },
      (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
      },
    );

    upstream.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`upstream ${TARGET} unreachable: ${e.message}\n`);
    });

    req.pipe(upstream);
  },
);

/**
 * Someone speaking HTTP to the TLS port — point them at the right scheme.
 *
 * 307, NOT 301 and NOT 308.
 *
 * Not 301: a browser given one on a POST re-sends it as a GET with no body.
 * The login request then arrives as `GET /api/login`, matches no API route,
 * falls through to the SPA catch-all and comes back as 200 with an HTML page
 * — a success status, no token, and a failure that looks like the app's.
 *
 * Not 308 either, though it preserves the method: 308 is PERMANENT, and a
 * browser may remember it long after this proxy has stopped. Turn the proxy
 * off, go back to plain `artisan serve`, and the browser keeps upgrading to
 * HTTPS on its own — every request arrives as TLS bytes the PHP server cannot
 * read. A dev box that flips between the two must not hand out a permanent
 * anything.
 *
 * 307 keeps the method and body, and expires.
 */
const plain = http.createServer((req, res) => {
  const host = req.headers.host || `192.168.1.84:${LISTEN}`;

  res.writeHead(307, { Location: `https://${host}${req.url}`, 'cache-control': 'no-store' });
  res.end();
});

net
  .createServer((socket) => {
    /* 'readable' + read(1), never 'data'.
       A 'data' listener switches the stream to flowing mode, and the bytes
       are gone before the server that is meant to parse them is attached —
       so both protocols hang. Reading one byte by hand leaves the socket
       paused, which is the state http/https expect a fresh connection in. */
    socket.once('readable', () => {
      const first = socket.read(1);
      if (!first) { socket.destroy(); return; }

      socket.unshift(first);
      // 0x16 is the TLS handshake record type; anything else is plain HTTP.
      (first[0] === 0x16 ? secure : plain).emit('connection', socket);
    });

    socket.on('error', () => socket.destroy());
  })
  .listen(LISTEN, '0.0.0.0', () => {
    console.log(`:${LISTEN}  tls + http-redirect  ->  127.0.0.1:${TARGET}`);
  });

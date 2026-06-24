<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Zoho Sign API client.
 *
 * Wraps the OAuth refresh-token dance, the multipart "create request" call,
 * the "submit with signer fields" call, and the signed-PDF / certificate
 * downloads. Lifted out of New_IDIMS_6.0's monolithic DocumentController
 * into a service so [[ClmSignatureController]] (and any future
 * Consignee/Vendor controllers) stays focused on persistence + presentation.
 *
 * All public methods either return the decoded JSON body, raw PDF bytes,
 * or throw RuntimeException with the upstream error embedded — callers
 * surface that as 500s with the Zoho message intact so the user can act on
 * it (Zoho's errors are usually actionable: bad email, scope missing,
 * etc.).
 */
class ZohoSignService
{
    private const TOKEN_CACHE_KEY = 'zoho_sign_access_token';

    // Default signature-field placement. The send modal can override these
    // per-document via document_settings[{docId}] but a sensible default
    // matches what [[New_IDIMS_6.0]] ships with (bottom-right area, first
    // page). Coordinates are in PDF points (1pt = 1/72 in); A4 is 595×842.
    public const DEFAULT_FIELD_X      = 380;
    public const DEFAULT_FIELD_Y      = 720;
    public const DEFAULT_FIELD_PAGE   = 0;
    public const DEFAULT_FIELD_WIDTH  = 150;
    public const DEFAULT_FIELD_HEIGHT = 45;

    /**
     * Optional sub-pt fine-tuning applied to every signature field BEFORE
     * it ships to Zoho. The SPA drag overlay and Zoho both use a top-left
     * page origin and a top-left field anchor in A4 points, so the base
     * mapping is a direct 1:1 passthrough (x_coord = x, y_coord = y) and
     * these default to 0. Set a small value here ONLY if a specific tenant
     * PDF template lands consistently off by a couple of pt.
     *   - SIG_X_NUDGE_PT  shifts the field horizontally (negative = left)
     *   - SIG_Y_NUDGE_PT  shifts the field vertically   (positive = down)
     *
     * History: these were once -4 / +4 alongside a "+ height" Y term that
     * assumed Zoho anchored the field's BOTTOM edge. QA confirmed that
     * pushed every signature one box-height too low and ~4pt left, so the
     * height term was removed and the nudges zeroed.
     */
    public const SIG_X_NUDGE_PT = 0;
    public const SIG_Y_NUDGE_PT = 0;

    private string $clientId;
    private string $clientSecret;
    private string $refreshToken;
    private string $baseUrl;
    private string $accountsUrl;
    private string $apiVersion;
    private bool   $testingMode;

    public function __construct()
    {
        $cfg = config('services.zoho');
        $this->clientId     = (string) ($cfg['client_id']     ?? '');
        $this->clientSecret = (string) ($cfg['client_secret'] ?? '');
        $this->refreshToken = (string) ($cfg['refresh_token'] ?? '');
        $this->baseUrl      = rtrim((string) ($cfg['base_url']     ?? 'https://sign.zoho.in'), '/');
        $this->accountsUrl  = rtrim((string) ($cfg['accounts_url'] ?? 'https://accounts.zoho.in'), '/');
        $this->apiVersion   = (string) ($cfg['api_version']   ?? 'v1');
        $this->testingMode  = (bool)   ($cfg['testing_mode']  ?? false);
    }

    /** Exposed so the controller can warn the user when sandbox mode is on. */
    public function isTestingMode(): bool { return $this->testingMode; }

    /** True once the env keys are filled — used by the controller to 503 cleanly. */
    public function isConfigured(): bool
    {
        return $this->clientId !== '' && $this->clientSecret !== '' && $this->refreshToken !== '';
    }

    /* ─────────────────────── Auth ─────────────────────── */

    private function getAccessToken(): string
    {
        if (!$this->isConfigured()) {
            throw new RuntimeException('Zoho Sign is not configured. Set ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN.');
        }

        $cached = Cache::get(self::TOKEN_CACHE_KEY);
        if (is_string($cached) && $cached !== '') return $cached;

        return $this->refreshAccessToken();
    }

    private function refreshAccessToken(): string
    {
        $resp = Http::asForm()->post("{$this->accountsUrl}/oauth/v2/token", [
            'refresh_token' => $this->refreshToken,
            'client_id'     => $this->clientId,
            'client_secret' => $this->clientSecret,
            'grant_type'    => 'refresh_token',
        ]);

        if (!$resp->successful()) {
            Log::error('Zoho token refresh failed', ['status' => $resp->status(), 'body' => $resp->body()]);
            throw new RuntimeException('Zoho token refresh failed: ' . $resp->body());
        }

        $data = $resp->json();
        $token = $data['access_token'] ?? null;
        if (!is_string($token) || $token === '') {
            throw new RuntimeException('Zoho refresh response missing access_token: ' . $resp->body());
        }

        // 10-min safety buffer before Zoho's stated expiry so an inflight
        // request never gets a 401 mid-flow.
        $ttl = max(60, ((int) ($data['expires_in'] ?? 3600)) - 600);
        Cache::put(self::TOKEN_CACHE_KEY, $token, now()->addSeconds($ttl));

        return $token;
    }

    /* ─────────────────────── Low-level HTTP ─────────────────────── */

    /**
     * JSON / form / GET requests against /api/{version}/{endpoint}.
     * Pass $data['data'] = [...] to body-POST the way Zoho expects ("data=
     * <json>" form-urlencoded — not a real JSON body).
     */
    public function makeRequest(string $method, string $endpoint, array $data = []): array
    {
        $token = $this->getAccessToken();
        $url   = "{$this->baseUrl}/api/{$this->apiVersion}/" . ltrim($endpoint, '/');

        $headers = ['Authorization' => 'Zoho-oauthtoken ' . $token];

        switch (strtoupper($method)) {
            case 'GET':
                $resp = Http::withHeaders($headers)->get($url, $data);
                break;

            case 'POST':
                if (array_key_exists('data', $data)) {
                    // Zoho's "submit" / "recall" / "remind" endpoints want the
                    // payload wrapped as `data=<json>` in a form body, NOT a
                    // raw JSON POST. New_IDIMS hit the same quirk.
                    $payload = is_string($data['data']) ? $data['data'] : json_encode($data['data']);
                    $resp = Http::withHeaders($headers)->asForm()->post($url, ['data' => $payload]);
                } elseif (empty($data)) {
                    $resp = Http::withHeaders($headers + ['Content-Type' => 'application/json'])
                        ->withBody('{}', 'application/json')->post($url);
                } else {
                    $resp = Http::withHeaders($headers)->post($url, $data);
                }
                break;

            case 'PUT':
                $resp = Http::withHeaders($headers)->put($url, $data);
                break;

            case 'DELETE':
                $resp = Http::withHeaders($headers)->delete($url, $data);
                break;

            default:
                throw new RuntimeException("Unsupported HTTP method: {$method}");
        }

        if (!$resp->successful()) {
            Log::error('Zoho API error', [
                'method'   => $method,
                'endpoint' => $endpoint,
                'status'   => $resp->status(),
                'body'     => $resp->body(),
            ]);
            throw new RuntimeException('Zoho Sign API error: ' . $resp->body());
        }

        return $resp->json() ?? [];
    }

    /**
     * Multipart POST to /requests — Zoho expects `data` (JSON) + N x `file`
     * (PDF) parts. Returns the decoded response body containing the new
     * request_id under `requests.request_id`.
     *
     * @param  array<int, string>  $pdfPaths
     * @param  array<int, string>  $filenames  Parallel array, same order as $pdfPaths.
     * @param  array               $requestData  The Zoho-shaped `requests` payload (with `actions[]`).
     */
    public function createRequestMultipart(array $pdfPaths, array $filenames, array $requestData): array
    {
        $token = $this->getAccessToken();
        $url   = "{$this->baseUrl}/api/{$this->apiVersion}/requests";
        // Sandbox flag — only attached to the request-creation endpoint
        // (Zoho ignores it elsewhere). Lets free-tier orgs side-step
        // error 12000 for end-to-end smoke testing.
        if ($this->testingMode) {
            $url .= '?testing=true';
        }

        $parts = [[
            'name'     => 'data',
            'contents' => json_encode($requestData),
            'headers'  => ['Content-Type' => 'application/json'],
        ]];

        foreach ($pdfPaths as $i => $absPath) {
            if (!is_string($absPath) || !file_exists($absPath)) continue;
            $parts[] = [
                'name'     => 'file',
                'contents' => fopen($absPath, 'r'),
                'filename' => ($filenames[$i] ?? ('document_' . ($i + 1))) . '.pdf',
                'headers'  => ['Content-Type' => 'application/pdf'],
            ];
        }

        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])
            ->asMultipart()->post($url, $parts);

        if (!$resp->successful()) {
            Log::error('Zoho create-request failed', ['status' => $resp->status(), 'body' => $resp->body()]);
            throw new RuntimeException('Zoho create-request failed: ' . $resp->body());
        }

        return $resp->json() ?? [];
    }

    /**
     * Build the signer×field payload and POST /requests/{id}/submit.
     * $perDocCoords is keyed by the *Zoho* document_id you got back from
     * createRequestMultipart() — pass [] to use defaults everywhere.
     *
     * @param  array<int, array{action_id?:string, recipient_email?:string, recipient_name?:string, action_type?:string}>  $actions
     * @param  array<int, array{document_id?:string}>                                                                       $documentIds
     * @param  array<string, array{x?:float, y?:float, page?:int, width?:float, height?:float}>                             $perDocCoords
     */
    public function submitWithFields(string $requestId, array $actions, array $documentIds, array $perDocCoords = []): array
    {
        $submitActions = [];

        foreach ($actions as $aIdx => $action) {
            $submitAction = [
                'action_id'       => $action['action_id']       ?? null,
                'recipient_name'  => $action['recipient_name']  ?? '',
                'recipient_email' => $action['recipient_email'] ?? '',
                'action_type'     => $action['action_type']     ?? 'SIGN',
            ];

            if (($action['action_type'] ?? 'SIGN') === 'SIGN') {
                $fields = [];
                foreach ($documentIds as $dIdx => $doc) {
                    $docId = $doc['document_id'] ?? null;
                    if (!$docId) continue;

                    /* Per-role lookup (agreement multi-signer case).
                     * When the SPA drags Buyer and Consignee boxes
                     * independently it sends:
                     *   document_settings[agreementId] = {
                     *     buyer:     {x, y, page, width, height},
                     *     consignee: {x, y, page, width, height},
                     *   }
                     * which mapClientCoordsToZohoDocIds rebins as
                     *   $perDocCoords[$zohoDocId] = {buyer:..., consignee:...}
                     * The controller stamps `cbc_role` onto each Zoho
                     * action before calling us, so we pick the role-
                     * specific coord here. Falls back to the flat
                     * shape so trade-doc single-signer sends keep
                     * working unchanged. */
                    $docCoords = $perDocCoords[$docId] ?? [];
                    $role      = (string) ($action['cbc_role'] ?? '');
                    $roleSlice = ($role !== '' && isset($docCoords[$role]) && is_array($docCoords[$role]))
                        ? $docCoords[$role]
                        : null;
                    $c = $roleSlice ?? (isset($docCoords['x']) ? $docCoords : []);
                    // Zoho rejects field coords with too many decimal places
                    // (error 9011 "You have entered too many characters") —
                    // the front-end PDF.js detector returns sub-pt-precision
                    // floats like 380.74832749827493, so round to whole pts
                    // before serialising. Sub-point precision is invisible
                    // to a signer anyway.
                    //
                    // Coordinate convention — Zoho Sign and the SPA drag
                    // overlay BOTH use a top-left page origin and anchor the
                    // field by its TOP-LEFT corner, in PDF points on the same
                    // A4 page. So the mapping is a direct 1:1 passthrough:
                    // x_coord = x, y_coord = y.
                    //
                    // (An earlier version added the field height to y on the
                    // assumption Zoho anchored the field's BOTTOM edge. QA
                    // confirmed that pushed every signature one box-height too
                    // LOW — and the old -4 X nudge put it ~4pt too far LEFT —
                    // so the height term is gone and the nudges default to 0.
                    // The SIG_*_NUDGE_PT knobs survive for per-tenant tweaks.)
                    // One signer can be asked to sign the SAME document in
                    // multiple places: when the coords carry a `boxes` array, drop
                    // one signature field per box. Otherwise fall back to the
                    // single flat box — the existing behaviour for every other
                    // flow, so customer / agreement / Buyer+Consignee sends are
                    // completely unchanged.
                    $boxes = (isset($c['boxes']) && is_array($c['boxes']) && $c['boxes'])
                        ? array_values(array_filter($c['boxes'], 'is_array'))
                        : [$c];
                    if (empty($boxes)) $boxes = [$c];
                    $multi = count($boxes) > 1;
                    foreach ($boxes as $bIdx => $b) {
                        $xPt = (float) ($b['x']      ?? self::DEFAULT_FIELD_X);
                        $yPt = (float) ($b['y']      ?? self::DEFAULT_FIELD_Y);
                        $wPt = (float) ($b['width']  ?? self::DEFAULT_FIELD_WIDTH);
                        $hPt = (float) ($b['height'] ?? self::DEFAULT_FIELD_HEIGHT);
                        $xPtAdj = $xPt + self::SIG_X_NUDGE_PT;
                        $yPtAdj = $yPt + self::SIG_Y_NUDGE_PT;
                        $fields[] = [
                            'document_id'     => $docId,
                            // Suffix only when there's more than one box so the
                            // single-box field name stays exactly as before.
                            'field_name'      => 'Signature_' . ($aIdx + 1) . '_' . ($dIdx + 1) . ($multi ? '_' . ($bIdx + 1) : ''),
                            'field_label'     => 'Signature',
                            'field_type_name' => 'Signature',
                            'field_category'  => 'image',
                            'x_coord'         => (int) round(max(0.0, $xPtAdj)),
                            'y_coord'         => (int) round(max(0.0, $yPtAdj)),
                            'abs_width'       => (int) round($wPt),
                            'abs_height'      => (int) round($hPt),
                            'page_no'         => (int) ($b['page'] ?? self::DEFAULT_FIELD_PAGE),
                            'is_mandatory'    => true,
                        ];
                    }
                }
                $submitAction['fields'] = $fields;
            }

            $submitActions[] = $submitAction;
        }

        // Carry the sandbox flag onto the SUBMIT (the actual send) too, not just
        // create — otherwise a free-tier org's submit trips error 12000
        // ("Upgrade Zoho Sign license to send documents via API") even though the
        // request was created in testing mode.
        $submitEndpoint = "requests/{$requestId}/submit" . ($this->testingMode ? '?testing=true' : '');
        return $this->makeRequest('POST', $submitEndpoint, [
            'data' => ['requests' => ['actions' => $submitActions]],
        ]);
    }

    /* ─────────────────────── Convenience wrappers ─────────────────────── */

    public function getRequest(string $requestId): array
    {
        return $this->makeRequest('GET', "requests/{$requestId}");
    }

    public function remind(string $requestId): array
    {
        return $this->makeRequest('POST', "requests/{$requestId}/remind");
    }

    public function recall(string $requestId, string $reason): array
    {
        return $this->makeRequest('POST', "requests/{$requestId}/recall", [
            'data' => ['recall_message' => $reason],
        ]);
    }

    /* ─────────────────────── PDF / certificate downloads ─────────────────────── */

    /**
     * Some Zoho endpoints return the PDF as raw bytes, others wrap it in
     * `{"document":"<base64>"}`. Detect and decode either shape.
     */
    private function unwrapPdfPayload(string $body): string
    {
        $maybeJson = json_decode($body, true);
        if (json_last_error() === JSON_ERROR_NONE && is_array($maybeJson) && isset($maybeJson['document'])) {
            return (string) base64_decode((string) $maybeJson['document'], true);
        }
        return $body;
    }

    public function downloadDocumentPdf(string $requestId, string $zohoDocumentId): string
    {
        $token = $this->getAccessToken();
        $url   = "{$this->baseUrl}/api/{$this->apiVersion}/requests/{$requestId}/documents/{$zohoDocumentId}/pdf";

        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])->get($url);
        if (!$resp->successful()) {
            throw new RuntimeException("Zoho download failed for document {$zohoDocumentId}: " . $resp->body());
        }
        return $this->unwrapPdfPayload($resp->body());
    }

    /**
     * Request-level signed PDF — the whole completed request as one PDF
     * (all its documents combined). This is the fallback for environments
     * where the per-document endpoint above fails (e.g. a refresh token
     * scoped without per-document read access). For single-document
     * requests this returns exactly the same signed PDF.
     */
    public function downloadRequestPdf(string $requestId): string
    {
        $token = $this->getAccessToken();
        $url   = "{$this->baseUrl}/api/{$this->apiVersion}/requests/{$requestId}/pdf";

        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])->get($url);
        if (!$resp->successful()) {
            throw new RuntimeException("Zoho request-level download failed for {$requestId}: " . $resp->body());
        }
        return $this->unwrapPdfPayload($resp->body());
    }

    public function downloadCertificate(string $requestId): string
    {
        $token = $this->getAccessToken();
        $url   = "{$this->baseUrl}/api/{$this->apiVersion}/requests/{$requestId}/completioncertificate";

        $resp = Http::withHeaders(['Authorization' => 'Zoho-oauthtoken ' . $token])->get($url);
        if (!$resp->successful()) {
            throw new RuntimeException('Zoho certificate download failed: ' . $resp->body());
        }
        return $this->unwrapPdfPayload($resp->body());
    }
}

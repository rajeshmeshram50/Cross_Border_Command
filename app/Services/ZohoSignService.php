<?php

namespace App\Services;

use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;

class ZohoSignService
{
    private const TOKEN_CACHE_KEY = 'zoho_sign_access_token';

    public const DEFAULT_FIELD_X      = 380;
    public const DEFAULT_FIELD_Y      = 720;
    public const DEFAULT_FIELD_PAGE   = 0;
    public const DEFAULT_FIELD_WIDTH  = 150;
    public const DEFAULT_FIELD_HEIGHT = 45;

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

    public function isTestingMode(): bool { return $this->testingMode; }

    public function isConfigured(): bool
    {
        return $this->clientId !== '' && $this->clientSecret !== '' && $this->refreshToken !== '';
    }

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

        $ttl = max(60, ((int) ($data['expires_in'] ?? 3600)) - 600);
        Cache::put(self::TOKEN_CACHE_KEY, $token, now()->addSeconds($ttl));

        return $token;
    }

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

    public function createRequestMultipart(array $pdfPaths, array $filenames, array $requestData): array
    {
        $token = $this->getAccessToken();
        $url   = "{$this->baseUrl}/api/{$this->apiVersion}/requests";
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

                    $docCoords = $perDocCoords[$docId] ?? [];
                    $role      = (string) ($action['cbc_role'] ?? '');
                    $roleSlice = ($role !== '' && isset($docCoords[$role]) && is_array($docCoords[$role]))
                        ? $docCoords[$role]
                        : null;
                    $c = $roleSlice ?? (isset($docCoords['x']) ? $docCoords : []);
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

        $submitEndpoint = "requests/{$requestId}/submit" . ($this->testingMode ? '?testing=true' : '');
        return $this->makeRequest('POST', $submitEndpoint, [
            'data' => ['requests' => ['actions' => $submitActions]],
        ]);
    }

    public function getRequest(string $requestId): array
    {
        return $this->makeRequest('GET', "requests/{$requestId}");
    }

    public function getRequestsBatch(array $requestIds): array
    {
        $ids = array_values(array_unique(array_filter(array_map('strval', $requestIds), 'strlen')));
        if (!$ids) return [];

        $token   = $this->getAccessToken();
        $headers = ['Authorization' => 'Zoho-oauthtoken ' . $token];
        $base    = "{$this->baseUrl}/api/{$this->apiVersion}/requests/";

        $responses = Http::pool(fn (Pool $pool) => array_map(
            fn (string $id) => $pool->as($id)->withHeaders($headers)->get($base . $id),
            $ids,
        ));

        $out = [];
        $unauthorised = false;
        foreach ($ids as $id) {
            $resp = $responses[$id] ?? null;
            if (!$resp instanceof Response) {
                Log::warning('Zoho batch call failed for request ' . $id . ': '
                    . ($resp instanceof \Throwable ? $resp->getMessage() : 'no response'));
                $out[$id] = null;
                continue;
            }
            if (!$resp->successful()) {
                if ($resp->status() === 401) $unauthorised = true;
                Log::warning('Zoho batch call returned ' . $resp->status() . ' for request ' . $id
                    . ': ' . Str::limit((string) $resp->body(), 200));
                $out[$id] = null;
                continue;
            }
            $out[$id] = $resp->json() ?? [];
        }
        if ($unauthorised) Cache::forget(self::TOKEN_CACHE_KEY);
        return $out;
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

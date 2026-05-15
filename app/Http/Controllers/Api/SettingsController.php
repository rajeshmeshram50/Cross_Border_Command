<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PlatformSetting;
use App\Support\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

/**
 * Platform Settings API.
 *
 *  GET    /api/settings                      — every section, any auth user
 *  PUT    /api/settings/{section}            — upsert one section, super_admin only
 *  POST   /api/settings/appearance/asset     — upload logo or favicon, super_admin only
 *
 * Section payloads are validated per-section so each tab can evolve its
 * shape without breaking the others.
 */
class SettingsController extends Controller
{
    /**
     * The validators for each section. Centralised so update() can
     * dispatch by $section without a giant switch.
     */
    private const RULES = [
        'general' => [
            'platform_name' => 'required|string|max:255',
            'tagline'       => 'nullable|string|max:255',
            'description'   => 'nullable|string|max:2000',
            'support_email' => 'nullable|email|max:255',
            'admin_email'   => 'nullable|email|max:255',
            'contact_phone' => 'nullable|string|max:32',
            'website_url'   => 'nullable|url|max:500',
        ],
        'security' => [
            'tfa'         => 'boolean',
            'pwReset'     => 'boolean',
            'loginNotif'  => 'boolean',
            'ipWhite'     => 'boolean',
            'sessTimeout' => 'boolean',
            'bruteForce'  => 'boolean',
        ],
        'notifications' => [
            'emailNotif'    => 'boolean',
            'pushNotif'     => 'boolean',
            'planExp'       => 'boolean',
            'newUser'       => 'boolean',
            'payAlerts'     => 'boolean',
            'weeklyReports' => 'boolean',
        ],
        'appearance' => [
            'primary_color'   => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'secondary_color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'dark_default'    => 'boolean',
            // logo_path / favicon_path are written by the asset upload endpoint,
            // not directly by section update — preserved on save if not sent.
            'logo_path'       => 'nullable|string',
            'favicon_path'    => 'nullable|string',
        ],
        'privacy' => [
            'encrypt'            => 'boolean',
            'actLog'             => 'boolean',
            'retention'          => 'boolean',
            'cookie'             => 'boolean',
            'privacy_policy_url' => 'nullable|url|max:500',
        ],
        'help' => [
            'faqs'     => 'array',
            'faqs.*.q' => 'required_with:faqs|string|max:500',
            'faqs.*.a' => 'required_with:faqs|string|max:5000',
        ],
        'contact' => [
            'support_email'   => 'nullable|email|max:255',
            'support_phone'   => 'nullable|string|max:32',
            'website'         => 'nullable|url|max:500',
            'status_page'     => 'nullable|string|max:255',
            'emergency_phone' => 'nullable|string|max:32',
        ],
    ];

    /**
     * Return every section as { section => value } so the SPA can hydrate the
     * whole Settings page in one request.
     */
    public function index(Request $request)
    {
        $rows = PlatformSetting::query()->get(['section', 'value', 'updated_at']);
        $out  = [];
        foreach ($rows as $r) {
            $out[$r->section] = $r->value;
        }
        // Ensure every section key exists in the response so the SPA never
        // hits "undefined" when a fresh DB hasn't seeded a section yet.
        foreach (array_keys(self::RULES) as $sec) {
            if (!isset($out[$sec])) $out[$sec] = (object)[];
        }
        return response()->json($out);
    }

    /**
     * Upsert one section. Validates by section. Super_admin only — platform
     * settings are global config, not per-tenant.
     */
    public function update(Request $request, string $section)
    {
        if (!$request->user()->isSuperAdmin()) {
            return response()->json(['message' => 'Only super admin can change platform settings'], 403);
        }
        if (!isset(self::RULES[$section])) {
            return response()->json(['message' => "Unknown settings section: {$section}"], 404);
        }

        $data = $request->validate(self::RULES[$section]);

        // For appearance, preserve existing logo_path/favicon_path if the
        // form didn't send them (they're managed by the asset endpoint).
        if ($section === 'appearance') {
            $existing = PlatformSetting::getSection('appearance');
            $data['logo_path']    = $data['logo_path']    ?? ($existing['logo_path']    ?? null);
            $data['favicon_path'] = $data['favicon_path'] ?? ($existing['favicon_path'] ?? null);
        }

        PlatformSetting::setSection($section, $data, $request->user()->id);
        Settings::bust();  // cached toggles must reflect this save immediately

        return response()->json([
            'message' => 'Settings saved',
            'section' => $section,
            'value'   => PlatformSetting::getSection($section),
        ]);
    }

    /**
     * Upload a logo or favicon for the appearance section. Stores under
     * public/platform/ and writes the relative path back into the
     * appearance settings JSON. Super_admin only.
     */
    public function uploadAsset(Request $request)
    {
        if (!$request->user()->isSuperAdmin()) {
            return response()->json(['message' => 'Only super admin can upload platform assets'], 403);
        }

        $request->validate([
            'kind' => 'required|in:logo,favicon',
            'file' => 'required|image|mimes:jpg,jpeg,png,svg,webp,ico|max:2048',
        ]);

        $kind  = $request->input('kind');
        $field = $kind === 'logo' ? 'logo_path' : 'favicon_path';

        $existing = PlatformSetting::getSection('appearance');

        // Delete old file (best-effort; don't fail upload on cleanup error)
        if (!empty($existing[$field])) {
            try { Storage::disk('public')->delete($existing[$field]); } catch (\Throwable $e) {}
        }

        $path = $request->file('file')->store('platform/' . $kind, 'public');

        $merged = array_merge($existing, [$field => $path]);
        PlatformSetting::setSection('appearance', $merged, $request->user()->id);
        Settings::bust();

        return response()->json([
            'message' => ucfirst($kind) . ' uploaded',
            'path'    => $path,
            'url'     => file_url($path),
            'value'   => $merged,
        ]);
    }
}

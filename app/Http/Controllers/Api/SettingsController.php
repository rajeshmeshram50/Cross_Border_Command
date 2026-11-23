<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PlatformSetting;
use App\Support\Settings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class SettingsController extends Controller
{
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

    public function index(Request $request)
    {
        $rows = PlatformSetting::query()->get(['section', 'value', 'updated_at']);
        $out  = [];
        foreach ($rows as $r) {
            $out[$r->section] = $r->value;
        }
        foreach (array_keys(self::RULES) as $sec) {
            if (!isset($out[$sec])) $out[$sec] = (object)[];
        }

        if (isset($out['appearance']) && is_array($out['appearance'])) {
            $logoPath    = $out['appearance']['logo_path']    ?? null;
            $faviconPath = $out['appearance']['favicon_path'] ?? null;
            $out['appearance']['logo_url']    = $logoPath    ? file_url($logoPath)    : null;
            $out['appearance']['favicon_url'] = $faviconPath ? file_url($faviconPath) : null;
        }

        return response()->json($out);
    }

    public function update(Request $request, string $section)
    {
        if (!$request->user()->isSuperAdmin()) {
            return response()->json(['message' => 'Only super admin can change platform settings'], 403);
        }
        if (!isset(self::RULES[$section])) {
            return response()->json(['message' => "Unknown settings section: {$section}"], 404);
        }

        $data = $request->validate(self::RULES[$section]);

        if ($section === 'appearance') {
            $existing = PlatformSetting::getSection('appearance');
            $data['logo_path']    = $data['logo_path']    ?? ($existing['logo_path']    ?? null);
            $data['favicon_path'] = $data['favicon_path'] ?? ($existing['favicon_path'] ?? null);
        }

        PlatformSetting::setSection($section, $data, $request->user()->id);
        Settings::bust();

        return response()->json([
            'message' => 'Settings saved',
            'section' => $section,
            'value'   => PlatformSetting::getSection($section),
        ]);
    }

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

        if (!empty($existing[$field])) {
            try { Storage::disk('public')->delete($existing[$field]); } catch (\Throwable $e) {}
        }

        $path = $request->file('file')->store('platform/' . $kind, 'public');

        $merged = array_merge($existing, [$field => $path]);
        PlatformSetting::setSection('appearance', $merged, $request->user()->id);
        Settings::bust();

        $merged['logo_url']    = !empty($merged['logo_path'])    ? file_url($merged['logo_path'])    : null;
        $merged['favicon_url'] = !empty($merged['favicon_path']) ? file_url($merged['favicon_path']) : null;

        return response()->json([
            'message' => ucfirst($kind) . ' uploaded',
            'path'    => $path,
            'url'     => file_url($path),
            'value'   => $merged,
        ]);
    }
}

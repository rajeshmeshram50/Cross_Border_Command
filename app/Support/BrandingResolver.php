<?php

namespace App\Support;

use App\Models\Client;
use App\Models\User;

class BrandingResolver
{
    public static function forUser(?User $user): array
    {
        if (!$user || empty($user->client_id)) {
            return [];
        }

        if (($user->user_type ?? null) === 'client_admin') {
            return [];
        }

        $client = Client::find($user->client_id);
        if (!$client) {
            return [];
        }

        $orgName = trim((string) $client->org_name);

        $branding = array_filter([
            'brandName'    => $orgName ?: null,
            'brandShort'   => $orgName ? strtoupper($orgName) : null,
            'logoUrl'      => self::resolveLogoUrl($client->logo),
            'supportEmail' => $client->email ?: null,
            'supportPhone' => $client->phone ?: null,
            'websiteUrl'   => $client->website ?: null,
        ], fn ($v) => $v !== null && $v !== '');

        $branding['brandTagline'] = '';

        return $branding;
    }

    private static function resolveLogoUrl(?string $logo): ?string
    {
        if (!$logo) return null;
        if (preg_match('#^https?://#i', $logo)) return $logo;
        return asset('storage/' . ltrim($logo, '/'));
    }
}

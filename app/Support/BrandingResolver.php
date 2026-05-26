<?php

namespace App\Support;

use App\Models\Client;
use App\Models\User;

/**
 * Resolves per-tenant branding for transactional emails.
 *
 * Platform users (no client_id, e.g. super admin) → empty array → the email
 * template falls back to its platform defaults (IGC / Cross Border Command).
 *
 * Client-org users (branch / employee) → returns the client's own org_name,
 * logo, website, email, phone so the email looks like it came FROM that
 * organisation, not from us.
 *
 * Used by every Mailable that supports the `array $branding` constructor arg
 * (PasswordResetOtpMail, PasswordChangedMail, etc.) — keeping the resolution
 * logic in one place so a future change to the Client model only needs one
 * edit.
 */
class BrandingResolver
{
    /**
     * Branding array shaped for the email templates. Keys match the variables
     * the blade templates expect. Any keys not present here fall through to
     * the template's `?? default` fallback at render time.
     *
     * Empty string for `brandTagline` is intentional — it forces the template
     * to suppress the platform-specific "GROUP OF COMPANIES" subline for
     * client orgs that don't have one of their own.
     */
    public static function forUser(?User $user): array
    {
        if (!$user || empty($user->client_id)) {
            return [];
        }

        // Client admins are managed BY the platform (super admin onboards
        // them, super admin can reset their password), so transactional emails
        // sent to them are FROM us, not from their own org. Return empty so
        // the templates fall back to IGC platform defaults — same as super
        // admin recipients.
        // Branch users / employees stay with their parent client's brand
        // because their day-to-day operator IS the client admin, not us.
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

        // Force-suppress the IGC-specific "GROUP OF COMPANIES" subline — empty
        // string overrides the template's `?? default` fallback.
        $branding['brandTagline'] = '';

        return $branding;
    }

    /**
     * Turn a client's stored logo path into a publicly fetchable URL.
     * Returns null if no logo is set so the template falls back to the IGC
     * default logo.
     */
    private static function resolveLogoUrl(?string $logo): ?string
    {
        if (!$logo) return null;
        if (preg_match('#^https?://#i', $logo)) return $logo;
        return asset('storage/' . ltrim($logo, '/'));
    }
}

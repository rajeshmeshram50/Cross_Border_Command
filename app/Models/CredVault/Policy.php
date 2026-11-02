<?php

namespace App\Models\CredVault;

use Illuminate\Database\Eloquent\Model;

/**
 * CredVault · the tenant's policy document. One row per client; a key the
 * row does not hold reads its default, so new settings need no migration.
 */
class Policy extends Model
{
    protected $table = 'credvault_policies';

    /**
     * The 17 settings and their defaults — the prototype's CV_POL_DEF.
     * cp_admin_user_id null means "any Vault Admin of the client".
     */
    public const DEFAULTS = [
        'min_strength'     => 3,
        'rotation_default' => 90,
        'rotation_warn'    => 15,
        'gen_length'       => 20,
        'gen_symbols'      => true,
        'twofa_risks'      => ['critical', 'high'],
        'share_critical'   => true,
        'share_max_days'   => 30,
        'share_reason'     => true,
        'overshare_limit'  => 3,
        'cp_admin'         => true,
        'cp_admin_user_id' => null,
        'cp_manager'       => true,
        'cp_otp'           => true,
        'cp_max_minutes'   => 60,
        'bin_days'         => 30,
        'bin_purge'        => true,
    ];

    /** The values each setting may take; the PUT validates against these. */
    public const OPTIONS = [
        'min_strength'     => [2, 3, 4],
        'rotation_default' => [null, 30, 60, 90, 180],
        'rotation_warn'    => [7, 15, 30],
        'gen_length'       => [16, 20, 24, 32],
        'share_max_days'   => [0, 7, 30, 90],      // 0 = no limit
        'overshare_limit'  => [2, 3, 5, 10],
        'cp_max_minutes'   => [5, 15, 30, 60],
        'bin_days'         => [7, 15, 30, 60, 90],
    ];

    /** 2FA risk levels are kept in this order — the order the policy screen and its summary read them. */
    public const RISK_ORDER = ['critical', 'high', 'medium', 'low'];

    /** The five policy cards: [title, subtitle], as POL_SECS / POL_SUBS. */
    public const SECTIONS = [
        'password' => ['Password Policy', 'Strength, rotation and the password generator'],
        'twofa'    => ['Two-Factor', 'When two-factor authentication is mandatory'],
        'sharing'  => ['Sharing', 'Who can share, for how long, and how widely'],
        'critical' => ['Critical Access', 'Approval steps and unlock time for critical credentials'],
        'bin'      => ['Recycle Bin', 'How long removed credentials are kept'],
    ];

    /**
     * Every rule as the policy screen shows it:
     * [section, label, description, applies to, control, options [[value, label]…]]
     * control: seg (pick one) · multi (pick many) · switch · admin (a Vault Admin, null = any)
     */
    public const CATALOG = [
        'min_strength' => ['password', 'Minimum password strength', 'Passwords below this level cannot be saved and are flagged as weak in Password Health.',
            ['Add / Edit Credential', 'Password Health'], 'seg', [[2, 'Fair'], [3, 'Good'], [4, 'Strong']]],
        'rotation_default' => ['password', 'Default rotation for new credentials', 'Pre-selected rotation period when a new password-based credential is added.',
            ['Add Credential'], 'seg', [[30, '30 days'], [60, '60 days'], [90, '90 days'], [180, '180 days'], [null, 'None']]],
        'rotation_warn' => ['password', 'Rotation reminder', 'How early a password is flagged as “Rotation due soon” before it expires.',
            ['Password Health'], 'seg', [[7, '7 days'], [15, '15 days'], [30, '30 days']]],
        'gen_length' => ['password', 'Generated password length', 'Default length used by Generate Password everywhere in CredVault.',
            ['Generate Password'], 'seg', [[16, '16'], [20, '20'], [24, '24'], [32, '32']]],
        'gen_symbols' => ['password', 'Include symbols in generated passwords', 'Adds characters like ! @ # $ to generated passwords.',
            ['Generate Password'], 'switch', null],
        'twofa_risks' => ['twofa', 'Two-factor authentication required for', 'Credentials at these risk levels are flagged in Password Health when 2FA is off.',
            ['Password Health', 'Add / Edit Credential'], 'multi', [['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']]],
        'share_critical' => ['sharing', 'Allow sharing critical credentials', 'When off, the Share option is blocked for credentials marked Critical.',
            ['Share Credential', 'My Vault', 'Team Vault'], 'switch', null],
        'share_max_days' => ['sharing', 'Maximum share duration', 'Longest time a share can stay active. “No limit” allows shares without an end date.',
            ['Share Credential'], 'seg', [[7, '7 days'], [30, '30 days'], [90, '90 days'], [0, 'No limit']]],
        'share_reason' => ['sharing', 'Reason required to share', 'The person sharing must explain why access is needed.',
            ['Share Credential', 'Shared By Me'], 'switch', null],
        'overshare_limit' => ['sharing', 'Over-sharing limit', 'A credential shared with this many people or teams is flagged as shared too widely.',
            ['Password Health'], 'seg', [[2, '2'], [3, '3'], [5, '5'], [10, '10']]],
        'cp_admin' => ['critical', 'Vault Admin approval', 'Step 1 — the request goes to the Vault Admin first.',
            ['Critical Vault', 'Access Request Management'], 'switch', null],
        'cp_admin_user_id' => ['critical', 'Default Vault Admin', 'Who receives new access requests for critical credentials.',
            ['Critical Vault', 'Access Request Management'], 'admin', null],
        'cp_manager' => ['critical', 'Reporting Manager approval', 'Step 2 — the requester’s reporting manager gives the second approval.',
            ['Critical Vault', 'Access Request Management'], 'switch', null],
        'cp_otp' => ['critical', 'Authenticator OTP', 'Step 3 — a 6-digit code from an authenticator app is needed before reveal.',
            ['Critical Vault'], 'switch', null],
        'cp_max_minutes' => ['critical', 'Maximum unlock window', 'The longest access window a requester can choose. The credential locks again after it.',
            ['Critical Vault'], 'seg', [[5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 hour']]],
        'bin_days' => ['bin', 'Retention period', 'How long credentials stay in the Recycle Bin before they are permanently deleted.',
            ['Recycle Bin', 'Move to Bin'], 'seg', [[7, '7 days'], [15, '15 days'], [30, '30 days'], [60, '60 days'], [90, '90 days']]],
        'bin_purge' => ['bin', 'Allow permanent delete', 'When off, items can only be restored or left to expire — no one can erase them early or empty the bin.',
            ['Recycle Bin'], 'switch', null],
    ];

    /** The catalogue as the API serves it. */
    public static function catalog(): array
    {
        $out = [];
        foreach (self::CATALOG as $key => [$sec, $label, $desc, $applies, $control, $opts]) {
            $out[] = [
                'key' => $key, 'section' => $sec, 'label' => $label, 'description' => $desc, 'applies_to' => $applies,
                'control' => $control, 'default' => self::DEFAULTS[$key],
                'options' => $opts ? array_map(fn ($o) => ['value' => $o[0], 'label' => $o[1]], $opts) : null,
            ];
        }
        return $out;
    }

    /** A value as people read it — the prototype's polFmt(): "Good", "Every 90 days", "1 hour", "No limit". */
    public static function format(string $key, $v, ?string $adminName = null): string
    {
        return match ($key) {
            'min_strength'     => [1 => 'Weak', 2 => 'Fair', 3 => 'Good', 4 => 'Strong'][$v] ?? (string) $v,
            'rotation_default' => $v ? "Every {$v} days" : 'No rotation',
            'rotation_warn'    => "{$v} days before",
            'gen_length'       => "{$v} characters",
            'twofa_risks'      => $v ? implode(', ', array_map('ucfirst', $v)) : 'Not required',
            'share_max_days'   => $v ? "{$v} days" : 'No limit',
            'overshare_limit'  => "{$v} people / teams",
            'cp_max_minutes'   => $v < 60 ? "{$v} minutes" : ($v / 60) . ' hour',
            'bin_days'         => "{$v} days",
            'cp_admin_user_id' => $v ? ($adminName ?? "User #{$v}") : 'Any Vault Admin',
            default            => is_bool($v) ? ($v ? 'On' : 'Off') : (string) $v,
        };
    }

    protected $fillable = ['client_id', 'settings', 'updated_by'];

    protected $casts = ['settings' => 'array'];

    /** Read once per request — every CredVault endpoint consults the policy. */
    private static array $memo = [];

    /** The tenant's settings with every missing key filled from DEFAULTS. */
    public static function for(int $clientId): array
    {
        if (!isset(self::$memo[$clientId])) {
            $row = static::where('client_id', $clientId)->first();
            self::$memo[$clientId] = array_merge(
                self::DEFAULTS,
                array_intersect_key($row?->settings ?? [], self::DEFAULTS)
            );
        }
        return self::$memo[$clientId];
    }

    /** After a save, so the rest of the same request reads the new values. */
    public static function forget(int $clientId): void
    {
        unset(self::$memo[$clientId]);
    }
    
}

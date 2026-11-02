<?php

namespace App\Models\CredVault;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * CredVault · one audited event. Append-only — created, never updated.
 */
class AuditLog extends Model
{
    protected $table = 'credvault_audit_logs';

    public const UPDATED_AT = null;

    /** action => [label, base severity]. Reveal, copy and share on a critical credential are raised to critical. */
    public const ACTIONS = [
        'view'         => ['Viewed', 'info'],
        'reveal'       => ['Password revealed', 'warn'],
        'copy'         => ['Password copied', 'warn'],
        'launch'       => ['Website launched', 'info'],
        'create'       => ['Credential added', 'info'],
        'edit'         => ['Credential updated', 'info'],
        'share'        => ['Shared', 'warn'],
        'revoke'       => ['Access revoked', 'info'],
        'request'      => ['Access requested', 'warn'],
        'approve'      => ['Access approved', 'info'],
        'reject'       => ['Access rejected', 'critical'],
        'cancel'       => ['Request cancelled', 'info'],
        'unlock'       => ['Critical unlocked', 'critical'],
        'lock'         => ['Locked again', 'info'],
        'otp_failed'   => ['Wrong authenticator code', 'warn'],
        'export'       => ['Exported', 'critical'],
        'bin'          => ['Moved to bin', 'warn'],
        'restore'      => ['Restored', 'info'],
        'purge'        => ['Deleted permanently', 'critical'],
        'policy'       => ['Policy changed', 'warn'],
        'importx'      => ['Credentials imported', 'warn'],
        'backup'       => ['Backup created', 'warn'],
        'backupfail'   => ['Backup attempt failed', 'critical'],
        'health_fixed' => ['Health issue resolved', 'info'],
        'totp_linked'  => ['Authenticator linked', 'info'],
    ];

    /** Actions that touch a secret directly — on a critical credential they are security alerts. */
    public const RAISE_ON_CRITICAL = ['reveal', 'copy', 'share'];

    /** The timeline sentence "<actor> <verb> <credential>" — the prototype's AL_VERB, completed for every action. */
    public const VERBS = [
        'view' => 'viewed', 'reveal' => 'revealed the password of', 'copy' => 'copied the password of',
        'launch' => 'launched the website of', 'create' => 'added', 'edit' => 'updated', 'share' => 'shared',
        'revoke' => 'revoked access to', 'request' => 'requested access to', 'approve' => 'approved access to',
        'reject' => 'rejected access to', 'cancel' => 'cancelled the access request for', 'unlock' => 'unlocked',
        'lock' => 'locked', 'otp_failed' => 'entered wrong authenticator codes for', 'export' => 'exported',
        'bin' => 'moved to the recycle bin', 'restore' => 'restored', 'purge' => 'permanently deleted',
        'policy' => 'changed a CredVault policy', 'importx' => 'imported credentials', 'backup' => 'downloaded a backup',
        'backupfail' => 'attempted a backup', 'health_fixed' => 'resolved a health issue on', 'totp_linked' => 'linked an authenticator to',
    ];

    public const SEVERITY_LABELS = ['info' => 'Info', 'warn' => 'Warning', 'critical' => 'Critical'];

    protected $fillable = [
        'client_id', 'branch_id', 'user_id', 'action', 'severity', 'credential_id', 'credential_code',
        'credential_name', 'module', 'detail', 'meta', 'ip', 'user_agent', 'created_at',
    ];

    protected $casts = [
        'meta'       => 'array',
        'created_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}

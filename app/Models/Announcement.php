<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

class Announcement extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by', 'updated_by',
        'code',

        'title', 'description', 'type', 'priority',
        'attachment_path', 'attachment_original_name',

        'audience_type',
        'audience_role_ids', 'audience_designation_ids', 'exclude_employee_ids',
        'audience_count',

        'publish_type', 'publish_at', 'expires_at',

        'ack_required', 'ack_mode', 'ack_reminder_frequency', 'ack_escalation_days',

        'notify_email', 'notify_in_app', 'notify_sms', 'notify_whatsapp',

        'status',
    ];

    protected $casts = [
        'audience_role_ids'        => 'array',
        'audience_designation_ids' => 'array',
        'exclude_employee_ids'     => 'array',
        'audience_count'           => 'integer',
        'publish_at'               => 'datetime',
        'expires_at'               => 'datetime',
        'ack_required'             => 'boolean',
        'ack_escalation_days'      => 'integer',
        'notify_email'             => 'boolean',
        'notify_in_app'            => 'boolean',
        'notify_sms'               => 'boolean',
        'notify_whatsapp'          => 'boolean',
    ];

    /** Append the attachment URL alongside the stored relative path. */
    protected $appends = ['attachment_url'];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updater(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    /**
     * Public URL for the optional attachment file. Returns null when no
     * file was uploaded so the table renders an em-dash. Streamed through
     * a Laravel route in a follow-up if Apache DocumentRoot ≠ public/
     * causes 404s — same pattern as candidate CVs.
     */
    public function getAttachmentUrlAttribute(): ?string
    {
        if (empty($this->attachment_path)) return null;
        return Storage::disk('public')->url($this->attachment_path);
    }
}

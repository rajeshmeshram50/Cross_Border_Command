<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

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
     * URL for the optional attachment — the STREAMING route, not a raw
     * /storage path. (CBC #3)
     *
     * This used to return file_url(), i.e. "/storage/announcements/...". That
     * only resolves when public/storage is symlinked AND the bytes are on the
     * local disk. Neither holds reliably: the symlink is missing on a fresh
     * checkout, and on the server the public disk is Azure Blob, where no
     * /storage path exists at all. Clicking View therefore opened a blank tab
     * on a 404 while the file sat perfectly intact on the disk.
     *
     * announcements.attachment streams the bytes THROUGH the disk, so local and
     * Azure behave identically — which is exactly why the emailed announcement
     * already links here. The UI was the odd one out; both use it now.
     *
     * `signed` because the route's middleware requires it, and because that is
     * what lets the same link work for a recipient who is not logged in. The
     * signature covers the id, so it cannot be edited to reach another
     * announcement's file.
     */
    public function getAttachmentUrlAttribute(): ?string
    {
        if (!$this->attachment_path) {
            return null;
        }
        // An unsaved model has no id to sign — fall back rather than throw.
        return $this->getKey()
            ? \Illuminate\Support\Facades\URL::signedRoute('announcements.attachment', ['id' => $this->getKey()])
            : file_url($this->attachment_path);
    }
}

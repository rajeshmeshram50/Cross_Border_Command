<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Branch extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id',
        'name',
        'code',
        'email',
        'phone',
        'website',
        'contact_person',
        'branch_type',
        // Sandwich Leave Policy master switch. Branch-level on purpose: it
        // governs every employee posted here, including future joiners.
        'sandwich_policy',
        'industry',
        'description',
        'gst_number',
        'gst_state_code',
        'pan_number',
        'registration_number',
        'cin',
        'iec',
        'drug_license',
        'pcpndt_no',
        'aeo_code',
        'one_star_file_no',
        'one_star_udin_no',
        'logo',
        'signature_path',
        'profile_photo',
        'primary_color',
        'secondary_color',
        'address',
        'city',
        'district',
        'taluka',
        'state',
        'pincode',
        'country',
        'max_users',
        'established_at',
        'status',
        'notes',
        'shifts',
        'bank_accounts',
        'created_by',
    ];

    protected $appends = ['logo_url', 'profile_photo_url', 'signature_url'];

    protected function casts(): array
    {
        return [
            'max_users' => 'integer',
            // Cast so the API always emits a real JSON true/false. Without it
            // Postgres hands back "t"/"f" and the form's Yes/No select would
            // silently fall through to "not chosen" on edit.
            'sandwich_policy' => 'boolean',
            'established_at' => 'date',
            'shifts' => 'array',
            'bank_accounts' => 'array',
        ];
    }

    public function getLogoUrlAttribute(): ?string
    {
        return file_url($this->logo);
    }

    public function getProfilePhotoUrlAttribute(): ?string
    {
        return file_url($this->profile_photo);
    }

    /** Authorised-signatory image rendered on "with signature" Quotation/PI PDFs. */
    public function getSignatureUrlAttribute(): ?string
    {
        return file_url($this->signature_path);
    }

    // ── Relationships ──

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class);
    }

    public function departments(): HasMany
    {
        return $this->hasMany(Department::class);
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(Permission::class);
    }

    public function approvalQueue(): HasMany
    {
        return $this->hasMany(ApprovalQueue::class);
    }

    public function activityLogs(): HasMany
    {
        return $this->hasMany(ActivityLog::class);
    }

    // ── Helpers ──

    public function isActive(): bool
    {
        return $this->status === 'active';
    }
}

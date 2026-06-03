<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class CtcContract extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'code', 'title', 'agreement_type',
        'org_name', 'org_short_code', 'org_state', 'org_country',
        'counterparties', 'eff_date', 'end_date', 'termination_notice',
        'auto_renewal', 'renewal_type', 'content', 'header_config', 'footer_config',
        'approvers', 'approver_emails', 'clarifications',
        'stage', 'approval_status', 'status', 'rejection_reason',
        'days_to_approve', 'reminder_days', 'cp_signed_date',
        'primary_approver_name', 'primary_approver_email',
        'created_by', 'created_by_name', 'submitted_at',
    ];

    protected $casts = [
        'counterparties' => 'array',
        'header_config'  => 'array',
        'footer_config'  => 'array',
        'approvers'      => 'array',
        'approver_emails' => 'array',
        'clarifications' => 'array',
        'auto_renewal'   => 'boolean',
        'eff_date'       => 'date',
        'end_date'       => 'date',
        'cp_signed_date' => 'date',
        'submitted_at'   => 'datetime',
        'stage'          => 'integer',
        'termination_notice' => 'integer',
        'days_to_approve'    => 'integer',
        'reminder_days'      => 'integer',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}

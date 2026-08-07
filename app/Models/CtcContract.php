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
        'counterparties', 'eff_date', 'end_date',
        'auto_renewal', 'renewal_type', 'content', 'header_config', 'footer_config', 'page_config',
        'approvers', 'approver_emails', 'clarifications',
        'versions', 'signing_recipients', 'days_to_sign',
        'zoho_request_id', 'signature_request_id', 'signature_declined_at',
        'stage', 'approval_status', 'status', 'rejection_reason',
        'days_to_approve', 'reminder_days', 'cp_signed_date',
        'primary_approver_name', 'primary_approver_email',
        'created_by', 'created_by_name', 'submitted_at',
    ];

    protected $casts = [
        'counterparties' => 'array',
        'header_config'  => 'array',
        'footer_config'  => 'array',
        // { "margin_x": 25 } — left/right page margin in px, see the migration.
        'page_config'    => 'array',
        'approvers'      => 'array',
        'approver_emails' => 'array',
        'clarifications' => 'array',
        'versions'           => 'array',
        'signing_recipients' => 'array',
        'auto_renewal'   => 'boolean',
        'eff_date'       => 'date',
        'end_date'       => 'date',
        'cp_signed_date' => 'date',
        'submitted_at'   => 'datetime',
        'stage'          => 'integer',
        'days_to_approve'    => 'integer',
        'reminder_days'      => 'integer',
        'days_to_sign'       => 'integer',
        'signature_request_id' => 'integer',
        'signature_declined_at' => 'datetime',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
}

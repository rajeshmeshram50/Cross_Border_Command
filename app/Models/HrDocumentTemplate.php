<?php

namespace App\Models;

use App\Models\Masters\TriggerPoints;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrDocumentTemplate extends Model
{
    protected $table = 'hr_document_templates';

    protected $fillable = [
        'client_id', 'branch_id',
        'code', 'name', 'description',
        'employee_category', 'role_type', 'doc_type', 'trigger_point_id',
        'version',
        'is_mandatory', 'requires_signature', 'requires_manager_approval', 'include_in_audit',
        'signing_mode', 'signers',
        'editor_mode', 'content_html', 'header_config', 'footer_config',
        'docx_path', 'docx_original_name',
        'status', 'created_by',
    ];

    protected $casts = [
        'is_mandatory'              => 'boolean',
        'requires_signature'        => 'boolean',
        'requires_manager_approval' => 'boolean',
        'include_in_audit'          => 'boolean',
        'signers'                   => 'array',
        'header_config'             => 'array',
        'footer_config'             => 'array',
    ];

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

    public function triggerPoint(): BelongsTo
    {
        return $this->belongsTo(TriggerPoints::class, 'trigger_point_id');
    }
}

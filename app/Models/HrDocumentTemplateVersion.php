<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A saved snapshot of a document template. Append-only: nothing edits or
 * deletes a version, because the whole value of one is that it still says what
 * it said. (#34)
 */
class HrDocumentTemplateVersion extends Model
{
    protected $table = 'hr_document_template_versions';

    protected $fillable = [
        'client_id', 'branch_id', 'template_id',
        'version', 'code', 'name', 'status',
        'editor_mode', 'content_html', 'header_config', 'footer_config',
        'docx_path', 'docx_original_name',
        'created_by',
    ];

    protected $casts = [
        'header_config' => 'array',
        'footer_config' => 'array',
    ];

    public function template(): BelongsTo
    {
        return $this->belongsTo(HrDocumentTemplate::class, 'template_id');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}

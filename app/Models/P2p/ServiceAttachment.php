<?php

namespace App\Models\P2p;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ServiceAttachment extends Model
{
    protected $table = 'p2p_service_attachments';

    protected $fillable = ['service_id', 'client_id', 'file_path', 'original_name', 'mime_type', 'size', 'uploaded_by'];

    protected $casts = [
        'size' => 'integer',
    ];

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class, 'service_id');
    }
}

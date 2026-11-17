<?php

namespace App\Models\P2p;

use App\Support\Concerns\EnforcesUniqueEmail;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Supplier extends Model
{
    use EnforcesUniqueEmail;
    protected static string $emailScope   = 'vendor';
    protected static array  $emailColumns = ['email'];

    use SoftDeletes;

    protected $table = 'p2p_suppliers';

    protected $fillable = [
        'client_id', 'branch_id',
        'name', 'segment', 'contact', 'mobile', 'email',
        'gmaps', 'address', 'country', 'state', 'state_code', 'city',
        'card_path', 'created_by', 'origin',

        'converted_vendor_id', 'converted_at', 'converted_by',
    ];

    protected $casts = [
        'converted_at' => 'datetime',
    ];
}

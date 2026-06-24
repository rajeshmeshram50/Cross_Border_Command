<?php

namespace App\Models\P2p;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * P2P · Bulk Sourcing — a "New Supplier" directory entry (p2p_suppliers).
 *
 * Separate from the company Vendor master. Created inline from the Map Supplier
 * Directory form; referenced by p2p_sourcing_product_suppliers.supplier_id when
 * source='new', so the same supplier can be re-mapped to other products by id.
 */
class Supplier extends Model
{
    use SoftDeletes;

    protected $table = 'p2p_suppliers';

    protected $fillable = [
        'client_id', 'branch_id',
        'name', 'segment', 'contact', 'mobile', 'email',
        'gmaps', 'address', 'country', 'state', 'state_code', 'city',
        'card_path', 'created_by',
    ];
}

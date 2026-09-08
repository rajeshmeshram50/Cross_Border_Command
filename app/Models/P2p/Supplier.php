<?php

namespace App\Models\P2p;

use App\Support\Concerns\EnforcesUniqueEmail;
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
    /* Email uniqueness — the rule itself lives in
       config/email_uniqueness.php; these two lines only say which
       identity this model belongs to. (#email-unique) */
    use EnforcesUniqueEmail;
    protected static string $emailScope   = 'vendor';
    protected static array  $emailColumns = ['email'];

    use SoftDeletes;

    protected $table = 'p2p_suppliers';

    protected $fillable = [
        'client_id', 'branch_id',
        'name', 'segment', 'contact', 'mobile', 'email',
        'gmaps', 'address', 'country', 'state', 'state_code', 'city',
        'card_path', 'created_by',
    ];
}

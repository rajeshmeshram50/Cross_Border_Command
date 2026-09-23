<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * CS-414 — Stage 04 documents open answered, not undecided.
 *
 * A document row used to be created with no answer at all, and the Necessary
 * column read "NOT DECIDED" until someone said yes or no. From now on a row
 * starts as Not necessary and is promoted after it has been read, so the rows
 * already sitting undecided are given that same answer here. The Purchase
 * Order itself is necessary by its kind, so it is answered yes.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('p2p_purchase_order_documents')->whereNull('needed')
            ->where('doc_kind', 'purchase_order')->update(['needed' => 'yes']);

        DB::table('p2p_purchase_order_documents')->whereNull('needed')
            ->where(fn ($q) => $q->where('doc_kind', '!=', 'purchase_order')->orWhereNull('doc_kind'))
            ->update(['needed' => 'no']);
    }

    /**
     * Only the rows this migration answered can be put back, and they are no
     * longer distinguishable from a real "no" — so nothing is undone.
     */
    public function down(): void
    {
    }
};

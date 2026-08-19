<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Sequential document-code allocator (ADV-0001, EXP-0042, ANN-0007, HGRP-0003…).
 *
 * The same twenty lines were written five times — twice inside
 * AdvanceRequestController alone, plus ExpenseClaimController,
 * AnnouncementController and HolidayGroupController. Only three things ever
 * differed: the model, the column and the prefix.
 *
 * WHY THE SCAN, RATHER THAN max(id) + 1
 * -------------------------------------
 * Codes are per-tenant, so the sequence restarts for every client/branch pair
 * and cannot be derived from the primary key. The stored value is a string, so
 * MAX() on it sorts lexically ("ADV-9" > "ADV-10"); the numeric part has to be
 * parsed out. Hence pluck-and-scan.
 *
 * WHY IT MUST RUN INSIDE A TRANSACTION
 * ------------------------------------
 * lockForUpdate() holds its rows only until the enclosing transaction ends.
 * Called outside one, MySQL commits immediately after the SELECT and the lock
 * is gone before the caller inserts — two concurrent requests then read the
 * same max and allocate the same code. Every existing caller already runs
 * inside DB::transaction(), but nothing said so out loud, so this asserts it:
 * a missing transaction is a programming error, not a runtime condition, and
 * failing loudly in development beats a duplicate code in production.
 *
 * Deliberately NOT wrapped in its own DB::transaction(): that would satisfy the
 * assertion while still releasing the lock the moment this method returns —
 * the appearance of safety without the substance.
 */
class DocumentNumber
{
    /**
     * Next code in the per-tenant sequence, allocated under a row lock.
     *
     * @param  class-string<\Illuminate\Database\Eloquent\Model>  $modelClass
     * @param  string  $column        Column holding the code (e.g. 'advance_no').
     * @param  string  $prefix        Code prefix without the dash (e.g. 'ADV').
     * @param  bool    $withTrashed   Include soft-deleted rows. Keep true where a
     *                                deleted row's code must never be reissued.
     * @param  int     $pad           Digits after the dash.
     */
    public static function next(
        string $modelClass,
        string $column,
        string $prefix,
        ?int $clientId,
        ?int $branchId,
        bool $withTrashed = false,
        int $pad = 4,
    ): string {
        if (DB::transactionLevel() === 0) {
            throw new \LogicException(
                static::class . '::next() must be called inside DB::transaction(). '
                . 'lockForUpdate() outside a transaction releases immediately, so two '
                . 'concurrent requests can allocate the same ' . $prefix . ' code.'
            );
        }

        $q = $modelClass::query();
        if ($withTrashed) {
            $q->withTrashed();
        }
        $q->lockForUpdate();

        // Null and a value are different tenants, not interchangeable — a null
        // client_id must not inherit the sequence of client 1.
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);

        $max = 0;
        foreach ($q->pluck($column) as $code) {
            if (preg_match('/^' . preg_quote($prefix, '/') . '-(\d+)$/i', (string) $code, $m)) {
                $n = (int) $m[1];
                if ($n > $max) {
                    $max = $n;
                }
            }
        }

        return $prefix . '-' . str_pad((string) ($max + 1), $pad, '0', STR_PAD_LEFT);
    }
}

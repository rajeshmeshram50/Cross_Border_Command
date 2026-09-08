<?php

namespace App\Support\Concerns;

use App\Support\EmailGuard;
use Illuminate\Validation\ValidationException;

/**
 * Model-level enforcement — the part that makes this hard to bypass.
 *
 * A model opts in with two lines:
 *
 *     use EnforcesUniqueEmail;
 *     protected static string $emailScope   = 'employee';
 *     protected static array  $emailColumns = ['email', 'official_email'];
 *
 * and every write path is covered: controllers, the Excel importers, seeders,
 * console commands, anything. That is the point of doing it here rather than
 * in each controller — there are ~20 places that create these records, and a
 * rule added to 19 of them is not a rule.
 *
 * Only DIRTY columns are checked, so re-saving a record for an unrelated
 * reason costs nothing, and an existing row whose address predates this rule
 * keeps saving until someone actually edits the address. That last part is
 * deliberate: the data already contains duplicates (see the audit in
 * config/email_uniqueness.php), and a rule that blocks editing a phone number
 * because of a legacy email clash would be unusable.
 */
trait EnforcesUniqueEmail
{
    public static function bootEnforcesUniqueEmail(): void
    {
        static::saving(function ($model) {
            $scope   = static::$emailScope   ?? null;
            $columns = static::$emailColumns ?? [];
            if (!$scope || !$columns) return;

            /* A RESTORE has to be treated as if the address were new.
             *
             * Deleting a record frees its address — that is deliberate, and
             * someone else may legitimately have taken it since. Restoring then
             * brings the old row back alongside the new holder, and the dirty
             * check alone waves it through: restore() marks `deleted_at`
             * dirty, never the email, so there is nothing for the loop below
             * to look at. Two live records end up sharing an address without
             * anyone editing one.
             *
             * So on the delete→live transition every email column is re-checked
             * whether it changed or not. This is the one place the rule has to
             * look at unchanged data, because what changed is the row's
             * visibility, not its contents.
             *
             * Detected from the attribute alone. An earlier version also asked
             * getDates() whether the model tracked `deleted_at`, which quietly
             * defeated the whole check: SoftDeletes registers deleted_at as a
             * CAST in current Laravel, not a date, so that test was false on
             * every model and the restore sailed through. A model without the
             * column simply never has it dirty, so the extra question bought
             * nothing but a way to be wrong. */
            $isRestoring = $model->isDirty('deleted_at')
                && $model->deleted_at === null
                && $model->getOriginal('deleted_at') !== null;

            foreach ($columns as $col) {
                // Untouched column → nothing new to validate, unless restoring.
                if (!$isRestoring && !$model->isDirty($col)) continue;

                $value = $model->{$col};
                if (EmailGuard::normalise($value) === '') continue;

                $conflict = EmailGuard::conflict(
                    $scope,
                    $value,
                    $model->client_id ?? null,
                    // exists() so a CREATE has no id to exclude and an UPDATE does.
                    $model->exists ? ['table' => $model->getTable(), 'id' => $model->getKey()] : [],
                );

                if ($conflict) {
                    /* ValidationException, not a plain exception: it surfaces as
                       a 422 keyed on the field, which is the shape every form in
                       the SPA already knows how to render. A 500 here would show
                       the user nothing useful. */
                    throw ValidationException::withMessages([
                        $col => [EmailGuard::message($conflict)],
                    ]);
                }
            }
        });
    }
}

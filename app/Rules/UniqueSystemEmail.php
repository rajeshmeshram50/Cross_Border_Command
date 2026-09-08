<?php

namespace App\Rules;

use App\Support\EmailGuard;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Form-level half of the email uniqueness rule.
 *
 * Use it wherever an email is validated so the user gets a 422 against the
 * right FIELD:
 *
 *   'email' => ['required','email', new UniqueSystemEmail('employee', $clientId, 'employees', $id)]
 *
 * The model trait enforces the same rule on save, so leaving this off does not
 * create a hole — it only costs the nice field-level message. Both call the
 * same EmailGuard, so they can never disagree about what counts as a
 * duplicate.
 */
class UniqueSystemEmail implements ValidationRule
{
    public function __construct(
        private string $scope,
        private ?int $clientId = null,
        private ?string $ignoreTable = null,
        private ?int $ignoreId = null,
    ) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $ignore = ($this->ignoreTable && $this->ignoreId)
            ? ['table' => $this->ignoreTable, 'id' => $this->ignoreId]
            : [];

        $conflict = EmailGuard::conflict($this->scope, is_string($value) ? $value : null, $this->clientId, $ignore);
        if ($conflict) $fail(EmailGuard::message($conflict));
    }
}

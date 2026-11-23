<?php

namespace App\Rules;

use App\Support\EmailGuard;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

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

<?php

namespace Database\Seeders;

use App\Models\CredVault\Credential;
use App\Models\Employee;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * A minimal, deterministic cast for testing the Critical Vault flow end to end:
 *
 *   1 Branch User (Vault Admin)  — opens everything in the branch directly
 *   2 HODs                       — act as the reporting managers
 *   2 Employees                  — Emp 1 reports to HOD 1, Emp 2 to HOD 2
 *   4 Critical credentials       — owned across the people above, all protected
 *                                  (Vault Admin + Manager + Authenticator)
 *
 * All five logins share one password (below). Every credential's 2FA is a
 * Google Authenticator secret that is FIXED, so GET /api/credvault/dev/totp
 * returns a working code (no phone / clock-skew needed).
 *
 * Re-runnable: rows are keyed by the @cvtest.local email domain / CVT-FLOW codes
 * and updated in place, never duplicated. Resolves the client + branch from the
 * first branch on the tenant, so it works whatever the local ids are.
 *
 * Run:  php artisan db:seed --class=CredVaultFlowTestSeeder
 */
class CredVaultFlowTestSeeder extends Seeder
{
    /** One password for all five logins. */
    private const PASSWORD = 'Vault@123';

    /** Fixed Base32 TOTP secrets (one per credential) so dev/totp is stable. */
    private const SECRETS = [
        'OCWZGAAFP4HNKJY2M6WUPD4EIW72CS4S',
        'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU',
        'MFRGGZDFMZTWQ2LKMFRGGZDFMZTWQ2LK',
    ];

    public function run(): void
    {
        $branch = DB::table('branches')->orderBy('id')->first();
        if (!$branch) { $this->command->error('No branch found — seed a client/branch first.'); return; }
        $clientId = (int) $branch->client_id;
        $branchId = (int) $branch->id;

        // ── People ────────────────────────────────────────────────────────────
        $branchUser = $this->user('CV Branch Admin', 'vault.branch@cvtest.local', 'branch_user', $clientId, $branchId);
        $hod1 = $this->user('CV HOD One',  'hod1@cvtest.local',  'employee', $clientId, $branchId);
        $hod2 = $this->user('CV HOD Two',  'hod2@cvtest.local',  'employee', $clientId, $branchId);
        $emp1 = $this->user('CV Emp One',  'emp1@cvtest.local',  'employee', $clientId, $branchId);
        $emp2 = $this->user('CV Emp Two',  'emp2@cvtest.local',  'employee', $clientId, $branchId);

        // Employee records — HODs are the reporting managers; Emp 1 → HOD 1, Emp 2 → HOD 2.
        $this->employee($hod1, 'CVT-HOD1', $clientId, $branchId, null);
        $this->employee($hod2, 'CVT-HOD2', $clientId, $branchId, null);
        $this->employee($emp1, 'CVT-EMP1', $clientId, $branchId, $hod1->id);
        $this->employee($emp2, 'CVT-EMP2', $clientId, $branchId, $hod2->id);

        // ── Credentials (all critical, all protected: admin + manager + otp) ────
        $this->credential('CVT-FLOW-01', 'Bank Portal (Branch Admin)', $branchUser, $clientId, $branchId, 'team',     self::SECRETS[0]);
        $this->credential('CVT-FLOW-02', 'AWS Root (Emp One)',          $emp1,       $clientId, $branchId, 'personal', self::SECRETS[1]);
        $this->credential('CVT-FLOW-03', 'Tax Portal (Emp Two)',        $emp2,       $clientId, $branchId, 'personal', self::SECRETS[2]);
        $this->credential('CVT-FLOW-04', 'Payroll Login (HOD One)',     $hod1,       $clientId, $branchId, 'team',     self::SECRETS[3]);

        $this->command->info('CredVault flow test data ready.');
        $this->command->info('Logins (password for all = ' . self::PASSWORD . '):');
        foreach (['vault.branch@cvtest.local (Branch Admin / Vault Admin)', 'hod1@cvtest.local (Reporting Manager of Emp 1)',
                  'hod2@cvtest.local (Reporting Manager of Emp 2)', 'emp1@cvtest.local (Employee)', 'emp2@cvtest.local (Employee)'] as $l) {
            $this->command->line('  · ' . $l);
        }
        $this->command->info('TOTP codes for the OTP step: GET /api/credvault/dev/totp (local only).');
    }

    private function user(string $name, string $email, string $type, int $clientId, int $branchId): User
    {
        return User::updateOrCreate(['email' => $email], [
            'name'          => $name,
            'password'      => self::PASSWORD,   // 'hashed' cast hashes on save
            'user_type'     => $type,
            'client_id'     => $clientId,
            'branch_id'     => $branchId,
            'status'        => 'active',
            'email_active'  => true,
        ]);
    }

    private function employee(User $u, string $code, int $clientId, int $branchId, ?int $managerUserId): void
    {
        [$first, $last] = array_pad(explode(' ', $u->name, 2), 2, '');
        $emp = Employee::updateOrCreate(['user_id' => $u->id], [
            'client_id'                => $clientId,
            'branch_id'                => $branchId,
            'emp_code'                 => $code,
            'first_name'               => $first ?: $u->name,
            'last_name'                => $last ?: null,
            'display_name'             => $u->name,
            'email'                    => $u->email,
            'status'                   => 'Active',
            'reporting_manager_user_id'=> $managerUserId,
            'date_of_joining'          => Carbon::now()->subYear()->toDateString(),
            // Fully onboarded (OnboardingGuard::COMPLETE_STAGE) so the login is
            // not bounced to the onboarding wizard.
            'onboarding_stage_completed' => 6,
        ]);
        // Keep the login's employee_code in step so employeeOf() resolves either way.
        if ($u->employee_code !== $code) $u->forceFill(['employee_code' => $code])->save();
        unset($emp);
    }

    private function credential(string $code, string $name, User $owner, int $clientId, int $branchId, string $scope, string $totp): void
    {
        $password = 'Zb!' . str_replace(' ', '', $name) . '-2026';
        $fields   = ['username' => strtolower(explode('@', $owner->email)[0]) . '@example.com', 'password' => $password, 'url' => 'https://example.com'];

        Credential::updateOrCreate(['code' => $code, 'client_id' => $clientId], [
            'branch_id'       => $branchId,
            'owner_id'        => $owner->id,
            'created_by'      => $owner->id,
            'updated_by'      => $owner->id,
            'vault'           => 'critical',
            'type'            => 'login',
            'category_group'  => 'Logins & Access',
            'name'            => $name,
            'scope'           => $scope,
            'username'        => $fields['username'],
            'url'             => $fields['url'],
            'secret'          => $password,                         // encrypted cast
            'secret_hash'     => Credential::hashSecret($password),
            'fields'          => $fields,                           // encrypted:array cast
            'risk'            => 'critical',
            'strength'        => Credential::strengthOf($password),   // 0–4 scale
            'has_password'    => true,
            'twofa'           => 'yes',
            // Protection: all three steps on; approvers resolved at unlock (new flow).
            'lock_admin'            => true,
            'lock_manager'          => true,
            'lock_otp'              => true,
            'lock_admin_user_id'    => null,
            'lock_manager_user_id'  => null,
            // 2FA = Google Authenticator with a fixed secret (dev/totp returns the code).
            'twofa_method'    => 'google',
            'totp_secret'     => $totp,                             // encrypted cast
            'totp_linked_at'  => now(),
            'twofa_linked_at' => now(),
            'password_changed_at' => now(),
        ]);
    }
}

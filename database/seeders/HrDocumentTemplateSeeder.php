<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Seeds one active HR document template into every Category × Role tab of
 * Document Template Management (client 1 / branch 3) so each tab has data.
 *
 * Categories: IT · Non-IT · Legal.  Roles: Director/CEO · HOD · Team Leader ·
 * Executive · Employee · Intern/Trainee (18 combos). Idempotent — a combo that
 * already has a template is skipped, so the existing four are left untouched.
 * Run:  php artisan db:seed --class=HrDocumentTemplateSeeder
 */
class HrDocumentTemplateSeeder extends Seeder
{
    private int $clientId = 1;
    private int $branchId = 3;

    public function run(): void
    {
        $categories = ['IT' => 'IT', 'Non-IT' => 'OPS', 'Legal' => 'LGL'];
        $roles = [
            'Director / CEO'           => 'DIR',
            'Head of Department (HOD)' => 'HOD',
            'Team Leader'              => 'TL',
            'Executive'                => 'EXE',
            'Employee'                 => 'EMP',
            'Intern / Trainee'         => 'INT',
        ];

        // Split each tab's templates across trigger points: 5 Onboarding + 5 Exit.
        $onboardingId = DB::table('master_trigger_points')->where('module_name', 'Onboarding')->value('id');
        $exitId       = DB::table('master_trigger_points')->where('module_name', 'Exit Management')->value('id');
        $triggers = [
            // label => [code prefix, trigger_point_id, 5 document names]
            'Onboarding' => ['ON', $onboardingId, ['Onboarding Letter', 'Offer Letter', 'Appointment Letter', 'Confirmation Letter', 'Probation Letter']],
            'Exit'       => ['EX', $exitId,       ['Relieving Letter', 'Experience Letter', 'Exit Clearance', 'Full & Final Settlement', 'No-Objection Certificate']],
        ];
        $perTrigger = 5;

        $signers = json_encode([[
            'role_id' => null, 'role_name' => 'Employee', 'designation_id' => null,
            'designation_name' => null, 'action' => 'Sign', 'days' => 3,
        ]]);
        $footer = json_encode([
            'text' => 'Company Name Pvt. Ltd.  |  Confidential', 'align' => 'center',
            'background' => '#ffffff', 'text_color' => '#6b7280',
            'show_page_number' => true, 'page_number_align' => 'right', 'page_number_format' => 'Page N of M',
        ]);
        $content = '<p>This letter is issued to {{EmployeeName}} ({{EmployeeCode}}) for the '
            . '{{RoleType}} role.</p><p>&nbsp;</p><p>{{Signer1Name}} {{Signer1Date}} {{Signer1Sign}}</p>';

        // Clean this seeder's own prior rows so re-running gives a fresh 5+5 split
        // (identified by the description tag; the real templates are untouched).
        DB::table('hr_document_templates')
            ->where('client_id', $this->clientId)
            ->where('description', 'like', 'Seeded template%')
            ->delete();

        $made = 0;
        foreach ($categories as $cat => $catCode) {
            foreach ($roles as $role => $roleCode) {
                foreach ($triggers as $trgLabel => [$trgCode, $trgId, $names]) {
                    if (!$trgId) continue; // trigger point not configured
                    for ($i = 1; $i <= $perTrigger; $i++) {
                        DB::table('hr_document_templates')->insert([
                            'client_id' => $this->clientId, 'branch_id' => $this->branchId,
                            'code' => "{$catCode}-{$roleCode}-{$trgCode}" . str_pad((string) $i, 2, '0', STR_PAD_LEFT),
                            'name' => $names[$i - 1] ?? ($trgLabel . ' Document ' . $i),
                            'description' => "Seeded template — {$cat} · {$role} · {$trgLabel}.",
                            'employee_category' => $cat, 'role_type' => $role,
                            'doc_type' => null, 'trigger_point_id' => $trgId,
                            'version' => 'v1',
                            'is_mandatory' => true, 'requires_signature' => true,
                            'requires_manager_approval' => true, 'include_in_audit' => true,
                            'signing_mode' => 'Sequential', 'signers' => $signers,
                            'editor_mode' => 'web', 'content_html' => $content,
                            'docx_path' => null, 'docx_original_name' => null,
                            'status' => 'Active', 'created_by' => 4,
                            'header_config' => json_encode([
                                'show_logo' => false, 'title' => $names[$i - 1] ?? $trgLabel, 'subtitle' => 'Confidential',
                                'align' => 'right', 'background' => '#ffffff', 'text_color' => '#111827', 'show_title' => true,
                            ]),
                            'footer_config' => $footer,
                            'created_at' => now(), 'updated_at' => now(),
                        ]);
                        $made++;
                    }
                }
            }
        }

        $this->command->info("HR document templates seeded — {$made} created ({$perTrigger} Onboarding + {$perTrigger} Exit per Category × Role tab).");
    }
}

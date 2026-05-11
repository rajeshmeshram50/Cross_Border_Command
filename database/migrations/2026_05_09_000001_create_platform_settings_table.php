<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * Platform-wide settings store. One row per section (general, security,
 * notifications, appearance, privacy, help, contact). Value is JSON so each
 * section can evolve its shape without a schema change.
 *
 * Reads = any authenticated user (so Contact Us, FAQs, branding can render
 *         on every page the SPA shows).
 * Writes = super_admin only (enforced in SettingsController).
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('platform_settings', function (Blueprint $table) {
            $table->id();
            $table->string('section', 64)->unique();
            $table->json('value');
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
        });

        // Seed sensible defaults so the SPA's Settings page renders something
        // the very first time it loads. Idempotent — uses INSERT only when
        // section is absent so re-running the seeder won't clobber edits.
        $defaults = [
            'general' => [
                'platform_name'  => 'Cross Border Command',
                'tagline'        => 'Multi-Tenant SaaS Platform',
                'description'    => 'Cross Border Command is a comprehensive multi-tenant platform for managing organizations, branches, and teams.',
                'support_email'  => 'support@cbc.com',
                'admin_email'    => 'admin@cbc.com',
                'contact_phone'  => '+91 9876543210',
                'website_url'    => 'https://cbc.com',
            ],
            'security' => [
                'tfa'         => true,
                'pwReset'     => false,
                'loginNotif'  => true,
                'ipWhite'     => false,
                'sessTimeout' => true,
                'bruteForce'  => true,
            ],
            'notifications' => [
                'emailNotif'    => true,
                'pushNotif'     => true,
                'planExp'       => true,
                'newUser'       => true,
                'payAlerts'     => true,
                'weeklyReports' => false,
            ],
            'appearance' => [
                'primary_color'   => '#4F46E5',
                'secondary_color' => '#10B981',
                'dark_default'    => false,
                'logo_path'       => null,
                'favicon_path'    => null,
            ],
            'privacy' => [
                'encrypt'            => true,
                'actLog'             => true,
                'retention'          => false,
                'cookie'             => true,
                'privacy_policy_url' => 'https://cbc.com/privacy',
            ],
            'help' => [
                'faqs' => [
                    ['q' => 'How to add a new client?',          'a' => 'Go to Clients and click Add Client. Fill in the organization details and admin credentials. The client admin will receive a welcome email with login credentials.'],
                    ['q' => 'How to manage branches?',           'a' => 'Client admins can add branches from the Branches page. Set one branch as "Main" (Head Office) to give its users visibility across all branches.'],
                    ['q' => 'How do permissions work?',          'a' => 'Super admins assign permissions to client admins. Client admins can then assign permissions to their branch users. Each module has View, Add, Edit, Delete, Export, Import, and Approve permissions.'],
                    ['q' => 'How to subscribe to a plan?',       'a' => 'Client admins can go to My Plan page to view available plans and subscribe. Plans determine which modules and features are available.'],
                    ['q' => 'What happens when a plan expires?', 'a' => 'Branch users will be blocked from accessing the platform. Client admins will only see the plan selection page until they renew.'],
                ],
            ],
            'contact' => [
                'support_email'   => 'support@cbc.com',
                'support_phone'   => '+91 9876543210',
                'website'         => 'https://cbc.com',
                'status_page'     => 'status.cbc.com',
                'emergency_phone' => '+91 98765 00000',
            ],
        ];

        foreach ($defaults as $section => $value) {
            $exists = DB::table('platform_settings')->where('section', $section)->exists();
            if (!$exists) {
                DB::table('platform_settings')->insert([
                    'section'    => $section,
                    'value'      => json_encode($value),
                    'updated_by' => null,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_settings');
    }
};

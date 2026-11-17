<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_service_categories', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('created_by')->nullable()->index();
            $table->string('service_type', 30)->index();
            $table->string('classification', 30)->nullable()->index();
            $table->string('name', 150);
            $table->string('status', 20)->default('Active');
            $table->boolean('is_system')->default(false);
            $table->timestamps();
        });

        Schema::table('p2p_services', function (Blueprint $table) {
            $table->unsignedBigInteger('category_id')->nullable()->after('classification');

            $table->string('provider_brand', 255)->nullable()->after('category_id');
            $table->string('delivery_type', 50)->nullable()->after('provider_brand');
            $table->string('haz_type', 20)->nullable()->after('delivery_type');
            $table->text('remark')->nullable()->after('contract_required');
            $table->text('confidential_info')->nullable()->after('remark');
            $table->unsignedTinyInteger('step_completed')->default(0)->after('status');
            $table->unsignedBigInteger('updated_by')->nullable()->after('created_by');

            $table->index('service_type');
            $table->index('classification');
            $table->index('category_id');
            $table->index('segment_id');
        });

        Schema::table('p2p_services', function (Blueprint $table) {
            $table->string('status', 20)->default('draft')->change();
            $table->decimal('gst_percentage', 5, 2)->nullable()->default(null)->change();
        });
        DB::table('p2p_services')->update(['status' => DB::raw('LOWER(status)')]);

        Schema::table('p2p_services', function (Blueprint $table) {
            $table->dropUnique('p2p_services_code_unique');
            $table->unique(['client_id', 'branch_id', 'code'], 'p2p_services_tenant_code_unique');
        });

        Schema::table('p2p_service_suppliers', function (Blueprint $table) {
            $table->text('remarks')->nullable()->after('total_amount');
            $table->unsignedBigInteger('created_by')->nullable()->after('remarks');
            $table->unsignedBigInteger('updated_by')->nullable()->after('created_by');
        });

        Schema::table('p2p_service_images', function (Blueprint $table) {
            $table->unsignedBigInteger('client_id')->nullable()->index()->after('service_id');
            $table->string('original_name', 255)->nullable()->after('file_path');
            $table->unsignedSmallInteger('sort_order')->default(0)->after('is_primary');
        });

        Schema::create('p2p_service_attachments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('service_id')->index();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->string('file_path', 500);
            $table->string('original_name', 255)->nullable();
            $table->string('mime_type', 120)->nullable();
            $table->unsignedBigInteger('size')->nullable();
            $table->unsignedBigInteger('uploaded_by')->nullable();
            $table->timestamps();
        });

        $this->seedDefaults();
    }

    private function seedDefaults(): void
    {
        $now = now();

        $categories = [
            'soft_digital' => [
                '' => ['Software Licence', 'SaaS Subscription', 'Cloud & Hosting', 'Website & Domain', 'Email & Collaboration',
                       'Cybersecurity', 'API & Integration', 'IT Support & Maintenance', 'Software Development',
                       'AI Assistant', 'Design & Creative Tools', 'Digital Marketing Platform', 'Online Learning',
                       'Productivity App', 'Media & Content Subscription', 'Survey & Forms Tool'],
            ],
            'other_operational' => [
                'professional' => ['Chartered Accountant (CA)', 'Legal Consultancy', 'Accounting & Bookkeeping', 'HR Consultancy',
                                   'Tax Advisory', 'Audit Services', 'Company Secretary'],
                'utility'      => ['Electricity', 'Water Supply', 'Internet Connectivity', 'Telephone / Mobile', 'Gas Supply'],
                'facility'     => ['Housekeeping', 'Security Services', 'Pantry Management', 'Pest Control', 'Front Desk / Reception'],
                'maintenance'  => ['AC Maintenance', 'Electrical Repair', 'Equipment AMC', 'Plumbing', 'Lift / Elevator AMC', 'Civil & Carpentry'],
                'outsourcing'  => ['Recruitment', 'Payroll Processing', 'Courier Services', 'Transportation', 'Event Management', 'Printing Services'],
            ],
        ];
        $rows = [];
        foreach ($categories as $type => $byClass) {
            foreach ($byClass as $class => $names) {
                foreach ($names as $name) {
                    $rows[] = ['service_type' => $type, 'classification' => $class ?: null, 'name' => $name,
                               'status' => 'Active', 'is_system' => false, 'created_at' => $now, 'updated_at' => $now];
                }
            }
        }
        DB::table('master_service_categories')->insert($rows);
    }

    public function down(): void
    {
        Schema::dropIfExists('p2p_service_attachments');

        Schema::table('p2p_service_images', function (Blueprint $table) {
            $table->dropColumn(['client_id', 'original_name', 'sort_order']);
        });

        Schema::table('p2p_service_suppliers', function (Blueprint $table) {
            $table->dropColumn(array_values(array_filter(
                ['remarks', 'status', 'created_by', 'updated_by'],
                fn ($c) => Schema::hasColumn('p2p_service_suppliers', $c)
            )));
        });

        Schema::table('p2p_services', function (Blueprint $table) {
            $table->dropUnique('p2p_services_tenant_code_unique');
            $table->unique('code');
            $table->dropIndex(['service_type']);
            $table->dropIndex(['classification']);
            $table->dropIndex(['category_id']);
            $table->dropIndex(['segment_id']);
            $table->dropColumn(['category_id', 'provider_brand', 'delivery_type', 'haz_type',
                                'remark', 'confidential_info', 'step_completed', 'updated_by']);
        });
        Schema::table('p2p_services', function (Blueprint $table) {
            $table->string('status')->default('Active')->change();
            $table->decimal('gst_percentage', 5, 2)->default(0.00)->change();
        });

        Schema::dropIfExists('master_service_categories');
    }
};

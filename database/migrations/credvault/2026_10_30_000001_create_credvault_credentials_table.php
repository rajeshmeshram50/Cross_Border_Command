<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;


return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credvault_credentials')) return;

        Schema::create('credvault_credentials', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            
            $t->string('code', 20);

            $t->string('type', 20);                     // login | bank | totp | … (25 types)
            $t->string('category_group', 40);           // Logins & Access | Finance & Banking | …
            $t->string('name', 150);
            $t->string('scope', 10)->default('personal');   // personal | team
            $t->unsignedBigInteger('owner_id')->index();
            // The team a team-scope credential belongs to (master_departments.id).
            $t->unsignedBigInteger('department_id')->nullable()->index();

            $t->string('url', 500)->nullable();
            $t->string('username', 191)->nullable();
            $t->text('secret')->nullable();             // encrypted
            $t->string('secret_hash', 64)->nullable()->index();
            $t->text('fields')->nullable();             // encrypted json
            $t->text('notes')->nullable();              // encrypted
            $t->json('attachments')->nullable();        // [{name,size,mime,path,at}]

            $t->string('risk', 10)->default('medium');  // low | medium | high | critical
            $t->unsignedTinyInteger('strength')->default(0);   // 0 none … 4 strong
            $t->boolean('has_password')->default(false);
            $t->string('twofa', 3)->default('na');      // yes | no | na
            $t->unsignedSmallInteger('rotation_days')->nullable();
            $t->timestamp('password_changed_at')->nullable();

         
            $t->boolean('lock_admin')->default(false);
            $t->boolean('lock_manager')->default(false);
            $t->boolean('lock_otp')->default(false);
            $t->unsignedBigInteger('lock_admin_user_id')->nullable();
            $t->unsignedBigInteger('lock_manager_user_id')->nullable();
            $t->text('totp_secret')->nullable();        // encrypted base32
            $t->timestamp('totp_linked_at')->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->unsignedBigInteger('deleted_by')->nullable();
            $t->timestamps();
            $t->softDeletes();

            $t->unique(['client_id', 'code']);
            $t->index(['client_id', 'risk']);
            $t->index(['client_id', 'scope', 'department_id']);
            $t->index(['client_id', 'updated_at']);
            $t->index(['client_id', 'deleted_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("alter table credvault_credentials add constraint credvault_cred_scope_check check (scope in ('personal','team'))");
            DB::statement("alter table credvault_credentials add constraint credvault_cred_risk_check check (risk in ('low','medium','high','critical'))");
            DB::statement("alter table credvault_credentials add constraint credvault_cred_twofa_check check (twofa in ('yes','no','na'))");
            DB::statement("alter table credvault_credentials add constraint credvault_cred_strength_check check (strength between 0 and 4)");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('credvault_credentials');
    }
};

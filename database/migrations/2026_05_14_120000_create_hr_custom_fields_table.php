<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * HR > Document & Evidence > Custom Fields.
 *
 * Stores user-defined variables that document templates can reference via
 * {{FieldName}} placeholders. These are variables NOT available in the
 * employee data set — the system prompts the user to fill them in at
 * document-generation time.
 *
 * Tenant scoping mirrors hr_document_templates: (client_id, branch_id) with
 * per-branch + BranchSwitcher visibility rules applied by the controller.
 * "used_in" is intentionally NOT stored — it's derived on read by scanning
 * hr_document_templates.content_html for {{FieldName}} occurrences, so the
 * answer is always truthful even when templates are edited.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hr_custom_fields', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();

            // PascalCase, no spaces — becomes {{name}} in templates.
            $table->string('name', 100);
            $table->enum('type', ['text', 'date', 'number', 'textarea'])->default('text');
            $table->string('description', 500)->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();

            // Uniqueness within tenant — same variable can't be defined twice
            // for the same (client, branch). Different branches under the same
            // client can each have their own.
            $table->unique(['client_id', 'branch_id', 'name'], 'hr_custom_fields_tenant_name_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hr_custom_fields');
    }
};

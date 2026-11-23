<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('email_logs', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('user_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->nullable()->index();

            $table->string('direction', 12)->default('outbound');

            $table->string('category', 40)->nullable()->index();
            $table->string('mailable_class', 191)->nullable();

            $table->string('from_email', 191)->nullable();
            $table->string('from_name', 191)->nullable();
            $table->string('to_email', 191)->nullable()->index();
            $table->string('to_name', 191)->nullable();
            $table->json('cc')->nullable();
            $table->json('bcc')->nullable();

            $table->string('subject', 255)->nullable();
            $table->longText('body_html')->nullable();
            $table->longText('body_text')->nullable();
            $table->boolean('has_attachments')->default(false);

            $table->string('status', 12)->default('sent');
            $table->text('error')->nullable();

            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'branch_id'], 'email_logs_tenant_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('email_logs');
    }
};

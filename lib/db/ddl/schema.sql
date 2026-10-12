-- Gurukul Portal: schema-only DDL generated from the Drizzle schema (lib/db/src/schema).
-- Regenerate with: cd lib/db && npx drizzle-kit export --dialect postgresql --schema ./src/schema/index.ts > ddl/schema.sql
-- (then re-add these header lines). Reference only: apply schema changes with `pnpm --filter @workspace/db run push`.

CREATE TYPE "public"."attendance_status" AS ENUM('Present', 'Absent', 'Late');
CREATE TYPE "public"."course_level_status" AS ENUM('Active', 'Inactive');
CREATE TYPE "public"."enrollment_status" AS ENUM('Enrolled', 'Completed', 'Withdrawn');
CREATE TYPE "public"."notification_priority" AS ENUM('High', 'Normal', 'Low');
CREATE TYPE "public"."notification_status" AS ENUM('Draft', 'Published', 'Sent');
CREATE TYPE "public"."payment_status" AS ENUM('Paid', 'Pending', 'Overdue');
CREATE TYPE "public"."portal_user_role" AS ENUM('teacher', 'assistant');
CREATE TYPE "public"."portal_user_status" AS ENUM('active', 'inactive');
CREATE TYPE "public"."teacher_status" AS ENUM('Active', 'Inactive');
CREATE TYPE "public"."weekly_update_status" AS ENUM('Draft', 'Published');
CREATE TABLE "admin_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"audience_type" text DEFAULT 'parents' NOT NULL,
	"sent_by" text,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"teacher_emails" text,
	"filter_course" text,
	"filter_curric_year" text,
	"filter_employer" text,
	"sent_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "admin_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assigned_to_id" integer,
	"created_by_id" integer,
	"assigned_to_name" text,
	"created_by_name" text,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"due_date" text,
	"reminder_date" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "admin_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"pin_hash" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_id" integer,
	"updated_by_id" integer,
	"assigned_course_id" integer,
	"linked_teacher_id" integer,
	"last_login_at" timestamp,
	"pin_changed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"date" text NOT NULL,
	"expiry_date" text,
	"is_urgent" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "attendance_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_level_id" integer NOT NULL,
	"student_id" integer NOT NULL,
	"date" text NOT NULL,
	"status" "attendance_status" NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_user_id" integer,
	"admin_name" text NOT NULL,
	"user_role" text,
	"module_name" text NOT NULL,
	"action_type" text NOT NULL,
	"entity_name" text NOT NULL,
	"entity_id" text,
	"previous_value" text,
	"new_value" text,
	"curriculum_year" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"mother_name" text,
	"mother_phone" text,
	"mother_email" text,
	"father_name" text,
	"father_phone" text,
	"father_email" text,
	"child_name" text,
	"child_age" integer,
	"course_interest" text,
	"message" text,
	"sender_name" text,
	"sender_email" text,
	"sender_phone" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "course_levels" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"level_number" integer NOT NULL,
	"class_name" text NOT NULL,
	"capacity" integer DEFAULT 20 NOT NULL,
	"enrolled" integer DEFAULT 0 NOT NULL,
	"status" "course_level_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "course_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_level_id" integer NOT NULL,
	"section_name" text NOT NULL,
	"capacity" integer DEFAULT 20 NOT NULL,
	"status" "course_level_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"age_group" text NOT NULL,
	"level" text NOT NULL,
	"schedule" text NOT NULL,
	"instructor" text NOT NULL,
	"icon" text DEFAULT '📚' NOT NULL,
	"learning_areas" text,
	"levels_detail" text,
	"outcome" text,
	"curriculum_year" text,
	"fee" numeric(10, 2),
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "email_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"recipient_emails" text DEFAULT '' NOT NULL,
	"filter_course" text,
	"filter_curric_year" text,
	"filter_employer" text,
	"sent_by" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp DEFAULT now()
);

CREATE TABLE "enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"registration_id" integer,
	"course_level_id" integer NOT NULL,
	"section_id" integer,
	"enroll_date" text NOT NULL,
	"status" "enrollment_status" DEFAULT 'Enrolled' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "enrollment_registration_level_uniq" UNIQUE("registration_id","course_level_id")
);

CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"date" text NOT NULL,
	"time" text NOT NULL,
	"location" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"date_procured" text,
	"quantity_procured" integer DEFAULT 0 NOT NULL,
	"current_stock" integer DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 5 NOT NULL,
	"last_replenishment" text,
	"vendor" text,
	"remarks" text,
	"curriculum_year" text,
	"course_id" integer,
	"level_id" integer,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"name" text,
	"email" text,
	"phone" text,
	"employer" text,
	"is_existing_member" boolean DEFAULT false,
	"policy_agreed" boolean DEFAULT false,
	"membership_year" integer,
	"created_at" timestamp DEFAULT now(),
	"address" text,
	"validation_status" text DEFAULT 'Invalidated' NOT NULL,
	"validation_date" timestamp,
	"validated_by_admin_id" integer,
	"validated_by_admin_name" text,
	"id_card_type_seen" text,
	"id_card_number_last4" text,
	"id_card_issuing_authority" text,
	"validation_notes" text,
	"member_code" text,
	"tier_id" integer,
	"membership_start_date" date,
	"temple_member_years" integer,
	"legacy_member_id" text,
	"source" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text DEFAULT 'US',
	"spouse_first_name" text,
	"spouse_last_name" text,
	"spouse_email" text,
	"spouse_phone" text,
	CONSTRAINT "members_member_code_unique" UNIQUE("member_code"),
	CONSTRAINT "members_phone_uniq" UNIQUE("phone")
);

CREATE TABLE "membership_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"member_id" integer NOT NULL,
	"membership_year" integer NOT NULL,
	"amount_due" numeric(10, 2) DEFAULT '150.00' NOT NULL,
	"amount_paid" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"discount_amount" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'Pending' NOT NULL,
	"payment_method" text,
	"receipt_id" text,
	"payment_date" text,
	"notes" text,
	"pending_reason" text,
	"updated_by_admin_name" text,
	"updated_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "membership_payments_member_year_uniq" UNIQUE("member_id","membership_year")
);

CREATE TABLE "membership_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"fee" numeric(10, 2),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "membership_tiers_name_unique" UNIQUE("name")
);

CREATE TABLE "parent_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"course_id" integer,
	"course_name" text,
	"audience" text DEFAULT 'All Students' NOT NULL,
	"priority" "notification_priority" DEFAULT 'Normal' NOT NULL,
	"status" "notification_status" DEFAULT 'Draft' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"published_at" timestamp
);

CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"enrollment_id" integer NOT NULL,
	"amount_due" numeric(10, 2) DEFAULT '150.00' NOT NULL,
	"amount_paid" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'Pending' NOT NULL,
	"payment_method" text,
	"receipt_id" text,
	"payment_date" text,
	"pending_reason" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "payments_enrollment_id_unique" UNIQUE("enrollment_id")
);

CREATE TABLE "portal_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "portal_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"pin_hash" text NOT NULL,
	"role" "portal_user_role" DEFAULT 'teacher' NOT NULL,
	"status" "portal_user_status" DEFAULT 'active' NOT NULL,
	"login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"last_login_at" timestamp,
	"pin_changed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portal_users_phone_unique" UNIQUE("phone")
);

CREATE TABLE "section_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"section_id" integer NOT NULL,
	"teacher_id" integer NOT NULL,
	"role" text DEFAULT 'Teacher' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "student_fees" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"registration_id" integer,
	"fee_type" text NOT NULL,
	"amount_due" numeric(10, 2) NOT NULL,
	"amount_paid" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'Pending' NOT NULL,
	"payment_method" text,
	"receipt_id" text,
	"payment_date" text,
	"pending_reason" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "student_fees_student_type_uniq" UNIQUE("student_id","fee_type")
);

CREATE TABLE "student_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"curriculum_year" text NOT NULL,
	"registered_at" date NOT NULL,
	"date_provenance" text,
	"updated_at" timestamp,
	CONSTRAINT "student_registrations_student_year_uniq" UNIQUE("student_id","curriculum_year")
);

CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_code" text NOT NULL,
	"name" text NOT NULL,
	"dob" text,
	"grade" text,
	"is_new_student" boolean DEFAULT true,
	"is_active" boolean DEFAULT true NOT NULL,
	"curriculum_year" text,
	"member_id" integer,
	"primary_member_role" text,
	"mother_name" text,
	"mother_phone" text,
	"mother_email" text,
	"mother_employer" text,
	"father_name" text,
	"father_phone" text,
	"father_email" text,
	"father_employer" text,
	"address" text,
	"volunteer_parent" boolean DEFAULT false,
	"volunteer_area" text,
	"registration_source" text,
	"membership_fee_decision" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "students_student_code_unique" UNIQUE("student_code")
);

CREATE TABLE "teacher_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"teacher_id" integer NOT NULL,
	"course_id" integer NOT NULL,
	"level_from" integer DEFAULT 1 NOT NULL,
	"level_to" integer DEFAULT 7 NOT NULL,
	"timing" text,
	"section_id" integer,
	"assistant_teacher_id" integer,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "teacher_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_key" text NOT NULL,
	"content" text NOT NULL,
	"date" text NOT NULL,
	"color" text DEFAULT 'yellow' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "teachers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"bio" text,
	"category" text DEFAULT 'Teacher' NOT NULL,
	"status" "teacher_status" DEFAULT 'Active' NOT NULL,
	"assistant_id" integer,
	"curriculum_year" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "teachers_email_unique" UNIQUE("email")
);

CREATE TABLE "testimonials" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"detail" text NOT NULL,
	"quote" text NOT NULL,
	"avatar_color" text DEFAULT 'bg-orange-500' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE "weekly_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer,
	"course_name" text NOT NULL,
	"level_id" integer,
	"level_name" text NOT NULL,
	"section_id" integer,
	"section_name" text DEFAULT '' NOT NULL,
	"week_start" text NOT NULL,
	"week_end" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"topics_covered" text,
	"homework" text,
	"upcoming_plan" text,
	"reminders" text,
	"attachment_link" text,
	"priority" "notification_priority" DEFAULT 'Normal' NOT NULL,
	"status" "weekly_update_status" DEFAULT 'Draft' NOT NULL,
	"teacher_name" text NOT NULL,
	"created_by" text NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE "member_access_challenges" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"session_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp NOT NULL,
	"request_window_started_at" timestamp NOT NULL,
	"resend_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "bulk_email_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"bulk_email_id" integer NOT NULL,
	"email" text NOT NULL,
	"names" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp
);

CREATE TABLE "bulk_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"source" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"sent_by_admin_id" integer,
	"sent_by_name" text NOT NULL,
	"selected_count" integer NOT NULL,
	"recipient_count" integer NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);

ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_assigned_to_id_admin_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_created_by_id_admin_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_course_level_id_course_levels_id_fk" FOREIGN KEY ("course_level_id") REFERENCES "public"."course_levels"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "course_levels" ADD CONSTRAINT "course_levels_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_course_level_id_course_levels_id_fk" FOREIGN KEY ("course_level_id") REFERENCES "public"."course_levels"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_registration_id_student_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."student_registrations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_level_id_course_levels_id_fk" FOREIGN KEY ("course_level_id") REFERENCES "public"."course_levels"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_section_id_course_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."course_sections"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_level_id_course_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."course_levels"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "members" ADD CONSTRAINT "members_tier_id_membership_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."membership_tiers"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "membership_payments" ADD CONSTRAINT "membership_payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "parent_notifications" ADD CONSTRAINT "parent_notifications_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "section_assignments" ADD CONSTRAINT "section_assignments_section_id_course_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."course_sections"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "section_assignments" ADD CONSTRAINT "section_assignments_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "student_fees" ADD CONSTRAINT "student_fees_registration_id_student_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."student_registrations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "student_registrations" ADD CONSTRAINT "student_registrations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "students" ADD CONSTRAINT "students_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_section_id_course_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."course_sections"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "teacher_assignments" ADD CONSTRAINT "teacher_assignments_assistant_teacher_id_teachers_id_fk" FOREIGN KEY ("assistant_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_level_id_course_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."course_levels"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "weekly_updates" ADD CONSTRAINT "weekly_updates_section_id_course_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."course_sections"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "bulk_email_recipients" ADD CONSTRAINT "bulk_email_recipients_bulk_email_id_bulk_emails_id_fk" FOREIGN KEY ("bulk_email_id") REFERENCES "public"."bulk_emails"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "bulk_emails" ADD CONSTRAINT "bulk_emails_sent_by_admin_id_admin_users_id_fk" FOREIGN KEY ("sent_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX "members_phone_normalized_uniq" ON "members" USING btree (regexp_replace(phone, '[^0-9]', '', 'g')) WHERE phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') <> '';
CREATE UNIQUE INDEX "bulk_email_recipients_email_key" ON "bulk_email_recipients" USING btree ("bulk_email_id","email");
CREATE INDEX "bulk_email_recipients_status_idx" ON "bulk_email_recipients" USING btree ("bulk_email_id","status");
CREATE UNIQUE INDEX "bulk_emails_request_id_key" ON "bulk_emails" USING btree ("request_id");

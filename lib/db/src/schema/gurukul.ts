import {
  pgTable,
  pgEnum,
  text,
  serial,
  boolean,
  date,
  integer,
  numeric,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const teacherStatusEnum = pgEnum("teacher_status", ["Active", "Inactive"]);
export const courseLevelStatusEnum = pgEnum("course_level_status", ["Active", "Inactive"]);
export const enrollmentStatusEnum = pgEnum("enrollment_status", ["Enrolled", "Completed", "Withdrawn"]);
export const paymentStatusEnum = pgEnum("payment_status", ["Paid", "Pending", "Overdue"]);

// ─── Existing tables (extended, backward-compatible) ─────────────────────────

export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  date: text("date").notNull(),                          // publishDate
  expiryDate: text("expiry_date"),                       // NEW — nullable
  isUrgent: boolean("is_urgent").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true), // NEW — default active
  category: text("category").notNull().default("General"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  date: text("date").notNull(),
  time: text("time").notNull(),
  location: text("location").notNull(),
  category: text("category").notNull().default("General"),
  isRecurring: boolean("is_recurring").notNull().default(false), // NEW
  createdAt: timestamp("created_at").defaultNow(),
});

export const coursesTable = pgTable("courses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  ageGroup: text("age_group").notNull(),
  level: text("level").notNull(),
  schedule: text("schedule").notNull(),
  instructor: text("instructor").notNull(),
  icon: text("icon").notNull().default("📚"),
  learningAreas: text("learning_areas"),
  levelsDetail: text("levels_detail"),
  outcome: text("outcome"),
  curriculumYear: text("curriculum_year"),            // e.g. "2026-27"; null = not year-scoped
  fee: numeric("fee", { precision: 10, scale: 2 }),  // per-course fee; null = use global setting
  archivedAt: timestamp("archived_at"),              // null = active; set = archived
  createdAt: timestamp("created_at").defaultNow(),
});

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  motherName:     text("mother_name"),
  motherPhone:    text("mother_phone"),
  motherEmail:    text("mother_email"),
  fatherName:     text("father_name"),
  fatherPhone:    text("father_phone"),
  fatherEmail:    text("father_email"),
  childName:      text("child_name"),
  childAge:       integer("child_age"),
  courseInterest: text("course_interest"),
  message:        text("message"),
  // Simplified contact form fields
  senderName:     text("sender_name"),
  senderEmail:    text("sender_email"),
  senderPhone:    text("sender_phone"),
  isRead:         boolean("is_read").notNull().default(false),
  createdAt:      timestamp("created_at").defaultNow(),
});

// ─── Admin Users ──────────────────────────────────────────────────────────────
// Portal admin accounts. Super admin is identified by role = 'super_admin'.
// Regular admins authenticate with phone (= username) + 4-digit PIN.
// Super admin authenticates with email + password.

export const adminUsersTable = pgTable("admin_users", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull(),
  email:       text("email"),             // required for course_coordinator; super admin email also stored here
  phone:       text("phone"),             // 10-digit; = username for regular admins
  pinHash:     text("pin_hash").notNull(), // bcrypt hash of password (super) or 4-digit PIN (admin)
  role:        text("role").notNull().default("admin"), // "super_admin" | "admin"
  status:      text("status").notNull().default("active"), // "active" | "inactive"
  createdById:      integer("created_by_id"),   // admin who created this account (null for super admin)
  updatedById:      integer("updated_by_id"),
  assignedCourseId: integer("assigned_course_id"), // for course_coordinator role — the course they manage
  linkedTeacherId:  integer("linked_teacher_id"),  // for course_coordinator — auto-created teacher record id
  lastLoginAt:      timestamp("last_login_at"), // most recent successful login
  pinChanged:  boolean("pin_changed").notNull().default(false), // true once user changes their system-assigned credential
  createdAt:   timestamp("created_at").defaultNow(),
  updatedAt:   timestamp("updated_at").defaultNow(),
});

// ─── Teachers ─────────────────────────────────────────────────────────────────
// One row per teacher. Independent of courses.

export const teachersTable = pgTable("teachers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  bio: text("bio"),
  category: text("category").notNull().default("Teacher"), // "Teacher" | "Assistant"
  status: teacherStatusEnum("status").notNull().default("Active"),
  // For Teacher rows: which assistant (if any) is paired with this teacher
  assistantId: integer("assistant_id"),
  curriculumYear: text("curriculum_year"),  // e.g. "2027-2028"; long format
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Teacher Assignments ──────────────────────────────────────────────────────
// Links a teacher to a course with an optional level range and timing.
// A teacher can be assigned to many courses; a course can have many teachers.

export const teacherAssignmentsTable = pgTable("teacher_assignments", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id")
    .notNull()
    .references(() => teachersTable.id, { onDelete: "cascade" }),
  courseId: integer("course_id")
    .notNull()
    .references(() => coursesTable.id, { onDelete: "cascade" }),
  levelFrom: integer("level_from").notNull().default(1),
  levelTo: integer("level_to").notNull().default(7),
  timing: text("timing"),
  sectionId: integer("section_id")
    .references(() => courseSectionsTable.id, { onDelete: "set null" }),
  assistantTeacherId: integer("assistant_teacher_id")
    .references(() => teachersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Course Levels ────────────────────────────────────────────────────────────
// Each course has up to 7 levels. This is the granular class unit.

export const courseLevelsTable = pgTable("course_levels", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id")
    .notNull()
    .references(() => coursesTable.id, { onDelete: "cascade" }),
  levelNumber: integer("level_number").notNull(),  // 1–7
  className: text("class_name").notNull(),          // e.g., "Level 1"
  schedule: text("schedule"),                        // e.g., "Sundays 10–11 AM"
  capacity: integer("capacity").notNull().default(20),
  enrolled: integer("enrolled").notNull().default(0),
  status: courseLevelStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Temple Members ───────────────────────────────────────────────────────────
// A temple member (parent/guardian) who has registered or been looked up.

export const membersTable = pgTable("members", {
  id: serial("id").primaryKey(),
  name:             text("name"),
  email:            text("email"),
  phone:            text("phone"),
  employer:         text("employer"),
  // isExistingMember: true = verified temple member, false = parent membership created during registration
  isExistingMember: boolean("is_existing_member").default(false),
  policyAgreed:     boolean("policy_agreed").default(false),
  membershipYear:   integer("membership_year"), // Year membership was last renewed/confirmed
  createdAt:        timestamp("created_at").defaultNow(),
  // ── Member Validation ──────────────────────────────────────────────────────
  // Admin must physically verify the member's identity (photo ID) within 90 days.
  address:                text("address"),
  validationStatus:       text("validation_status").notNull().default("Invalidated"),
  validationDate:         timestamp("validation_date"),
  validatedByAdminId:     integer("validated_by_admin_id"),
  validatedByAdminName:   text("validated_by_admin_name"),
  idCardTypeSeen:         text("id_card_type_seen"),       // e.g. "Driver's License"
  idCardNumberLast4:      text("id_card_number_last4"),    // last 4 chars of ID number
  idCardIssuingAuthority: text("id_card_issuing_authority"), // e.g. "Ohio BMV"
  validationNotes:        text("validation_notes"),
  // Stable human-readable identifier, e.g. MEM-2026-0042
  memberCode:             text("member_code").unique(),
}, (table) => [
  unique("members_phone_uniq").on(table.phone),
  uniqueIndex("members_phone_normalized_uniq")
    .on(sql`regexp_replace(phone, '[^0-9]', '', 'g')`)
    .where(sql`phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') <> ''`),
]);

// ─── Students ─────────────────────────────────────────────────────────────────
// One row per student (child). Parent info lives here too.

export const studentsTable = pgTable("students", {
  id: serial("id").primaryKey(),
  studentCode: text("student_code").notNull().unique(), // e.g., GK-001
  name: text("name").notNull(),
  // Extended student fields
  dob: text("dob"),                        // Date of birth e.g. "2015-06-10"
  grade: text("grade"),                    // School grade e.g. "4th"
  isNewStudent: boolean("is_new_student").default(true),
  isActive: boolean("is_active").notNull().default(true),
  curriculumYear: text("curriculum_year"),  // e.g. "2027-2028"
  // Member linkage
  memberId: integer("member_id").references(() => membersTable.id),
  primaryMemberRole: text("primary_member_role"),
  // Separate parent contacts
  motherName:     text("mother_name"),
  motherPhone:    text("mother_phone"),
  motherEmail:    text("mother_email"),
  motherEmployer: text("mother_employer"),
  fatherName:     text("father_name"),
  fatherPhone:    text("father_phone"),
  fatherEmail:    text("father_email"),
  fatherEmployer: text("father_employer"),
  address: text("address"),
  // Volunteer info
  volunteerParent: boolean("volunteer_parent").default(false),
  volunteerArea:   text("volunteer_area"),
  // Registration source tracking
  registrationSource: text("registration_source"), // "public" | "admin"
  // Membership fee decision recorded at time of registration
  // Values: "New Member" | "Existing Active Member — Membership Fee Not Required" | "Existing Member Renewal — Membership Fee Required"
  membershipFeeDecision: text("membership_fee_decision"),
  createdAt: timestamp("created_at").defaultNow(),
});

// A student's registration is scoped to one curriculum year. date_provenance
// distinguishes a registration date recorded at registration from a legacy
// first-enrollment date; the latter is not asserted to be the original date.
export const studentRegistrationsTable = pgTable("student_registrations", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id")
    .notNull()
    .references(() => studentsTable.id, { onDelete: "cascade" }),
  curriculumYear: text("curriculum_year").notNull(),
  registeredAt: date("registered_at", { mode: "string" }).notNull(),
  dateProvenance: text("date_provenance"),
  updatedAt: timestamp("updated_at"),
}, (t) => [
  unique("student_registrations_student_year_uniq").on(t.studentId, t.curriculumYear),
]);

// ─── Enrollments ──────────────────────────────────────────────────────────────
// A registration may be enrolled in multiple course levels (one row each).
// sectionId is nullable — a student enrolled in a level can be assigned to a
// specific section within that level. null = unassigned / whole level.

export const enrollmentsTable = pgTable("enrollments", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id")
    .notNull()
    .references(() => studentsTable.id, { onDelete: "cascade" }),
  registrationId: integer("registration_id")
    .references(() => studentRegistrationsTable.id, { onDelete: "set null" }),
  courseLevelId: integer("course_level_id")
    .notNull()
    .references(() => courseLevelsTable.id, { onDelete: "restrict" }),
  sectionId: integer("section_id")
    .references(() => courseSectionsTable.id, { onDelete: "set null" }),
  enrollDate: text("enroll_date").notNull(),
  status: enrollmentStatusEnum("status").notNull().default("Enrolled"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  // A registration can only be enrolled in one section per course level.
  unique("enrollment_registration_level_uniq").on(t.registrationId, t.courseLevelId),
]);

// ─── Payments ─────────────────────────────────────────────────────────────────
// One payment record per enrollment (1-to-1, but kept separate for audit trail).

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  enrollmentId: integer("enrollment_id")
    .notNull()
    .unique()
    .references(() => enrollmentsTable.id, { onDelete: "cascade" }),
  amountDue: numeric("amount_due", { precision: 10, scale: 2 }).notNull().default("150.00"),
  amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }).notNull().default("0.00"),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("Pending"),
  paymentMethod: text("payment_method"),   // Check, Zelle, Cash
  receiptId: text("receipt_id"),
  paymentDate: text("payment_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Inventory ────────────────────────────────────────────────────────────────
// Temple Gurukul supplies and materials stock tracking.

export const inventoryTable = pgTable("inventory", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),           // Books, Bags, Papers, Supplies
  dateProcured: text("date_procured"),
  quantityProcured: integer("quantity_procured").notNull().default(0),
  currentStock: integer("current_stock").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(5),
  lastReplenishment: text("last_replenishment"),
  vendor: text("vendor"),
  remarks: text("remarks"),
  curriculumYear: text("curriculum_year"),         // e.g. "2027-2028"; long format
  courseId: integer("course_id").references(() => coursesTable.id, { onDelete: "set null" }),
  levelId:  integer("level_id").references(() => courseLevelsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Course Sections ─────────────────────────────────────────────────────────
// Sections subdivide a level (e.g., Level 1 Morning / Level 1 Afternoon).
// Students are enrolled at the level level; sections handle scheduling/grouping.

export const courseSectionsTable = pgTable("course_sections", {
  id:            serial("id").primaryKey(),
  courseLevelId: integer("course_level_id")
    .notNull()
    .references(() => courseLevelsTable.id, { onDelete: "cascade" }),
  sectionName:   text("section_name").notNull(),    // e.g., "Morning Batch", "Section A"
  schedule:      text("schedule"),                   // e.g., "Sundays 10–11 AM"
  capacity:      integer("capacity").notNull().default(20),
  status:        courseLevelStatusEnum("status").notNull().default("Active"),
  createdAt:     timestamp("created_at").defaultNow(),
});

// Teacher/Assistant → Section assignment (granular, per section)
export const sectionAssignmentsTable = pgTable("section_assignments", {
  id:        serial("id").primaryKey(),
  sectionId: integer("section_id")
    .notNull()
    .references(() => courseSectionsTable.id, { onDelete: "cascade" }),
  teacherId: integer("teacher_id")
    .notNull()
    .references(() => teachersTable.id, { onDelete: "cascade" }),
  role:      text("role").notNull().default("Teacher"),  // "Teacher" | "Assistant"
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Attendance ───────────────────────────────────────────────────────────────

export const attendanceStatusEnum = pgEnum("attendance_status", ["Present", "Absent", "Late"]);

export const attendanceRecordsTable = pgTable("attendance_records", {
  id:            serial("id").primaryKey(),
  courseLevelId: integer("course_level_id")
    .notNull()
    .references(() => courseLevelsTable.id, { onDelete: "cascade" }),
  studentId:     integer("student_id")
    .notNull()
    .references(() => studentsTable.id, { onDelete: "cascade" }),
  date:          text("date").notNull(),
  status:        attendanceStatusEnum("status").notNull(),
  recordedBy:    text("recorded_by").notNull(),
  createdAt:     timestamp("created_at").defaultNow(),
});

// ─── Parent Notifications ─────────────────────────────────────────────────────

export const notificationStatusEnum   = pgEnum("notification_status",   ["Draft", "Published", "Sent"]);
export const notificationPriorityEnum = pgEnum("notification_priority",  ["High", "Normal", "Low"]);

export const parentNotificationsTable = pgTable("parent_notifications", {
  id:          serial("id").primaryKey(),
  title:       text("title").notNull(),
  message:     text("message").notNull(),
  courseId:    integer("course_id").references(() => coursesTable.id, { onDelete: "set null" }),
  courseName:  text("course_name"),
  audience:    text("audience").notNull().default("All Students"),
  priority:    notificationPriorityEnum("priority").notNull().default("Normal"),
  status:      notificationStatusEnum("status").notNull().default("Draft"),
  createdBy:   text("created_by").notNull(),
  createdAt:   timestamp("created_at").defaultNow(),
  publishedAt: timestamp("published_at"),
});

// ─── Relations ────────────────────────────────────────────────────────────────

export const coursesRelations = relations(coursesTable, ({ many }) => ({
  levels: many(courseLevelsTable),
  teacherAssignments: many(teacherAssignmentsTable),
}));

export const courseLevelsRelations = relations(courseLevelsTable, ({ one, many }) => ({
  course: one(coursesTable, {
    fields: [courseLevelsTable.courseId],
    references: [coursesTable.id],
  }),
  enrollments: many(enrollmentsTable),
}));

export const teachersRelations = relations(teachersTable, ({ many }) => ({
  assignments: many(teacherAssignmentsTable),
}));

export const teacherAssignmentsRelations = relations(teacherAssignmentsTable, ({ one }) => ({
  teacher: one(teachersTable, {
    fields: [teacherAssignmentsTable.teacherId],
    references: [teachersTable.id],
  }),
  course: one(coursesTable, {
    fields: [teacherAssignmentsTable.courseId],
    references: [coursesTable.id],
  }),
}));

export const studentsRelations = relations(studentsTable, ({ many }) => ({
  enrollments: many(enrollmentsTable),
  registrations: many(studentRegistrationsTable),
}));

export const studentRegistrationsRelations = relations(studentRegistrationsTable, ({ one, many }) => ({
  student: one(studentsTable, {
    fields: [studentRegistrationsTable.studentId],
    references: [studentsTable.id],
  }),
  enrollments: many(enrollmentsTable),
}));

export const enrollmentsRelations = relations(enrollmentsTable, ({ one }) => ({
  student: one(studentsTable, {
    fields: [enrollmentsTable.studentId],
    references: [studentsTable.id],
  }),
  registration: one(studentRegistrationsTable, {
    fields: [enrollmentsTable.registrationId],
    references: [studentRegistrationsTable.id],
  }),
  courseLevel: one(courseLevelsTable, {
    fields: [enrollmentsTable.courseLevelId],
    references: [courseLevelsTable.id],
  }),
  section: one(courseSectionsTable, {
    fields: [enrollmentsTable.sectionId],
    references: [courseSectionsTable.id],
  }),
  payment: one(paymentsTable, {
    fields: [enrollmentsTable.id],
    references: [paymentsTable.enrollmentId],
  }),
}));

export const paymentsRelations = relations(paymentsTable, ({ one }) => ({
  enrollment: one(enrollmentsTable, {
    fields: [paymentsTable.enrollmentId],
    references: [enrollmentsTable.id],
  }),
}));

// ─── Membership Payments ──────────────────────────────────────────────────────
// Tracks annual temple membership fee payments.
// One record per (member, year). Upserted when a member renews or pays their fee.

export const membershipPaymentsTable = pgTable("membership_payments", {
  id:             serial("id").primaryKey(),
  memberId:       integer("member_id")
    .notNull()
    .references(() => membersTable.id, { onDelete: "cascade" }),
  membershipYear: integer("membership_year").notNull(),
  amountDue:      numeric("amount_due",  { precision: 10, scale: 2 }).notNull().default("150.00"),
  amountPaid:     numeric("amount_paid", { precision: 10, scale: 2 }).notNull().default("0.00"),
  paymentStatus:  paymentStatusEnum("payment_status").notNull().default("Pending"),
  paymentMethod:  text("payment_method"),   // "Stripe", "Check", "Zelle", "Cash", etc.
  receiptId:      text("receipt_id"),
  paymentDate:    text("payment_date"),
  notes:          text("notes"),
  updatedByAdminName: text("updated_by_admin_name"),
  updatedAt:      timestamp("updated_at"),
  createdAt:      timestamp("created_at").defaultNow(),
}, (t) => [
  unique("membership_payments_member_year_uniq").on(t.memberId, t.membershipYear),
]);

export const insertMembershipPaymentSchema = createInsertSchema(membershipPaymentsTable).omit({ id: true, createdAt: true, updatedByAdminName: true, updatedAt: true });
export type MembershipPayment       = typeof membershipPaymentsTable.$inferSelect;
export type InsertMembershipPayment = z.infer<typeof insertMembershipPaymentSchema>;

// ─── Insert Schemas (Zod validation) ─────────────────────────────────────────

export const insertAnnouncementSchema = createInsertSchema(announcementsTable).omit({ id: true, createdAt: true });
export const insertEventSchema = createInsertSchema(eventsTable).omit({ id: true, createdAt: true });
export const insertCourseSchema = createInsertSchema(coursesTable).omit({ id: true, createdAt: true });
export const insertContactSchema = createInsertSchema(contactsTable).omit({ id: true, createdAt: true });
export const insertTeacherSchema = createInsertSchema(teachersTable).omit({ id: true, createdAt: true });
export const insertTeacherAssignmentSchema = createInsertSchema(teacherAssignmentsTable).omit({ id: true, createdAt: true });
export const insertCourseLevelSchema = createInsertSchema(courseLevelsTable).omit({ id: true, createdAt: true });
export const insertStudentSchema = createInsertSchema(studentsTable).omit({ id: true, createdAt: true });
export const insertStudentRegistrationSchema = createInsertSchema(studentRegistrationsTable).omit({ id: true });
export const insertEnrollmentSchema = createInsertSchema(enrollmentsTable).omit({ id: true, createdAt: true });
export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true });
export const insertInventorySchema = createInsertSchema(inventoryTable).omit({ id: true, createdAt: true });
export const insertAttendanceSchema       = createInsertSchema(attendanceRecordsTable).omit({ id: true, createdAt: true });
export const insertParentNotificationSchema = createInsertSchema(parentNotificationsTable).omit({ id: true, createdAt: true, publishedAt: true });

// ─── Portal Settings ─────────────────────────────────────────────────────────
// Simple key-value store for admin-configurable portal settings.
// Key examples: "active_curriculum_year" → "2027-28"

export const portalSettingsTable = pgTable("portal_settings", {
  key:       text("key").primaryKey(),
  value:     text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type PortalSetting = typeof portalSettingsTable.$inferSelect;

// ─── Testimonials ─────────────────────────────────────────────────────────────

export const testimonialsTable = pgTable("testimonials", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull(),
  detail:      text("detail").notNull(),
  quote:       text("quote").notNull(),
  avatarColor: text("avatar_color").notNull().default("bg-orange-500"),
  isActive:    boolean("is_active").notNull().default(true),
  sortOrder:   integer("sort_order").notNull().default(0),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const insertTestimonialSchema = createInsertSchema(testimonialsTable).omit({ id: true, createdAt: true });
export type Testimonial = typeof testimonialsTable.$inferSelect;
export type InsertTestimonial = z.infer<typeof insertTestimonialSchema>;

// ─── Email Log ────────────────────────────────────────────────────────────────

export const emailLogsTable = pgTable("email_logs", {
  id:           serial("id").primaryKey(),
  subject:      text("subject").notNull(),
  body:         text("body").notNull(),
  recipientCount: integer("recipient_count").notNull().default(0),
  recipientEmails: text("recipient_emails").notNull().default(""),
  filterCourse:      text("filter_course"),
  filterCurricYear:  text("filter_curric_year"),
  filterEmployer:    text("filter_employer"),
  sentBy:       text("sent_by"),
  status:       text("status").notNull().default("sent"),
  sentAt:       timestamp("sent_at").defaultNow(),
});

export type EmailLog = typeof emailLogsTable.$inferSelect;

// ─── Weekly Updates ───────────────────────────────────────────────────────────
// Class-level weekly updates published by teachers, visible to parents.

export const weeklyUpdateStatusEnum = pgEnum("weekly_update_status", ["Draft", "Published"]);

export const weeklyUpdatesTable = pgTable("weekly_updates", {
  id:             serial("id").primaryKey(),
  courseId:       integer("course_id").references(() => coursesTable.id, { onDelete: "set null" }),
  courseName:     text("course_name").notNull(),
  levelId:        integer("level_id").references(() => courseLevelsTable.id, { onDelete: "set null" }),
  levelName:      text("level_name").notNull(),
  sectionId:      integer("section_id").references(() => courseSectionsTable.id, { onDelete: "set null" }),
  sectionName:    text("section_name").notNull().default(""),
  weekStart:      text("week_start").notNull(),
  weekEnd:        text("week_end").notNull(),
  title:          text("title").notNull(),
  content:        text("content").notNull(),
  topicsCovered:  text("topics_covered"),
  homework:       text("homework"),
  upcomingPlan:   text("upcoming_plan"),
  reminders:      text("reminders"),
  attachmentLink: text("attachment_link"),
  priority:       notificationPriorityEnum("priority").notNull().default("Normal"),
  status:         weeklyUpdateStatusEnum("status").notNull().default("Draft"),
  teacherName:    text("teacher_name").notNull(),
  createdBy:      text("created_by").notNull(),
  publishedAt:    timestamp("published_at"),
  createdAt:      timestamp("created_at").defaultNow(),
  updatedAt:      timestamp("updated_at").defaultNow(),
});

export const insertWeeklyUpdateSchema = createInsertSchema(weeklyUpdatesTable).omit({ id: true, createdAt: true, updatedAt: true, publishedAt: true });
export type WeeklyUpdate = typeof weeklyUpdatesTable.$inferSelect;
export type InsertWeeklyUpdate = z.infer<typeof insertWeeklyUpdateSchema>;

// ─── Portal Users (Teachers / Assistants with PIN auth) ───────────────────────

export const portalUserStatusEnum  = pgEnum("portal_user_status",  ["active", "inactive"]);
export const portalUserRoleEnum    = pgEnum("portal_user_role",    ["teacher", "assistant"]);

export const portalUsersTable = pgTable("portal_users", {
  id:            serial("id").primaryKey(),
  name:          text("name").notNull(),
  phone:         text("phone").notNull().unique(),
  pinHash:       text("pin_hash").notNull(),
  role:          portalUserRoleEnum("role").notNull().default("teacher"),
  status:        portalUserStatusEnum("status").notNull().default("active"),
  loginAttempts: integer("login_attempts").notNull().default(0),
  lockedUntil:   timestamp("locked_until"),
  lastLoginAt:   timestamp("last_login_at"), // most recent successful login
  pinChanged:    boolean("pin_changed").notNull().default(false), // true once user changes their system-assigned PIN
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});

export const insertPortalUserSchema = createInsertSchema(portalUsersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type PortalUser       = typeof portalUsersTable.$inferSelect;
export type InsertPortalUser = z.infer<typeof insertPortalUserSchema>;

// ─── Teacher Notes (private scratch pad, per teacher) ────────────────────────

export const teacherNotesTable = pgTable("teacher_notes", {
  id:        serial("id").primaryKey(),
  ownerKey:  text("owner_key").notNull(),  // normalized email OR digits-only phone
  content:   text("content").notNull(),
  date:      text("date").notNull(),        // YYYY-MM-DD
  color:     text("color").notNull().default("yellow"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TeacherNote = typeof teacherNotesTable.$inferSelect;

// ─── Admin In-App Messages ────────────────────────────────────────────────────
// Replaces SMTP email blasts — messages are stored here and displayed in-portal.

export const adminMessagesTable = pgTable("admin_messages", {
  id:               serial("id").primaryKey(),
  subject:          text("subject").notNull(),
  body:             text("body").notNull(),
  audienceType:     text("audience_type").notNull().default("parents"), // "parents" | "teachers" | "both"
  sentBy:           text("sent_by"),
  recipientCount:   integer("recipient_count").notNull().default(0),
  teacherEmails:    text("teacher_emails"),      // comma-separated, set when audienceType includes teachers
  filterCourse:     text("filter_course"),
  filterCurricYear: text("filter_curric_year"),
  filterEmployer:   text("filter_employer"),
  sentAt:           timestamp("sent_at").defaultNow().notNull(),
});

export type AdminMessage = typeof adminMessagesTable.$inferSelect;

// ─── Admin Tasks ─────────────────────────────────────────────────────────────
// Internal task tracker for admins — assign to self or other admins, set due dates.

export const adminTasksTable = pgTable("admin_tasks", {
  id:           serial("id").primaryKey(),
  title:        text("title").notNull(),
  description:  text("description"),
  assignedToId: integer("assigned_to_id").references(() => adminUsersTable.id, { onDelete: "set null" }),
  createdById:  integer("created_by_id").references(() => adminUsersTable.id, { onDelete: "set null" }),
  assignedToName: text("assigned_to_name"),  // denormalized for display
  createdByName:  text("created_by_name"),   // denormalized for display
  priority:     text("priority").notNull().default("Medium"),    // "Low"|"Medium"|"High"|"Urgent"
  status:       text("status").notNull().default("todo"),        // "todo"|"in_progress"|"done"
  dueDate:      text("due_date"),            // ISO date string "YYYY-MM-DD"
  reminderDate: text("reminder_date"),       // ISO date string, nullable
  completedAt:  timestamp("completed_at"),   // set when status → done
  createdAt:    timestamp("created_at").defaultNow(),
  updatedAt:    timestamp("updated_at").defaultNow(),
});

export type AdminTask       = typeof adminTasksTable.$inferSelect;
export type InsertAdminTask = typeof adminTasksTable.$inferInsert;

// ─── Audit Logs ───────────────────────────────────────────────────────────────
// Immutable trail of every mutating admin action across all modules.

export const auditLogsTable = pgTable("audit_logs", {
  id:             serial("id").primaryKey(),
  adminUserId:    integer("admin_user_id"),
  adminName:      text("admin_name").notNull(),
  userRole:       text("user_role"),               // role of the acting user (admin, course_coordinator, etc.)
  moduleName:     text("module_name").notNull(),
  actionType:     text("action_type").notNull(),
  entityName:     text("entity_name").notNull(),
  entityId:       text("entity_id"),
  previousValue:  text("previous_value"),
  newValue:       text("new_value"),
  curriculumYear: text("curriculum_year"),          // curriculum year context for the action
  ipAddress:      text("ip_address"),
  userAgent:      text("user_agent"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Announcement = typeof announcementsTable.$inferSelect;
export type Event = typeof eventsTable.$inferSelect;
export type Course = typeof coursesTable.$inferSelect;
export type Contact = typeof contactsTable.$inferSelect;
export type Teacher = typeof teachersTable.$inferSelect;
export type TeacherAssignment = typeof teacherAssignmentsTable.$inferSelect;
export type CourseLevel = typeof courseLevelsTable.$inferSelect;
export type Student = typeof studentsTable.$inferSelect;
export type StudentRegistration = typeof studentRegistrationsTable.$inferSelect;
export type Enrollment = typeof enrollmentsTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
export type InventoryItem = typeof inventoryTable.$inferSelect;

export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type InsertTeacher = z.infer<typeof insertTeacherSchema>;
export type InsertTeacherAssignment = z.infer<typeof insertTeacherAssignmentSchema>;
export type InsertCourseLevel = z.infer<typeof insertCourseLevelSchema>;
export type InsertStudent = z.infer<typeof insertStudentSchema>;
export type InsertStudentRegistration = z.infer<typeof insertStudentRegistrationSchema>;
export type InsertEnrollment = z.infer<typeof insertEnrollmentSchema>;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type InsertInventory = z.infer<typeof insertInventorySchema>;

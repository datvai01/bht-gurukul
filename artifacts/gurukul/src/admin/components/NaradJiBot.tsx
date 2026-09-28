import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send } from "lucide-react";
import { useAuth } from "../AuthContext";

// ─── Knowledge base ───────────────────────────────────────────────────────────

type KBEntry = { keywords: string[]; response: string };

const KB: KBEntry[] = [
  // ── Auth & Login ─────────────────────────────────────────────────────────────
  {
    keywords: ["login", "sign in", "sign-in", "password", "pin", "auth", "access", "locked", "forgot", "log in"],
    response:
      "🔐 Login & Authentication\n\nAdmins log in with email + password.\nTeachers & Assistants log in with phone number + PIN.\n\nWrong PIN 5 times? The account locks for 15 minutes automatically. Admins can reset a teacher's PIN instantly from User Management.",
  },
  {
    keywords: ["reset pin", "forgot pin", "teacher pin", "change pin", "new pin"],
    response:
      "🔑 Resetting a Teacher's PIN\n\n1. Go to User Management in the sidebar\n2. Find the teacher in the list\n3. Click Reset PIN\n4. A new PIN is generated — share it securely with the teacher\n\nThe old PIN is immediately invalidated. Teachers can change their own PIN from Settings after logging in.",
  },
  {
    keywords: ["teacher login", "how teacher login", "how teacher signs in", "teacher access"],
    response:
      "📱 Teacher Login\n\nTeachers visit /admin/login and enter:\n1. Their registered 10-digit phone number\n2. Their PIN (provided by Admin from User Management)\n\nTeachers land on Courses & Classes after signing in. If a PIN is missing or locked, the Admin resets it from User Management.",
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  {
    keywords: ["dashboard", "overview", "home page", "stats", "statistics", "summary", "count"],
    response:
      "📊 Dashboard\n\nThe Dashboard is the Admin's home screen. It shows:\n• Total students enrolled\n• Number of active teachers\n• Upcoming calendar events\n• Attendance summary\n• Recent announcements\n\nTeachers and Assistants go directly to Courses & Classes when they log in.",
  },

  // ── Announcements & Events ────────────────────────────────────────────────
  {
    keywords: ["announcement", "notice", "news bulletin", "publish notice", "post notice"],
    response:
      "📢 Announcements\n\nAnnouncements appear on the public website for all visitors.\n\nTo create one:\n1. Click New Announcement\n2. Enter a title and body\n3. Set an optional expiry date\n4. Set status to Published\n\nDrafts are saved privately and not visible to the public.",
  },
  {
    keywords: ["calendar", "event", "schedule", "upcoming event", "add event", "program"],
    response:
      "📅 Events Calendar\n\nThe calendar shows all Gurukul events on the public website.\n\nTo add an event:\n1. Click Add Event\n2. Enter name, date, time, location, description\n3. Save — it appears publicly immediately\n\nEdit or delete events at any time.",
  },

  // ── Course Structure ──────────────────────────────────────────────────────
  {
    keywords: ["course management", "create course", "add course", "level", "section", "structure", "hierarchy", "curriculum"],
    response:
      "📚 Course Management\n\nThe class structure follows this hierarchy:\nCourse → Level → Section\n\nExample:\nHindi → Beginner → Section A (Sat 10 AM)\n\nSteps:\n1. Create a Course (e.g. Sanskrit, Telugu)\n2. Add Levels (Beginner, Intermediate…)\n3. Add Sections — these are actual class batches\n\nSections are what teachers are assigned to and students enroll in.",
  },
  {
    keywords: ["difference between course", "what is section", "what is level", "course vs section"],
    response:
      "📖 Course vs Level vs Section\n\nCourse — the subject (Hindi, Sanskrit, Dharma)\nLevel — the student's stage within a course (Beginner, Level 1, Advanced)\nSection — a specific class batch with a fixed schedule, teacher, and enrolled students\n\nA course can have many levels. A level can have many sections (e.g. Section A on Saturdays, Section B on Sundays).",
  },
  {
    keywords: ["archive course", "delete course", "remove course", "deactivate course", "course archive", "soft delete course"],
    response:
      "🗄️ Archiving a Course\n\nTo archive a course (soft-delete — data preserved):\n1. Go to Course Management\n2. Find the course\n3. Click the Archive button\n4. Confirm\n\nArchived courses are hidden from new enrollments but all historical data (attendance, payments) is preserved.\n\n⚠️ Deleting a course permanently removes it and all its levels/sections. Use Archive instead — it keeps history intact.",
  },

  // ── Staff & Teachers ──────────────────────────────────────────────────────
  {
    keywords: ["add teacher", "create teacher", "new teacher"],
    response:
      "👩‍🏫 Adding a Teacher\n\n1. Go to Staff Management → Add Teacher\n2. Enter name, email, phone, and category (Senior Teacher or Assistant)\n3. Assign to a course, level, and section\n4. Save\n\nThen go to User Management → Add User to create their portal login account so they can sign in with phone + PIN.",
  },
  {
    keywords: ["staff management", "edit teacher", "remove teacher", "deactivate teacher", "faculty"],
    response:
      "👩‍🏫 Staff Management\n\nView all teachers and assistants with their course assignments.\n\n• Edit — update name, contact, or course assignment\n• Deactivate portal access — go to User Management and toggle their account\n• Remove from system — delete from Staff Management (removes class assignment)\n\nNote: Deleting a teacher here does NOT delete their portal user account — do that separately from User Management.",
  },
  {
    keywords: ["assign teacher", "change teacher", "reassign teacher", "teacher assignment", "move teacher", "teacher section"],
    response:
      "🔄 Assigning / Changing a Teacher's Section\n\nMethod 1 — via Staff Management:\n1. Go to Staff Management\n2. Find the teacher and click Edit\n3. Update their assigned course, level, and section\n4. Save\n\nMethod 2 — via Course Management:\n1. Go to Course Management → Level → Section\n2. Click Assign Teacher in the section header\n3. Select the teacher from the dropdown\n\nA teacher can be assigned to multiple sections.",
  },

  // ── Students ──────────────────────────────────────────────────────────────
  {
    keywords: ["register student", "new student", "add student", "student registration", "admission", "enroll student"],
    response:
      "📝 Registering a New Student\n\n1. Go to Student Registration\n2. Search for or create a Temple Member to link the student to (mandatory)\n3. Enter: student name, date of birth, grade, parent/guardian contacts\n4. Choose course(s), level, and section to enroll in\n5. Set the fee amount\n6. Submit — student code (GK-XXX) is auto-assigned\n\nThe student appears in Students & Payments and in the teacher's class roster for attendance.",
  },
  {
    keywords: ["student code", "gk code", "what is gk", "student id", "gk-", "student number", "code format"],
    response:
      "🆔 Student Code\n\nEvery student gets a unique code in the format GK-001, GK-002, etc.\n\nThis code is:\n• Auto-assigned on registration (never reused)\n• Used to identify the student across all records (attendance, payments, notifications)\n• Searchable in the Students & Payments search box\n\nIf a student re-enrolls in a new year, they keep the same student code.",
  },
  {
    keywords: ["delete student", "remove student", "withdraw student", "deactivate student", "inactive student"],
    response:
      "🗑️ Deleting vs Deactivating a Student\n\nDeactivate (recommended for withdrawals):\n• Click the UserX icon on the student row → student stays in the system with all history\n• Hidden from active views but data is fully preserved\n\nDelete (permanent — use only for errors):\n• Click the trash icon\n• ⚠️ Permanently removes ALL records: enrollments, attendance, payments — CANNOT be undone\n\nFor mid-year withdrawals always Deactivate. Delete only test/error records.",
  },
  {
    keywords: ["bulk", "select all", "multiple students", "bulk delete", "bulk activate", "bulk deactivate", "select multiple", "mass action"],
    response:
      "☑️ Bulk Student Actions\n\n1. On the Students page, check the boxes on student rows you want to select\n2. Check the header checkbox to select all on the current page\n3. A bulk action bar appears at the bottom with three options:\n   • Mark Active\n   • Mark Inactive\n   • Delete Selected\n\n⚠️ Bulk delete permanently removes all selected students and their full payment history. This cannot be undone.",
  },
  {
    keywords: ["export", "csv", "download students", "export list", "student report", "download list", "print students"],
    response:
      "📥 Exporting Student Data (CSV)\n\n1. Apply any filters first (course, level, section, payment status, curriculum year…)\n2. Click the Download CSV icon (↓) at the top-right of the student table\n\nThe CSV respects your active filters — filter first to export a specific group.\n\nThe export includes: Student Code, Name, Grade, Courses, Parent contacts, Payment status, Total Paid, and more.",
  },
  {
    keywords: ["filter student", "search student", "find student", "sort student", "filter by course", "filter by payment"],
    response:
      "🔍 Filtering & Searching Students\n\nSearch box — type any name, student code (GK-XXX), or parent name to instantly filter.\n\nFilter panel (funnel icon) — narrow by:\n• Course\n• Level\n• Section\n• Payment Status (Paid / Pending / Overdue)\n• Active Status (Active / Inactive)\n• Curriculum Year\n\nSort — click any column header (Name, Grade, Course, Level, Payment Status, Total Paid, Active).\n\nAll filters combine — e.g. 'Hindi + Overdue' shows only Hindi students with outstanding fees.",
  },
  {
    keywords: ["assign student", "section assignment", "move student to section", "student section", "place student", "reassign student"],
    response:
      "📌 Assigning a Student to a Section\n\nStudents can be moved between sections within the same course level:\n\nMethod 1 — via Course Management:\n1. Go to Course Management → open the level\n2. Find the student in the enrolled list\n3. Use the section dropdown to reassign\n\nMethod 2 — via Student edit panel:\n1. Click the pencil (✏) icon on any student row\n2. Update the section in the Course Enrollment panel\n3. Save",
  },
  {
    keywords: ["backfill", "unlinked student", "link student to member", "student not linked", "member not linked", "fix member link", "link member", "no member"],
    response:
      "🔗 Linking Students to Temple Members\n\nEvery student must be linked to a Temple Member record. If a yellow banner appears on the Students page saying 'X students have no member link':\n\n1. Click 'Fix Now' — the system auto-matches students to members by phone number\n2. For students that can't be auto-matched, click the pencil (✏) to edit them and manually assign a member\n\nYou can also run the backfill at any time — it is safe to run multiple times.",
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  {
    keywords: ["student", "enrollment", "enroll", "fee", "payment", "fee status", "tuition", "record payment", "record fee", "update payment", "edit payment", "mark paid"],
    response:
      "🎓 Recording / Updating a Fee Payment\n\n1. Go to Students & Payments\n2. Click the Payment cell of the student (shows their pay status)\n3. The Payment Details slide-over opens — one card per enrolled course\n4. Click 'Edit Payment' on the card you want to update\n5. Fill in:\n   • Amount Due\n   • Amount Paid\n   • Status (Paid / Pending / Overdue)\n   • Method (Cash / Check / Zelle / Online / Waived)\n   • Receipt or Transaction #\n   • Payment Date\n6. Click 'Save Payment'\n\nThe student list refreshes automatically. Every change is logged in the Audit Log.\n\n⚠️ Online Stripe payments do NOT auto-update admin records — admins must record payments manually here.",
  },
  {
    keywords: ["overdue", "outstanding", "pending payment", "unpaid", "who hasn't paid", "not paid", "balance due", "overdue payment", "fee overdue"],
    response:
      "💸 Finding Overdue & Pending Payments\n\n1. Go to Students & Payments\n2. Open the Filter panel (funnel icon)\n3. Set Payment Status to 'Overdue' or 'Pending'\n\nOr click the Payment Status column header to sort — all Overdue students group at the top.\n\nTo record a payment for any student:\n1. Click their Payment cell → 'Edit Payment'\n2. Enter amount paid, method, receipt number\n3. Set status to 'Paid' and save",
  },

  // ── Attendance ────────────────────────────────────────────────────────────
  {
    keywords: ["attendance", "mark attendance", "present", "absent", "roll call", "take attendance", "class attendance"],
    response:
      "✅ Taking Attendance\n\n1. Go to Attendance in the sidebar\n2. Select the course, level, and section\n3. Choose the class date\n4. Mark each student:\n   • Present ✓\n   • Absent ✗\n   • Late ⏰\n5. Click Save\n\nYou only see students in your own assigned sections. Attendance is date-locked once saved — but you can edit by re-opening the same date.",
  },
  {
    keywords: ["late", "tardy", "mark late", "late student", "arrived late", "late mark"],
    response:
      "⏰ Marking a Student Late\n\n1. Go to Attendance\n2. Select course, level, section, and date\n3. Find the student in the roster\n4. Click the status button to cycle to 'Late'\n\nStatus cycles: Present → Absent → Late → Present\n\nLate is counted separately in attendance summaries and does not reduce the student's attendance percentage as severely as Absent.",
  },
  {
    keywords: ["attendance history", "past attendance", "attendance report", "previous attendance", "attendance record", "percentage", "attendance rate", "attendance summary"],
    response:
      "📊 Attendance History & Reports\n\n1. Go to Attendance\n2. Click the 'History' tab at the top\n3. Select the course, level, and section\n\nYou'll see:\n• A date-by-date log of every attendance session\n• Per-student attendance percentage\n• Present / Absent / Late breakdown for each date\n\nTeachers only see their own assigned sections. Admins can view all sections.",
  },

  // ── Weekly Updates ────────────────────────────────────────────────────────
  {
    keywords: ["weekly update", "class update", "parent update", "publish update", "write update", "post update"],
    response:
      "📰 Publishing a Weekly Update\n\n1. Go to Weekly Updates → New Update\n2. Select course, level, section\n3. Set week start and end dates\n4. Choose Priority: High 🔴, Normal, or Low\n5. Fill in: Class Highlights (required), Topics Covered, Homework, Upcoming Plan, Reminders\n6. Add an optional attachment link\n7. Publish\n\nParents see published updates on the Parent Portal after verifying their membership phone number.",
  },
  {
    keywords: ["priority", "high priority", "urgent update", "red badge", "low priority"],
    response:
      "🔴 Update Priority\n\nHigh — shows a 🔴 badge on the Parent Portal. Use for urgent reminders (exam, closure, special class).\nNormal — standard weekly update, no special badge.\nLow — routine or informational update.\n\nParents see the 🔴 badge immediately when browsing weekly updates. Only admins and teachers can set priority.",
  },

  // ── Documents ─────────────────────────────────────────────────────────────
  {
    keywords: ["document", "upload", "material", "resource", "file", "worksheet", "pdf", "course document"],
    response:
      "📄 Course Documents\n\nTeachers can upload learning materials, worksheets, and reference links.\n\n1. Go to Course Documents\n2. Select the course and section\n3. Click Upload Document\n4. Enter title, description, and attach file or URL\n5. Save\n\nTip: For large files use a Google Drive or Dropbox link instead of uploading directly.",
  },

  // ── Teacher Notes ─────────────────────────────────────────────────────────
  {
    keywords: ["teacher note", "sticky note", "class note", "my notes", "personal note", "remind myself", "internal note"],
    response:
      "📝 Teacher Notes (Sticky Notes)\n\nTeachers can write personal notes — visible only to them.\n\n1. Look for the sticky-note / notepad icon in your header bar\n2. Click to open your notes panel\n3. Add a note with a colour label and date\n4. Edit or delete notes at any time\n\nNotes are private — not shared with Admin or parents. Great for class reminders, lesson plans, or anything you need to remember.",
  },

  // ── User Management ───────────────────────────────────────────────────────
  {
    keywords: ["user management", "portal user", "create user", "add user", "teacher account", "generate pin", "portal access"],
    response:
      "🔑 User Management\n\nCreate portal login accounts for teachers and assistants.\n\n1. Click Add User\n2. Select from the existing staff dropdown (name & phone auto-fill) or enter manually\n3. Click Create & Generate PIN\n4. Copy the PIN immediately — it's shown only once!\n\nOther actions:\n• Reset PIN — generates a fresh PIN for the user\n• Activate / Deactivate — toggle portal access\n• Delete — permanently removes the account",
  },

  // ── Roles & Permissions ───────────────────────────────────────────────────
  {
    keywords: ["role", "permission", "access control", "rbac", "what can admin", "what can teacher", "who can access", "admin permission", "teacher permission"],
    response:
      "🛡️ Roles & Permissions\n\nAdmin / Super Admin — full access to all features\nTeacher — Courses & Classes, Attendance, Weekly Updates, Course Documents, Teacher Notes, Communication Hub, Settings, Help\nAssistant — Courses & Classes, Attendance, Course Documents, Settings, Help\n\nAdmins exclusively access:\n• Student registration & payments\n• Member management\n• Staff management\n• User management\n• Inventory\n• Announcements & Events\n• Messaging\n• Audit logs\n\nAssistants do NOT have access to:\n• Weekly Updates\n• Communication Hub\n\nFor the full permissions matrix, go to User Management → 'View Role Permissions Overview'.",
  },
  {
    keywords: ["what can i do", "what features", "my features", "what do i have access", "features available", "show my features", "my permissions"],
    response: "__ROLE_ACCESS__",
  },
  {
    keywords: ["courses classes", "my classes", "my sections", "assigned course", "teacher view", "my roster"],
    response:
      "📖 Courses & Classes (Teacher View)\n\nShows all sections you are assigned to with the enrolled student roster.\n\n• View students in each section\n• Quick links to Attendance and Course Documents\n• See section schedule and timing\n\nIf a section is missing, ask your Admin to update your assignment in Staff Management.",
  },

  // ── Members ───────────────────────────────────────────────────────────────
  {
    keywords: ["member management", "add member", "create member", "membership", "temple member", "member record", "member list"],
    response:
      "👨‍👩‍👧 Member Management\n\nEvery Gurukul student must be linked to a Temple Member record.\n\nTo add a new member:\n1. Go to Member Management\n2. Click Add Member\n3. Enter name, phone, email, and membership year\n4. Save — the member can now be linked when registering a student\n\nFrom the member's detail view you can also:\n• See all their enrolled children\n• Validate their identity (shield icon)\n• Renew their membership",
  },
  {
    keywords: ["validate member", "verify member", "member verification", "invalidate member", "member identity", "id check", "member badge", "overdue member", "validation badge", "verified badge"],
    response:
      "✅ Member Identity Validation\n\nAdmins can verify a member's identity in person:\n\n1. Click the shield icon on any member's row\n2. Choose the ID type (State ID, Driver's License, Passport)\n3. Enter last 4 digits of ID and issuing authority\n4. Set status to Validated or Invalidated and add notes\n5. Save — the badge updates immediately\n\nMembers registered for 90+ days without verification are flagged Overdue (orange badge). A banner at the top shows the count.\n\nThe Validated / Invalidated tiles on the Members page are clickable filters.",
  },

  // ── Settings & Curriculum Year ────────────────────────────────────────────
  {
    keywords: ["settings", "change password", "update password", "account settings"],
    response:
      "⚙️ Settings\n\nAdmins — change your login password under Settings → Account → Change Password.\nTeachers / Assistants — change your PIN under Settings → Account → Change PIN.\n\nIf you forget your credentials entirely, ask the Admin to reset them from User Management.",
  },
  {
    keywords: ["curriculum year", "academic year", "active year", "set year", "portal settings", "default fee", "fee amount", "portal configuration"],
    response:
      "📅 Curriculum Year & Portal Settings\n\nTo set the active year or default fees:\n1. Go to Settings → Portal tab\n2. Update 'Active Curriculum Year' (e.g. 2026-2027)\n3. Update default fee amounts if needed\n4. Save\n\nThe active year controls which students appear by default in student views. You can still filter to see any year.\n\nChanging the year does NOT auto-archive old students — use Bulk Actions → Mark Inactive to clean up.",
  },
  {
    keywords: ["new academic year", "year preparation", "start new year", "next year", "prepare year", "year end", "year transition", "year rollover"],
    response:
      "🗓️ Preparing for a New Academic Year\n\n1. Settings → Portal → Update 'Active Curriculum Year' to the new year\n2. Course Management → Review / add new levels and sections\n3. Students page → Bulk-select last year's students → Mark Inactive\n4. Register new students for the new year\n5. Staff Management → Update teacher assignments to new sections\n6. User Management → Create / reset PINs for new teachers\n7. Settings → Portal → Update fee amounts if needed",
  },

  // ── Audit Log ─────────────────────────────────────────────────────────────
  {
    keywords: ["audit log", "audit retention", "how long logs", "delete logs", "purge logs", "audit purge", "keep logs", "log history", "audit trail"],
    response:
      "🗂️ Audit Log Retention\n\nAll admin write actions (create, update, delete, login, PIN reset) are logged with timestamp, admin name, and before/after values.\n\nRetention is configured in Settings → System tab:\n• Default: 7 days\n• Maximum: 15 days (server enforced)\n• Quick presets: 7 Days (default) / 15 Days (max)\n\nAuto-purge runs at server startup and then every 6 hours.\n\nTo purge immediately: Go to the Audit Log page → Purge Now.\n\n⚠️ Purged logs are gone permanently. Export to CSV first if you need a permanent record.",
  },

  // ── Staff Schedule ────────────────────────────────────────────────────────
  {
    keywords: ["staff schedule", "teacher schedule", "class schedule", "schedule view", "schedule calendar", "print schedule", "course time table", "time table", "timetable", "who teaches what"],
    response:
      "📅 Staff Schedule View\n\nA Course × Time-slot table showing all teacher assignments at a glance.\n\nTo open it:\n1. Go to Staff Management\n2. Click the 'Staff Schedule' tab\n\nThe table shows:\n• Rows — each course (Hindi, Dharma, Sanskrit…)\n• Columns — each time slot (e.g. Sat 10:00 AM)\n• Cells — section name + assigned teacher\n\nHover any cell for full details. Use the day tabs (Mon–Sun) to filter to a specific day.\n\n🖨️ Print: Click the Print button (top-right) → use your browser's Print dialog.",
  },

  // ── Inventory ─────────────────────────────────────────────────────────────
  {
    keywords: ["inventory", "item", "stock", "asset", "track", "supplies", "equipment", "textbook"],
    response:
      "📦 Inventory\n\nTrack physical items — textbooks, stationery, classroom equipment.\n\n• Add items with name, quantity, and category\n• Update quantity as items are used or restocked (Replenish button)\n• Search by name or category\n\nUseful for tracking textbooks issued to students and managing classroom supplies.",
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  {
    keywords: ["notification", "parent notification", "notify parent", "alert parent", "send notification", "student notification"],
    response:
      "🔔 Parent Notifications\n\nThe Notifications panel lets admins create and manage notifications sent to parents.\n\n1. Go to Notifications\n2. Click New Notification\n3. Enter recipient, priority (High / Normal / Low), and message\n4. Send\n\nParents can view their notifications through the Parent Portal after verifying their phone number.",
  },

  // ── Messaging ─────────────────────────────────────────────────────────────
  {
    keywords: ["messaging", "email", "send email", "notify parents", "broadcast", "message center", "mass email"],
    response:
      "✉️ Messaging Centre\n\nSend email communications to parents and families.\n\n• Filter recipients by course, curriculum year, or employer\n• Send a broadcast to all enrolled families\n• View sent message history in your Inbox\n\nNote: SMTP must be configured in the server environment for emails to be delivered. Contact your Admin if emails aren't going out.",
  },

  // ── Testimonials ──────────────────────────────────────────────────────────
  {
    keywords: ["testimonial", "review", "parent feedback", "quote", "website quote"],
    response:
      "💬 Testimonials\n\nParent and student quotes displayed on the public website's homepage.\n\n1. Click Add Testimonial\n2. Enter name, relationship (Parent / Student), and their quote\n3. Set status to Published\n\nDraft testimonials are saved but hidden from the public website.",
  },

  // ── Parent Portal ─────────────────────────────────────────────────────────
  {
    keywords: ["parent portal", "what can parents see", "parents section", "public portal", "member verification", "parent access"],
    response:
      "🏠 Parent Portal\n\nParents visit the public website at /parents.\n\nTo access Weekly Class Updates they must:\n1. Solve a captcha\n2. Enter their registered temple membership phone number\n3. If found, they see all published updates for their children's courses\n\nParents can see:\n• Published weekly updates (class highlights, homework, reminders)\n• High Priority updates flagged with a 🔴 badge\n• Their parent notifications\n\nDraft updates are never visible to parents.",
  },

  // ── Support & Contact ─────────────────────────────────────────────────────
  {
    keywords: ["contact admin", "contact support", "help from admin", "ask admin", "support", "technical issue", "portal issue", "who to contact"],
    response:
      "📞 Need Help?\n\nFor portal issues (locked account, wrong assignment, missing section):\n• Contact your Gurukul Admin directly — they can reset PINs, fix assignments, and manage accounts from User Management\n\nFor general Gurukul inquiries:\n✉️ gurukul@bhtohio.org\n📍 Bhartiya Hindu Temple\n    3671 Hyatts Rd, Powell, OH 43065",
  },

  // ── Help Guide ────────────────────────────────────────────────────────────
  {
    keywords: ["help guide", "documentation", "manual", "where is documentation", "full guide"],
    response:
      "📋 Help & Guide\n\nThe complete portal guide is available by clicking Help & Guide — the last link in the sidebar.\n\nIt covers all features with:\n• Step-by-step instructions\n• Role-specific sections (Admin / Teacher / Assistant)\n• Tips and important notes\n• Searchable and filterable by role\n\nYou can also ask me any question directly here!",
  },

  // ── Narad Ji ──────────────────────────────────────────────────────────────
  {
    keywords: ["hello", "hi", "namaste", "hey", "good morning", "good afternoon", "help me", "how can", "what can you do"],
    response: "__GREETING__",
  },
  {
    keywords: ["narad", "who are you", "bot", "chatbot", "your name", "about you"],
    response:
      "🪗 Narayan Narayan!\n\nI am Narad Ji — the divine sage and celestial messenger, now dedicated to guiding the staff of Bhartiya Hindu Temple Gurukul Portal.\n\nI know every feature of this system and am here to answer your questions instantly.\n\nFor the full written guide, click Help & Guide in the sidebar.",
  },
];

// ─── Role-specific access summaries ──────────────────────────────────────────

const ROLE_ACCESS: Record<string, string> = {
  admin:
    "🛡️ Your Access — Admin\n\nAs an Admin you have full access to:\n• Dashboard & statistics\n• Student registration & payment management\n• Member management & identity validation\n• Course management (courses, levels, sections)\n• Staff management & teacher assignments\n• User management & PIN management\n• Attendance (all sections)\n• Weekly updates (all sections)\n• Course documents\n• Inventory management\n• Announcements & Events\n• Messaging & Notifications\n• Audit logs & Settings\n• Help & Guide\n\nUse Help & Guide in the sidebar for step-by-step instructions on any feature.",
  super_admin:
    "🛡️ Your Access — Super Admin\n\nAs Super Admin you have the highest level of access — everything an Admin can do, plus:\n• Change the Super Admin password (from Settings)\n• Override PIN for sensitive operations\n\nAll admin features are fully available to you.",
  teacher:
    "📖 Your Access — Teacher\n\nAs a Teacher you can access:\n• Courses & Classes — your enrolled student roster\n• Attendance — mark Present / Absent / Late for your sections\n• Weekly Updates — write and publish class updates for parents\n• Course Documents — upload worksheets and materials\n• Teacher Notes — private sticky notes for your own use\n• Settings — change your PIN and view account info\n• Help & Guide — full portal documentation\n\nFor anything outside this (payment records, member management, etc.) contact your Admin.",
  assistant:
    "📖 Your Access — Teaching Assistant\n\nAs a Teaching Assistant you can access:\n• Courses & Classes — your enrolled student roster\n• Attendance — mark Present / Absent / Late for your sections\n• Weekly Updates — write and publish class updates for parents\n• Course Documents — upload worksheets and materials\n• Teacher Notes — private sticky notes for your own use\n• Settings — change your PIN and view account info\n• Help & Guide — full portal documentation\n\nFor anything outside this contact your Admin.",
};

// ─── Role-specific quick replies ──────────────────────────────────────────────

const ADMIN_QUICK_REPLIES = [
  "How do I register a new student?",
  "How do I record a fee payment?",
  "How do I find students with overdue fees?",
  "How do I export the student list?",
  "How do I verify a member's identity?",
  "How do I add a teacher?",
  "How do I create a teacher portal login?",
  "How do I reset a teacher's PIN?",
  "How do I view the staff schedule?",
  "How do I set the curriculum year?",
  "How do I add an announcement?",
  "How do I send an email to parents?",
  "How do I archive a course?",
  "How do I link a student to a member?",
  "How do I prepare for a new academic year?",
  "What is the audit log?",
  "How do I do bulk student actions?",
  "How does the Parent Portal work?",
];

const TEACHER_QUICK_REPLIES = [
  "How do I take attendance?",
  "How do I mark a student late?",
  "How do I view attendance history?",
  "How do I publish a weekly update?",
  "What is a High Priority update?",
  "How do I view my students?",
  "How do I upload course documents?",
  "How do I write teacher notes?",
  "How do I change my PIN?",
  "What can I access as a teacher?",
  "How does the Parent Portal work?",
  "Who do I contact for help?",
];

const ASSISTANT_QUICK_REPLIES = [
  "How do I take attendance?",
  "How do I mark a student late?",
  "How do I view attendance history?",
  "How do I publish a weekly update?",
  "What is a High Priority update?",
  "How do I view my students?",
  "How do I upload course documents?",
  "How do I write teacher notes?",
  "How do I change my PIN?",
  "What can I access as an assistant?",
  "How does the Parent Portal work?",
  "Who do I contact for help?",
];

function getQuickReplies(role?: string | null): string[] {
  if (role === "teacher")   return TEACHER_QUICK_REPLIES;
  if (role === "assistant") return ASSISTANT_QUICK_REPLIES;
  return ADMIN_QUICK_REPLIES;
}

function getRoleLabel(role?: string | null): string {
  if (role === "super_admin") return "Super Admin Guide";
  if (role === "teacher")     return "Teacher Portal Guide";
  if (role === "assistant")   return "Assistant Portal Guide";
  return "Admin Portal Guide";
}

function getGreeting(role?: string | null, name?: string | null): string {
  const first = name ? name.split(" ")[0] : null;
  const salutation = first ? `Namaste, ${first}!` : "Namaste!";

  if (role === "teacher") {
    return `${salutation} 🙏 I'm Narad Ji — your Teacher Portal Guide.\n\nI can help you with:\n• Taking & reviewing attendance\n• Writing weekly updates for parents\n• Viewing your students & sections\n• Uploading course documents\n• Changing your PIN\n\nAsk me anything, or pick a question below!`;
  }
  if (role === "assistant") {
    return `${salutation} 🙏 I'm Narad Ji — your Teaching Assistant Portal Guide.\n\nI can help you with:\n• Taking & reviewing attendance\n• Writing weekly updates for parents\n• Viewing your students & sections\n• Uploading course documents\n• Changing your PIN\n\nAsk me anything, or pick a question below!`;
  }
  return `${salutation} 🙏 I'm Narad Ji — your Admin Portal Guide.\n\nI can help with:\n• Students & payments\n• Members & identity validation\n• Courses, staff & user management\n• Attendance & weekly updates\n• Announcements, events & messaging\n• Settings, audit logs & more\n\nAsk me anything, or pick a question below!`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildResponse(input: string, role?: string | null): string {
  const lower = input.toLowerCase();

  for (const entry of KB) {
    const isRoleAccess = entry.response === "__ROLE_ACCESS__";
    const isGreeting   = entry.response === "__GREETING__";
    if (!isRoleAccess && !isGreeting) continue;

    const score = entry.keywords.reduce(
      (acc, kw) => acc + (lower.includes(kw) ? kw.length : 0), 0
    );
    if (score > 0) {
      if (isGreeting)   return getGreeting(role);
      if (isRoleAccess) return ROLE_ACCESS[role ?? "admin"] ?? ROLE_ACCESS["admin"];
    }
  }

  let best: KBEntry | null = null;
  let bestScore = 0;
  for (const entry of KB) {
    if (entry.response === "__ROLE_ACCESS__" || entry.response === "__GREETING__") continue;
    const score = entry.keywords.reduce(
      (acc, kw) => acc + (lower.includes(kw) ? kw.length : 0), 0
    );
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return best ? best.response : DEFAULT_RESPONSE;
}

const DEFAULT_RESPONSE =
  "🤔 Narad Ji ponders…\n\nI don't have a specific answer for that yet, but I can help with:\n\n• Login & authentication\n• Student registration & payments\n• Course & class structure\n• Attendance & weekly updates\n• Staff & user management\n• Member validation\n• Parent Portal\n• Audit logs & settings\n\nTry rephrasing your question, or click Help & Guide in the sidebar!";

type Msg = { id: number; from: "user" | "bot"; text: string };
let msgId = 0;

// ─── Component ────────────────────────────────────────────────────────────────

export default function NaradJiBot() {
  const { user } = useAuth();
  const role = user?.role ?? null;
  const name = (user as { displayName?: string; name?: string } | null)?.displayName
    || (user as { displayName?: string; name?: string } | null)?.name
    || null;

  const [open, setOpen]             = useState(false);
  const [showBubble, setShowBubble] = useState(false);
  const [input, setInput]           = useState("");
  const [showQuickReplies, setShowQuickReplies] = useState(true);
  const [messages, setMessages]     = useState<Msg[]>(() => [
    { id: msgId++, from: "bot", text: getGreeting(role, name) },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  const quickReplies = getQuickReplies(role);
  const roleLabel    = getRoleLabel(role);

  // Auto-pop the speech bubble after 3 s, auto-hide after 5 s
  useEffect(() => {
    const showTimer = setTimeout(() => {
      setShowBubble(true);
      const hideTimer = setTimeout(() => setShowBubble(false), 5000);
      return () => clearTimeout(hideTimer);
    }, 3000);
    return () => clearTimeout(showTimer);
  }, []);

  useEffect(() => { if (open) setShowBubble(false); }, [open]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [messages, open]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: Msg = { id: msgId++, from: "user", text };
    const botMsg:  Msg = { id: msgId++, from: "bot",  text: buildResponse(text, role) };
    setMessages(prev => [...prev, userMsg, botMsg]);
    setInput("");
    setShowQuickReplies(false);
  }, [role]);

  const AVATAR = `${import.meta.env.BASE_URL}images/naradji-avatar.png`;

  return (
    <>
      {/* ── Chat panel ──────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed bottom-20 right-4 sm:right-6 z-50 w-[340px] sm:w-[390px] flex flex-col shadow-2xl rounded-2xl overflow-hidden border border-amber-200"
          style={{ maxHeight: "calc(100vh - 120px)" }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3 text-white shrink-0"
            style={{ background: "linear-gradient(135deg, #7b1f1f 0%, #a52929 100%)" }}
          >
            <div className="w-11 h-11 rounded-full bg-amber-100 overflow-hidden shadow-md shrink-0 border-2 border-amber-300">
              <img src={AVATAR} alt="Narad Ji" className="w-full h-full object-cover object-top" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm leading-tight">Narad Ji</p>
              <p className="text-white/70 text-xs">{roleLabel} • Always Here</p>
              {name && (
                <p className="text-white/50 text-[10px] truncate">Helping: {name}</p>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto p-4 space-y-3 bg-amber-50"
            style={{ minHeight: 240, maxHeight: 420 }}
          >
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"}`}>
                {msg.from === "bot" && (
                  <div className="w-8 h-8 rounded-full bg-amber-100 overflow-hidden shrink-0 mt-1 mr-2 shadow border border-amber-200">
                    <img src={AVATAR} alt="Narad Ji" className="w-full h-full object-cover object-top" />
                  </div>
                )}
                <div
                  className={`max-w-[82%] px-3 py-2 rounded-2xl text-sm whitespace-pre-line leading-relaxed shadow-sm ${
                    msg.from === "bot"
                      ? "bg-white text-gray-800 rounded-tl-none"
                      : "text-white rounded-tr-none"
                  }`}
                  style={msg.from === "user" ? { background: "#7b1f1f" } : {}}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {/* Initial quick replies — shown inline inside the message area */}
            {showQuickReplies && (
              <div className="pt-1">
                <p className="text-xs text-gray-500 mb-2 ml-10">Suggested questions for you:</p>
                <div className="flex flex-wrap gap-2 ml-10">
                  {quickReplies.slice(0, 8).map(qr => (
                    <button
                      key={qr}
                      onClick={() => sendMessage(qr)}
                      className="text-xs px-3 py-1.5 rounded-full border border-amber-400 text-amber-800 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
                    >
                      {qr}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Compact scrollable quick-reply strip — shown after first message */}
          {!showQuickReplies && (
            <div className="px-3 pt-2 pb-1 bg-amber-50 border-t border-amber-100 shrink-0">
              <p className="text-[10px] text-gray-400 mb-1.5">Quick questions:</p>
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {quickReplies.slice(0, 8).map(qr => (
                  <button
                    key={qr}
                    onClick={() => sendMessage(qr)}
                    className="text-xs px-2.5 py-1 rounded-full border border-amber-300 text-amber-800 bg-white hover:bg-amber-50 whitespace-nowrap transition-colors shrink-0"
                  >
                    {qr}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-3 py-3 bg-white border-t border-gray-100 flex gap-2 items-center shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMessage(input)}
              placeholder="Ask Narad Ji…"
              className="flex-1 text-sm px-3 py-2 rounded-full border border-gray-200 focus:outline-none focus:border-amber-400 bg-gray-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim()}
              className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-colors disabled:opacity-40"
              style={{ background: "#7b1f1f" }}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Auto-pop speech bubble ───────────────────────────────────── */}
      {showBubble && !open && (
        <div
          className="fixed bottom-24 right-4 sm:right-6 z-50 cursor-pointer"
          onClick={() => setOpen(true)}
        >
          <div className="bg-white border border-amber-200 rounded-2xl rounded-br-none shadow-lg px-4 py-2.5 max-w-[220px]">
            <p className="text-xs text-gray-700 font-medium leading-snug">
              {name ? `Namaste, ${name.split(" ")[0]}! 🙏` : "Namaste! 🙏"} Need help with the portal?
            </p>
          </div>
        </div>
      )}

      {/* ── Floating trigger button ──────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-20 right-4 sm:right-6 z-50 w-14 h-14 rounded-full shadow-2xl overflow-hidden border-2 border-amber-300 hover:scale-105 transition-transform"
        title="Ask Narad Ji"
      >
        <img src={AVATAR} alt="Narad Ji" className="w-full h-full object-cover object-top" />
      </button>
    </>
  );
}

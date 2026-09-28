export type UserRole =
  | "admin"
  | "course_coordinator"
  | "operations_manager"
  | "teacher"
  | "assistant";

export type Permission =
  | "dashboard"
  | "announcements"
  | "calendar"
  | "courses"
  | "courseManagement"
  | "teachers"
  | "students"
  | "members"
  | "inventory"
  | "settings"
  | "documents"
  | "attendance"
  | "roles"
  | "registration"
  | "testimonials"
  | "messaging"
  | "weeklyUpdates"
  | "help"
  | "audit"
  | "adminTasks";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  // Full access — manages all modules, users, and settings
  admin: [
    "dashboard", "announcements", "calendar", "courseManagement",
    "teachers", "students", "members", "inventory", "roles", "settings",
    "registration", "testimonials", "messaging", "help", "audit", "adminTasks",
  ],

  // Academic focus — courses, staff, inventory, communications, and classroom tools
  course_coordinator: [
    "courseManagement", "teachers", "inventory", "messaging", "calendar", "help",
    "courses", "attendance", "weeklyUpdates", "documents", "settings",
  ],

  // Operations focus — student/member data and registrations; no academic or administration modules
  operations_manager: [
    "dashboard", "registration", "students", "members", "help",
  ],

  // Teachers: classroom-level operations + weekly updates + messaging
  teacher:   ["courses", "attendance", "weeklyUpdates", "documents", "messaging", "settings", "help"],
  // Assistants: classroom support only — no weekly updates or communication hub
  assistant: ["courses", "attendance", "documents", "settings", "help"],
};

export function canAccess(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case "admin":              return "Gurukul Admin";
    case "course_coordinator": return "Course Coordinator";
    case "operations_manager": return "Operations Manager";
    case "teacher":            return "Teacher";
    case "assistant":          return "Assistant";
  }
}

export function getRoleBadgeColor(role: UserRole): string {
  switch (role) {
    case "admin":              return "bg-red-100 text-red-800";
    case "course_coordinator": return "bg-purple-100 text-purple-800";
    case "operations_manager": return "bg-orange-100 text-orange-800";
    case "teacher":            return "bg-blue-100 text-blue-800";
    case "assistant":          return "bg-green-100 text-green-800";
  }
}

export function getDefaultRoute(role: UserRole): string {
  switch (role) {
    case "admin":
    case "operations_manager": return "/admin/dashboard";
    case "course_coordinator": return "/admin/course-management";
    case "teacher":
    case "assistant":          return "/admin/attendance";
  }
}

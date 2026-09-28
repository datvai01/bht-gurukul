const BASE = "/api/admin";
const AUTH_KEY = "gurukul_admin_auth_v2";

function getAuthHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return {};
    const user = JSON.parse(raw) as { email?: string; phone?: string; role?: string; displayName?: string; name?: string };
    const headers: Record<string, string> = {};
    if (user.email)                              headers["X-User-Email"] = user.email;
    if (user.phone)                              headers["X-User-Phone"] = user.phone;
    if (user.role)                               headers["X-User-Role"]  = user.role;
    const name = user.displayName || user.name;
    if (name)                                    headers["X-User-Name"]  = name;
    return headers;
  } catch {
    return {};
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const authHeaders = getAuthHeaders();
  const headers: Record<string, string> = { ...authHeaders };
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error ?? `Request failed: ${res.status}`);
    Object.assign(error, { status: res.status });
    throw error;
  }
  return res.json();
}

export type CurrentRegistrationSummary = {
  id: number;
  studentCode: string;
  studentName: string;
  curriculumYear: string | null;
  registeredAt: string;
  dateSource: "recorded" | "first_enrollment";
  updatedAt: string;
  subjects: Array<{
    enrollmentId: number;
    courseId: number;
    courseName: string;
    courseLevelId: number;
    levelNumber: number;
    className: string;
    sectionId: number | null;
    sectionName: string | null;
    status: string;
  }>;
};

export type RegistrationBalance = {
  studentId: number;
  studentCode: string;
  memberId: number;
  curriculumYear: string;
  memberValidated: boolean;
  onlinePaymentEligible: boolean;
  items: Array<{
    kind: "course" | "membership";
    id: number;
    label: string;
    amountDue: number;
    amountPaid: number;
    balance: number;
    pendingReason: string | null;
  }>;
  total: number;
};

export type DuplicateStudentCheck = {
  student: { studentCode: string; name: string; dob: string | null; grade: string | null } | null;
  currentRegistration: CurrentRegistrationSummary | null;
};

export const adminApi = {
  teachers: {
    list:              () => request<unknown[]>("GET", "/teachers"),
    assistants:        () => request<{ id: number; name: string }[]>("GET", "/teachers/assistants"),
    create:            (data: unknown) => request("POST", "/teachers", data),
    update:            (id: number, data: unknown) => request("PUT", `/teachers/${id}`, data),
    resetPin:          (id: number) => request<{ pin: string }>("POST", `/teachers/${id}/reset-pin`),
    remove:            (id: number) => request("DELETE", `/teachers/${id}`),
    getCourseAssignments: (id: number) => request<number[]>("GET", `/teachers/${id}/course-assignments`),
    setCourseAssignments: (id: number, courseIds: number[]) => request("PUT", `/teachers/${id}/course-assignments`, { courseIds }),
  },
  students: {
    list:            () => request<unknown[]>("GET", "/students"),
    meta:            () => request<unknown>("GET", "/students/meta"),
    unlinkedCount:   () => request<{ unlinkedCount: number }>("GET", "/students/unlinked-count"),
    register: (data: {
      firstName: string; lastName: string;
      dob?: string; grade?: string; isNewStudent?: boolean;
      curriculumYear?: string; memberId?: number;
      primaryMemberRole?: "mother" | "father"; memberContextToken?: string;
      motherName?: string; motherPhone?: string; motherEmail?: string; motherEmployer?: string;
      fatherName?: string; fatherPhone?: string; fatherEmail?: string; fatherEmployer?: string;
      address: string; volunteerParent?: boolean; volunteerArea?: string;
      registrationSource?: "public" | "admin";
      membershipFeeDecision?: string;
      advanceMembershipRenewal?: boolean;
      policyAccepted?: boolean;
      studentCode?: string;
      enrollments: { courseLevelId: number; sectionId?: number | null; enrollDate?: string; amountDue?: string }[];
    }) => request<{ success: boolean; studentCode: string; studentId: number; isNewMember: boolean; balance: RegistrationBalance | null }>("POST", "/students", data),
    checkDuplicate: (data: { memberId: number; firstName: string; lastName: string; dob: string }) =>
      request<DuplicateStudentCheck>("POST", "/students/check-duplicate", data),
    paymentBalance: (studentCode: string, memberId: number) =>
      request<RegistrationBalance>("GET", `/students/${encodeURIComponent(studentCode)}/payment-balance?memberId=${memberId}`),
    chooseTempleDeskPayment: (studentCode: string, memberId: number) =>
      request<{ success: boolean; paymentStatus: string; balance: RegistrationBalance | null }>(
        "POST", `/students/${encodeURIComponent(studentCode)}/payment-choice`, { memberId, choice: "temple_desk" },
      ),
    update:        (code: string, data: unknown) => request("PATCH", `/students/${code}`, data),
    setSubjects:   (code: string, data: {
      subjects: { courseLevelId: number; sectionId: number | null }[];
      expectedEnrollments: { enrollmentId: number; courseLevelId: number; sectionId: number | null }[];
      reason: string;
    }) =>
      request<{ success: boolean }>("PATCH", `/students/${code}/subjects`, data),
    setStatus:     (code: string, isActive: boolean) => request("PATCH", `/students/${code}/status`, { isActive }),
    remove:        (code: string) => request("DELETE", `/students/${code}`),
    bulkSetStatus: (codes: string[], isActive: boolean) => request("PATCH", "/students/bulk/status", { codes, isActive }),
    bulkDelete:    (codes: string[]) => request("DELETE", "/students/bulk", { codes }),
    assignSection: (enrollmentId: number, sectionId: number | null) =>
      request("PATCH", `/students/enrollments/${enrollmentId}/section`, { sectionId }),
    updatePayment: (enrollmentId: number, data: {
      amountDue?:     number;
      amountPaid?:    number;
      paymentStatus?: "Paid" | "Pending" | "Overdue";
      paymentMethod?: string | null;
      receiptId?:     string | null;
      paymentDate?:   string | null;
    }) => request("PATCH", `/students/payments/${enrollmentId}`, data),
    duplicates: () => request<unknown[][]>("GET", "/students/duplicates"),
    merge:      (data: { canonicalCode: string; duplicateCodes: string[] }) =>
      request<{ success: boolean; merged: number }>("POST", "/students/merge", data),
    currentRegistration: (studentCode: string, memberId: number) =>
      request<CurrentRegistrationSummary>(
        "GET",
        `/students/${encodeURIComponent(studentCode)}/current-registration?memberId=${memberId}`,
      ),
    updateCurrentRegistration: (
      studentCode: string,
      memberId: number,
      data: {
        mode: "add" | "change";
        subjects: { courseLevelId: number; sectionId: number | null }[];
        expectedEnrollments: { enrollmentId: number; courseLevelId: number; sectionId: number | null }[];
      },
    ) => request<CurrentRegistrationSummary>(
      "PATCH",
      `/students/${encodeURIComponent(studentCode)}/current-registration?memberId=${memberId}`,
      { ...data, memberId },
    ),
  },
  members: {
    existingEmailHint: (data: { phone: string; identifier?: string }) =>
      request<{ maskedEmail: string }>("POST", "/members/existing-email-hint", data),
    requestEmailVerification: (data: { phone: string; email?: string; identifier?: string; memberType: "existing" | "new" }) =>
      request<{ success: true; maskedEmail: string }>("POST", "/members/email-verification/request", data),
    verifyEmailCode: (data: { phone: string; email?: string; identifier?: string; code: string; memberType: "existing" | "new" }) =>
      request<{ success: true; memberExists: boolean }>("POST", "/members/email-verification/verify", data),
    lookup: (phone: string, email?: string) => request<{ id: number; memberCode: string | null; memberContextToken: string; name: string | null; email: string | null; phone: string | null; employer: string | null; address: string | null; membershipYear: number | null; createdAt: string; validationStatus: string | null; memFeeStatus: string | null; memFeePaid: number; memFeeDue: number }>("POST", "/members/lookup", email ? { phone, email } : { phone }),
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<{
        data: Array<{ id: number; name: string | null; email: string | null; phone: string | null; isExistingMember: boolean; policyAgreed: boolean; membershipYear: number | null; createdAt: string; studentCount: number; isActive: boolean; expiringSoon: boolean; employer: string | null; memFeeStatus: string | null; memFeePaid: number; memFeeDue: number }>;
        total: number; page: number; limit: number;
        stats: { totalMembers: number; activeCount: number; expiredCount: number; withStudents: number; withoutStudents: number; addedThisMonth: number };
      }>("GET", `/members${qs}`);
    },
    getById: (id: number) => request<{
      id: number; name: string | null; email: string | null; phone: string | null;
      isExistingMember: boolean; policyAgreed: boolean; membershipYear: number | null; createdAt: string;
      address: string | null;
      validationStatus: string; validationDate: string | null;
      validatedByAdminName: string | null; idCardTypeSeen: string | null;
      idCardNumberLast4: string | null; idCardIssuingAuthority: string | null; validationNotes: string | null;
      memFeeStatus: string | null; memFeePaid: number; memFeeDue: number;
      students: Array<{ id: number; studentCode: string; name: string; dob: string | null; grade: string | null; isActive: boolean }>;
    }>("GET", `/members/${id}`),
    studentsByMember: (memberId: number) => request<Array<{
      id: number; studentCode: string; name: string;
      dob: string | null; grade: string | null; curriculumYear: string | null;
      motherName: string | null; motherPhone: string | null; motherEmail: string | null; motherEmployer: string | null;
      fatherName: string | null; fatherPhone: string | null; fatherEmail: string | null; fatherEmployer: string | null;
      address: string | null; volunteerParent: boolean | null; volunteerArea: string | null;
    }>>("GET", `/members/${memberId}/students`),
    create: (data: { firstName: string; lastName: string; phone?: string | null; email?: string | null; employer?: string | null; address?: string; isExistingMember?: boolean; policyAgreed?: boolean; membershipYear?: number | null; memberType?: "new" }) =>
      request<{ id: number; memberCode: string | null; memberContextToken: string; isExistingMember: boolean; firstName: string | null; lastName: string | null; name: string | null; email: string | null; phone: string | null; employer: string | null; address: string | null; createdAt: string }>("POST", "/members", data),
    fullUpdate: (id: number, data: { firstName: string; lastName: string; email?: string | null; phone?: string | null; isExistingMember?: boolean; policyAgreed?: boolean; membershipYear?: number | null; address?: string | null }) =>
      request("PUT", `/members/${id}`, data),
    patch: (id: number, data: unknown) => request("PATCH", `/members/${id}`, data),
    renew: (id: number, paymentData?: {
      amountDue?:    number;
      amountPaid?:   number;
      paymentStatus?: "Paid" | "Pending" | "Overdue";
      paymentMethod?: string;
      receiptId?:     string;
      paymentDate?:   string;
      notes?:         string;
    }) => request<{ id: number; createdAt: string; membershipYear: number | null }>("PATCH", `/members/${id}/renew`, paymentData ?? {}),
    getMembershipPayment: (id: number) => request<{
      id: number; memberId: number; membershipYear: number;
      amountDue: string; amountPaid: string;
      paymentStatus: "Paid" | "Pending" | "Overdue";
      paymentMethod: string | null; receiptId: string | null;
      paymentDate: string | null; notes: string | null;
    } | null>("GET", `/members/${id}/membership-payment`),
    upsertMembershipPayment: (id: number, data: {
      membershipYear?: number;
      amountDue?:      number;
      amountPaid?:     number;
      paymentStatus?:  "Paid" | "Pending" | "Overdue";
      paymentMethod?:  string | null;
      receiptId?:      string | null;
      paymentDate?:    string | null;
      notes?:          string | null;
    }) => request("POST", `/members/${id}/membership-payment`, data),
    validate: (id: number, data: {
      idCardTypeSeen: string;
      idCardNumberLast4?: string;
      idCardIssuingAuthority?: string;
      validationNotes?: string;
    }) => request("PATCH", `/members/${id}/validate`, data),
    remove: (id: number) => request("DELETE", `/members/${id}`),
  },
  backfill: {
    linkMembers: () => request<{ created: number; linked: number; reusedExisting: number; totalStudentsFixed: number }>("POST", "/backfill/members", {}),
  },
  inventory: {
    list:       () => request<unknown[]>("GET", "/inventory"),
    create:     (data: unknown) => request("POST", "/inventory", data),
    update:     (id: number, data: unknown) => request("PUT", `/inventory/${id}`, data),
    replenish:  (id: number, quantity: number) => request("PATCH", `/inventory/${id}/replenish`, { quantity }),
    remove:     (id: number) => request("DELETE", `/inventory/${id}`),
  },
  announcements: {
    list:   () => request<unknown[]>("GET", "/announcements"),
    create: (data: unknown) => request("POST", "/announcements", data),
    update: (id: number, data: unknown) => request("PUT", `/announcements/${id}`, data),
    toggle: (id: number) => request("PATCH", `/announcements/${id}/toggle`),
    remove: (id: number) => request("DELETE", `/announcements/${id}`),
  },
  events: {
    list:   () => request<unknown[]>("GET", "/events"),
    create: (data: unknown) => request("POST", "/events", data),
    update: (id: number, data: unknown) => request("PUT", `/events/${id}`, data),
    remove: (id: number) => request("DELETE", `/events/${id}`),
  },
  courses: {
    list:            (includeArchived = false) => request<unknown[]>("GET", `/courses${includeArchived ? "?includeArchived=true" : ""}`),
    create:          (data: unknown) => request("POST", "/courses", data),
    update:          (id: number, data: unknown) => request("PUT", `/courses/${id}`, data),
    archive:         (id: number) => request("PATCH", `/courses/${id}/archive`),
    remove:          (id: number) => request("DELETE", `/courses/${id}`),
    addLevel:        (courseId: number, data: unknown) => request("POST", `/courses/${courseId}/levels`, data),
    updateLevel:     (levelId: number, data: unknown) => request("PUT", `/courses/levels/${levelId}`, data),
    deleteLevel:     (levelId: number) => request("DELETE", `/courses/levels/${levelId}`),
    levelStudents:   (levelId: number, sectionId?: number | null) => request<unknown[]>("GET", `/courses/levels/${levelId}/students${sectionId ? `?sectionId=${sectionId}` : ""}`),
    levelSections:   (levelId: number) => request<unknown[]>("GET", `/courses/levels/${levelId}/sections`),
    addSection:      (levelId: number, data: unknown) => request("POST", `/courses/levels/${levelId}/sections`, data),
    updateSection:   (sectionId: number, data: unknown) => request("PUT", `/courses/sections/${sectionId}`, data),
    deleteSection:   (sectionId: number) => request("DELETE", `/courses/sections/${sectionId}`),
    assignSection:   (sectionId: number, data: unknown) => request("POST", `/courses/sections/${sectionId}/assign`, data),
    unassignSection: (sectionId: number, teacherId: number) => request("DELETE", `/courses/sections/${sectionId}/unassign/${teacherId}`),
    // For attendance dropdown — all levels with course name
    levels:          () => request<unknown[]>("GET", "/attendance/levels"),
  },
  attendance: {
    get:     (levelId: number, date: string) => request<unknown[]>("GET", `/attendance?levelId=${levelId}&date=${encodeURIComponent(date)}`),
    history: (levelId: number) => request<unknown[]>("GET", `/attendance/history?levelId=${levelId}`),
    summary: () => request<{ date: string; total: number; present: number; pct: number }[]>("GET", "/attendance/summary"),
    save:    (data: unknown) => request("POST", "/attendance", data),
  },
  testimonials: {
    list:   () => request<unknown[]>("GET", "/testimonials"),
    create: (data: unknown) => request<{ id: number }>("POST", "/testimonials", data),
    update: (id: number, data: unknown) => request("PUT", `/testimonials/${id}`, data),
    remove: (id: number) => request("DELETE", `/testimonials/${id}`),
  },
  notifications: {
    list:         () => request<unknown[]>("GET", "/notifications"),
    create:       (data: unknown) => request("POST", "/notifications", data),
    updateStatus: (id: number, status: string) => request("PATCH", `/notifications/${id}/status`, { status }),
  },
  weeklyUpdates: {
    list:       () => request<unknown[]>("GET", "/weekly-updates"),
    formMeta:   () => request<unknown>("GET", "/weekly-updates/form-meta"),
    create:     (data: unknown) => request("POST", "/weekly-updates", data),
    update:     (id: number, data: unknown) => request("PUT", `/weekly-updates/${id}`, data),
    publish:    (id: number) => request("PATCH", `/weekly-updates/${id}/publish`, {}),
    remove:     (id: number) => request("DELETE", `/weekly-updates/${id}`),
  },
  teacherNotes: {
    list:   () => request<unknown[]>("GET", "/teacher-notes"),
    create: (data: { content: string; date: string; color: string }) => request("POST", "/teacher-notes", data),
    update: (id: number, data: { content?: string; color?: string }) => request("PUT", `/teacher-notes/${id}`, data),
    remove: (id: number) => request("DELETE", `/teacher-notes/${id}`),
  },
  adminUsers: {
    list:             () => request<unknown[]>("GET", "/admin-users"),
    create:           (data: unknown) => request<unknown>("POST", "/admin-users", data),
    update:           (id: number, data: unknown) => request("PUT", `/admin-users/${id}`, data),
    resetPin:         (id: number, data?: unknown) => request("PATCH", `/admin-users/${id}/reset-pin`, data ?? {}),
    setStatus:        (id: number, status: string) => request("PATCH", `/admin-users/${id}/status`, { status }),
    remove:           (id: number) => request("DELETE", `/admin-users/${id}`),
    changeSuperAdminPassword: (overridePin: string, newPassword: string) =>
      request("POST", "/admin-users/super-admin/change-password", { overridePin, newPassword }),
  },
  settings: {
    getAll:  () => request<Record<string, string>>("GET", "/settings"),
    saveAll: (settings: Record<string, string>) => request("PUT", "/settings", { settings }),
    addCurriculumYear: (kind: "active" | "registration", year: string) =>
      request<{ success: boolean; list: string[] }>("POST", "/settings/add-year", { kind, year }),
  },
  audit: {
    list: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return request<{
        data: Array<{
          id: number; adminName: string; userRole: string | null;
          moduleName: string; actionType: string;
          entityName: string; entityId: string | null;
          previousValue: string | null; newValue: string | null;
          curriculumYear: string | null;
          ipAddress: string | null; userAgent: string | null; createdAt: string;
        }>;
        total: number; page: number; limit: number; retentionDays: number;
      }>("GET", `/audit${qs}`);
    },
    users:    () => request<string[]>("GET", "/audit/users"),
    activity: () => request<{
      modules: string[];
      days: Array<Record<string, string | number>>;
    }>("GET", "/audit/activity"),
    purge: () => request<{ success: boolean; deleted: number; retentionDays: number }>("POST", "/audit/purge"),
    exportUrl: (params?: Record<string, string>) => {
      const qs = params ? "?" + new URLSearchParams(params).toString() : "";
      return `/api/admin/audit/export${qs}`;
    },
  },
  dashboard: {
    stats: () => request<{
      enrollmentTrend: { month: string; label: string; count: number }[];
      paymentMonthly:  { month: string; label: string; gurukul: number; membership: number }[];
      curriculumYear?: string;
    }>("GET", "/dashboard/stats"),
  },
  tasks: {
    list:         () => request<unknown[]>("GET", "/tasks"),
    create:       (data: unknown) => request<unknown>("POST", "/tasks", data),
    update:       (id: number, data: unknown) => request<unknown>("PUT", `/tasks/${id}`, data),
    setStatus:    (id: number, status: string) => request<unknown>("PATCH", `/tasks/${id}/status`, { status }),
    remove:       (id: number) => request("DELETE", `/tasks/${id}`),
  },
  messaging: {
    recipients: (params: { course?: string; curricYear?: string; employer?: string }) => {
      const qs = new URLSearchParams();
      if (params.course)     qs.set("course",     params.course);
      if (params.curricYear) qs.set("curricYear",  params.curricYear);
      if (params.employer)   qs.set("employer",    params.employer);
      return request<unknown[]>("GET", `/messaging/recipients?${qs}`);
    },
    employers:     () => request<string[]>("GET", "/messaging/employers"),
    send:          (data: unknown) => request("POST", "/messaging/send", data),
    messages:      () => request<unknown[]>("GET", "/messaging/messages"),
    teacherInbox:  () => request<unknown[]>("GET", "/messaging/teacher-inbox"),
    inbox:         () => request<unknown[]>("GET", "/messaging/inbox"),
    markRead:      (id: number) => request("PATCH", `/messaging/inbox/${id}/read`, {}),
    deleteMessage: (id: number) => request("DELETE", `/messaging/inbox/${id}`),
    deleteLog:     (id: number) => request("DELETE", `/messaging/messages/${id}`),
    dailyStats:    () => request<{ sentToday: number; limit: number; totalMessages: number; totalLimit: number }>("GET", "/messaging/daily-stats"),
  },
};

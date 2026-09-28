import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { adminApi } from "@/lib/adminApi";
import { membershipExpiryLabel, membershipStatus } from "@/lib/membership";
import {
  AddressFields, EMPTY_ADDRESS, formatAddressParts, isCompleteAddress, parseAddress, validateAddressParts,
  type AddressErrors, type AddressParts,
} from "@/components/registration/AddressFields";
import { usePortalSettings } from "../contexts/PortalSettingsContext";
import {
  Search, Download, ChevronUp, ChevronDown, Filter, Loader2,
  X, Plus, Trash2, UserPlus, BookOpen, GraduationCap, Users,
  Pencil, ChevronLeft, ChevronRight, UserX, UserCheck, AlertTriangle,
  Phone, Mail, CreditCard, Receipt, GitMerge,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "../AuthContext";
import { canAccess } from "../rbac";

// ─── Types ────────────────────────────────────────────────────────────────────

type Enrollment = {
  enrollmentId: number | null;
  courseId: number | null;
  courseLevelId: number | null;
  sectionId: number | null;
  paymentId: number | null;
  course: string;
  courseIcon: string;
  level: string;
  levelNum: number;
  section: string;
  timing: string;
  enrollDate: string;
  enrollStatus: string;
  paymentStatus: "Paid" | "Pending" | "Overdue";
  pendingReason: string | null;
  amountDue: number;
  amountPaid: number;
  paymentMethod: string;
  receiptId: string;
};

type Student = {
  id: string;
  studentDbId: number;
  name: string;
  dob: string;
  grade: string;
  curriculumYear: string;
  isNewStudent: boolean;
  isActive: boolean;
  // Temple membership
  memberId: number | null;
  memberName: string | null;
  memberPhone: string | null;
  memberEmail: string | null;
  memFeeStatus: string | null;
  // Parent contacts
  motherName: string;
  motherPhone: string;
  motherEmail: string;
  fatherName: string;
  fatherPhone: string;
  fatherEmail: string;
  address: string;
  enrollments: Enrollment[];
  // aggregated helpers
  courses: string[];
  primaryCourse: string;
  primaryLevel: string;
  primarySection: string;
  totalPaid: number;
  totalDue: number;
  worstPayStatus: "Paid" | "Pending" | "Overdue";
  parentPhone: string;
};

type RawRow = Record<string, unknown>;

const PAGE_SIZE = 100;

const PAYMENT_RANK: Record<string, number> = { Overdue: 3, Pending: 2, Paid: 1 };
const isHistoricalEnrollment = (enrollment: Enrollment) =>
  ["withdrawn", "completed"].includes(enrollment.enrollStatus.trim().toLowerCase());
const currentEnrollments = (student: Student) =>
  student.enrollments.filter(e => !isHistoricalEnrollment(e));

type DupGroup = {
  studentCode:    string;
  studentId:      number;
  name:           string;
  grade:          string | null;
  memberId:       number | null;
  memberName:     string | null;
  curriculumYear: string | null;
  enrollCount:    number;
};

function DuplicatesModal({
  groups, loading, mergingGroup, onMerge, onClose,
}: {
  groups: DupGroup[][];
  loading: boolean;
  mergingGroup: string | null;
  onMerge: (canonicalCode: string, duplicateCodes: string[]) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 border border-border flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div>
            <h3 className="text-base font-bold text-secondary">Duplicate Student Records</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading ? "Scanning…" : groups.length === 0
                ? "No duplicates found — all student profiles are unique."
                : `${groups.length} duplicate group${groups.length !== 1 ? "s" : ""} detected`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}
          {!loading && groups.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <GraduationCap className="w-10 h-10 mx-auto mb-3 opacity-30" />
              No duplicate student profiles detected.
            </div>
          )}
          {groups.map((group, gi) => {
            const canonical = group[0];
            const dupCodes = group.slice(1).map(d => d.studentCode);
            const isMerging = mergingGroup === canonical.studentCode;
            return (
              <div key={gi} className="border border-amber-200 bg-amber-50 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-secondary text-sm">{canonical.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {canonical.grade && <span className="mr-3">{canonical.grade}</span>}
                      {canonical.memberName && <span>Member: {canonical.memberName}</span>}
                    </div>
                    <div className="mt-2 space-y-1">
                      {group.map((s, si) => (
                        <div key={s.studentCode} className="flex items-center gap-2 text-xs flex-wrap">
                          <span className={`font-mono px-1.5 py-0.5 rounded text-[11px] font-medium ${si === 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                            {s.studentCode}
                          </span>
                          <span className="text-muted-foreground">{s.curriculumYear ?? "—"}</span>
                          <span className="text-muted-foreground">{s.enrollCount} course{s.enrollCount !== 1 ? "s" : ""}</span>
                          {si === 0 && <span className="text-green-700 font-medium">← keep this record</span>}
                          {si > 0  && <span className="text-red-600">← merge into {canonical.studentCode}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => onMerge(canonical.studentCode, dupCodes)}
                    disabled={isMerging}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    {isMerging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                    {isMerging ? "Merging…" : "Merge"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="p-4 border-t border-border flex justify-end shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

function groupRows(raw: RawRow[]): Student[] {
  const map = new Map<string, Student>();
  for (const r of raw) {
    const code = r.id as string;
    if (!map.has(code)) {
      map.set(code, {
        id: code,
        studentDbId: r.studentDbId as number,
        name: r.name as string,
        dob: r.dob as string ?? "",
        grade: r.grade as string ?? "",
        curriculumYear: r.curriculumYear as string ?? "",
        isNewStudent: r.isNewStudent as boolean ?? true,
        isActive: r.isActive as boolean ?? true,
        memberId: r.memberId as number | null ?? null,
        memberName: r.memberName as string | null ?? null,
        memberPhone: r.memberPhone as string | null ?? null,
        memberEmail: r.memberEmail as string | null ?? null,
        memFeeStatus: r.memFeeStatus as string | null ?? null,
        motherName: r.motherName as string ?? "",
        motherPhone: r.motherPhone as string ?? "",
        motherEmail: r.motherEmail as string ?? "",
        fatherName: r.fatherName as string ?? "",
        fatherPhone: r.fatherPhone as string ?? "",
        fatherEmail: r.fatherEmail as string ?? "",
        address: r.address as string ?? "",
        enrollments: [],
        courses: [],
        primaryCourse: "",
        primaryLevel: "",
        primarySection: "",
        totalPaid: 0,
        totalDue: 0,
        worstPayStatus: "Paid",
        parentPhone: "",
      });
    }
    const s = map.get(code)!;
    if (r.enrollmentId) {
      const enr: Enrollment = {
        enrollmentId:  r.enrollmentId as number,
        courseId:      r.courseId as number | null ?? null,
        courseLevelId: r.courseLevelId as number | null ?? null,
        sectionId:     r.sectionId as number | null ?? null,
        paymentId:     r.paymentId as number | null ?? null,
        course:        r.course as string ?? "",
        courseIcon:    r.courseIcon as string ?? "",
        level:         r.level as string ?? "",
        levelNum:      r.levelNum as number ?? 0,
        section:       r.section as string ?? "",
        timing:        r.timing as string ?? "",
        enrollDate:    r.enrollDate as string ?? "",
        enrollStatus:  r.enrollStatus as string ?? "Enrolled",
        paymentStatus: r.paymentStatus as "Paid"|"Pending"|"Overdue" ?? "Pending",
        pendingReason: r.pendingReason as string | null ?? null,
        amountDue:     r.amountDue as number ?? 0,
        amountPaid:    r.amountPaid as number ?? 0,
        paymentMethod: r.paymentMethod as string ?? "-",
        receiptId:     r.receiptId as string ?? "-",
      };
      s.enrollments.push(enr);
    }
  }

  // compute aggregated fields
  for (const s of map.values()) {
    const current = currentEnrollments(s);
    const financial = s.enrollments;
    s.courses = [...new Set(current.map(e => e.course).filter(Boolean))];
    s.primaryCourse  = current[0]?.course ?? "";
    s.primaryLevel   = current[0]?.level ?? "";
    s.primarySection = current[0]?.section ?? "";
    s.totalPaid = financial.reduce((a, e) => a + e.amountPaid, 0);
    s.totalDue  = financial.reduce((a, e) => a + e.amountDue, 0);
    let worst = 1;
    for (const e of financial) {
      const paymentRank = PAYMENT_RANK[e.paymentStatus] ?? 1;
      const liabilityRank = e.amountDue > e.amountPaid && paymentRank < PAYMENT_RANK.Pending
        ? PAYMENT_RANK.Pending
        : paymentRank;
      worst = Math.max(worst, liabilityRank);
    }
    s.worstPayStatus = worst === 3 ? "Overdue" : worst === 2 ? "Pending" : "Paid";
    s.parentPhone = s.motherPhone || s.fatherPhone;
  }

  return Array.from(map.values());
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  title, message, confirmLabel, danger, onConfirm, onCancel, loading,
}: {
  title: string; message: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4 border border-border">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-4 ${danger ? "bg-red-100" : "bg-amber-100"}`}>
          <AlertTriangle className={`w-5 h-5 ${danger ? "text-red-600" : "text-amber-600"}`} />
        </div>
        <h3 className="text-base font-bold text-secondary mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            className={danger ? "bg-red-600 hover:bg-red-700 text-white" : ""}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Student Panel ────────────────────────────────────────────────────────

type SubjectDraft = {
  key: number;
  courseId: number | "";
  courseLevelId: number | "";
  sectionId: number | "" | null;
  original?: Enrollment;
};

function RegisteredSubjectsEditor({ student, onSaved }: { student: Student; onSaved: () => void }) {
  const { user } = useAuth();
  const { courseFee } = usePortalSettings();
  const canManageSubjects = user?.role === "admin";
  const enrolledRows = student.enrollments.filter(e => e.enrollStatus.trim().toLowerCase() === "enrolled");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState("");
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  // Every post-registration subject change records who made it, when, and why.
  const [changeReason, setChangeReason] = useState("");
  const [nextKey, setNextKey] = useState(enrolledRows.length);
  const [rows, setRows] = useState<SubjectDraft[]>(() => enrolledRows.map((e, key) => ({
    key,
    courseId: e.courseId ?? "",
    courseLevelId: e.courseLevelId ?? "",
    sectionId: e.sectionId,
    original: e,
  })));
  const inputCls = "w-full text-xs border border-border rounded-lg px-2.5 py-2 focus:outline-none focus:border-primary bg-white";

  useEffect(() => {
    let cancelled = false;
    setMetaError("");
    adminApi.students.meta()
      .then(data => {
        if (!cancelled) setMeta(data as Meta);
      })
      .catch(err => {
        if (!cancelled) setMetaError(err instanceof Error ? err.message : "Failed to load course catalog.");
      });
    return () => { cancelled = true; };
  }, [retry]);

  const courses = meta?.courses ?? [];
  const fieldErrors = rows.map(row => {
    const course = courses.find(c => c.id === row.courseId);
    const level = course?.levels.find(l => l.id === row.courseLevelId);
    const errors: { course: string; level: string; section: string } = { course: "", level: "", section: "" };
    if (!row.courseId) errors.course = "Select a course.";
    else if (!course) errors.course = "This existing course is unavailable. Choose a current course or remove this subject.";
    if (!row.courseLevelId) errors.level = "Select a level.";
    else if (!level) errors.level = "This level is unavailable for the selected course.";
    else if (student.enrollments.some(enrollment =>
      enrollment.enrollStatus.trim().toLowerCase() === "completed" &&
      enrollment.courseLevelId === row.courseLevelId
    )) errors.level = "A completed course enrollment cannot be re-added.";
    if (row.sectionId && !level?.sections.some(s => s.id === row.sectionId)) {
      errors.section = "This section is unavailable. Choose another section or no section.";
    }
    return errors;
  });
  rows.forEach((row, index) => {
    if (!row.courseId) return;
    const duplicateIndexes = rows.flatMap((other, otherIndex) => other.courseId === row.courseId ? [otherIndex] : []);
    if (duplicateIndexes.length > 1) {
      fieldErrors[index].course = "A student can register for only one level per course.";
      duplicateIndexes.forEach(duplicateIndex => {
        fieldErrors[duplicateIndex].course = "A student can register for only one level per course.";
      });
    }
  });
  const hasValidationErrors = fieldErrors.some(errors => errors.course || errors.level || errors.section);
  const missingExpectedEnrollment = enrolledRows.some(e => e.enrollmentId == null || e.courseLevelId == null);
  const chargeSubjects: { courseLevelId: number; courseName: string; levelName: string; fee: number }[] = [];
  const reusedPaymentSubjects: { courseName: string; levelName: string }[] = [];
  const estimatedLevels = new Set<number>();
  rows.forEach((row, index) => {
    if (fieldErrors[index].course || fieldErrors[index].level || fieldErrors[index].section) return;
    if (typeof row.courseId !== "number" || typeof row.courseLevelId !== "number" || estimatedLevels.has(row.courseLevelId)) return;
    const course = courses.find(candidate => candidate.id === row.courseId);
    const level = course?.levels.find(candidate => candidate.id === row.courseLevelId);
    if (!course || !level) return;
    estimatedLevels.add(row.courseLevelId);
    if (enrolledRows.some(enrollment => enrollment.courseLevelId === row.courseLevelId)) return;
    const withdrawnWithPayment = student.enrollments.some(enrollment =>
      enrollment.enrollStatus.trim().toLowerCase() === "withdrawn" &&
      enrollment.courseLevelId === row.courseLevelId &&
      enrollment.paymentId != null
    );
    if (withdrawnWithPayment) {
      reusedPaymentSubjects.push({ courseName: course.name, levelName: level.className || `Level ${level.levelNumber}` });
      return;
    }
    chargeSubjects.push({
      courseLevelId: level.id,
      courseName: course.name,
      levelName: level.className || `Level ${level.levelNumber}`,
      fee: course.fee ?? courseFee,
    });
  });
  const feeTotal = chargeSubjects.reduce((total, subject) => total + subject.fee, 0);

  function updateRow(key: number, patch: Partial<SubjectDraft>) {
    setSaveError("");
    setRows(previous => previous.map(row => {
      if (row.key !== key) return row;
      const updated = { ...row, ...patch };
      if (patch.courseId !== undefined) {
        updated.courseLevelId = "";
        updated.sectionId = null;
      } else if (patch.courseLevelId !== undefined) {
        updated.sectionId = null;
      }
      return updated;
    }));
  }

  async function saveSubjects() {
    if (!canManageSubjects || !meta || hasValidationErrors || missingExpectedEnrollment || saving) return;
    if (!changeReason.trim()) {
      setSaveError("Enter the reason for this subject change before saving.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await adminApi.students.setSubjects(student.id, {
        subjects: rows.map(row => ({
          courseLevelId: Number(row.courseLevelId),
          sectionId: row.sectionId == null || row.sectionId === "" ? null : Number(row.sectionId),
        })),
        expectedEnrollments: enrolledRows.map(row => ({
          enrollmentId: row.enrollmentId as number,
          courseLevelId: row.courseLevelId as number,
          sectionId: row.sectionId,
        })),
        reason: changeReason.trim(),
      });
      setChangeReason("");
      toast.success("Registered subjects updated");
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save registered subjects.");
    } finally {
      setSaving(false);
    }
  }

  const currentRows = currentEnrollments(student);
  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3" data-testid="section-registered-subjects">
      <div className="border-b border-blue-200 pb-2">
        <p className="text-xs font-bold text-secondary uppercase tracking-wide">Registered Subjects</p>
        <p className="text-[11px] text-muted-foreground mt-1">
          {canManageSubjects ? "Manage current enrolled course, level, and section assignments." : "Current registered subjects (read-only)."}
        </p>
      </div>

      {!canManageSubjects ? (
        currentRows.length === 0
          ? <p className="text-xs text-muted-foreground" data-testid="text-no-current-subjects">No current registered subjects.</p>
          : <div className="space-y-2">
              {currentRows.map(e => (
                <div key={e.enrollmentId ?? `${e.course}-${e.level}`} className="text-xs bg-white rounded-lg px-3 py-2 border border-border" data-testid={`text-current-subject-${e.enrollmentId ?? e.course}`}>
                  <span className="font-semibold text-secondary">{e.courseIcon} {e.course}</span>
                  <span className="text-muted-foreground ml-2">{e.level}{e.section ? ` · ${e.section}` : ""}</span>
                </div>
              ))}
            </div>
      ) : (
        <>
          {metaError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700" role="alert" data-testid="status-subjects-load-error">
              <p>{metaError}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setRetry(value => value + 1)} data-testid="button-retry-subjects-meta">Retry loading courses</Button>
            </div>
          )}
          {!meta && !metaError && <p className="text-xs text-muted-foreground flex items-center gap-2" data-testid="status-subjects-loading"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading course catalog…</p>}
          {meta && (
            <>
              {rows.length === 0 && <p className="text-xs text-muted-foreground" data-testid="text-no-enrolled-subjects">No currently enrolled subjects.</p>}
              <div className="space-y-3">
                {rows.map((row, index) => {
                  const selectedCourse = courses.find(course => course.id === row.courseId);
                  const selectedLevel = selectedCourse?.levels.find(level => level.id === row.courseLevelId);
                  const original = row.original;
                  const unavailableExisting = !!original && (!!fieldErrors[index].course || !!fieldErrors[index].level || !!fieldErrors[index].section);
                  return (
                    <div key={row.key} className="rounded-lg border border-border bg-white p-3 space-y-2.5" data-testid={`row-subject-${row.key}`}>
                      {unavailableExisting && <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1" data-testid={`status-subject-unavailable-${row.key}`}>Existing assignment unavailable in the course catalog: {original.course} · {original.level}{original.section ? ` · ${original.section}` : ""}. Replace it or remove it.</p>}
                      <div className="grid grid-cols-1 gap-2">
                        <div>
                          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Course</label>
                          <select className={inputCls} value={row.courseId} onChange={event => updateRow(row.key, { courseId: event.target.value ? Number(event.target.value) : "" })} data-testid={`select-subject-course-${row.key}`}>
                            <option value="">— Select course —</option>
                            {row.courseId && !selectedCourse && <option value={row.courseId}>Unavailable: {original?.course || `Course ${row.courseId}`}</option>}
                            {courses.map(course => <option key={course.id} value={course.id}>{course.icon} {course.name}</option>)}
                          </select>
                          {fieldErrors[index].course && <p className="text-[10px] text-red-600 mt-1" data-testid={`error-subject-course-${row.key}`}>{fieldErrors[index].course}</p>}
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Level</label>
                          <select className={inputCls} value={row.courseLevelId} onChange={event => updateRow(row.key, { courseLevelId: event.target.value ? Number(event.target.value) : "" })} data-testid={`select-subject-level-${row.key}`}>
                            <option value="">— Select level —</option>
                            {row.courseLevelId && !selectedLevel && <option value={row.courseLevelId}>Unavailable: {original?.level || `Level ${row.courseLevelId}`}</option>}
                            {selectedCourse?.levels.map(level => <option key={level.id} value={level.id}>Level {level.levelNumber}{level.className ? ` — ${level.className}` : ""}</option>)}
                          </select>
                          {fieldErrors[index].level && <p className="text-[10px] text-red-600 mt-1" data-testid={`error-subject-level-${row.key}`}>{fieldErrors[index].level}</p>}
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Section</label>
                          <select className={inputCls} value={row.sectionId ?? ""} onChange={event => updateRow(row.key, { sectionId: event.target.value ? Number(event.target.value) : null })} data-testid={`select-subject-section-${row.key}`}>
                            <option value="">No section</option>
                            {row.sectionId && !selectedLevel?.sections.some(section => section.id === row.sectionId) && <option value={row.sectionId}>Unavailable: {original?.section || `Section ${row.sectionId}`}</option>}
                            {selectedLevel?.sections.map(section => <option key={section.id} value={section.id}>{section.sectionName}{section.schedule ? ` — ${section.schedule}` : ""}</option>)}
                          </select>
                          {fieldErrors[index].section && <p className="text-[10px] text-red-600 mt-1" data-testid={`error-subject-section-${row.key}`}>{fieldErrors[index].section}</p>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {original && <Button type="button" variant="outline" size="sm" onClick={() => updateRow(row.key, { courseId: "" })} data-testid={`button-replace-subject-${row.key}`}>Replace</Button>}
                        <Button type="button" variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => { setSaveError(""); setRows(previous => previous.filter(candidate => candidate.key !== row.key)); }} data-testid={`button-remove-subject-${row.key}`}>
                          <Trash2 className="w-3.5 h-3.5 mr-1" />Remove
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-secondary">Reason for change <span className="text-red-500">*</span></span>
                <textarea
                  value={changeReason}
                  onChange={event => { setChangeReason(event.target.value); setSaveError(""); }}
                  maxLength={500}
                  rows={2}
                  placeholder="e.g. Parent requested switching Hindi Level 1 to Level 2 at the desk"
                  className="w-full text-xs border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white"
                  data-testid="input-subject-change-reason"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setRows(previous => [...previous, { key: nextKey, courseId: "", courseLevelId: "", sectionId: null }]); setNextKey(value => value + 1); setSaveError(""); }} data-testid="button-add-subject">
                  <Plus className="w-3.5 h-3.5 mr-1" />Add subject
                </Button>
                <Button type="button" onClick={saveSubjects} disabled={saving || !meta || hasValidationErrors || missingExpectedEnrollment} className="gap-2" data-testid="button-save-subjects">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookOpen className="w-4 h-4" />}
                  {saving ? "Saving subjects…" : "Save Subjects"}
                </Button>
              </div>
              {missingExpectedEnrollment && <p className="text-xs text-red-600" role="alert" data-testid="error-subject-enrollment-snapshot">Cannot safely update subjects because a current enrollment snapshot is incomplete. Refresh the student list and try again.</p>}
              {(chargeSubjects.length > 0 || reusedPaymentSubjects.length > 0) && (
                <div className="rounded-lg bg-green-50 border border-green-100 p-3 text-xs" data-testid="text-subject-fee-impact">
                  {chargeSubjects.length > 0 && (
                    <>
                      <p className="font-semibold text-green-800">Estimated new charges</p>
                      {chargeSubjects.map(subject => <div key={subject.courseLevelId} className="flex justify-between text-green-700 mt-1"><span>{subject.courseName} · {subject.levelName}</span><span>${subject.fee.toFixed(2)}</span></div>)}
                      <div className="flex justify-between border-t border-green-200 mt-2 pt-2 font-semibold text-green-800"><span>Estimated new charges</span><span>${feeTotal.toFixed(2)}</span></div>
                    </>
                  )}
                  {reusedPaymentSubjects.map((subject, index) => (
                    <p key={`${subject.courseName}-${subject.levelName}-${index}`} className="text-green-700 mt-1" data-testid={`text-reused-subject-payment-${index}`}>
                      {subject.courseName} · {subject.levelName}: existing payment reused; no new charge.
                    </p>
                  ))}
                </div>
              )}
              {saveError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-700" role="alert" data-testid="status-subjects-save-error">
                  <p>{saveError}</p>
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={saveSubjects} disabled={saving || hasValidationErrors || missingExpectedEnrollment} data-testid="button-retry-save-subjects">Retry Save Subjects</Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function EditStudentPanel({
  student, onClose, onSaved, curriculumYears,
}: {
  student: Student;
  onClose: () => void;
  onSaved: () => void;
  curriculumYears: string[];
}) {
  const nameParts = student.name.split(" ");
  const [firstName,    setFirstName]    = useState(nameParts[0] ?? "");
  const [lastName,     setLastName]     = useState(nameParts.slice(1).join(" "));
  const [dob,          setDob]          = useState(student.dob);
  const [grade,        setGrade]        = useState(student.grade);
  const [curricYear,   setCurricYear]   = useState(student.curriculumYear);
  const [motherName,   setMotherName]   = useState(student.motherName);
  const [motherPhone,  setMotherPhone]  = useState(student.motherPhone);
  const [motherEmail,  setMotherEmail]  = useState(student.motherEmail);
  const [fatherName,   setFatherName]   = useState(student.fatherName);
  const [fatherPhone,  setFatherPhone]  = useState(student.fatherPhone);
  const [fatherEmail,  setFatherEmail]  = useState(student.fatherEmail);
  const [address,      setAddress]      = useState(student.address);
  const [saving,       setSaving]       = useState(false);

  const GRADES = ["Kindergarten","1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"];
  const inputCls  = "w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white";
  const selectCls = "w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white";

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim()) { toast.error("First name is required"); return; }
    setSaving(true);
    try {
      await adminApi.students.update(student.id, {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        dob, grade, curriculumYear: curricYear,
        motherName, motherPhone, motherEmail,
        fatherName, fatherPhone, fatherEmail,
        address,
      });
      toast.success(`${firstName} ${lastName} updated`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-secondary text-white shrink-0">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            <div>
              <h2 className="font-bold text-sm">Edit Student</h2>
              <p className="text-white/70 text-xs">{student.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSave} className="flex-1 flex flex-col">
          <div className="flex-1 p-6 space-y-5 overflow-y-auto">

            {/* Student Info */}
            <div>
              <p className="text-xs font-bold text-secondary uppercase tracking-wide border-b border-border pb-2 mb-4">Student Information</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">First Name <span className="text-red-500">*</span></label>
                  <input required value={firstName} onChange={e => setFirstName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">Last Name</label>
                  <input value={lastName} onChange={e => setLastName(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">Date of Birth</label>
                  <input type="date" value={dob} onChange={e => setDob(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">School Grade</label>
                  <select value={grade} onChange={e => setGrade(e.target.value)} className={selectCls}>
                    <option value="">— Select —</option>
                    {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">Curriculum Year</label>
                  <select value={curricYear} onChange={e => setCurricYear(e.target.value)} className={selectCls}>
                    {curriculumYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Mother */}
            <div className="p-4 rounded-xl bg-pink-50 border border-pink-100 space-y-3">
              <p className="text-xs font-bold text-pink-700 uppercase tracking-wide">Mother</p>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">Full Name</label>
                <input value={motherName} onChange={e => setMotherName(e.target.value)} placeholder="Mother's full name" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">Phone</label>
                  <input type="tel" value={motherPhone} onChange={e => setMotherPhone(e.target.value)} placeholder="(614) 555-0100" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">Email</label>
                  <input type="email" value={motherEmail} onChange={e => setMotherEmail(e.target.value)} placeholder="mom@email.com" className={inputCls} />
                </div>
              </div>
            </div>

            {/* Father */}
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 space-y-3">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Father</p>
              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">Full Name</label>
                <input value={fatherName} onChange={e => setFatherName(e.target.value)} placeholder="Father's full name" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">Phone</label>
                  <input type="tel" value={fatherPhone} onChange={e => setFatherPhone(e.target.value)} placeholder="(614) 555-0101" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">Email</label>
                  <input type="email" value={fatherEmail} onChange={e => setFatherEmail(e.target.value)} placeholder="dad@email.com" className={inputCls} />
                </div>
              </div>
            </div>

            {/* Address */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1 block">Home Address</label>
              <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, City, State ZIP" className={inputCls} />
            </div>

            <RegisteredSubjectsEditor student={student} onSaved={onSaved} />
          </div>

          <div className="px-6 py-4 border-t border-border flex gap-3 justify-end bg-gray-50 shrink-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Register Student Panel (unchanged logic, kept for quick access) ───────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-secondary mb-1 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

type EnrollmentDraft = { key: number; courseId: number | ""; levelId: number | ""; sectionId: number | ""; amountDue: string; };
type MetaSection  = { id: number; sectionName: string; schedule: string };
type MetaLevel    = { id: number; levelNumber: number; className: string; sections: MetaSection[] };
type MetaCourse   = { id: number; name: string; icon: string; fee?: number | null; levels: MetaLevel[] };
type Meta         = { nextCode?: string; courses: MetaCourse[] };

type LinkedMember = { id: number; memberCode?: string | null; name: string | null; email: string | null; phone: string | null; address: string | null; createdAt: string; membershipYear?: number | null; employer?: string | null };

function RegisterStudentPanel({ onClose, onRegistered }: { onClose: () => void; onRegistered: () => void }) {
  const { activeYearsListLong, activeCurriculumYearLong, courseFee } = usePortalSettings();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  // ── Temple member (required) ──
  const [membershipPath, setMembershipPath] = useState<"existing" | "new" | null>(null);
  const [linkedMember,   setLinkedMember]   = useState<LinkedMember | null>(null);
  const [memberContextToken, setMemberContextToken] = useState<string | null>(null);
  const [primaryMemberRole, setPrimaryMemberRole] = useState<"mother" | "father" | null>(null);
  const [primaryRoleError, setPrimaryRoleError] = useState("");
  const [renewingMember, setRenewingMember] = useState(false);
  const [memberSearch,      setMemberSearch]      = useState("");
  const [memberSearchError, setMemberSearchError] = useState("");
  const [memberLooking,     setMemberLooking]     = useState(false);
  const [memberNotFound,    setMemberNotFound]    = useState(false);
  const [creatingMember, setCreatingMember] = useState(false);
  const [newMemberFirstName, setNewMemberFirstName] = useState("");
  const [newMemberLastName,  setNewMemberLastName]  = useState("");
  // Pre-fill from a single parent-name field: first word is the first name, the rest the last name.
  function setNewMemberName(full: string) {
    const parts = full.trim().split(/\s+/).filter(Boolean);
    setNewMemberFirstName(parts[0] ?? "");
    setNewMemberLastName(parts.slice(1).join(" "));
  }
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [addressParts, setAddressParts] = useState<AddressParts>({ ...EMPTY_ADDRESS });
  const [addressErrors, setAddressErrors] = useState<AddressErrors>({});
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressSaveError, setAddressSaveError] = useState("");
  const memberSequence = useRef(0);
  // ── Student fields ──
  const [firstName,  setFirstName]  = useState("");
  const [lastName,   setLastName]   = useState("");
  const [dob,        setDob]        = useState("");
  const [grade,      setGrade]      = useState("");
  const [curricYear, setCurricYear] = useState(() => activeCurriculumYearLong || "2027-2028");
  const [motherName,  setMotherName]  = useState("");
  const [motherPhone, setMotherPhone] = useState("");
  const [motherEmail, setMotherEmail] = useState("");
  const [fatherName,  setFatherName]  = useState("");
  const [fatherPhone, setFatherPhone] = useState("");
  const [fatherEmail, setFatherEmail] = useState("");
  const [address,     setAddress]     = useState("");
  const [enrollments, setEnrollments] = useState<EnrollmentDraft[]>([{ key: 0, courseId: "", levelId: "", sectionId: "", amountDue: courseFee.toFixed(2) }]);
  const [draftKey, setDraftKey] = useState(1);
  const GRADES = ["Kindergarten","1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"];
  const inputCls  = "w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white";
  const selectCls = "w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white";

  useEffect(() => {
    adminApi.students.meta().then((d) => setMeta(d as Meta)).finally(() => setLoading(false));
  }, []);

  function resetMemberPath() {
    memberSequence.current++;
    setMembershipPath(null);
    setLinkedMember(null);
    setMemberContextToken(null);
    setMemberSearch("");
    setMemberLooking(false);
    setMemberNotFound(false);
    setNewMemberName("");
    setNewMemberPhone("");
    setNewMemberEmail("");
    setCreatingMember(false);
    setAddress("");
    setAddressConfirmed(false);
    setEditingAddress(false);
    setAddressSaving(false);
    setAddressSaving(false);
    setAddressParts({ ...EMPTY_ADDRESS });
    setAddressErrors({});
    setAddressSaveError("");
  }

  function selectNewPath() {
    memberSequence.current++;
    setMembershipPath("new");
    // Pre-populate from the selected primary parent's information.
    setNewMemberName((primaryMemberRole === "mother" ? motherName : primaryMemberRole === "father" ? fatherName : "").trim());
    setNewMemberPhone((primaryMemberRole === "mother" ? motherPhone : primaryMemberRole === "father" ? fatherPhone : "").trim());
    setNewMemberEmail((primaryMemberRole === "mother" ? motherEmail : primaryMemberRole === "father" ? fatherEmail : "").trim());
    setCreatingMember(false);
    setMemberNotFound(false);
    setLinkedMember(null);
    setMemberContextToken(null);
    setMemberLooking(false);
    setAddress("");
    setAddressConfirmed(false);
    setAddressParts({ ...EMPTY_ADDRESS });
    setAddressErrors({});
    setAddressSaveError("");
  }

  async function lookupMember() {
    const val = memberSearch.trim();
    const digits = val.replace(/\D/g, "");
    if (digits.length < 10) {
      setMemberSearchError("Please enter a valid 10-digit phone number.");
      return;
    }
    setMemberSearchError("");
    setMemberLooking(true);
    setMemberNotFound(false);
    setLinkedMember(null);
    setMemberContextToken(null);
    setAddress("");
    setAddressConfirmed(false);
    setEditingAddress(false);
    setAddressSaving(false);
    setAddressSaveError("");
    const sequence = ++memberSequence.current;
    try {
      const m = await adminApi.members.lookup(digits) as Awaited<ReturnType<typeof adminApi.members.lookup>> & { memberContextToken?: string; memberCode?: string | null; employer?: string | null };
      if (sequence !== memberSequence.current) return;
      setLinkedMember(m);
      setMemberContextToken(m.memberContextToken ?? null);
      setAddressParts(parseAddress(m.address));
      toast.success(`Member found: ${m.name ?? val}`);
    } catch {
      if (sequence !== memberSequence.current) return;
      setMemberNotFound(true);
      setAddressParts({ ...EMPTY_ADDRESS });
      // Pre-fill the create fields with the selected primary parent's info + searched phone.
      setNewMemberName((primaryMemberRole === "mother" ? motherName : primaryMemberRole === "father" ? fatherName : "").trim());
      setNewMemberPhone((primaryMemberRole === "mother" ? motherPhone : primaryMemberRole === "father" ? fatherPhone : "").trim() || val);
      setNewMemberEmail((primaryMemberRole === "mother" ? motherEmail : primaryMemberRole === "father" ? fatherEmail : "").trim());
    } finally {
      if (sequence === memberSequence.current) setMemberLooking(false);
    }
  }

  async function createAndLinkMember() {
    if (!newMemberFirstName.trim() || !newMemberLastName.trim()) { toast.error("Member first name and last name are required"); return; }
    const fieldErrors = validateAddressParts(addressParts);
    setAddressErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    const formatted = formatAddressParts(addressParts);
    const sequence = memberSequence.current;
    setMemberContextToken(null);
    setCreatingMember(true);
    try {
      const isTemple = membershipPath === "existing";
      const m = await adminApi.members.create({
        firstName:        newMemberFirstName.trim(),
        lastName:         newMemberLastName.trim(),
        phone:            newMemberPhone.trim() || null,
        email:            newMemberEmail.trim() || null,
        address:          formatted,
        isExistingMember: isTemple,
      }) as Awaited<ReturnType<typeof adminApi.members.create>> & { memberContextToken?: string; memberCode?: string | null; employer?: string | null };
      if (sequence !== memberSequence.current) return;
      setLinkedMember({ id: m.id, memberCode: m.memberCode, name: m.name ?? `${newMemberFirstName.trim()} ${newMemberLastName.trim()}`, phone: (m.phone ?? newMemberPhone.trim()) || null, email: (m.email ?? newMemberEmail.trim()) || null, address: formatted, createdAt: m.createdAt, employer: m.employer });
      setMemberContextToken(m.memberContextToken ?? null);
      setAddress(formatted);
      setAddressConfirmed(true);
      setMemberNotFound(false);
      toast.success(isTemple ? "Temple member record created and linked!" : "Parent Membership created and linked!");
    } catch (err) {
      if (sequence === memberSequence.current) toast.error(err instanceof Error ? err.message : "Failed to create membership record");
    } finally {
      if (sequence === memberSequence.current) setCreatingMember(false);
    }
  }

  async function saveUpdatedAddress() {
    if (!linkedMember) return;
    const fieldErrors = validateAddressParts(addressParts);
    setAddressErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) return;
    const formatted = formatAddressParts(addressParts);
    const sequence = memberSequence.current;
    setAddressSaving(true);
    setAddressSaveError("");
    try {
      await adminApi.members.patch(linkedMember.id, { address: formatted });
      if (sequence !== memberSequence.current) return;
      setLinkedMember({ ...linkedMember, address: formatted });
      setAddress(formatted);
      setAddressConfirmed(true);
      setEditingAddress(false);
      toast.success("Member address updated.");
    } catch (err) {
      if (sequence === memberSequence.current) setAddressSaveError(err instanceof Error ? err.message : "Could not update address.");
    } finally {
      if (sequence === memberSequence.current) setAddressSaving(false);
    }
  }

  async function renewLinkedMember() {
    if (!linkedMember) return;
    const id = linkedMember.id;
    const sequence = memberSequence.current;
    setRenewingMember(true);
    try {
      const renewed = await adminApi.members.renew(id);
      if (sequence !== memberSequence.current) return;
      setLinkedMember(prev => prev?.id === id ? { ...prev, createdAt: renewed.createdAt } : prev);
      toast.success("Membership renewed through December 31 of this year.");
    } catch (err) {
      if (sequence === memberSequence.current) toast.error(err instanceof Error ? err.message : "Membership renewal failed");
    } finally {
      if (sequence === memberSequence.current) setRenewingMember(false);
    }
  }

  function addEnrollment() {
    setEnrollments(prev => [...prev, { key: draftKey, courseId: "", levelId: "", sectionId: "", amountDue: courseFee.toFixed(2) }]);
    setDraftKey(k => k + 1);
  }
  function removeEnrollment(key: number) { setEnrollments(prev => prev.filter(e => e.key !== key)); }
  function updateEnrollment(key: number, patch: Partial<EnrollmentDraft>) {
    setEnrollments(prev => prev.map(e => {
      if (e.key !== key) return e;
      const u = { ...e, ...patch };
      if (patch.courseId !== undefined) { u.levelId = ""; u.sectionId = ""; }
      if (patch.levelId  !== undefined) { u.sectionId = ""; }
      return u;
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) { toast.error("First and last name required"); return; }
    if (!primaryMemberRole) {
      setPrimaryRoleError("Choose Mother or Father as the primary member before registering.");
      return;
    }
    setPrimaryRoleError("");
    if (!linkedMember) { toast.error("A temple member record must be linked first. Use the Temple Membership section above."); return; }
    if (!memberContextToken) { toast.error("The linked member context is missing. Change or relink the member before registering."); return; }
    if (!membershipStatus(linkedMember.createdAt, undefined, linkedMember.membershipYear).isActive) {
      toast.error("This membership expired on December 31. Renew it for this calendar year before registering.");
      return;
    }
    if (!addressConfirmed || !address.trim() || address !== linkedMember.address?.trim()) {
      toast.error("Confirm the member's address or save an updated address before registering.");
      return;
    }
    const valid = enrollments.filter(e => e.courseId && e.levelId);
    const registrationData = {
      firstName: firstName.trim(), lastName: lastName.trim(),
      dob: dob || undefined, grade: grade || undefined,
      curriculumYear: curricYear || undefined, isNewStudent: true,
      memberId: linkedMember.id,
      primaryMemberRole, memberContextToken,
      motherName: primaryMemberRole === "mother" ? linkedMember.name || motherName.trim() || undefined : motherName.trim() || undefined,
      motherPhone: primaryMemberRole === "mother" ? linkedMember.phone || motherPhone.trim() || undefined : motherPhone.trim() || undefined,
      motherEmail: primaryMemberRole === "mother" ? linkedMember.email || motherEmail.trim() || undefined : motherEmail.trim() || undefined,
      fatherName: primaryMemberRole === "father" ? linkedMember.name || fatherName.trim() || undefined : fatherName.trim() || undefined,
      fatherPhone: primaryMemberRole === "father" ? linkedMember.phone || fatherPhone.trim() || undefined : fatherPhone.trim() || undefined,
      fatherEmail: primaryMemberRole === "father" ? linkedMember.email || fatherEmail.trim() || undefined : fatherEmail.trim() || undefined,
      address: address.trim(),
      enrollments: valid.map(e => ({ courseLevelId: Number(e.levelId), sectionId: e.sectionId ? Number(e.sectionId) : null, amountDue: e.amountDue || courseFee.toFixed(2), enrollDate: new Date().toISOString().slice(0, 10) })),
    };
    setSaving(true);
    try {
      await adminApi.students.register(registrationData);
      toast.success(`${firstName} ${lastName} registered!`);
      onRegistered();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-secondary text-white shrink-0">
          <div className="flex items-center gap-2"><UserPlus className="w-5 h-5" /><h2 className="font-bold text-lg">Register New Student</h2></div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        {loading ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              {meta?.nextCode && (
                <div className="flex items-center gap-2 px-3 py-2 bg-primary/8 rounded-xl border border-primary/20">
                  <span className="text-xs text-muted-foreground">Estimated next student ID (assigned when saved):</span>
                  <span className="font-mono font-bold text-primary text-sm">{meta.nextCode}</span>
                </div>
              )}

              {/* ── Temple Membership (REQUIRED) ── */}
              <div>
                <div className="flex items-center gap-2 py-2 border-b border-border mb-4">
                  <Users className="w-4 h-4 text-amber-600" />
                  <span className="text-sm font-bold text-secondary uppercase tracking-wide">Temple Membership</span>
                  <span className="ml-auto text-xs font-semibold text-red-600 uppercase">Required</span>
                </div>
                <fieldset className="rounded-xl border border-border p-3 mb-4">
                  <legend className="px-1 text-sm font-semibold text-secondary">Primary Member Role <span className="text-red-600">Required</span></legend>
                  <p className="mb-2 text-xs text-muted-foreground">Choose which parent is linked to the temple membership. Their contact fields will use the linked member record.</p>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" name="primaryMemberRole" value="mother" checked={primaryMemberRole === "mother"} aria-invalid={!!primaryRoleError} aria-describedby={primaryRoleError ? "primary-member-role-error" : undefined} onChange={() => { setPrimaryMemberRole("mother"); setPrimaryRoleError(""); }} />
                      Mother Primary Member
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" name="primaryMemberRole" value="father" checked={primaryMemberRole === "father"} aria-invalid={!!primaryRoleError} aria-describedby={primaryRoleError ? "primary-member-role-error" : undefined} onChange={() => { setPrimaryMemberRole("father"); setPrimaryRoleError(""); }} />
                      Father Primary Member
                    </label>
                  </div>
                  {primaryRoleError && <p id="primary-member-role-error" className="mt-2 text-xs text-red-600" role="alert">{primaryRoleError}</p>}
                </fieldset>

                {/* ── Linked: show confirmation card ── */}
                 {linkedMember ? (
                   <div className="space-y-3">
                     <div className="flex items-start justify-between p-3 bg-green-50 border border-green-200 rounded-xl gap-3">
                       <div>
                         <p className="font-semibold text-green-800 text-sm">{linkedMember.name ?? "Unknown"}</p>
                         <p className="text-xs text-green-700 mt-0.5">{[linkedMember.phone, linkedMember.email].filter(Boolean).join(" · ")}</p>
                          {primaryMemberRole && <span className="inline-flex mt-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">{primaryMemberRole === "mother" ? "Mother" : "Father"} Primary Member · ID {linkedMember.memberCode || linkedMember.id}</span>}
                         <p className="text-xs text-green-600 mt-1">
                           {membershipPath === "new" ? "New Parent Membership created" : "Linked to existing temple member"}
                         </p>
                       </div>
                       <button type="button" onClick={resetMemberPath}
                         className="text-xs text-red-500 hover:text-red-700 underline shrink-0 mt-0.5">Change</button>
                     </div>
                     <div className={`rounded-xl border px-3 py-2 text-sm ${membershipStatus(linkedMember.createdAt, undefined, linkedMember.membershipYear).isActive ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                       Membership {membershipStatus(linkedMember.createdAt, undefined, linkedMember.membershipYear).isActive ? "active" : "expired"} — {membershipStatus(linkedMember.createdAt, undefined, linkedMember.membershipYear).isActive ? "expires" : "expired"} {membershipExpiryLabel(linkedMember.createdAt, linkedMember.membershipYear)}.
                       {!membershipStatus(linkedMember.createdAt, undefined, linkedMember.membershipYear).isActive && (
                         <Button type="button" size="sm" className="mt-2 w-full" disabled={renewingMember} onClick={renewLinkedMember}>
                           {renewingMember ? "Renewing…" : "Renew Membership to Continue"}
                         </Button>
                       )}
                     </div>
                     <div className="p-3 rounded-xl border border-border space-y-3">
                       <p className="text-sm font-semibold text-secondary">Verify home address</p>
                       <p className="text-xs text-muted-foreground">
                         {membershipPath === "new" ? "Address saved to the new member record." : "Check the address currently on the member record before registering."}
                       </p>
                       <p className="text-sm text-secondary bg-gray-50 rounded-lg p-2 whitespace-pre-wrap">{linkedMember.address?.trim() || "No address on file. Enter a complete address below."}</p>
                       {addressConfirmed && !editingAddress && <p className="text-xs text-green-700">Address confirmed</p>}
                       {!editingAddress ? (
                         <div className="flex gap-2 flex-wrap">
                           {membershipPath === "existing" && (
                             <Button type="button" disabled={!linkedMember.address?.trim()} onClick={() => {
                               if (!linkedMember.address?.trim()) return;
                               if (!isCompleteAddress(linkedMember.address)) {
                                 setAddressSaveError("The address on file needs a street, city, 2-letter state and ZIP. Please update it.");
                                 return;
                               }
                               setAddress(linkedMember.address.trim());
                               setAddressConfirmed(true);
                               setAddressSaveError("");
                             }}>Confirm Address</Button>
                           )}
                           <Button type="button" variant="outline" onClick={() => {
                             setEditingAddress(true);
                             setAddressConfirmed(false);
                             setAddressParts(parseAddress(linkedMember.address));
                             setAddressErrors({});
                             setAddressSaveError("");
                           }}>Update Address</Button>
                         </div>
                       ) : (
                         <div className="space-y-3">
                           <AddressFields
                             value={addressParts}
                             onChange={next => { setAddressParts(next); setAddressErrors({}); setAddressSaveError(""); }}
                             errors={addressErrors}
                           />
                           <div className="flex gap-2">
                             <Button type="button" onClick={saveUpdatedAddress} disabled={addressSaving} className="gap-1.5">
                               {addressSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save Address
                             </Button>
                             <Button type="button" variant="outline" disabled={addressSaving} onClick={() => { setEditingAddress(false); setAddressErrors({}); setAddressSaveError(""); }}>Cancel</Button>
                           </div>
                         </div>
                       )}
                       {addressSaveError && <p className="text-xs text-red-600" role="alert">{addressSaveError}</p>}
                     </div>
                   </div>

                ) : membershipPath === null ? (
                  /* ── Step 1: choose path ── */
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground mb-3">Is this family already a registered temple member?</p>
                    <button type="button" onClick={() => setMembershipPath("existing")}
                      className="w-full flex items-center gap-3 px-4 py-3 border-2 border-border rounded-xl hover:border-primary hover:bg-primary/5 text-left transition-colors group">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20">
                        <Users className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-secondary">Yes — Existing Temple Member</p>
                        <p className="text-xs text-muted-foreground">Search for their existing member record</p>
                      </div>
                    </button>
                    <button type="button" onClick={selectNewPath}
                      className="w-full flex items-center gap-3 px-4 py-3 border-2 border-border rounded-xl hover:border-amber-500 hover:bg-amber-50 text-left transition-colors group">
                      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 group-hover:bg-amber-200">
                        <UserPlus className="w-4 h-4 text-amber-700" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-secondary">No — Not a Temple Member</p>
                        <p className="text-xs text-muted-foreground">A Parent Membership record will be created automatically</p>
                      </div>
                    </button>
                  </div>

                ) : membershipPath === "existing" ? (
                  /* ── Step 2a: search for existing member ── */
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <button type="button" onClick={resetMemberPath} className="text-xs text-primary hover:underline">← Back</button>
                      <span className="text-xs text-muted-foreground">Search existing temple member by phone number</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          value={memberSearch}
                           onChange={e => {
                             memberSequence.current++;
                             setMemberSearch(e.target.value);
                             setMemberNotFound(false);
                             setMemberSearchError("");
                             setMemberLooking(false);
                             setLinkedMember(null);
                              setMemberContextToken(null);
                             setAddress("");
                             setAddressConfirmed(false);
                             setAddressErrors({});
                           }}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); lookupMember(); } }}
                          placeholder="Phone number (e.g. 614-555-0100)"
                          className={`${inputCls} ${memberSearchError ? "border-red-400" : ""}`}
                          autoFocus
                        />
                        <button type="button" onClick={lookupMember} disabled={memberLooking}
                          className="shrink-0 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1.5">
                          {memberLooking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                          Find
                        </button>
                      </div>
                      {memberSearchError && (
                        <p className="text-xs text-red-600">{memberSearchError}</p>
                      )}
                    </div>
                    {memberNotFound && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                        <p className="text-xs font-semibold text-amber-800">No member found. Confirm details to create a member record:</p>
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <input value={newMemberFirstName} onChange={e => setNewMemberFirstName(e.target.value)} placeholder="First name *" className={inputCls} />
                            <input value={newMemberLastName}  onChange={e => setNewMemberLastName(e.target.value)}  placeholder="Last name *"  className={inputCls} />
                          </div>
                          <input value={newMemberPhone} onChange={e => setNewMemberPhone(e.target.value)} placeholder="Phone number"  className={inputCls} />
                          <input value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} placeholder="Email address" className={inputCls} />
                        </div>
                        <AddressFields value={addressParts} onChange={next => { setAddressParts(next); setAddressErrors({}); }} errors={addressErrors} />
                        <button type="button" onClick={createAndLinkMember} disabled={creatingMember}
                          className="w-full py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2">
                          {creatingMember && <Loader2 className="w-4 h-4 animate-spin" />}
                          Create Member Record &amp; Link
                        </button>
                      </div>
                    )}
                  </div>

                ) : (
                  /* ── Step 2b: create parent membership from father's info ── */
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <button type="button" onClick={resetMemberPath} className="text-xs text-primary hover:underline">← Back</button>
                      <span className="text-xs text-muted-foreground">Parent Membership — pre-filled from father's info</span>
                    </div>
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                      <p className="text-xs text-amber-800">A <strong>Parent Membership</strong> record will be created with the information below (primarily from the father's details). Fill in the Parent Information section below first, or enter the details here directly.</p>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs font-medium text-amber-900 block mb-1">Parent / Guardian Name <span className="text-red-500">*</span></label>
                          <div className="grid grid-cols-2 gap-2">
                            <input value={newMemberFirstName} onChange={e => setNewMemberFirstName(e.target.value)} placeholder="First name" className={inputCls} />
                            <input value={newMemberLastName}  onChange={e => setNewMemberLastName(e.target.value)}  placeholder="Last name"  className={inputCls} />
                          </div>
                        </div>
                        <div>
                          <label className="text-xs font-medium text-amber-900 block mb-1">Phone Number</label>
                          <input value={newMemberPhone} onChange={e => setNewMemberPhone(e.target.value)} placeholder="Phone number" className={inputCls} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-amber-900 block mb-1">Email Address</label>
                          <input value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} placeholder="Email address" className={inputCls} />
                        </div>
                      </div>
                      <AddressFields value={addressParts} onChange={next => { setAddressParts(next); setAddressErrors({}); }} errors={addressErrors} />
                      <button type="button" onClick={createAndLinkMember} disabled={creatingMember || !newMemberFirstName.trim() || !newMemberLastName.trim()}
                        className="w-full py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-60 flex items-center justify-center gap-2 font-medium">
                        {creatingMember && <Loader2 className="w-4 h-4 animate-spin" />}
                        Create Parent Membership &amp; Continue
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2 py-2 border-b border-border mb-4"><GraduationCap className="w-4 h-4 text-primary" /><span className="text-sm font-bold text-secondary uppercase tracking-wide">Student Information</span></div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="First Name" required><input required value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="e.g. Arjun" className={inputCls} /></Field>
                  <Field label="Last Name" required><input required value={lastName} onChange={e => setLastName(e.target.value)} placeholder="e.g. Sharma" className={inputCls} /></Field>
                  <Field label="Date of Birth"><input type="date" value={dob} onChange={e => setDob(e.target.value)} className={inputCls} /></Field>
                  <Field label="School Grade">
                    <select value={grade} onChange={e => setGrade(e.target.value)} className={selectCls}>
                      <option value="">— Select —</option>
                      {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </Field>
                  <Field label="Curriculum Year" required>
                    <select value={curricYear} onChange={e => setCurricYear(e.target.value)} className={selectCls}>
                      {activeYearsListLong.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 py-2 border-b border-border mb-4"><Users className="w-4 h-4 text-primary" /><span className="text-sm font-bold text-secondary uppercase tracking-wide">Parent / Guardian</span></div>
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-pink-50 border border-pink-100 space-y-3">
                    <p className="text-xs font-bold text-pink-700 uppercase tracking-wide">Mother</p>
                    <Field label="Full Name"><input value={primaryMemberRole === "mother" && linkedMember?.name?.trim() ? linkedMember.name : motherName} onChange={e => setMotherName(e.target.value)} readOnly={primaryMemberRole === "mother" && !!linkedMember?.name?.trim()} placeholder="Mother's full name" className={`${inputCls} ${primaryMemberRole === "mother" && !!linkedMember?.name?.trim() ? "bg-gray-100" : ""}`} /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Phone"><input type="tel" value={primaryMemberRole === "mother" && linkedMember?.phone?.trim() ? linkedMember.phone : motherPhone} onChange={e => setMotherPhone(e.target.value)} readOnly={primaryMemberRole === "mother" && !!linkedMember?.phone?.trim()} placeholder="(614) 555-0100" className={`${inputCls} ${primaryMemberRole === "mother" && !!linkedMember?.phone?.trim() ? "bg-gray-100" : ""}`} /></Field>
                      <Field label="Email"><input type="email" value={primaryMemberRole === "mother" && linkedMember?.email?.trim() ? linkedMember.email : motherEmail} onChange={e => setMotherEmail(e.target.value)} readOnly={primaryMemberRole === "mother" && !!linkedMember?.email?.trim()} placeholder="mom@email.com" className={`${inputCls} ${primaryMemberRole === "mother" && !!linkedMember?.email?.trim() ? "bg-gray-100" : ""}`} /></Field>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 space-y-3">
                    <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Father</p>
                    <Field label="Full Name"><input value={primaryMemberRole === "father" && linkedMember?.name?.trim() ? linkedMember.name : fatherName} onChange={e => setFatherName(e.target.value)} readOnly={primaryMemberRole === "father" && !!linkedMember?.name?.trim()} placeholder="Father's full name" className={`${inputCls} ${primaryMemberRole === "father" && !!linkedMember?.name?.trim() ? "bg-gray-100" : ""}`} /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Phone"><input type="tel" value={primaryMemberRole === "father" && linkedMember?.phone?.trim() ? linkedMember.phone : fatherPhone} onChange={e => setFatherPhone(e.target.value)} readOnly={primaryMemberRole === "father" && !!linkedMember?.phone?.trim()} placeholder="(614) 555-0101" className={`${inputCls} ${primaryMemberRole === "father" && !!linkedMember?.phone?.trim() ? "bg-gray-100" : ""}`} /></Field>
                      <Field label="Email"><input type="email" value={primaryMemberRole === "father" && linkedMember?.email?.trim() ? linkedMember.email : fatherEmail} onChange={e => setFatherEmail(e.target.value)} readOnly={primaryMemberRole === "father" && !!linkedMember?.email?.trim()} placeholder="dad@email.com" className={`${inputCls} ${primaryMemberRole === "father" && !!linkedMember?.email?.trim() ? "bg-gray-100" : ""}`} /></Field>
                    </div>
                  </div>
                   <Field label="Home Address"><p className="rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm text-secondary">{address || "Confirm or enter an address in Temple Membership above."}</p></Field>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 py-2 border-b border-border mb-4"><BookOpen className="w-4 h-4 text-primary" /><span className="text-sm font-bold text-secondary uppercase tracking-wide">Course Enrollment</span></div>
                <div className="space-y-3">
                  {enrollments.map((enr, idx) => {
                    const sc = meta?.courses.find(c => c.id === enr.courseId) ?? null;
                    const sl = sc?.levels.find(l => l.id === enr.levelId) ?? null;
                    return (
                      <div key={enr.key} className="p-4 rounded-xl border border-border bg-gray-50 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-secondary">Course {idx + 1}</span>
                          {enrollments.length > 1 && <button type="button" onClick={() => removeEnrollment(enr.key)} className="text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>}
                        </div>
                        <Field label="Course">
                          <select value={enr.courseId} onChange={e => updateEnrollment(enr.key, { courseId: e.target.value ? Number(e.target.value) : "" })} className={selectCls}>
                            <option value="">— Select course —</option>
                            {meta?.courses.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                          </select>
                        </Field>
                        {sc && (
                          <Field label="Level">
                            <select value={enr.levelId} onChange={e => updateEnrollment(enr.key, { levelId: e.target.value ? Number(e.target.value) : "" })} className={selectCls}>
                              <option value="">— Select level —</option>
                              {sc.levels.map(l => <option key={l.id} value={l.id}>Level {l.levelNumber} — {l.className}</option>)}
                            </select>
                          </Field>
                        )}
                        {sl && sl.sections.length > 0 && (
                          <Field label="Section">
                            <select value={enr.sectionId} onChange={e => updateEnrollment(enr.key, { sectionId: e.target.value ? Number(e.target.value) : "" })} className={selectCls}>
                              <option value="">— Unassigned —</option>
                              {sl.sections.map(s => <option key={s.id} value={s.id}>{s.sectionName}{s.schedule ? ` · ${s.schedule}` : ""}</option>)}
                            </select>
                          </Field>
                        )}
                        <Field label="Fee ($)">
                          <input type="number" min="0" step="0.01" value={enr.amountDue} onChange={e => updateEnrollment(enr.key, { amountDue: e.target.value })} className={`${inputCls} w-32`} />
                        </Field>
                      </div>
                    );
                  })}
                  <button type="button" onClick={addEnrollment}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-primary/30 text-primary text-sm font-medium hover:border-primary/60 hover:bg-primary/5 transition-colors">
                    <Plus className="w-4 h-4" /> Add Another Course
                  </button>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border flex gap-3 justify-end bg-gray-50 shrink-0">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                {saving ? "Registering…" : "Register Student"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Payment Drawer ───────────────────────────────────────────────────────────

function PaymentDrawer({ student, onClose, onRefresh }: {
  student:   Student;
  onClose:   () => void;
  onRefresh: () => void;
}) {
  const PAY_BADGE: Record<string, string> = {
    Paid:    "bg-green-100 text-green-700",
    Pending: "bg-orange-100 text-orange-700",
    Overdue: "bg-red-100 text-red-700",
  };

  // ── edit state ────────────────────────────────────────────────────────────
  const [editingId,   setEditingId]   = useState<number | null>(null);
  const [saving,      setSaving]      = useState(false);
  const [editDue,     setEditDue]     = useState("");
  const [editPaid,    setEditPaid]    = useState("");
  const [editStatus,  setEditStatus]  = useState<"Paid" | "Pending" | "Overdue">("Pending");
  const [editMethod,  setEditMethod]  = useState("");
  const [editReceipt, setEditReceipt] = useState("");
  const [editDate,    setEditDate]    = useState("");

  function startEdit(e: Enrollment) {
    if (e.enrollmentId == null) return;
    setEditingId(e.enrollmentId);
    setEditDue(String(e.amountDue));
    setEditPaid(String(e.amountPaid));
    setEditStatus(e.paymentStatus);
    setEditMethod(e.paymentMethod === "-" ? "" : e.paymentMethod);
    setEditReceipt(e.receiptId === "-" ? "" : e.receiptId);
    setEditDate("");
  }

  async function saveEdit(enrollmentId: number) {
    setSaving(true);
    try {
      await adminApi.students.updatePayment(enrollmentId, {
        amountDue:     parseFloat(editDue)  || 0,
        amountPaid:    parseFloat(editPaid) || 0,
        paymentStatus: editStatus,
        paymentMethod: editMethod   || null,
        receiptId:     editReceipt  || null,
        paymentDate:   editDate     || null,
      });
      toast.success("Payment updated successfully");
      setEditingId(null);
      onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update payment");
    } finally {
      setSaving(false);
    }
  }

  const totalDue  = student.enrollments.reduce((a, e) => a + e.amountDue,  0);
  const totalPaid = student.enrollments.reduce((a, e) => a + e.amountPaid, 0);
  const balance   = totalDue - totalPaid;

  const inputCls  = "w-full px-2.5 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary bg-white";
  const selectCls = `${inputCls} cursor-pointer`;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-primary" />
              <span className="font-semibold text-secondary">Payment Details</span>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">{student.name}</div>
            <div className="font-mono text-xs text-muted-foreground">{student.id}</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100 text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Payment history and the overall summary include current and historical enrollments. */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {student.enrollments.length > 0 && (
            <p className="text-[11px] text-muted-foreground" data-testid="text-payment-history-scope">
              Payment history and overall totals include current and historical enrollments.
            </p>
          )}
          {student.enrollments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No enrollments found.</p>
          ) : student.enrollments.map((e, i) => (
            <div key={i} className="rounded-xl border border-border p-4 space-y-2.5">
              {/* Course + Level + Status badge */}
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-secondary">
                    <span>{e.courseIcon}</span>
                    <span>{e.course}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {e.level}{e.section ? ` · ${e.section}` : ""}{e.timing ? ` · ${e.timing}` : ""}
                  </div>
                  {isHistoricalEnrollment(e) && (
                    <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600" data-testid={`status-payment-history-${e.enrollmentId ?? i}`}>
                      Historical enrollment · {e.enrollStatus}
                    </span>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${PAY_BADGE[e.paymentStatus] ?? "bg-gray-100 text-gray-500"}`}>
                  {e.paymentStatus === "Pending" && e.pendingReason ? `Pending – ${e.pendingReason}` : e.paymentStatus}
                </span>
              </div>

              {editingId === e.enrollmentId ? (
                /* ── Inline edit form ── */
                <div className="space-y-3 pt-2 border-t border-border/60">
                  <p className="text-[11px] font-bold text-primary uppercase tracking-wide">Edit Payment</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold block mb-1">Amount Due ($)</label>
                      <input type="number" min="0" step="0.01" value={editDue} onChange={ev => setEditDue(ev.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold block mb-1">Amount Paid ($)</label>
                      <input type="number" min="0" step="0.01" value={editPaid} onChange={ev => setEditPaid(ev.target.value)} className={inputCls} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold block mb-1">Status</label>
                      <select value={editStatus} onChange={ev => setEditStatus(ev.target.value as "Paid" | "Pending" | "Overdue")} className={selectCls}>
                        <option value="Paid">Paid</option>
                        <option value="Pending">Pending</option>
                        <option value="Overdue">Overdue</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold block mb-1">Method</label>
                      <select value={editMethod} onChange={ev => setEditMethod(ev.target.value)} className={selectCls}>
                        <option value="">— None —</option>
                        <option value="Cash">Cash</option>
                        <option value="Check">Check</option>
                        <option value="Zelle">Zelle</option>
                        <option value="Online">Online</option>
                        <option value="Waived">Waived</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold block mb-1">Receipt / Transaction #</label>
                      <input value={editReceipt} onChange={ev => setEditReceipt(ev.target.value)} placeholder="e.g. RCP-2026-001" className={inputCls} />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold block mb-1">Payment Date</label>
                      <input type="date" value={editDate} onChange={ev => setEditDate(ev.target.value)} className={inputCls} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={saving}
                      className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => saveEdit(e.enrollmentId!)}
                      disabled={saving || e.enrollmentId == null}
                      className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                      Save Payment
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Read view ── */
                <>
                  {/* Amounts */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded-lg px-2 py-1.5">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Due</div>
                      <div className="text-sm font-semibold text-secondary">${e.amountDue.toFixed(0)}</div>
                    </div>
                    <div className="bg-green-50 rounded-lg px-2 py-1.5">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Paid</div>
                      <div className="text-sm font-semibold text-green-700">${e.amountPaid.toFixed(0)}</div>
                    </div>
                    <div className={`rounded-lg px-2 py-1.5 ${e.amountDue - e.amountPaid > 0 ? "bg-orange-50" : "bg-green-50"}`}>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Balance</div>
                      <div className={`text-sm font-semibold ${e.amountDue - e.amountPaid > 0 ? "text-orange-600" : "text-green-700"}`}>
                        ${(e.amountDue - e.amountPaid).toFixed(0)}
                      </div>
                    </div>
                  </div>

                  {/* Method + Receipt + Enrolled date */}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    {e.paymentMethod && e.paymentMethod !== "-" ? (
                      <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" />{e.paymentMethod}</span>
                    ) : <span className="text-muted-foreground/50">No method</span>}
                    {e.receiptId && e.receiptId !== "-" ? (
                      <span className="flex items-center gap-1"><Receipt className="w-3 h-3" />#{e.receiptId}</span>
                    ) : null}
                    {e.enrollDate && (
                      <span>Enrolled: {new Date(e.enrollDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    )}
                  </div>

                  {/* Edit button */}
                  <button
                    onClick={() => startEdit(e)}
                    disabled={e.enrollmentId == null}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors disabled:opacity-40"
                  >
                    <Pencil className="w-3 h-3" /> Edit Payment
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Footer summary */}
        <div className="border-t border-border px-5 py-4 bg-gray-50">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Overall Total Due</div>
              <div className="text-base font-bold text-secondary">${totalDue.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Overall Total Paid</div>
              <div className="text-base font-bold text-green-700">${totalPaid.toFixed(0)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Overall Balance</div>
              <div className={`text-base font-bold ${balance > 0 ? "text-orange-600" : "text-green-700"}`}>${balance.toFixed(0)}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type SortKey = "id" | "name" | "grade" | "primaryCourse" | "totalPaid" | "worstPayStatus" | "isActive";

export default function Students() {
  const { user } = useAuth();
  const isAdmin = user ? canAccess(user.role, "dashboard") : false;
  const { activeYearsListLong } = usePortalSettings();

  // ── data
  const [rawStudents, setRawStudents] = useState<Student[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState<string | null>(null);

  // ── search & filters (operate on full dataset)
  const [search,          setSearch]          = useState("");
  const [filterCourse,    setFilterCourse]    = useState("All");
  const [filterLevel,     setFilterLevel]     = useState("All");
  const [filterSection,   setFilterSection]   = useState("All");
  const [filterPayStatus, setFilterPayStatus] = useState("All");
  const [filterActive,    setFilterActive]    = useState("All");
  const [filterCurricYear,setFilterCurricYear]= useState("All");
  const [showFilters,     setShowFilters]     = useState(false);

  // ── sort
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);

  // ── pagination
  const [page, setPage]         = useState(1);
  const [pageInput, setPageInput] = useState("1");

  // ── selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── panels / dialogs
  const [editStudent,    setEditStudent]    = useState<Student | null>(null);
  const [showRegister,   setShowRegister]   = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);
  const [paymentDrawer,  setPaymentDrawer]  = useState<Student | null>(null);
  const [confirmInactive, setConfirmInactive] = useState(false);
  const [confirmActive,   setConfirmActive]   = useState(false);
  const [actionLoading,   setActionLoading]   = useState(false);
  // ── unlinked member banner
  const [unlinkedCount,   setUnlinkedCount]   = useState(0);
  const [backfilling,     setBackfilling]     = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);

  // ── duplicate detection
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupGroups,      setDupGroups]      = useState<DupGroup[][]>([]);
  const [dupLoading,     setDupLoading]     = useState(false);
  const [mergingGroup,   setMergingGroup]   = useState<string | null>(null);

  const loadStudents = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    adminApi.students.list()
      .then((d) => setRawStudents(groupRows(d as RawRow[])))
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Could not load students."))
      .finally(() => setLoading(false));
  }, []);

  const loadUnlinkedCount = useCallback(() => {
    adminApi.students.unlinkedCount().then(r => setUnlinkedCount(r.unlinkedCount ?? 0)).catch(() => {});
  }, []);

  async function runBackfill() {
    setBackfilling(true);
    try {
      const res = await adminApi.backfill.linkMembers();
      toast.success(`Backfill complete: ${res.totalStudentsFixed} student(s) linked to member records.`);
      loadStudents();
      loadUnlinkedCount();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setBackfilling(false);
    }
  }

  async function loadDuplicates() {
    setDupLoading(true);
    try {
      const data = await adminApi.students.duplicates();
      setDupGroups(data as DupGroup[][]);
    } catch { toast.error("Failed to load duplicates"); }
    finally { setDupLoading(false); }
  }

  async function handleMerge(canonicalCode: string, duplicateCodes: string[]) {
    setMergingGroup(canonicalCode);
    try {
      const result = await adminApi.students.merge({ canonicalCode, duplicateCodes });
      toast.success(`Merged ${result.merged} duplicate record${result.merged !== 1 ? "s" : ""} into ${canonicalCode}`);
      await loadDuplicates();
      loadStudents();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed to merge"); }
    finally { setMergingGroup(null); }
  }

  useEffect(() => { loadStudents(); loadUnlinkedCount(); }, [loadStudents, loadUnlinkedCount]);

  // Keep paymentDrawer in sync with fresh data after a payment update
  useEffect(() => {
    if (paymentDrawer) {
      const updated = rawStudents.find(s => s.id === paymentDrawer.id);
      if (updated) setPaymentDrawer(updated);
    }
  }, [rawStudents]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── dynamic filter options from data
  const allYears = useMemo(() => Array.from(new Set([
    ...activeYearsListLong,
    ...rawStudents.map(s => s.curriculumYear).filter(Boolean),
  ])).sort(), [activeYearsListLong, rawStudents]);
  const allCourses  = useMemo(() => ["All", ...Array.from(new Set(rawStudents.flatMap(s => s.courses))).sort()], [rawStudents]);
  const allLevels   = useMemo(() => {
    const nums = Array.from(new Set(rawStudents.flatMap(s => currentEnrollments(s).map(e => e.levelNum)))).filter(Boolean).sort((a,b) => a-b);
    return ["All", ...nums.map(n => `Level ${n}`)];
  }, [rawStudents]);
  const allSections = useMemo(() => {
    const secs = Array.from(new Set(rawStudents.flatMap(s => currentEnrollments(s).map(e => e.section)).filter(Boolean))).sort();
    return ["All", ...secs];
  }, [rawStudents]);

  // ── filtered + sorted (entire dataset, no pagination yet)
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let data = rawStudents.filter(s => {
      if (filterCourse !== "All"     && !s.courses.includes(filterCourse)) return false;
      if (filterLevel  !== "All"     && !currentEnrollments(s).some(e => e.level === filterLevel)) return false;
      if (filterSection !== "All"    && !currentEnrollments(s).some(e => e.section === filterSection)) return false;
      if (filterPayStatus !== "All"  && s.worstPayStatus !== filterPayStatus) return false;
      if (filterActive !== "All"     && String(s.isActive) !== (filterActive === "Active" ? "true" : "false")) return false;
      if (filterCurricYear !== "All" && s.curriculumYear !== filterCurricYear) return false;
      if (q && !(
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.motherName.toLowerCase().includes(q) ||
        s.fatherName.toLowerCase().includes(q) ||
        s.motherPhone.includes(q) ||
        s.fatherPhone.includes(q) ||
        s.grade.toLowerCase().includes(q)
      )) return false;
      return true;
    });
    data = [...data].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (av === bv) return 0;
      if (av < bv) return sortAsc ? -1 : 1;
      return sortAsc ? 1 : -1;
    });
    return data;
  }, [rawStudents, search, filterCourse, filterLevel, filterSection, filterPayStatus, filterActive, filterCurricYear, sortKey, sortAsc]);

  // reset page when filters change
  useEffect(() => { setPage(1); setPageInput("1"); }, [search, filterCourse, filterLevel, filterSection, filterPayStatus, filterActive, filterCurricYear]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageIds     = new Set(paginated.map(s => s.id));
  const allPageSelected = paginated.length > 0 && paginated.every(s => selected.has(s.id));
  const somePageSelected = paginated.some(s => selected.has(s.id));
  const selectedArray = Array.from(selected);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="opacity-0 ml-1">↑</span>;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 inline ml-1 text-primary" />
      : <ChevronDown className="w-3 h-3 inline ml-1 text-primary" />;
  }

  function toggleSelectAll() {
    if (allPageSelected) {
      setSelected(prev => { const n = new Set(prev); pageIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); paginated.forEach(s => n.add(s.id)); return n; });
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function goToPage(p: number) {
    const clamped = Math.max(1, Math.min(totalPages, p));
    setPage(clamped);
    setPageInput(String(clamped));
    tableRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── Bulk operations
  async function doBulkSetStatus(isActive: boolean) {
    setActionLoading(true);
    try {
      await adminApi.students.bulkSetStatus(selectedArray, isActive);
      toast.success(`${selectedArray.length} student(s) marked ${isActive ? "active" : "inactive"}`);
      setSelected(new Set());
      loadStudents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setActionLoading(false);
      setConfirmInactive(false);
      setConfirmActive(false);
    }
  }

  async function doBulkDelete() {
    setActionLoading(true);
    try {
      await adminApi.students.bulkDelete(selectedArray);
      toast.success(`${selectedArray.length} student(s) deleted`);
      setSelected(new Set());
      loadStudents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setActionLoading(false);
      setConfirmDelete(false);
    }
  }

  function exportCSV() {
    const headers = ["Student ID","Name","Grade","Curriculum Year","Status","Course(s)","Parent Phone","Payment Status","Total Paid","Mother Name","Mother Email","Father Name","Father Email","Address"];
    const rows = filtered.map(s => [
      s.id, s.name, s.grade, s.curriculumYear, s.isActive ? "Active" : "Inactive",
      s.courses.join("; "),
      s.parentPhone,
      s.worstPayStatus,
      s.totalPaid.toFixed(2),
      s.motherName, s.motherEmail, s.fatherName, s.fatherEmail, s.address,
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "gurukul-students.csv"; a.click();
  }

  const statusBadge = { Paid: "bg-green-100 text-green-700", Pending: "bg-orange-100 text-orange-700", Overdue: "bg-red-100 text-red-700" };

  const activeFilterCount = [
    filterCourse !== "All", filterLevel !== "All", filterSection !== "All",
    filterPayStatus !== "All", filterActive !== "All",
    filterCurricYear !== "All",
  ].filter(Boolean).length;

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (loadError) return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
      Could not load students: {loadError}
      <Button variant="outline" size="sm" onClick={loadStudents} className="ml-3">Retry</Button>
    </div>
  );

  return (
    <div className="flex flex-col h-full space-y-3">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-secondary">Student Management</h2>
          <p className="text-xs text-muted-foreground">
            {filtered.length} student{filtered.length !== 1 ? "s" : ""} found
            {filtered.length !== rawStudents.length && ` · ${rawStudents.length} total`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <Button onClick={() => setShowRegister(true)} size="sm" className="gap-1.5 rounded-xl text-xs h-9">
                <UserPlus className="w-3.5 h-3.5" /> Register
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => { setShowDuplicates(true); loadDuplicates(); }}
                className="gap-1.5 rounded-xl text-xs h-9 text-amber-700 border-amber-300 hover:bg-amber-50"
              >
                <GitMerge className="w-3.5 h-3.5" /> Find Duplicates
              </Button>
              {unlinkedCount > 0 && (
                <Button
                  variant="outline" size="sm"
                  onClick={runBackfill}
                  disabled={backfilling}
                  title={`${unlinkedCount} students are not linked to a temple member record`}
                  className="gap-1.5 rounded-xl text-xs h-9 text-amber-700 border-amber-300 hover:bg-amber-50"
                >
                  {backfilling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  {backfilling ? "Linking…" : `Link ${unlinkedCount} unlinked`}
                </Button>
              )}
            </>
          )}
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5 rounded-xl text-xs h-9">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      {/* ── Search + Filters toggle ── */}
      <div className="flex gap-2 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search name, ID, parent name or phone…"
            className="pl-9 rounded-xl h-9 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-secondary">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(f => !f)}
          className={`gap-1.5 rounded-xl h-9 text-xs shrink-0 ${activeFilterCount > 0 ? "border-primary text-primary bg-primary/5" : ""}`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-primary text-white text-[10px] flex items-center justify-center font-bold">{activeFilterCount}</span>
          )}
        </Button>
      </div>

      {/* ── Filter Panel ── */}
      {showFilters && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-3 shrink-0">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {/* Curriculum Year */}
            <div className="space-y-1.5 shrink-0">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Year</label>
              <select
                value={filterCurricYear}
                onChange={e => setFilterCurricYear(e.target.value)}
                className="text-xs border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary bg-white min-w-32"
              >
                <option value="All">All Years</option>
                {allYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Status</label>
              <div className="flex gap-1">
                {["All","Active","Inactive"].map(s => (
                  <button key={s} onClick={() => setFilterActive(s)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterActive === s ? "bg-primary text-white" : "bg-gray-100 text-muted-foreground hover:bg-gray-200"}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Course */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Course</label>
              <div className="flex flex-wrap gap-1">
                {allCourses.map(c => (
                  <button key={c} onClick={() => setFilterCourse(c)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterCourse === c ? "bg-primary text-white" : "bg-gray-100 text-muted-foreground hover:bg-gray-200"}`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Level */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Level</label>
              <div className="flex flex-wrap gap-1">
                {allLevels.map(l => (
                  <button key={l} onClick={() => setFilterLevel(l)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterLevel === l ? "bg-primary text-white" : "bg-gray-100 text-muted-foreground hover:bg-gray-200"}`}>
                    {l === "All" ? "All" : l.replace("Level ", "L")}
                  </button>
                ))}
              </div>
            </div>

            {/* Section */}
            {allSections.length > 1 && (
              <div className="space-y-1.5 shrink-0">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Section</label>
                <select
                  value={filterSection}
                  onChange={e => setFilterSection(e.target.value)}
                  className="text-xs border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-primary bg-white min-w-32"
                >
                  {allSections.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            {/* Payment Status */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Payment</label>
              <div className="flex flex-wrap gap-1">
                {["All","Paid","Pending","Overdue"].map(p => (
                  <button key={p} onClick={() => setFilterPayStatus(p)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${filterPayStatus === p ? "bg-primary text-white" : "bg-gray-100 text-muted-foreground hover:bg-gray-200"}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="pt-1 border-t border-border">
              <button
                onClick={() => { setFilterCourse("All"); setFilterLevel("All"); setFilterSection("All"); setFilterPayStatus("All"); setFilterActive("All"); setFilterCurricYear("All"); }}
                className="text-xs text-red-500 hover:text-red-700 font-medium"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Bulk Actions Bar ── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-xl shrink-0 flex-wrap">
          <span className="text-sm font-semibold text-primary mr-2">{selected.size} selected</span>
          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs rounded-lg text-green-700 border-green-300 hover:bg-green-50"
            onClick={() => setConfirmActive(true)}>
            <UserCheck className="w-3.5 h-3.5" /> Mark Active
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs rounded-lg text-amber-700 border-amber-300 hover:bg-amber-50"
            onClick={() => setConfirmInactive(true)}>
            <UserX className="w-3.5 h-3.5" /> Mark Inactive
          </Button>
          {isAdmin && (
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs rounded-lg text-red-600 border-red-300 hover:bg-red-50"
              onClick={() => setConfirmDelete(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Delete Selected
            </Button>
          )}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col flex-1 min-h-0">
        <div ref={tableRef} className="overflow-auto flex-1 min-h-[320px]">
          <table className="w-full min-w-[1050px] text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-border shadow-sm">
              <tr>
                {/* Checkbox */}
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={el => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                {[
                  { label: "ID",      key: "id"            as SortKey, w: "w-16"  },
                  { label: "Name",    key: "name"          as SortKey, w: "w-36"  },
                  { label: "Grade",   key: "grade"         as SortKey, w: "w-16"  },
                  { label: "Course / Level / Section", key: "primaryCourse" as SortKey, w: "w-56" },
                  { label: "Parent Contact",                            w: "w-52", noSort: true },
                  { label: "Payment", key: "worstPayStatus" as SortKey, w: "w-28" },
                  { label: "Mem. Fee",                                  w: "w-24", noSort: true },
                  { label: "Status",  key: "isActive"      as SortKey, w: "w-20"  },
                  { label: "",                                          w: "w-16", noSort: true },
                ].map((col) => (
                  <th
                    key={col.label || "actions"}
                    className={`text-left font-semibold text-muted-foreground px-3 py-2.5 whitespace-nowrap select-none ${col.w} ${!col.noSort && col.key ? "cursor-pointer hover:text-secondary transition-colors" : ""}`}
                    onClick={() => !col.noSort && col.key && toggleSort(col.key as SortKey)}
                  >
                    {col.label}
                    {!col.noSort && col.key && <SortIcon k={col.key as SortKey} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-16 text-muted-foreground text-sm">
                    {rawStudents.length > 0 ? (
                      <>
                        No students match the selected filters.
                        <button
                          onClick={() => { setSearch(""); setFilterCourse("All"); setFilterLevel("All"); setFilterSection("All"); setFilterPayStatus("All"); setFilterActive("All"); setFilterCurricYear("All"); }}
                          className="text-primary hover:underline ml-1"
                        >
                          Show all students
                        </button>
                      </>
                    ) : (
                      <>
                        No students registered yet.
                        {isAdmin && <> <button onClick={() => setShowRegister(true)} className="text-primary hover:underline ml-1">Register one?</button></>}
                      </>
                    )}
                  </td>
                </tr>
              )}
              {paginated.map((s) => (
                <tr
                  key={s.id}
                  className={`border-b border-border/50 transition-colors ${selected.has(s.id) ? "bg-primary/5" : "hover:bg-gray-50"} ${!s.isActive ? "opacity-60" : ""}`}
                >
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="rounded" />
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">{s.id}</td>
                  <td className="px-3 py-2 font-medium text-secondary whitespace-nowrap max-w-[140px] truncate" title={s.name}>{s.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.grade || "—"}</td>
                  <td className="px-3 py-2">
                    {currentEnrollments(s).length === 0
                      ? <span className="text-muted-foreground">—</span>
                      : <div className="flex flex-col gap-1">
                          {currentEnrollments(s).map(e => (
                            <div key={e.enrollmentId} className="flex items-center gap-1 flex-wrap">
                              <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[11px] font-medium whitespace-nowrap">
                                {e.courseIcon} {e.course}
                              </span>
                              {e.level && <span className="text-[11px] text-muted-foreground whitespace-nowrap">{e.level}</span>}
                              {e.section && <span className="px-1 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-100 text-[11px] font-medium whitespace-nowrap">{e.section}</span>}
                            </div>
                          ))}
                        </div>
                    }
                  </td>
                  <td className="px-3 py-2">
                    <div className="space-y-0.5">
                      {(s.motherName || s.motherPhone || s.motherEmail) && (
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                          <span className="font-semibold text-pink-500 shrink-0">M</span>
                          {s.motherPhone && <span className="flex items-center gap-0.5 text-muted-foreground whitespace-nowrap"><Phone className="w-2.5 h-2.5" />{s.motherPhone}</span>}
                          {s.motherEmail && <span className="flex items-center gap-0.5 text-muted-foreground truncate max-w-[160px]"><Mail className="w-2.5 h-2.5 shrink-0" />{s.motherEmail}</span>}
                        </div>
                      )}
                      {(s.fatherName || s.fatherPhone || s.fatherEmail) && (
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                          <span className="font-semibold text-blue-500 shrink-0">F</span>
                          {s.fatherPhone && <span className="flex items-center gap-0.5 text-muted-foreground whitespace-nowrap"><Phone className="w-2.5 h-2.5" />{s.fatherPhone}</span>}
                          {s.fatherEmail && <span className="flex items-center gap-0.5 text-muted-foreground truncate max-w-[160px]"><Mail className="w-2.5 h-2.5 shrink-0" />{s.fatherEmail}</span>}
                        </div>
                      )}
                      {!s.motherPhone && !s.motherEmail && !s.fatherPhone && !s.fatherEmail && (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </div>
                  </td>
                  <td
                    className="px-3 py-2 cursor-pointer group"
                    title="Click to view payment details"
                    onClick={() => setPaymentDrawer(s)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded-full font-medium text-[11px] ${statusBadge[s.worstPayStatus]}`}>
                        {s.worstPayStatus}
                      </span>
                      <span className="text-xs font-medium text-green-700 whitespace-nowrap">${s.totalPaid.toFixed(0)}</span>
                      <CreditCard className="w-3 h-3 text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0" />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {s.memFeeStatus
                      ? <span className={`px-2 py-0.5 rounded-full font-medium text-[11px] ${s.memFeeStatus === "Paid" ? "bg-emerald-100 text-emerald-700" : s.memFeeStatus === "Overdue" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {s.memFeeStatus}
                        </span>
                      : <span className="text-muted-foreground/40 text-[11px]">—</span>
                    }
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${s.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {s.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        title="Edit student"
                        onClick={() => setEditStudent(s)}
                        className="p-1 rounded hover:bg-gray-100 text-muted-foreground hover:text-secondary transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        title={s.isActive ? "Mark inactive" : "Mark active"}
                        onClick={async () => {
                          try {
                            await adminApi.students.setStatus(s.id, !s.isActive);
                            toast.success(`${s.name} marked ${!s.isActive ? "active" : "inactive"}`);
                            loadStudents();
                          } catch { toast.error("Failed to update status"); }
                        }}
                        className="p-1 rounded hover:bg-gray-100 text-muted-foreground hover:text-secondary transition-colors"
                      >
                        {s.isActive ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                      </button>
                      {isAdmin && (
                        <button
                          title="Delete student"
                          onClick={() => { setSelected(new Set([s.id])); setConfirmDelete(true); }}
                          className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-3 bg-gray-50 shrink-0 flex-wrap gap-y-2">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            {selected.size > 0 && <span className="ml-2 text-primary font-medium">· {selected.size} selected</span>}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 1}
              className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-secondary hover:border-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Page</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={pageInput}
                onChange={e => setPageInput(e.target.value)}
                onBlur={() => goToPage(parseInt(pageInput) || 1)}
                onKeyDown={e => e.key === "Enter" && goToPage(parseInt(pageInput) || 1)}
                className="w-12 text-center border border-border rounded-lg px-1 py-1 focus:outline-none focus:border-primary text-xs"
              />
              <span className="text-muted-foreground">of {totalPages}</span>
            </div>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-secondary hover:border-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Panels & Dialogs ── */}
      {showRegister && (
        <RegisterStudentPanel onClose={() => setShowRegister(false)} onRegistered={() => { setShowRegister(false); loadStudents(); }} />
      )}

      {editStudent && (
        <EditStudentPanel
          student={editStudent}
          curriculumYears={activeYearsListLong}
          onClose={() => setEditStudent(null)}
          onSaved={() => { setEditStudent(null); loadStudents(); }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          danger
          title={`Delete ${selected.size} Student${selected.size !== 1 ? "s" : ""}?`}
          message={`This will permanently remove ${selected.size} student record${selected.size !== 1 ? "s" : ""} including all enrollments, attendance, and payment data. This cannot be undone.`}
          confirmLabel={`Delete ${selected.size} Student${selected.size !== 1 ? "s" : ""}`}
          loading={actionLoading}
          onConfirm={doBulkDelete}
          onCancel={() => { setConfirmDelete(false); if (selected.size === 1) setSelected(new Set()); }}
        />
      )}

      {confirmInactive && (
        <ConfirmDialog
          title={`Mark ${selected.size} Student${selected.size !== 1 ? "s" : ""} Inactive?`}
          message={`These students will be marked inactive. They will remain in the system but appear dimmed in the list. You can reactivate them at any time.`}
          confirmLabel="Mark Inactive"
          loading={actionLoading}
          onConfirm={() => doBulkSetStatus(false)}
          onCancel={() => setConfirmInactive(false)}
        />
      )}

      {confirmActive && (
        <ConfirmDialog
          title={`Mark ${selected.size} Student${selected.size !== 1 ? "s" : ""} Active?`}
          message={`These students will be marked active and will appear normally in all views.`}
          confirmLabel="Mark Active"
          loading={actionLoading}
          onConfirm={() => doBulkSetStatus(true)}
          onCancel={() => setConfirmActive(false)}
        />
      )}

      {paymentDrawer && (
        <PaymentDrawer
          student={paymentDrawer}
          onClose={() => setPaymentDrawer(null)}
          onRefresh={() => {
            loadStudents();
            // keep the drawer open but the student reference will be stale until rawStudents updates
          }}
        />
      )}

      {showDuplicates && (
        <DuplicatesModal
          groups={dupGroups.map(group => group.map(item => {
            const student = rawStudents.find(candidate => candidate.id === item.studentCode);
            return { ...item, enrollCount: student ? currentEnrollments(student).length : 0 };
          }))}
          loading={dupLoading}
          mergingGroup={mergingGroup}
          onMerge={handleMerge}
          onClose={() => setShowDuplicates(false)}
        />
      )}
    </div>
  );
}

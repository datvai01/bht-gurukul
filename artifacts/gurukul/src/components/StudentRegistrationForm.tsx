import { useState, useEffect, useCallback, useRef } from "react";
import { adminApi, type CurrentRegistrationSummary } from "@/lib/adminApi";
import { membershipExpiryLabel, membershipStatus, templeYear } from "@/lib/membership";
import { ensureRegistrationMember, type SavedRegistrationMember } from "@/lib/registration-member";
import { resolveParentDetails, type PrimaryMemberRole } from "@/lib/primary-member";
import {
  AddressFields, EMPTY_ADDRESS, formatAddressParts, isCompleteAddress, parseAddress, validateAddressParts,
  type AddressErrors, type AddressParts,
} from "@/components/registration/AddressFields";
import {
  validateUSPhone as _validateUSPhone,
  validateEmail as _validateEmail,
  validatePersonName as _validatePersonName,
  validateAddress as _validateAddress,
  formatUSPhone,
} from "@/lib/validators";
import {
  Loader2, Plus, Trash2, BookOpen, GraduationCap, Users,
  Search, UserCheck, UserPlus, ChevronRight, ShieldCheck,
  AlertCircle, BadgeDollarSign, RefreshCw, Receipt, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_AGE = 22;
const DEFAULT_MIN_AGE = 5;

function templeToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dateYearsAgo(years: number): string {
  const [year, month, day] = templeToday().split("-").map(Number);
  const lastDayOfMonth = new Date(Date.UTC(year - years, month, 0)).getUTCDate();
  const date = new Date(Date.UTC(year - years, month - 1, Math.min(day, lastDayOfMonth)));
  return date.toISOString().slice(0, 10);
}

function ageOnDate(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const birthDate = new Date(year, month - 1, day);
  if (
    Number.isNaN(birthDate.getTime()) ||
    birthDate.getFullYear() !== year ||
    birthDate.getMonth() !== month - 1 ||
    birthDate.getDate() !== day
  ) return null;
  const [todayYear, todayMonth, todayDay] = templeToday().split("-").map(Number);
  let age = todayYear - year;
  if (
    todayMonth < month ||
    (todayMonth === month && todayDay < day)
  ) age--;
  return age;
}

const GRADES = [
  "Kindergarten","1st","2nd","3rd","4th","5th","6th",
  "7th","8th","9th","10th","11th","12th",
];

const EMPLOYERS_LIST = [
  "Accenture",
  "Amazon",
  "American Electric Power (AEP)",
  "Bath & Body Works",
  "Cardinal Health",
  "Chipotle Mexican Grill",
  "Honda of America Manufacturing",
  "Huntington National Bank",
  "IBM",
  "JPMorgan Chase",
  "Microsoft",
  "Nationwide Children's Hospital",
  "Nationwide Insurance",
  "OhioHealth",
  "Ohio State University",
  "Oracle",
  "PricewaterhouseCoopers (PwC)",
  "Safelite AutoGlass",
  "State of Ohio",
  "Tata Consultancy Services",
  "Tech Mahindra",
  "Victoria's Secret & Co.",
  "Walmart",
  "Wipro",
  "Worthington Industries",
  "Prefer Not to Disclose",
  "Other (please specify)",
];

// ─── Validation helpers ───────────────────────────────────────────────────────

function validatePhone(v: string): string { return _validateUSPhone(v, true); }
function validateEmail(v: string): string { return _validateEmail(v, true); }
function validatePersonName(v: string, label: string): string { return _validatePersonName(v, label); }

function validateDob(v: string, minimumAge: number): string {
  if (!v) return "Date of birth is required.";
  if (v >= templeToday()) return "Date of birth must be in the past.";
  const ageYears = ageOnDate(v);
  if (ageYears === null) return "Please enter a valid date.";
  if (ageYears < minimumAge) return `Student must be at least ${minimumAge} years old for the selected course${minimumAge === 1 ? "" : "s"}.`;
  if (ageYears > MAX_AGE) return `Please check the date of birth — the student appears to be over ${MAX_AGE} years old.`;
  return "";
}

function validateAddress(v: string): string { return _validateAddress(v); }

function validateLookupInput(v: string): string {
  return _validateUSPhone(v, true);
}

function isMemberNotFoundError(error: unknown): boolean {
  return error instanceof Error && /^no member found with that phone number\.?$/i.test(error.message.trim());
}

function errorStatus(error: unknown): number | undefined {
  return error instanceof Error ? (error as Error & { status?: number }).status : undefined;
}

function formatRegistrationDate(value: string): string {
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function isActiveEnrollmentStatus(status: string): boolean {
  const normalized = status.trim().toLocaleLowerCase();
  return normalized === "enrolled" || normalized === "active";
}

function focusFirstFieldError() {
  requestAnimationFrame(() => {
    const first = document.querySelector<HTMLElement>('[data-field-error="true"]');
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
    first?.focus({ preventScroll: true });
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MetaSection  = { id: number; sectionName: string; schedule: string };
type MetaLevel    = { id: number; levelNumber: number; className: string; sections: MetaSection[] };
export type MetaCourse = { id: number; name: string; icon: string; fee?: number | null; ageGroup?: string | null; levels: MetaLevel[] };
type Meta         = { nextCode: string; courses: MetaCourse[] };

function minimumAgeForCourse(course: MetaCourse | undefined): number {
  const match = course?.ageGroup?.match(/\b(\d+)\s*(?:\+|(?:-|–|to)\s*\d+)/i);
  return match ? Number(match[1]) : DEFAULT_MIN_AGE;
}

type FoundMember  = {
  id: number;
  memberCode: string | null;
  memberContextToken: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  employer: string | null;
  address: string | null;
  membershipYear: number | null;
  createdAt: string;
  memFeeStatus: string | null;
  memFeePaid: number;
  memFeeDue: number;
};

type LinkedStudent = {
  id: number;
  studentCode: string;
  name: string;
  dob: string | null;
  grade: string | null;
  curriculumYear: string | null;
  motherName: string | null;
  motherPhone: string | null;
  motherEmail: string | null;
  motherEmployer: string | null;
  fatherName: string | null;
  fatherPhone: string | null;
  fatherEmail: string | null;
  fatherEmployer: string | null;
  address: string | null;
  volunteerParent: boolean | null;
  volunteerArea: string | null;
};

type EnrollmentDraft = {
  key:       number;
  courseId:  number | "";
  levelId:   number | "";
  sectionId: number | "";
  amountDue: string;
};

type ExistingSubjectDraft = { courseLevelId: number | ""; sectionId: number | null };

type Errors = Record<string, string>;

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-red-600 mt-1 flex items-center gap-1" role="alert">
      <AlertCircle className="w-3 h-3 shrink-0" /> {msg}
    </p>
  );
}

function Field({
  label, required, error, hint, children,
}: {
  label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-secondary mb-1 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="ml-1.5 font-normal text-muted-foreground">({hint})</span>}
      </label>
      {children}
      <FieldError msg={error} />
    </div>
  );
}

function SectionLabel({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-border mb-4">
      <span className="text-primary">{icon}</span>
      <span className="text-sm font-bold text-secondary uppercase tracking-wide">{title}</span>
    </div>
  );
}

function CurrentRegistrationCard({
  summary, selectedAction, onSelectAction, onChangeSelection, readOnly = false,
}: {
  summary: CurrentRegistrationSummary;
  selectedAction: "change" | "add" | "keep" | null;
  onSelectAction: (action: "change" | "add" | "keep") => void;
  onChangeSelection: () => void;
  readOnly?: boolean;
}) {
  const registeredDate = formatRegistrationDate(summary.registeredAt);
  return (
    <div className="p-4 rounded-xl bg-white border border-blue-200 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-secondary">{summary.studentName}'s current registration</p>
          <p className="text-xs text-muted-foreground">
            {summary.dateSource === "first_enrollment" ? "First recorded enrollment date" : "Registered"} {registeredDate}{summary.curriculumYear ? ` · ${summary.curriculumYear}` : ""}
          </p>
        </div>
        <button type="button" onClick={onChangeSelection} className="text-xs font-medium text-blue-700 hover:underline">
          Choose another student
        </button>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current subjects</p>
        {summary.subjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subjects are listed.</p>
        ) : summary.subjects.map(subject => (
          <div key={subject.enrollmentId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium text-secondary">
              {subject.courseName} · {subject.className}{subject.sectionName ? ` · ${subject.sectionName}` : ""}
            </span>
            <span className="text-xs text-muted-foreground">{subject.status}</span>
          </div>
        ))}
      </div>
      {!readOnly && <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What would you like to do?</legend>
        {([
          ["change", "Change Existing Registration", "(add or remove subjects)"],
          ["add", "Add More Subjects", "(append courses not already active)"],
          ["keep", "Keep Current Registration", "(read-only summary)"],
        ] as const).map(([action, label, detail]) => (
          <label key={action} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
            selectedAction === action ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
          }`}>
            <input
              type="radio"
              name={`existing-registration-${summary.id}`}
              value={action}
              checked={selectedAction === action}
              onChange={() => onSelectAction(action)}
              className="mt-0.5 accent-primary"
            />
            <span><strong className="text-secondary">{label}</strong><span className="ml-1 text-xs text-muted-foreground">{detail}</span></span>
          </label>
        ))}
      </fieldset>}
    </div>
  );
}

function EmployerSelect({
  value, otherValue, onChange, onOtherChange, onBlur, error, cls,
}: {
  value: string; otherValue: string;
  onChange: (v: string) => void; onOtherChange: (v: string) => void;
  onBlur?: () => void; error?: string; cls: string;
}) {
  return (
    <div className="space-y-2">
      <select
        required
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        className={cls}
      >
        <option value="">— Select employer —</option>
        {EMPLOYERS_LIST.map(emp => <option key={emp} value={emp}>{emp}</option>)}
      </select>
      {value === "Other (please specify)" && (
        <input
          required
          value={otherValue}
          onChange={e => onOtherChange(e.target.value)}
          placeholder="Please type your employer's name"
          className={cls}
        />
      )}
      <FieldError msg={error} />
    </div>
  );
}

// ─── Main Form Component ──────────────────────────────────────────────────────

export type RegistrationPaymentInfo = {
  courseCount:    number;
  membershipFee:  number;  // in dollars
  courseFee:      number;  // per course in dollars
  memberId?:      number;  // resolved member id for post-payment recording
  isNewMember:    boolean; // true if this was a brand-new temple member
};

type Props = {
  onSuccess: (studentCode: string, studentName: string, paymentInfo: RegistrationPaymentInfo) => void;
  onBack?:   () => void;
  submitLabel?: string;
  adminMode?: boolean;
};

export function StudentRegistrationForm({ onSuccess, onBack, submitLabel = "Register Student", adminMode = false }: Props) {
  // ── Course meta ──
  const [meta, setMeta]       = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Phase control: "member-check" → "form" ──
  const [phase, setPhase] = useState<"member-check" | "form" | "existing-editor" | "existing-done">("member-check");

  // ── Phase 1: Member check ──
  const [isExistingMember, setIsExistingMember] = useState<boolean | null>(null);
  const [publicStep, setPublicStep] = useState<"choice" | "hint" | "otp" | "verified">("choice");
  const [phoneVerified, setPhoneVerified] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [existingIdentifier, setExistingIdentifier] = useState("");
  const [needsExistingIdentifier, setNeedsExistingIdentifier] = useState(false);
  const [phoneVerificationError, setPhoneVerificationError] = useState("");
  const [memberChoiceError, setMemberChoiceError] = useState("");
  const [lookupValue,      setLookupValue]      = useState("");
  const [lookupLoading,    setLookupLoading]    = useState(false);
  const [foundMember,      setFoundMember]      = useState<FoundMember | null>(null);
  const [lookupError,      setLookupError]      = useState("");
  const [linkedStudents,   setLinkedStudents]   = useState<LinkedStudent[]>([]);
  const [linkedLoading,    setLinkedLoading]    = useState(false);
  const [prefillSource,    setPrefillSource]    = useState<LinkedStudent | null>(null);
  const [accessStage, setAccessStage] = useState<"idle" | "verified">("idle");
  const [accessCode, setAccessCode] = useState("");
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [selectedExistingStudent, setSelectedExistingStudent] = useState<LinkedStudent | null>(null);
  const [currentRegistration, setCurrentRegistration] = useState<CurrentRegistrationSummary | null>(null);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const [existingAction, setExistingAction] = useState<"change" | "add" | "keep" | null>(null);
  const [editorSubjects, setEditorSubjects] = useState<ExistingSubjectDraft[]>([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const lookupSequence = useRef(0);
  const registrationSequence = useRef(0);

  const [addressParts, setAddressParts] = useState<AddressParts>({ ...EMPTY_ADDRESS });
  const [addressPartsErrors, setAddressPartsErrors] = useState<AddressErrors>({});
  const [addressConfirmed, setAddressConfirmed] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressSaveError, setAddressSaveError] = useState("");

  // New member fields (if not existing)
  const [memberName,  setMemberName]  = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberPhone, setMemberPhone] = useState("");
  const [memberEmployer, setMemberEmployer] = useState("");
  const [p1Errors,    setP1Errors]    = useState<Errors>({});
  const [contactEmailError, setContactEmailError] = useState("");
  const [advancingMember, setAdvancingMember] = useState(false);
  const advanceInFlight = useRef(false);

  // Inline member renewal (during registration for expired members)
  const [renewingMember, setRenewingMember] = useState(false);
  const [renewalAlreadyApplied, setRenewalAlreadyApplied] = useState(false);

  async function handleRenewMember() {
    if (!foundMember) return;
    setRenewingMember(true);
    try {
      const renewed = await adminApi.members.renew(foundMember.id);
      setFoundMember({ ...foundMember, createdAt: renewed.createdAt });
      setRenewalAlreadyApplied(true);
      setMembershipConfirmed(true);
      setMembershipRenewalOpted(true);
      setMembershipError("");
      toast.success("Membership renewed — you may now continue.");
    } catch (err) {
      toast.error((err as Error).message ?? "Renewal failed");
    } finally {
      setRenewingMember(false);
    }
  }

  // Membership renewal acknowledgment
  const [membershipConfirmed, setMembershipConfirmed] = useState(false);
  const [membershipError,     setMembershipError]     = useState("");
  // Whether this registration should include membership renewal fee
  const [membershipRenewalOpted, setMembershipRenewalOpted] = useState(false);

  // Resolved member id (set after lookup or creation)
  const [resolvedMemberId, setResolvedMemberId] = useState<number | null>(null);
  const [savedNewMember, setSavedNewMember] = useState<SavedRegistrationMember | null>(null);
  const [memberContextToken, setMemberContextToken] = useState<string | null>(null);
  const [primaryMemberRole, setPrimaryMemberRole] = useState<PrimaryMemberRole | null>(null);

  // ── Phase 2: Student fields ──
  const [saving,  setSaving]  = useState(false);
  const [errors,  setErrors]  = useState<Errors>({});

  const [firstName,   setFirstName]   = useState("");
  const [lastName,    setLastName]    = useState("");
  const [dob,         setDob]         = useState("");
  const [grade,       setGrade]       = useState("");
  const [curricYear,  setCurricYear]  = useState("");
  const [isNew,       setIsNew]       = useState(true);

  // ── Registration window (loaded from /api/settings) ──────────────────────────
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);
  const [registrationSettingsError, setRegistrationSettingsError] = useState("");

  const [motherName,          setMotherName]          = useState("");
  const [motherPhone,         setMotherPhone]         = useState("");
  const [motherEmail,         setMotherEmail]         = useState("");
  const [motherEmployer,      setMotherEmployer]      = useState("");
  const [motherEmployerOther, setMotherEmployerOther] = useState("");

  const [fatherName,          setFatherName]          = useState("");
  const [fatherPhone,         setFatherPhone]         = useState("");
  const [fatherEmail,         setFatherEmail]         = useState("");
  const [fatherEmployer,      setFatherEmployer]      = useState("");
  const [fatherEmployerOther, setFatherEmployerOther] = useState("");

  const [address, setAddress] = useState("");

  const [volunteerParent, setVolunteerParent] = useState(false);
  const [volunteerArea,   setVolunteerArea]   = useState("");


  const [policyAgreed, setPolicyAgreed] = useState(false);

  // ── Fee settings (loaded from portal settings) ──
  const [membershipFee, setMembershipFee] = useState(150);
  const [courseFee,     setCourseFee]     = useState(35);

  const [enrollments, setEnrollments] = useState<EnrollmentDraft[]>([
    { key: 0, courseId: "", levelId: "", sectionId: "", amountDue: "35.00" },
  ]);
  const [draftKey, setDraftKey] = useState(1);
  const courseMinimumAge = Math.max(
    DEFAULT_MIN_AGE,
    ...enrollments
      .filter(enrollment => enrollment.courseId)
      .map(enrollment => minimumAgeForCourse(meta?.courses.find(course => course.id === enrollment.courseId))),
  );
  const dateMax = dateYearsAgo(courseMinimumAge);
  const dateMin = dateYearsAgo(MAX_AGE);

  useEffect(() => {
    adminApi.students.meta()
      .then((d) => setMeta(d as Meta))
      .catch(() => toast.error("Failed to load course data"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then(r => {
        if (!r.ok) throw new Error("Settings request failed");
        return r.json();
      })
      .then((s: Record<string, string>) => {
        const mf = parseFloat(s.stripe_membership_fee ?? "150");
        const cf = parseFloat(s.stripe_course_fee ?? "35");
        if (!isNaN(mf) && mf > 0) {
          setMembershipFee(mf);
        }
        if (!isNaN(cf) && cf > 0) {
          setCourseFee(cf);
          setEnrollments(prev => prev.map(e => ({ ...e, amountDue: cf.toFixed(2) })));
        }
        // ── Registration window ──
        const rcy = s.registration_curriculum_year?.trim() || "";
        const rod = s.registration_open_date  || "";
        const rcd = s.registration_close_date || "";
        if (!rcy) {
          setRegistrationSettingsError("The registration curriculum year is not configured in Settings.");
          setRegistrationOpen(false);
          return;
        }
        // Always default to the active curriculum year from settings
        setCurricYear(rcy);
        // Compute whether window is open
        if (rod && rcd) {
          const today = templeToday();
          setRegistrationOpen(today >= rod && today <= rcd);
        } else {
          setRegistrationOpen(false); // no window configured → closed
        }
      })
      .catch(() => {
        setRegistrationSettingsError("Registration settings could not be loaded. Please try again later.");
        setRegistrationOpen(false);
      });
  }, []); // adminMode is a stable prop — safe with empty deps

  // Active existing members need no acknowledgment; new members must explicitly agree.
  useEffect(() => {
    if (isExistingMember === false) {
      setMembershipRenewalOpted(true); // new members always pay membership fee
      return;
    }
    if (isExistingMember === true && foundMember) {
      const isActive = membershipStatus(foundMember.createdAt).isActive;
      if (isActive) {
        setMembershipConfirmed(true);
        // If membership fee is already paid for the current year, disable renewal opt-in
        if (foundMember.memFeeStatus === "Paid") {
          setMembershipRenewalOpted(false);
        }
        // Otherwise renewal is optional — keep whatever the checkbox says (default false)
      } else {
        // Expired members: renewal is mandatory once they click the renew button (set via handleRenewMember)
      }
    }
  }, [foundMember, isExistingMember]);

  // ── Computed employer values (resolve "Other" to custom text) ──
  const enteredMotherEmployer = motherEmployer === "Other (please specify)"
    ? motherEmployerOther.trim() : motherEmployer;
  const enteredFatherEmployer = fatherEmployer === "Other (please specify)"
    ? fatherEmployerOther.trim() : fatherEmployer;
  const primaryMember = isExistingMember ? foundMember : savedNewMember;
  const { mother: registrationMother, father: registrationFather } = resolveParentDetails(
    primaryMemberRole, primaryMember,
    { name: motherName, phone: motherPhone, email: motherEmail, employer: enteredMotherEmployer },
    { name: fatherName, phone: fatherPhone, email: fatherEmail, employer: enteredFatherEmployer },
  );
  const effectiveMotherEmployer = registrationMother.employer;
  const effectiveFatherEmployer = registrationFather.employer;

  // ── Enrollment helpers ──
  function addEnrollment() {
    setEnrollments(prev => [...prev, { key: draftKey, courseId: "", levelId: "", sectionId: "", amountDue: courseFee.toFixed(2) }]);
    setDraftKey(k => k + 1);
  }
  function removeEnrollment(key: number) {
    setEnrollments(prev => prev.filter(e => e.key !== key));
  }
  function updateEnrollment(key: number, patch: Partial<EnrollmentDraft>) {
    if (patch.courseId !== undefined) {
      setErrors(prev => ({ ...prev, [`course-${key}`]: "", [`level-${key}`]: "", dob: "" }));
    } else if (patch.levelId !== undefined) {
      setErrors(prev => ({ ...prev, [`level-${key}`]: "" }));
    }
    setEnrollments(prev => prev.map(e => {
      // When the course changes, auto-set amountDue from the course's own fee (or global fallback)
      if (patch.courseId !== undefined && patch.amountDue === undefined) {
        const course = meta?.courses.find(c => c.id === patch.courseId);
        patch = { ...patch, amountDue: course?.fee != null ? course.fee.toFixed(2) : courseFee.toFixed(2) };
      }
      if (e.key !== key) return e;
      const updated = { ...e, ...patch };
      if (patch.courseId !== undefined) { updated.levelId = ""; updated.sectionId = ""; }
      if (patch.levelId  !== undefined) { updated.sectionId = ""; }
      return updated;
    }));
  }

  // ── Blur handlers (Phase 2) ──
  const blurField = useCallback((field: string, value: string) => {
    let msg = "";
    switch (field) {
      case "firstName":         msg = validatePersonName(value, "First name"); break;
      case "lastName":          msg = validatePersonName(value, "Last name"); break;
      case "dob":               msg = validateDob(value, courseMinimumAge); break;
      case "grade":             msg = value ? "" : "Please select a grade."; break;
      case "curricYear":        msg = value ? "" : "Please select a curriculum year."; break;
      case "motherName":        msg = validatePersonName(value, "Mother's name"); break;
      case "motherPhone":       msg = validatePhone(value); break;
      case "motherEmail":       msg = validateEmail(value); break;
      case "motherEmployer":    msg = value ? "" : "Please select an employer."; break;
      case "motherEmployerOther": msg = value.trim() ? "" : "Please specify your employer."; break;
      case "fatherName":        msg = validatePersonName(value, "Father's name"); break;
      case "fatherPhone":       msg = validatePhone(value); break;
      case "fatherEmail":       msg = validateEmail(value); break;
      case "fatherEmployer":    msg = value ? "" : "Please select an employer."; break;
      case "fatherEmployerOther": msg = value.trim() ? "" : "Please specify your employer."; break;
      case "address":           msg = validateAddress(value); break;
      case "volunteerArea":     msg = value.trim() ? "" : "Please describe the volunteer area."; break;
    }
    setErrors(prev => ({ ...prev, [field]: msg }));
  }, [courseMinimumAge]);

  // ── Phase 2: Validate all fields ──
  function validateAll(): boolean {
    const e: Errors = {
      primaryMemberRole: primaryMemberRole ? "" : "Choose the mother or father who is the Primary Member.",
      firstName:         validatePersonName(firstName, "First name"),
      lastName:          validatePersonName(lastName, "Last name"),
      dob:               validateDob(dob, courseMinimumAge),
      grade:             grade ? "" : "Please select a grade.",
      curricYear:        curricYear ? "" : "Please select a curriculum year.",
      motherName:        validatePersonName(registrationMother.name, "Mother's name"),
      motherPhone:       validatePhone(registrationMother.phone),
      motherEmail:       validateEmail(registrationMother.email),
      motherEmployer:    effectiveMotherEmployer ? "" : "Please select an employer.",
      motherEmployerOther: (primaryMemberRole !== "mother" || !primaryMember?.employer) && motherEmployer === "Other (please specify)" && !motherEmployerOther.trim()
        ? "Please specify your employer." : "",
      fatherName:        validatePersonName(registrationFather.name, "Father's name"),
      fatherPhone:       validatePhone(registrationFather.phone),
      fatherEmail:       validateEmail(registrationFather.email),
      fatherEmployer:    effectiveFatherEmployer ? "" : "Please select an employer.",
      fatherEmployerOther: (primaryMemberRole !== "father" || !primaryMember?.employer) && fatherEmployer === "Other (please specify)" && !fatherEmployerOther.trim()
        ? "Please specify your employer." : "",
      address:           validateAddress(address),
      volunteerArea:     volunteerParent && !volunteerArea.trim()
        ? "Please describe the volunteer area." : "",
      policyAgreed:      policyAgreed ? "" : "Please read and agree to the Temple policies before submitting.",
    };
    enrollments.forEach(enrollment => {
      if (!enrollment.courseId) e[`course-${enrollment.key}`] = "Please select a course.";
      else if (!enrollment.levelId) e[`level-${enrollment.key}`] = "Please select a level.";
    });
    setErrors(e);
    return !Object.values(e).some(Boolean);
  }

  // ── Phase 1: Lookup ──
  function clearRegistrationIdentity() {
    lookupSequence.current++;
    registrationSequence.current++;
    setFoundMember(null);
    setMemberContextToken(null);
    setResolvedMemberId(null);
    setSavedNewMember(null);
    setLinkedStudents([]);
    setPrefillSource(null);
    setSelectedExistingStudent(null);
    setCurrentRegistration(null);
    setRegistrationError("");
    setExistingAction(null);
    setAccessStage("idle");
    setAccessError("");
    setAccessCode("");
    setLookupValue("");
    setContactEmail("");
    setExistingIdentifier("");
    setNeedsExistingIdentifier(false);
    setMaskedEmail("");
    setPhoneVerified("");
    setLookupError("");
    setLookupLoading(false);
    setLinkedLoading(false);
    setAddress("");
    setAddressConfirmed(false);
    setEditingAddress(false);
    setAddressSaving(false);
    setAddressSaveError("");
    setAddressParts({ ...EMPTY_ADDRESS });
    setAddressPartsErrors({});
    setMemberName("");
    setMemberEmail("");
    setMemberPhone("");
    setMemberEmployer("");
    setP1Errors({});
    setMembershipConfirmed(false);
    setMembershipError("");
    setMembershipRenewalOpted(false);
    setRenewalAlreadyApplied(false);
    setPrimaryMemberRole(null);
    setFirstName("");
    setLastName("");
    setDob("");
    setGrade("");
    setMotherName("");
    setMotherPhone("");
    setMotherEmail("");
    setMotherEmployer("");
    setMotherEmployerOther("");
    setFatherName("");
    setFatherPhone("");
    setFatherEmail("");
    setFatherEmployer("");
    setFatherEmployerOther("");
    setVolunteerParent(false);
    setVolunteerArea("");
    setPolicyAgreed(false);
    setIsNew(true);
    setErrors({});
  }

  function changeVerifiedContacts() {
    const phone = lookupValue;
    const email = contactEmail;
    clearRegistrationIdentity();
    setLookupValue(phone);
    setContactEmail(email);
    setPhoneVerified("");
    setMaskedEmail("");
    setPhoneVerificationError("");
    setContactEmailError("");
    setAccessStage("idle");
    setPublicStep("choice");
  }

  async function checkExistingEmail() {
    const digits = lookupValue.replace(/\D/g, "");
    const error = validateLookupInput(digits);
    if (error) { setLookupError(error); return; }
    setLookupError("");
    setPhoneVerificationError("");
    setLookupLoading(true);
    try {
      const result = await adminApi.members.existingEmailHint({
        phone: digits, ...(existingIdentifier.trim() ? { identifier: existingIdentifier.trim() } : {}),
      });
      setMaskedEmail(result.maskedEmail);
      setPublicStep("hint");
      setNeedsExistingIdentifier(false);
    } catch (err) {
      if (errorStatus(err) === 409) {
        setNeedsExistingIdentifier(err instanceof Error && err.message.includes("More than one"));
        setLookupError(err instanceof Error ? err.message : "Enter your registered last name or Member ID.");
      } else if (errorStatus(err) === 404) {
        setLookupError("We couldn't find a membership associated with this mobile number. Please check the number and try again. If you're a new member, select New Member to continue.");
      } else {
        setLookupError(err instanceof Error ? err.message : "Could not check this mobile number.");
      }
    } finally {
      setLookupLoading(false);
    }
  }

  async function requestEmailCode() {
    const digits = lookupValue.replace(/\D/g, "");
    const phoneError = validateLookupInput(digits);
    const emailError = isExistingMember ? "" : validateEmail(contactEmail);
    if (isExistingMember === null) {
      setMemberChoiceError("Please choose whether you are an existing or new member.");
      return;
    }
    setMemberChoiceError("");
    if (phoneError || emailError) {
      setLookupError(phoneError);
      setContactEmailError(emailError);
      return;
    }
    setLookupError("");
    setContactEmailError("");
    setPhoneVerificationError("");
    setAccessCode("");
    setLookupLoading(true);
    try {
      const result = await adminApi.members.requestEmailVerification({
        phone: digits,
        ...(!isExistingMember ? { email: contactEmail.trim() } : { identifier: existingIdentifier.trim() }),
        memberType: isExistingMember ? "existing" : "new",
      });
      setMaskedEmail(result.maskedEmail);
      setPublicStep("otp");
    } catch {
      setPhoneVerificationError("We could not verify the information provided. Please check your email address and phone number and try again. If you need help, contact the temple office at gurukul@bhtohio.org.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function verifyEmailCode() {
    const digits = lookupValue.replace(/\D/g, "");
    const code = accessCode.trim();
    if (!code) {
      setPhoneVerificationError("Enter the verification code sent to your email.");
      return;
    }
    setAccessLoading(true);
    setPhoneVerificationError("");
    const sequence = ++lookupSequence.current;
    try {
      const result = await adminApi.members.verifyEmailCode({
        phone: digits,
        ...(!isExistingMember ? { email: contactEmail.trim() } : { identifier: existingIdentifier.trim() }),
        code,
        memberType: isExistingMember ? "existing" : "new",
      });
      if (sequence !== lookupSequence.current) return;
      const shouldExist = isExistingMember === true;
      if (result.memberExists !== shouldExist) {
        setPhoneVerificationError(shouldExist
          ? "We could not verify the information provided. Please check your email address and phone number and try again. If you need help, contact the temple office at gurukul@bhtohio.org."
          : "We could not verify the information provided. Please use the existing-member option or contact the temple office at gurukul@bhtohio.org.");
        return;
      }
      setPhoneVerified(digits);
      setMemberPhone(formatUSPhone(digits));
      if (!shouldExist) setMemberEmail(contactEmail.trim());
      setAccessStage("verified");
      setPublicStep("verified");
      if (!shouldExist) {
        setMembershipRenewalOpted(true);
        return;
      }

      const member = await adminApi.members.lookup(digits) as FoundMember;
      if (sequence !== lookupSequence.current) return;
      await showVerifiedExistingMember(member, "", sequence);
    } catch {
      if (sequence === lookupSequence.current) {
        setPhoneVerificationError("We could not verify the information provided. Please check your email address and phone number and try again. If you need help, contact the temple office at gurukul@bhtohio.org.");
      }
    } finally {
      if (sequence === lookupSequence.current) setAccessLoading(false);
    }
  }

  async function handleLookup() {
    const raw = lookupValue.trim();
    const val = raw.replace(/\D/g, "");
    const err = validateLookupInput(val);
    if (err) { setLookupError(err); return; }
    setLookupError("");
    setFoundMember(null);
    setMemberContextToken(null);
    setRenewalAlreadyApplied(false);
    setAddressConfirmed(false);
    setAddress("");
    setEditingAddress(false);
    setAddressSaving(false);
    setAddressSaveError("");
    setLinkedStudents([]);
    setPrefillSource(null);
    setSelectedExistingStudent(null);
    setCurrentRegistration(null);
    setRegistrationError("");
    setExistingAction(null);
    setAccessStage("idle");
    setAccessError("");
    setAccessCode("");
    setLookupLoading(true);
    const sequence = ++lookupSequence.current;
    registrationSequence.current++;
    try {
      const m = await adminApi.members.lookup(val) as FoundMember;
      if (sequence !== lookupSequence.current) return;
      setFoundMember(m);
      setMemberContextToken(m.memberContextToken);
      setAddressParts(parseAddress(m.address));
      setAccessStage("verified");
      await loadLinkedStudents(m.id, sequence);
    } catch (err) {
      if (sequence === lookupSequence.current) {
        setFoundMember(null);
        setMemberContextToken(null);
        setLookupError(isMemberNotFoundError(err)
          ? "No member found with that phone number."
          : err instanceof Error ? err.message : "Could not look up your member record. Please try again.");
      }
    } finally {
      if (sequence === lookupSequence.current) setLookupLoading(false);
    }
  }

  async function loadLinkedStudents(memberId: number, sequence = lookupSequence.current) {
    setLinkedLoading(true);
    try {
      const students = await adminApi.members.studentsByMember(memberId);
      if (sequence === lookupSequence.current) setLinkedStudents(students);
    } catch (err) {
      if (sequence === lookupSequence.current) {
        setLinkedStudents([]);
        setAccessError(err instanceof Error ? err.message : "Could not load linked students.");
      }
    } finally {
      if (sequence === lookupSequence.current) setLinkedLoading(false);
    }
  }

  async function showVerifiedExistingMember(member: FoundMember, notice = "", sequence = lookupSequence.current) {
    if (sequence !== lookupSequence.current) return;
    setIsExistingMember(true);
    setFoundMember(member);
    setMemberContextToken(member.memberContextToken);
    setAddressParts(parseAddress(member.address));
    setAddress("");
    setAddressConfirmed(false);
    setEditingAddress(false);
    setAddressSaveError("");
    setSavedNewMember(null);
    setMemberName("");
    setMemberEmail("");
    setMemberEmployer("");
    setP1Errors({});
    setMembershipRenewalOpted(false);
    setMembershipConfirmed(false);
    setLookupError(notice);
    await loadLinkedStudents(member.id, sequence);
  }

  async function selectLinkedStudent(student: LinkedStudent) {
    if (!foundMember) return;
    setSelectedExistingStudent(student);
    setCurrentRegistration(null);
    setRegistrationError("");
    setRegistrationLoading(true);
    setExistingAction(null);
    prefillFromStudent(student);
    const selectionSequence = ++registrationSequence.current;
    try {
      const summary = await adminApi.students.currentRegistration(student.studentCode, foundMember.id);
      if (selectionSequence !== registrationSequence.current) return;
      setCurrentRegistration(summary);
      setEditorSubjects(summary.subjects
        .filter(subject => isActiveEnrollmentStatus(subject.status))
        .map(subject => ({ courseLevelId: subject.courseLevelId, sectionId: subject.sectionId })));
    } catch (err) {
      if (selectionSequence === registrationSequence.current && errorStatus(err) !== 404) {
        setRegistrationError(err instanceof Error ? err.message : "Could not load the current registration.");
      }
    } finally {
      if (selectionSequence === registrationSequence.current) setRegistrationLoading(false);
    }
  }

  function activeCurrentSubjects(summary = currentRegistration) {
    return (summary?.subjects ?? []).filter(subject => isActiveEnrollmentStatus(subject.status));
  }

  function activeCourseIds(summary = currentRegistration) {
    return new Set(activeCurrentSubjects(summary).map(subject => subject.courseId));
  }

  async function saveExistingRegistration() {
    if (!foundMember || !currentRegistration || !existingAction || existingAction === "keep") return;
    const activeSubjects = activeCurrentSubjects();
    const proposed = editorSubjects.filter(subject => subject.courseLevelId !== "");
    const activeCourseSet = activeCourseIds();
    const courseIds = proposed.map(subject => meta?.courses.find(course =>
      course.levels.some(level => level.id === subject.courseLevelId),
    )?.id);
    const hasDuplicateCourse = courseIds.some((courseId, index) =>
      courseId !== undefined && courseIds.indexOf(courseId) !== index,
    );
    const addsActiveCourse = existingAction === "add" && courseIds.some(courseId =>
      courseId !== undefined && activeCourseSet.has(courseId),
    );
    if (hasDuplicateCourse || addsActiveCourse) {
      setEditorError("Choose each course only once, and do not add courses that are already active.");
      return;
    }
    if (!proposed.length) {
      setEditorError(existingAction === "add"
        ? "Choose a course that is not already active in this registration."
        : "Keep at least one subject, or choose Add More Subjects.");
      return;
    }
    const payloadSubjects = proposed.map(subject => ({
      courseLevelId: Number(subject.courseLevelId),
      sectionId: subject.sectionId,
    }));
    const expectedEnrollments = activeSubjects.map(subject => ({
      enrollmentId: subject.enrollmentId,
      courseLevelId: subject.courseLevelId,
      sectionId: subject.sectionId,
    }));
    setEditorSaving(true);
    setEditorError("");
    try {
      const updated = await adminApi.students.updateCurrentRegistration(
        currentRegistration.studentCode,
        foundMember.id,
        {
          mode: existingAction,
          subjects: payloadSubjects,
          expectedEnrollments,
        },
      );
      setCurrentRegistration(updated);
      setEditorSubjects(activeCurrentSubjects(updated).map(subject => ({
        courseLevelId: subject.courseLevelId,
        sectionId: subject.sectionId,
      })));
      setPhase("existing-done");
    } catch (err) {
      if (errorStatus(err) === 409) {
        try {
          const fresh = await adminApi.students.currentRegistration(currentRegistration.studentCode, foundMember.id);
          setCurrentRegistration(fresh);
          setEditorSubjects(activeCurrentSubjects(fresh).map(subject => ({
            courseLevelId: subject.courseLevelId,
            sectionId: subject.sectionId,
          })));
          setEditorError("This registration changed in another session. The latest subjects are shown; review them and save again.");
        } catch (refreshError) {
          setEditorError(refreshError instanceof Error ? refreshError.message : "Registration changed, but the latest summary could not be refreshed.");
        }
      } else {
        setEditorError(err instanceof Error ? err.message : "Could not update this registration.");
      }
    } finally {
      setEditorSaving(false);
    }
  }

  async function saveUpdatedAddress() {
    if (!foundMember) return;
    const fieldErrors = validateAddressParts(addressParts);
    setAddressPartsErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) {
      focusFirstFieldError();
      return;
    }
    const formatted = formatAddressParts(addressParts);
    const memberId = foundMember.id;
    const sequence = lookupSequence.current;
    setAddressSaving(true);
    setAddressSaveError("");
    try {
      await adminApi.members.patch(memberId, { address: formatted });
      if (sequence !== lookupSequence.current) return;
      setFoundMember({ ...foundMember, address: formatted });
      setAddress(formatted);
      setAddressConfirmed(true);
      setEditingAddress(false);
      toast.success("Address updated on your member record.");
    } catch (err) {
      if (sequence === lookupSequence.current) setAddressSaveError(err instanceof Error ? err.message : "Could not update address.");
    } finally {
      if (sequence === lookupSequence.current) setAddressSaving(false);
    }
  }

  // ── Pre-fill Phase 2 fields from an existing student record ──
  function prefillFromStudent(s: LinkedStudent) {
    setPrefillSource(s);
    // Split stored full name into first / last
    const nameParts = (s.name ?? "").trim().split(/\s+/);
    setFirstName(nameParts[0] ?? "");
    setLastName(nameParts.slice(1).join(" ") ?? "");
    setDob(s.dob ?? "");
    setGrade(s.grade ?? "");
    // In admin mode use the student's existing year; in public mode keep the admin-controlled year
    // A returning student's previous registration year must not replace the
    // current year configured for this registration.
    // Mother
    setMotherName(s.motherName ?? "");
    setMotherPhone(formatUSPhone(s.motherPhone ?? ""));
    setMotherEmail(s.motherEmail ?? "");
    const mEmp = s.motherEmployer ?? "";
    if (!mEmp || EMPLOYERS_LIST.includes(mEmp)) {
      setMotherEmployer(mEmp);
      setMotherEmployerOther("");
    } else {
      setMotherEmployer("Other (please specify)");
      setMotherEmployerOther(mEmp);
    }
    // Father
    setFatherName(s.fatherName ?? "");
    setFatherPhone(formatUSPhone(s.fatherPhone ?? ""));
    setFatherEmail(s.fatherEmail ?? "");
    const fEmp = s.fatherEmployer ?? "";
    if (!fEmp || EMPLOYERS_LIST.includes(fEmp)) {
      setFatherEmployer(fEmp);
      setFatherEmployerOther("");
    } else {
      setFatherEmployer("Other (please specify)");
      setFatherEmployerOther(fEmp);
    }
    // Member address remains the source of truth; linked student addresses may be outdated.
    setVolunteerParent(s.volunteerParent ?? false);
    setVolunteerArea(s.volunteerArea ?? "");
    setErrors({});
  }

  // ── Derived: membership active state (shared across handlers and render) ──
  const memberIsActive = foundMember
    ? membershipStatus(foundMember.createdAt).isActive
    : false;
  const memberExpiry = foundMember
    ? membershipExpiryLabel(foundMember.createdAt)
    : null;

  async function createRegistrationMember(details: {
    name: string; email: string; phone: string; address: string; employer: string;
  }) {
    return adminApi.members.create({
      name: details.name,
      email: details.email || null,
      phone: details.phone || null,
      employer: details.employer || null,
      address: details.address,
      isExistingMember: false,
      policyAgreed: false,
      membershipYear: templeYear(),
      ...(!adminMode ? { memberType: "new" as const } : {}),
    });
  }

  // ── Phase 1 → Phase 2 ──
  async function handleAdvanceToForm() {
    if (advanceInFlight.current) return;
    if (isExistingMember === null) {
      setMemberChoiceError("Please select whether you are an existing temple member.");
      focusFirstFieldError();
      return;
    }
    setMemberChoiceError("");
    if (isExistingMember === true) {
      if (!foundMember) {
        setLookupError("Look up your member record before continuing.");
        focusFirstFieldError();
        return;
      }
      if (selectedExistingStudent && currentRegistration) {
        if (!existingAction) {
          setMemberChoiceError("Choose one of the actions for this student's current registration.");
          return;
        }
        setResolvedMemberId(foundMember.id);
        setMemberContextToken(foundMember.memberContextToken);
        setEditorError("");
        if (existingAction === "keep") {
          setPhase("existing-done");
        } else {
          const active = activeCurrentSubjects();
          setEditorSubjects(existingAction === "change"
            ? active.map(subject => ({ courseLevelId: subject.courseLevelId, sectionId: subject.sectionId }))
            : []);
          setPhase("existing-editor");
        }
        return;
      }
      if (!adminMode && accessStage !== "verified") {
        setAccessError("Verify your email address before continuing.");
        return;
      }
      if (!addressConfirmed || address !== foundMember.address?.trim()) {
        setAddressSaveError("Confirm the address on file or save an updated address to continue.");
        focusFirstFieldError();
        return;
      }
      if (!memberIsActive) {
        setMembershipError("Please renew your membership before continuing. An active membership is required to register a student.");
        focusFirstFieldError();
        return;
      }
      if (!foundMember.memberContextToken) {
        setMembershipError("Your member lookup has expired. Look up your member record again.");
        focusFirstFieldError();
        return;
      }
      // If active member opted for renewal, call the API now before advancing
      if (memberIsActive && membershipRenewalOpted && !renewalAlreadyApplied) {
        setRenewingMember(true);
        try {
          const renewed = await adminApi.members.renew(foundMember.id);
          setFoundMember({ ...foundMember, createdAt: renewed.createdAt });
          setRenewalAlreadyApplied(true);
        } catch (err) {
          toast.error((err as Error).message ?? "Renewal failed");
          setRenewingMember(false);
          return;
        }
        setRenewingMember(false);
      }
      setResolvedMemberId(foundMember.id);
      setMemberContextToken(foundMember.memberContextToken);
    } else {
      // Creation now happens on Continue, so never create a member for a closed
      // public registration window where the student cannot be submitted.
      if (!adminMode && registrationOpen !== true) {
        setMemberChoiceError(registrationSettingsError || "Registration is currently closed. Please contact the administration for assistance.");
        focusFirstFieldError();
        return;
      }
      const fieldErrors = validateAddressParts(addressParts);
      setAddressPartsErrors(fieldErrors);
      const nameErr = validatePersonName(memberName, "Member name");
      const emailErr = validateEmail(memberEmail);
      const verifiedMemberPhone = adminMode ? memberPhone : formatUSPhone(phoneVerified);
      const phoneErr = validatePhone(verifiedMemberPhone);
      const newErrors: Errors = { memberName: nameErr, memberEmail: emailErr, memberPhone: phoneErr };
      setP1Errors(newErrors);
      setMembershipError(membershipConfirmed ? "" : "Please acknowledge the annual membership fee to continue.");
      if (Object.values(newErrors).some(Boolean) || Object.keys(fieldErrors).length || !membershipConfirmed) {
        focusFirstFieldError();
        return;
      }
      // Check if the phone number is already registered as a member
      if (adminMode && verifiedMemberPhone.trim() && !savedNewMember) {
        const digits = verifiedMemberPhone.replace(/\D/g, "");
        try {
          const member = await adminApi.members.lookup(digits) as FoundMember;
          const sequence = ++lookupSequence.current;
          await showVerifiedExistingMember(
            member,
            "This verified phone is already linked to a member account. We’ve switched you to the existing-member path.",
            sequence,
          );
          return;
        } catch (err) {
          if (!isMemberNotFoundError(err)) {
            setP1Errors({
              memberPhone: err instanceof Error
                ? err.message
                : "Could not verify this phone number. Please try again.",
            });
            focusFirstFieldError();
            return;
          }
          // A confirmed 404 is the only lookup failure that permits member creation.
        }
      }
      setP1Errors({});
      const formattedAddress = formatAddressParts(addressParts);
      const details = {
        name: memberName.trim(),
        email: memberEmail.trim(),
        phone: verifiedMemberPhone.replace(/\D/g, ""),
        address: formattedAddress,
        employer: memberEmployer.trim(),
      };
      advanceInFlight.current = true;
      setAdvancingMember(true);
      try {
        let issuedToken = savedNewMember?.memberContextToken;
        const id = await ensureRegistrationMember(
          savedNewMember,
          details,
          async () => {
            const created = await createRegistrationMember(details);
            issuedToken = created.memberContextToken;
            return created;
          },
          setSavedNewMember,
        );
        if (!issuedToken) throw new Error("Could not confirm the new member record. Please try again.");
        setResolvedMemberId(id);
        setMemberContextToken(issuedToken);
        setAddress(formattedAddress);
        setAddressConfirmed(true);
      } catch (err) {
        if (!adminMode && errorStatus(err) === 409) {
          setPhoneVerificationError("We could not complete new-member registration. Please contact the temple office at gurukul@bhtohio.org for assistance.");
          return;
        }
        toast.error(err instanceof Error ? err.message : "Could not save member details. Please try again.");
        return;
      } finally {
        advanceInFlight.current = false;
        setAdvancingMember(false);
      }
    }
    setMembershipError("");
    setPhase("form");
  }

  // ── Phase 2: Submit ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!addressConfirmed || !address.trim()) {
      setAddressSaveError("Please confirm or enter your address before registering.");
      setPhase("member-check");
      focusFirstFieldError();
      return;
    }
    if (!validateAll()) {
      focusFirstFieldError();
      return;
    }

    const validEnrollments = enrollments.filter(e => e.courseId && e.levelId);

    setSaving(true);
    let publicMemberCreationCollision = false;
    try {
      let memberId = resolvedMemberId;
      let token = memberContextToken ?? (isExistingMember ? foundMember?.memberContextToken : savedNewMember?.memberContextToken);

      if (!isExistingMember) {
        const details = {
          name: memberName.trim(),
          email: memberEmail.trim(),
          phone: (adminMode ? memberPhone : phoneVerified).replace(/\D/g, ""),
          address: address.trim(),
          employer: memberEmployer.trim(),
        };
        if (!savedNewMember) {
          const memberErrors: Errors = {
            memberName: validatePersonName(memberName, "Member name"),
            memberEmail: validateEmail(details.email),
            memberPhone: validatePhone(details.phone),
          };
          setP1Errors(memberErrors);
          if (Object.values(memberErrors).some(Boolean)) {
            setPhase("member-check");
            focusFirstFieldError();
            return;
          }
        }
        let issuedToken = savedNewMember?.memberContextToken;
        memberId = await ensureRegistrationMember(savedNewMember, details, async () => {
          try {
            const created = await createRegistrationMember(details);
            issuedToken = created.memberContextToken;
            return created;
          } catch (err) {
            if (!adminMode && errorStatus(err) === 409) publicMemberCreationCollision = true;
            throw err;
          }
        }, setSavedNewMember);
        token = token ?? issuedToken;
        if (!savedNewMember && !token) throw new Error("Could not confirm the new member record. Please return to the membership step.");
      }
      if (!memberId || !token || !primaryMemberRole) {
        throw new Error("Select a Primary Member and confirm the member record on the previous screen.");
      }
      await adminApi.members.patch(memberId, {
        policyAgreed: true,
        ...(adminMode && isExistingMember ? { membershipYear: templeYear() } : {}),
      });

      // Compute the membership fee decision for audit / record-keeping
      const membershipFeeDecision = !isExistingMember
        ? "New Member"
        : membershipRenewalOpted
          ? "Existing Member Renewal — Membership Fee Required"
          : "Existing Active Member — Membership Fee Not Required";

      const result = await adminApi.students.register({
        firstName:          firstName.trim(),
        lastName:           lastName.trim(),
        dob,
        grade,
        curriculumYear:     curricYear || undefined,
        isNewStudent:       isNew,
        memberId:           memberId ?? undefined,
        memberContextToken: token,
        primaryMemberRole,
        registrationSource: adminMode ? "admin" : "public",
        membershipFeeDecision,
        motherName:     registrationMother.name.trim(),
        motherPhone:    registrationMother.phone.replace(/\D/g, ""),
        motherEmail:    registrationMother.email.trim(),
        motherEmployer: effectiveMotherEmployer || undefined,
        fatherName:     registrationFather.name.trim(),
        fatherPhone:    registrationFather.phone.replace(/\D/g, ""),
        fatherEmail:    registrationFather.email.trim(),
        fatherEmployer: effectiveFatherEmployer || undefined,
        address:        address.trim(),
        volunteerParent,
        volunteerArea:  volunteerParent ? volunteerArea.trim() : undefined,
        enrollments:    validEnrollments.map(e => ({
          courseLevelId: Number(e.levelId),
          sectionId:     e.sectionId ? Number(e.sectionId) : null,
          amountDue:     e.amountDue || courseFee.toFixed(2),
          enrollDate:    new Date().toISOString().slice(0, 10),
        })),
      });

      // Auto-create a pending membership fee record (admin mode only, when renewal is opted in)
      if (adminMode && memberId && membershipRenewalOpted) {
        try {
          await adminApi.members.upsertMembershipPayment(memberId, {
            membershipYear: templeYear(),
            amountDue:      membershipFee,
            amountPaid:     0,
            paymentStatus:  "Pending",
            paymentMethod:  null,
            receiptId:      null,
            paymentDate:    null,
            notes:          "Auto-created during student registration — update via Members page",
          });
        } catch {
          toast.warning("Student registered. Could not auto-create membership fee record — update manually via Members page.");
        }
      }

      onSuccess(result.studentCode, `${firstName.trim()} ${lastName.trim()}`, {
        courseCount:   validEnrollments.length,
        membershipFee: membershipRenewalOpted ? membershipFee : 0,
        courseFee:     courseFee,
        memberId:      memberId ?? undefined,
        isNewMember:   isExistingMember === false,
      });
    } catch (err: unknown) {
      if (publicMemberCreationCollision) {
        setPhoneVerificationError("We could not complete new-member registration. Please contact the temple office at gurukul@bhtohio.org for assistance.");
        setPhase("member-check");
        return;
      }
      if (errorStatus(err) === 409 && foundMember && accessStage === "verified") {
        const fullName = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, " ").toLocaleLowerCase();
        const matchingStudent = linkedStudents.find(student =>
          student.name.trim().replace(/\s+/g, " ").toLocaleLowerCase() === fullName &&
          student.dob === dob,
        );
        if (matchingStudent) {
          setPhase("member-check");
          await selectLinkedStudent(matchingStudent);
          setRegistrationError("A student with this name and date of birth is already linked to your member account. Review the current registration below instead of registering again.");
          return;
        }
      }
      toast.error(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls  = "w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white";
  const selectCls = inputCls;

  const inputErr = (field: string) =>
    errors[field]
      ? "border-red-400 focus:border-red-500"
      : "";

  const inputClsFor = (field: string) =>
    `${inputCls} ${inputErr(field)}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (phase === "existing-editor" && currentRegistration) {
    const activeCourseSet = activeCourseIds();
    const selectableCourses = meta?.courses.filter(course =>
      existingAction !== "add" || !activeCourseSet.has(course.id),
    ) ?? [];
    return (
      <div className="space-y-5">
        <SectionLabel icon={<BookOpen className="w-4 h-4" />} title={existingAction === "add" ? "Add Subjects" : "Change Registration"} />
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="font-semibold text-secondary">{currentRegistration.studentName} · Current registration</p>
          <p className="text-xs text-muted-foreground">
            Registered {formatRegistrationDate(currentRegistration.registeredAt)}
            {currentRegistration.curriculumYear ? ` · ${currentRegistration.curriculumYear}` : ""}
          </p>
        </div>
        {existingAction === "add" && (
          <p className="text-sm text-muted-foreground">Only courses not already active in this registration are available to add.</p>
        )}
        <div className="space-y-3">
          {editorSubjects.map((draft, index) => {
            const selectedLevel = meta?.courses.flatMap(course => course.levels).find(level => level.id === draft.courseLevelId);
            return (
              <div key={index} className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <select
                  value={draft.courseLevelId}
                  onChange={event => setEditorSubjects(previous => previous.map((item, itemIndex) =>
                    itemIndex === index ? { courseLevelId: event.target.value ? Number(event.target.value) : "", sectionId: null } : item,
                  ))}
                  className={selectCls}
                  aria-label="Course and level"
                >
                  <option value="">Select a course and level</option>
                  {selectableCourses.map(course => (
                    <optgroup key={course.id} label={course.name}>
                      {course.levels.map(level => (
                        <option key={level.id} value={level.id}>Level {level.levelNumber} · {level.className}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="self-center text-sm text-muted-foreground">{selectedLevel?.className ?? "Choose a level"}</div>
                <select
                  value={draft.sectionId ?? ""}
                  onChange={event => setEditorSubjects(previous => previous.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, sectionId: event.target.value ? Number(event.target.value) : null } : item,
                  ))}
                  disabled={!selectedLevel?.sections.length}
                  className={selectCls}
                  aria-label="Section"
                >
                  <option value="">No section</option>
                  {selectedLevel?.sections.map(section => <option key={section.id} value={section.id}>{section.sectionName}</option>)}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditorSubjects(previous => previous.filter((_, itemIndex) => itemIndex !== index))}
                  aria-label="Remove subject"
                  className="gap-1"
                >
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditorSubjects(previous => [...previous, { courseLevelId: "", sectionId: null }])}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Add Subject
          </Button>
        </div>
        {editorError && <p className="text-sm text-red-700" role="alert">{editorError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={editorSaving} onClick={() => setPhase("member-check")}>Back</Button>
          <Button type="button" disabled={editorSaving || !editorSubjects.length} onClick={saveExistingRegistration} className="gap-2">
            {editorSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {editorSaving ? "Saving…" : existingAction === "add" ? "Add Subjects" : "Save Registration Changes"}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "existing-done" && currentRegistration) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="font-semibold text-green-900">
            {existingAction === "keep" ? "Current registration kept unchanged" : "Registration updated"}
          </p>
          <p className="text-sm text-green-800">No new student registration was created.</p>
        </div>
        <CurrentRegistrationCard
          summary={currentRegistration}
          selectedAction={existingAction}
          onSelectAction={() => undefined}
          onChangeSelection={() => {
            setSelectedExistingStudent(null);
            setCurrentRegistration(null);
            setPrefillSource(null);
            setExistingAction(null);
            setPhase("member-check");
          }}
          readOnly
        />
        <div className="flex justify-end">
          <Button type="button" onClick={() => setPhase("member-check")}>Return to Registration</Button>
        </div>
      </div>
    );
  }

  if (!adminMode && phase === "member-check" && publicStep !== "verified") {
    if (publicStep === "choice") {
      return (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-secondary mb-3">Are you an existing Bhartiya Hindu Temple member?</p>
            <div className="flex gap-3">
              {([true, false] as const).map(value => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => {
                    clearRegistrationIdentity();
                    setIsExistingMember(value);
                    setMembershipRenewalOpted(!value);
                    setMemberChoiceError("");
                    setPhoneVerificationError("");
                  }}
                  className={`flex-1 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors ${
                    isExistingMember === value ? "border-primary bg-primary/5 text-secondary" : "border-border bg-white text-secondary hover:border-primary"
                  }`}
                >
                  {value ? "Yes, I am a member" : "No, I am new"}
                </button>
              ))}
            </div>
            {memberChoiceError && <FieldError msg={memberChoiceError} />}
          </div>
          <Field label="Mobile Phone Number" required error={lookupError}>
            <input
              type="tel"
              value={lookupValue}
              disabled={lookupLoading}
              onChange={event => { setLookupValue(formatUSPhone(event.target.value)); setLookupError(""); setPhoneVerificationError(""); setContactEmailError(""); setNeedsExistingIdentifier(false); }}
              placeholder="(614) 555-0100"
              maxLength={14}
              autoComplete="tel"
              className={`${inputCls} ${lookupError ? "border-red-400" : ""}`}
            />
          </Field>
          {needsExistingIdentifier && isExistingMember && (
            <Field label="Registered last name or Member ID" required>
              <input
                value={existingIdentifier}
                onChange={event => { setExistingIdentifier(event.target.value); setLookupError(""); }}
                autoComplete="family-name"
                className={inputCls}
                placeholder="Last name or Member ID"
              />
            </Field>
          )}
          {!isExistingMember && <Field label="Email Address" required error={contactEmailError}>
            <input
              type="email"
              value={contactEmail}
              disabled={lookupLoading}
              onChange={event => { setContactEmail(event.target.value); setPhoneVerificationError(""); setContactEmailError(""); }}
              placeholder="your@email.com"
              autoComplete="email"
              className={`${inputCls} ${contactEmailError ? "border-red-400" : ""}`}
            />
          </Field>}
          {phoneVerificationError && <p className="text-sm text-amber-900" role="alert">{phoneVerificationError}</p>}
          <Button type="button" onClick={() => void (isExistingMember ? checkExistingEmail() : requestEmailCode())} disabled={lookupLoading} className="w-full gap-2">
            {lookupLoading && <Loader2 className="h-4 w-4 animate-spin" />} {isExistingMember ? "Find membership" : "Continue with email verification"}
          </Button>
        </div>
      );
    }
    if (publicStep === "hint") {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-secondary">Verification Required</h3>
          <p className="text-sm text-muted-foreground">We found a membership associated with this mobile number. A verification code will be sent to:</p>
          <p className="font-semibold text-secondary">{maskedEmail}</p>
          {phoneVerificationError && <p className="text-sm text-red-700" role="alert">{phoneVerificationError}</p>}
          <Button type="button" onClick={() => void requestEmailCode()} disabled={lookupLoading} className="w-full gap-2">
            {lookupLoading && <Loader2 className="h-4 w-4 animate-spin" />} Send Verification Code
          </Button>
          <button type="button" className="text-sm text-primary underline" onClick={changeVerifiedContacts}>Change mobile number</button>
          <a className="block text-sm text-primary underline" href="mailto:gurukul@bhtohio.org?subject=Membership%20email%20update">I no longer have access to this email</a>
          <p className="text-xs text-muted-foreground">Contact the temple office to have an administrator update your email. You cannot change it here.</p>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-secondary">Enter Verification Code</p>
        <p className="text-sm text-muted-foreground">We sent a verification code to {maskedEmail || "your email address"}.</p>
        <input
          value={accessCode}
          disabled={accessLoading || lookupLoading}
          onChange={event => { setAccessCode(event.target.value); setPhoneVerificationError(""); }}
          onKeyDown={event => event.key === "Enter" && void verifyEmailCode()}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="Email verification code"
          placeholder="Verification code"
          className={`${inputCls} ${phoneVerificationError ? "border-red-400" : ""}`}
        />
        {phoneVerificationError && <p className="text-sm text-red-700" role="alert">{phoneVerificationError}</p>}
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="outline" onClick={changeVerifiedContacts} disabled={accessLoading}>Change {isExistingMember ? "mobile number" : "phone or email"}</Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => void requestEmailCode()} disabled={lookupLoading || accessLoading}>
              {lookupLoading && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Resend code
            </Button>
            <Button type="button" onClick={() => void verifyEmailCode()} disabled={accessLoading || lookupLoading} className="gap-2">
              {accessLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Verify & Continue
            </Button>
          </div>
        </div>
        {isExistingMember && <a className="text-sm text-primary underline" href="mailto:gurukul@bhtohio.org?subject=Membership%20email%20update">I no longer have access to this email</a>}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 1: Temple Member Check
  // ─────────────────────────────────────────────────────────────────────────────
  if (phase === "member-check") {
    return (
      <div className="space-y-6">
        <SectionLabel icon={<Users className="w-4 h-4" />} title="Temple Membership" />
        {!adminMode && publicStep === "verified" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
            <p className="text-sm text-green-900">Email verified: {maskedEmail}</p>
            <Button type="button" variant="outline" onClick={changeVerifiedContacts}>Change {isExistingMember ? "mobile number" : "phone or email"}</Button>
          </div>
        )}
        {!adminMode && lookupError && (
          <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900" role="status">{lookupError}</p>
        )}
        {!adminMode && phoneVerificationError && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{phoneVerificationError}</p>
        )}

        {/* Admins retain the immediate member-check flow. Public visitors have
            already made this choice before verifying their email and contacts. */}
        {adminMode && <div>
          <p className="text-sm font-semibold text-secondary mb-3">
            Are you an existing Bhartiya Hindu Temple member?
            <span className="text-red-500 ml-0.5">*</span>
          </p>
          <div
            className="flex gap-3"
            data-field-error={memberChoiceError ? "true" : undefined}
            tabIndex={memberChoiceError ? -1 : undefined}
          >
            {([true, false] as const).map(v => (
              <button
                key={String(v)}
                type="button"
                onClick={() => {
                  setIsExistingMember(v);
                  setMemberChoiceError("");
                  setP1Errors({});
                  setMembershipRenewalOpted(v === false);
                  setFoundMember(null);
                  setLookupValue("");
                  setLookupError("");
                  setLinkedStudents([]);
                  setPrefillSource(null);
                  setSelectedExistingStudent(null);
                  setCurrentRegistration(null);
                  registrationSequence.current++;
                  setAccessStage("idle");
                  setAccessError("");
                  setAccessCode("");
                  setExistingAction(null);
                  setRegistrationError("");
                  setMembershipConfirmed(false);
                  setMembershipError("");
                  lookupSequence.current++;
                  setLookupLoading(false);
                  setLinkedLoading(false);
                  setAddress("");
                  setAddressConfirmed(false);
                  setEditingAddress(false);
                  setAddressSaving(false);
                  setAddressParts({ ...EMPTY_ADDRESS });
                  setAddressPartsErrors({});
                  setAddressSaveError("");
                  setResolvedMemberId(null);
                  setMemberContextToken(null);
                }}
                className={`flex-1 py-3 rounded-xl text-sm font-semibold border-2 transition-all flex items-center justify-center gap-2 ${
                  isExistingMember === v
                    ? "border-primary bg-primary text-white shadow-sm"
                    : "border-border text-muted-foreground hover:border-primary/40 bg-white"
                }`}
              >
                {v
                  ? <><UserCheck className="w-4 h-4" /> Yes, I am a member</>
                  : <><UserPlus className="w-4 h-4" /> No, I am new</>
                }
              </button>
            ))}
          </div>
          {memberChoiceError && <p className="mt-2 text-xs text-red-600" role="alert">{memberChoiceError}</p>}
          {registrationSettingsError && (
            <p className="mt-2 text-xs text-red-600" role="alert">{registrationSettingsError}</p>
          )}
        </div>}

        {/* Existing member: lookup by phone */}
        {isExistingMember === true && (
          <div className="space-y-3">
            {adminMode && <>
            <div className="p-4 rounded-xl bg-green-50 border border-green-200 space-y-3">
              <p className="text-xs font-bold text-green-800 uppercase tracking-wide">Member Lookup</p>
              <p className="text-sm text-green-700">
                Enter the phone number registered with your temple membership to locate your record.
              </p>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1">
                  <input
                    type="tel"
                    value={lookupValue}
                    onChange={e => {
                      lookupSequence.current++;
                      setLookupValue(formatUSPhone(e.target.value));
                      setLookupError("");
                      setFoundMember(null);
                      setAccessStage("idle");
                      setAccessError("");
                      setAccessCode("");
                      setResolvedMemberId(null);
                      setMemberContextToken(null);
                      setLinkedStudents([]);
                      setPrefillSource(null);
                      setSelectedExistingStudent(null);
                      setCurrentRegistration(null);
                      registrationSequence.current++;
                      setExistingAction(null);
                      setRegistrationError("");
                      setAddress("");
                      setAddressConfirmed(false);
                      setAddressSaveError("");
                      setEditingAddress(false);
                      setAddressSaving(false);
                      setLookupLoading(false);
                      setLinkedLoading(false);
                    }}
                    onKeyDown={e => e.key === "Enter" && handleLookup()}
                    placeholder="(614) 555-0100"
                    maxLength={14}
                    className={`${inputCls} ${lookupError ? "border-red-400" : ""}`}
                    aria-invalid={!!lookupError}
                    data-field-error={lookupError ? "true" : undefined}
                  />
                  <FieldError msg={lookupError} />
                </div>
                <Button
                  type="button"
                  onClick={handleLookup}
                  disabled={lookupLoading}
                  className="gap-1.5 shrink-0 self-start"
                >
                  {lookupLoading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <><Search className="w-4 h-4" /> Find Me</>
                  }
                </Button>
              </div>

              {foundMember && (
                <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-green-300">
                  <UserCheck className="w-5 h-5 text-green-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-secondary">{foundMember.name ?? "Member"}</p>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {foundMember.phone ?? "Member record located"}
                    </p>
                  </div>
                  <span className="ml-auto text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full shrink-0">
                    Found ✓
                  </span>
                </div>
              )}
            </div>
            </>}

            {foundMember && !adminMode && (
              <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-3">
                <UserCheck className="h-5 w-5 shrink-0 text-green-700" />
                <div>
                  <p className="text-sm font-semibold text-green-950">{foundMember.name ?? "Temple member"}</p>
                  <p className="text-xs text-green-800">{foundMember.phone ?? formatUSPhone(phoneVerified)}</p>
                </div>
              </div>
            )}

            {foundMember && (adminMode || accessStage === "verified") && (
              <div className="p-4 rounded-xl bg-white border border-border space-y-3">
                <p className="text-sm font-bold text-secondary">Verify your home address</p>
                <p className="text-xs text-muted-foreground">Please check the address currently on your member record before continuing.</p>
                <div
                  className="rounded-lg bg-gray-50 border border-border px-3 py-2 text-sm text-secondary whitespace-pre-wrap"
                  data-field-error={addressSaveError ? "true" : undefined}
                  tabIndex={addressSaveError ? -1 : undefined}
                >
                  {foundMember.address?.trim() || "No address on file. Please add your complete address."}
                </div>
                {addressConfirmed && !editingAddress ? (
                  <p className="text-sm text-green-700 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Address confirmed</p>
                ) : null}
                {!editingAddress ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => {
                      if (!isCompleteAddress(foundMember.address)) { setAddressSaveError("The address on file needs a street, city, 2-letter state and ZIP. Please update it."); return; }
                      setAddress(foundMember.address!.trim());
                      setAddressConfirmed(true);
                      setAddressSaveError("");
                    }} disabled={!foundMember.address?.trim()} className="gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Confirm Address
                    </Button>
                    <Button type="button" variant="outline" onClick={() => {
                      setEditingAddress(true);
                      setAddressConfirmed(false);
                      setAddressParts(parseAddress(foundMember.address));
                      setAddressPartsErrors({});
                      setAddressSaveError("");
                    }}>
                      Update Address
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">Enter your complete updated address, including street, city, state and ZIP.</p>
                    <AddressFields
                      value={addressParts}
                      onChange={next => { setAddressParts(next); setAddressPartsErrors({}); setAddressSaveError(""); }}
                      errors={addressPartsErrors}
                    />
                    <div className="flex gap-2">
                      <Button type="button" onClick={saveUpdatedAddress} disabled={addressSaving} className="gap-1.5">
                        {addressSaving && <Loader2 className="w-4 h-4 animate-spin" />} Save Address
                      </Button>
                      <Button type="button" variant="outline" disabled={addressSaving} onClick={() => { setEditingAddress(false); setAddressPartsErrors({}); setAddressSaveError(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {addressSaveError && <FieldError msg={addressSaveError} />}
              </div>
            )}

            {/* Linked students — shown after member is found */}
            {foundMember && accessStage === "verified" && (
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 space-y-3">
                <p className="text-xs font-bold text-blue-800 uppercase tracking-wide">
                  {linkedLoading ? "Loading students…" : linkedStudents.length > 0 ? "Students in Your Account" : "No Students Registered Yet"}
                </p>
                {linkedLoading && (
                  <div className="flex items-center gap-2 text-sm text-blue-700">
                    <Loader2 className="w-4 h-4 animate-spin" /> Fetching your students…
                  </div>
                )}
                {accessError && <p className="text-sm text-red-700" role="alert">{accessError}</p>}
                {!linkedLoading && linkedStudents.length > 0 && (
                  <>
                    <p className="text-sm text-blue-700">
                      We found {linkedStudents.length} student{linkedStudents.length > 1 ? "s" : ""} linked to your account.
                      Select a student to pre-fill the registration form, or register a new child.
                    </p>
                    <div className="space-y-2">
                      {linkedStudents.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { void selectLinkedStudent(s); setMembershipConfirmed(false); setMembershipError(""); }}
                          className={`w-full text-left p-3 rounded-lg border-2 transition-all flex items-center gap-3 ${
                            selectedExistingStudent?.id === s.id
                              ? "border-primary bg-primary/5"
                              : "border-blue-200 bg-white hover:border-blue-400"
                          }`}
                        >
                          <GraduationCap className={`w-5 h-5 shrink-0 ${selectedExistingStudent?.id === s.id ? "text-primary" : "text-blue-500"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-secondary">{s.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {[s.grade ? `Grade: ${s.grade}` : null, s.curriculumYear ? `Year: ${s.curriculumYear}` : null].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                            selectedExistingStudent?.id === s.id
                              ? "bg-primary text-white"
                              : "bg-blue-100 text-blue-700"
                          }`}>
                            {selectedExistingStudent?.id === s.id ? "Selected ✓" : "Pre-fill Form"}
                          </span>
                        </button>
                      ))}
                    </div>
                    {selectedExistingStudent && (
                      <p className="text-xs text-blue-600 italic">
                        {selectedExistingStudent.name}'s details are selected. Check below for the current registration before continuing.
                      </p>
                    )}
                    {selectedExistingStudent && registrationLoading && (
                      <p className="flex items-center gap-2 text-sm text-blue-700"><Loader2 className="w-4 h-4 animate-spin" /> Loading current registration…</p>
                    )}
                    {registrationError && <p className="text-sm text-red-700" role="alert">{registrationError}</p>}
                    {selectedExistingStudent && !registrationLoading && !currentRegistration && !registrationError && (
                      <p className="text-sm text-blue-700">No current registration was found for this student. Continue to start a registration.</p>
                    )}
                    {currentRegistration && !registrationLoading && (
                      <CurrentRegistrationCard
                        summary={currentRegistration}
                        selectedAction={existingAction}
                        onSelectAction={action => { setExistingAction(action); setMemberChoiceError(""); setEditorError(""); }}
                        onChangeSelection={() => { setSelectedExistingStudent(null); setCurrentRegistration(null); setPrefillSource(null); setExistingAction(null); setRegistrationError(""); }}
                      />
                    )}
                    <div className="pt-1 border-t border-blue-200">
                      <button
                        type="button"
                        onClick={() => { setPrefillSource(null); setSelectedExistingStudent(null); setCurrentRegistration(null); setExistingAction(null); setRegistrationError(""); registrationSequence.current++; setErrors({}); }}
                        className={`text-sm font-medium flex items-center gap-1.5 transition-colors ${
                          prefillSource === null
                            ? "text-primary font-semibold"
                            : "text-blue-600 hover:text-primary"
                        }`}
                      >
                        <UserPlus className="w-4 h-4" />
                        Register a new child / start fresh
                        {prefillSource === null && <span className="text-xs ml-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Selected</span>}
                      </button>
                    </div>
                  </>
                )}
                {!linkedLoading && linkedStudents.length === 0 && (
                  <p className="text-sm text-blue-700">
                    You'll fill in all details on the next screen.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* New member: collect contact info */}
        {isExistingMember === false && (
          <div className="p-4 rounded-xl bg-orange-50 border border-orange-200 space-y-3">
            <p className="text-xs font-bold text-orange-800 uppercase tracking-wide">New Member Registration</p>
            {savedNewMember && (
              <p className="text-sm text-orange-800">
                Your member record has already been saved. If student registration failed, retrying will reuse it. To change saved member details, choose Existing member and look up the record by phone.
              </p>
            )}
            <p className="text-sm text-orange-700">
              Continuing will save your temple member record before student registration. A valid email address is required.
            </p>
            <Field label="Your Name" required error={p1Errors.memberName}>
              <input
                value={memberName}
                onChange={e => { setMemberName(e.target.value); setP1Errors(prev => ({ ...prev, memberName: "" })); }}
                onBlur={() => setP1Errors(prev => ({ ...prev, memberName: validatePersonName(memberName, "Member name") }))}
                placeholder="Full name of primary contact"
                className={`${inputCls} ${p1Errors.memberName ? "border-red-400" : ""}`}
                aria-invalid={!!p1Errors.memberName}
                data-field-error={p1Errors.memberName ? "true" : undefined}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Email Address" required error={p1Errors.memberEmail}>
                <input
                  type="email"
                  value={memberEmail}
                  readOnly={!adminMode}
                  onChange={e => { setMemberEmail(e.target.value); setP1Errors(prev => ({ ...prev, memberEmail: "" })); }}
                  onBlur={() => setP1Errors(prev => ({ ...prev, memberEmail: validateEmail(memberEmail) }))}
                  placeholder="your@email.com"
                  className={`${inputCls} ${!adminMode ? "bg-gray-100" : ""} ${p1Errors.memberEmail ? "border-red-400" : ""}`}
                  aria-invalid={!!p1Errors.memberEmail}
                  data-field-error={p1Errors.memberEmail ? "true" : undefined}
                />
              </Field>
              <Field label="Phone Number" required error={p1Errors.memberPhone}>
                <input
                  type="tel"
                  value={!adminMode ? formatUSPhone(phoneVerified) : memberPhone}
                  readOnly={!adminMode}
                  onChange={e => { setMemberPhone(formatUSPhone(e.target.value)); setP1Errors(prev => ({ ...prev, memberPhone: "" })); }}
                  onBlur={() => setP1Errors(prev => ({ ...prev, memberPhone: validatePhone(memberPhone) }))}
                  placeholder="(614) 555-0100"
                  maxLength={14}
                  className={`${inputCls} ${!adminMode ? "bg-gray-100" : ""} ${p1Errors.memberPhone ? "border-red-400" : ""}`}
                  aria-invalid={!!p1Errors.memberPhone}
                  data-field-error={p1Errors.memberPhone ? "true" : undefined}
                />
              </Field>
            </div>
            <Field label="Employer (if available)">
              <input
                value={memberEmployer}
                onChange={e => setMemberEmployer(e.target.value)}
                placeholder="Employer"
                className={inputCls}
              />
            </Field>
            <div className="pt-2 border-t border-orange-200 space-y-2">
              <p className="text-xs font-bold text-orange-800 uppercase tracking-wide">Complete home address</p>
              <AddressFields
                value={addressParts}
                onChange={next => { setAddressParts(next); setAddressPartsErrors({}); setAddressConfirmed(false); }}
                errors={addressPartsErrors}
              />
            </div>
          </div>
        )}

        {/* ── Temple Membership ── */}
        {isExistingMember !== null && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3">
            <div className="flex items-center gap-2">
              <BadgeDollarSign className="w-4 h-4 text-amber-700 shrink-0" />
              <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">
                Annual Temple Membership — {templeYear()}
              </p>
            </div>

            {/* Existing member: active status + optional/required renewal */}
            {isExistingMember === true && foundMember && (
              <div className="space-y-2.5">

                {/* Active status badge */}
                {memberIsActive && (
                  <div className="flex items-center gap-2 text-sm rounded-lg px-3 py-2 bg-green-100 text-green-800 border border-green-200">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Membership is <strong>active</strong> — expires{" "}
                       <strong>{memberExpiry}</strong>.
                    </span>
                  </div>
                )}

                {/* Membership fee already paid — show informational badge */}
                {memberIsActive && foundMember?.memFeeStatus === "Paid" && (
                  <div className="flex items-center gap-2 text-sm rounded-lg px-3 py-2 bg-emerald-50 text-emerald-800 border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                    <span>
                      Membership fee for <strong>{templeYear()}</strong> is already <strong>paid</strong>
                      {foundMember.memFeePaid > 0 ? ` ($${foundMember.memFeePaid.toFixed(2)})` : ""}.
                      No additional membership fee will be charged for this registration.
                    </span>
                  </div>
                )}

                {/* Renewal opt-in — shown only when fee is NOT yet paid for current year */}
                {memberIsActive && foundMember?.memFeeStatus !== "Paid" && (
                  <label className={`flex items-start gap-3 cursor-pointer rounded-xl border-2 p-3 transition-colors select-none ${
                    membershipRenewalOpted
                      ? "border-primary bg-primary/5"
                      : "border-border bg-white hover:border-primary/40"
                  }`}>
                    <input
                      type="checkbox"
                      checked={membershipRenewalOpted}
                      onChange={e => setMembershipRenewalOpted(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-primary shrink-0"
                    />
                    <div>
                      <p className="text-sm font-semibold text-secondary">
                        Yes, renew my membership for ${membershipFee}/year
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                         Membership is valid through December 31 of this calendar year and adds ${membershipFee} to the total fee.
                        Leave unchecked to skip renewal this time.
                      </p>
                    </div>
                  </label>
                )}

                {/* Expired status + mandatory renew button */}
                {!memberIsActive && (
                  <div className="rounded-lg px-3 py-2.5 text-sm space-y-2.5 bg-red-50 text-red-700 border border-red-200">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Membership <strong>expired</strong>
                        {memberExpiry ? <> on <strong>{memberExpiry}</strong></> : ""}.
                        {" "}You must renew before registering a student.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRenewMember}
                      disabled={renewingMember}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {renewingMember
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Renewing membership…</>
                        : <><RefreshCw className="w-4 h-4" /> Renew Membership — Required to Continue</>
                      }
                    </button>
                  </div>
                )}

              </div>
            )}

            <p className="text-sm text-amber-800">
              Temple annual membership is <strong>${membershipFee} per year</strong> and must be active to register
              students in Gurukul. Membership fees help support temple operations, events, and programs.
            </p>

            {/* New members must explicitly acknowledge the annual fee. */}
            {isExistingMember === false && (
              <label
                className={`flex items-start gap-3 rounded-lg p-2 transition-colors ${membershipError ? "bg-red-50" : "bg-amber-50/50"}`}
                data-field-error={membershipError ? "true" : undefined}
                tabIndex={membershipError ? -1 : undefined}
              >
                <input
                  type="checkbox"
                  checked={membershipConfirmed}
                  aria-invalid={!!membershipError}
                  onChange={e => {
                    setMembershipConfirmed(e.target.checked);
                    setMembershipError(e.target.checked ? "" : "Please acknowledge the annual membership fee to continue.");
                  }}
                  className="mt-0.5 w-4 h-4 accent-primary shrink-0"
                />
                <span className="text-sm text-secondary leading-relaxed">
                  I understand that I will be enrolling as a new temple member and agree to pay the{" "}
                  <strong>${membershipFee} annual membership fee for {templeYear()}</strong> as part of this
                  student registration.{" "}
                  <span className="text-xs text-muted-foreground font-normal">(Required for all new members)</span>
                </span>
              </label>
            )}
            {membershipError && <FieldError msg={membershipError} />}
          </div>
        )}

        {/* Continue */}
        <div className="flex gap-3 justify-end pt-2">
          {onBack && (
            <Button type="button" variant="outline" onClick={onBack}>Back</Button>
          )}
          <Button
            type="button"
            onClick={handleAdvanceToForm}
            disabled={
              (isExistingMember === true && !foundMember) ||
              (isExistingMember === true && !adminMode && accessStage !== "verified") ||
              (isExistingMember === true && !(selectedExistingStudent && currentRegistration) && foundMember !== null && !memberIsActive) ||
              registrationLoading ||
              linkedLoading ||
              (!!accessError && accessStage === "verified") ||
              (!!registrationError && !currentRegistration) ||
              (selectedExistingStudent && currentRegistration !== null && !existingAction) ||
              addressSaving || renewingMember
              || advancingMember
            }
            className="gap-2 min-w-40"
          >
            {advancingMember ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving member…</> : existingAction ? <>Continue with selected action <ChevronRight className="w-4 h-4" /></> : <>Continue <ChevronRight className="w-4 h-4" /></>}
          </Button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PHASE 2: Full Registration Form
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-8" noValidate>

      {/* ── Registration closed banner (public mode only) ── */}
      {!adminMode && registrationOpen === false && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">Registration is currently closed.</p>
            <p className="text-sm text-red-700 mt-0.5">Please contact the administration for assistance.</p>
          </div>
        </div>
      )}

      {/* ── Pre-fill banner ── */}
      {prefillSource && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm">
          <RefreshCw className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-blue-800">Form pre-filled from {prefillSource.name}'s record.</span>
            <span className="text-blue-700"> Review and update any fields, then choose courses and submit.</span>
          </div>
          <button type="button" onClick={() => setPrefillSource(null)} className="ml-auto text-blue-500 hover:text-blue-700 text-xs shrink-0">Clear</button>
        </div>
      )}

      {/* ── Section 1: Student Info ── */}
      <div>
        <SectionLabel icon={<GraduationCap className="w-4 h-4" />} title="Student Information" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First Name" required error={errors.firstName}>
            <input
              value={firstName}
              onChange={e => setFirstName(e.target.value)}
              onBlur={() => blurField("firstName", firstName)}
              placeholder="e.g. Arjun"
              className={inputClsFor("firstName")}
              data-field-error={errors.firstName ? "true" : undefined}
            />
          </Field>
          <Field label="Last Name" required error={errors.lastName}>
            <input
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              onBlur={() => blurField("lastName", lastName)}
              placeholder="e.g. Sharma"
              className={inputClsFor("lastName")}
              data-field-error={errors.lastName ? "true" : undefined}
            />
          </Field>
          <Field label="Date of Birth" required error={errors.dob} hint={`Student must be ${courseMinimumAge}–${MAX_AGE} years old for the selected course${courseMinimumAge === 1 ? "" : "s"}`}>
            <input
              type="date"
              value={dob}
              min={dateMin}
              max={dateMax}
              onChange={e => setDob(e.target.value)}
              onBlur={() => blurField("dob", dob)}
              className={inputClsFor("dob")}
              data-field-error={errors.dob ? "true" : undefined}
            />
          </Field>
          <Field label="School Grade" required error={errors.grade}>
            <select
              value={grade}
              onChange={e => setGrade(e.target.value)}
              onBlur={() => blurField("grade", grade)}
              className={`${selectCls} ${inputErr("grade")}`}
              data-field-error={errors.grade ? "true" : undefined}
            >
              <option value="">— Select grade —</option>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Curriculum Year" required error={errors.curricYear}
            hint="set by administration">
            <input
              type="text"
              value={curricYear}
              readOnly
              data-field-error={errors.curricYear ? "true" : undefined}
              className={`${inputCls} bg-gray-50 text-muted-foreground cursor-not-allowed`}
              title="Curriculum year is set by the administration in Settings and cannot be changed here."
            />
          </Field>
        </div>
      </div>

      {/* ── Section 2: Parents ── */}
      <div>
        <SectionLabel icon={<Users className="w-4 h-4" />} title="Parent / Guardian Information" />
        <div className="space-y-4">
          <fieldset
            className={`rounded-xl border-2 p-4 ${errors.primaryMemberRole ? "border-red-400 bg-red-50/40" : "border-amber-200 bg-amber-50/50"}`}
            data-field-error={errors.primaryMemberRole ? "true" : undefined}
            tabIndex={errors.primaryMemberRole ? -1 : undefined}
          >
            <legend className="px-1 text-sm font-semibold text-secondary">
              Primary Member <span className="text-red-500">*</span>
            </legend>
            <p className="text-xs text-muted-foreground mb-3">
              Which parent is the Temple member identified on the previous screen? Their member information will be filled in automatically.
            </p>
            <div className="flex flex-wrap gap-3">
              {(["mother", "father"] as const).map(role => (
                <label key={role} className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm cursor-pointer ${primaryMemberRole === role ? "border-primary bg-white text-primary font-semibold" : "border-border bg-white text-secondary"}`}>
                  <input type="radio" name="primary-member-role" value={role} checked={primaryMemberRole === role}
                    onChange={() => { setPrimaryMemberRole(role); setErrors(prev => ({ ...prev, primaryMemberRole: "" })); }}
                    className="accent-primary" />
                  {role === "mother" ? "Mother" : "Father"}
                </label>
              ))}
            </div>
            <FieldError msg={errors.primaryMemberRole} />
          </fieldset>

          {/* Mother */}
          <div className="p-4 rounded-xl bg-pink-50 border border-pink-100 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-pink-700 uppercase tracking-wide">Mother</p>
              {primaryMemberRole === "mother" && primaryMember && (
                <span className="text-xs font-semibold rounded-full bg-green-100 border border-green-200 text-green-800 px-2.5 py-1">
                  Primary Member · {primaryMember.memberCode || `Member #${primaryMember.id}`}
                </span>
              )}
            </div>
            <Field label="Full Name" required error={errors.motherName}>
              <input
                value={registrationMother.name}
                onChange={e => setMotherName(e.target.value)}
                onBlur={() => blurField("motherName", registrationMother.name)}
                readOnly={primaryMemberRole === "mother" && !!primaryMember?.name}
                placeholder="Mother's full name"
                className={inputClsFor("motherName")}
                data-field-error={errors.motherName ? "true" : undefined}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Phone" required error={errors.motherPhone}>
                <input
                  type="tel"
                  value={formatUSPhone(registrationMother.phone)}
                  onChange={e => setMotherPhone(formatUSPhone(e.target.value))}
                  onBlur={() => blurField("motherPhone", registrationMother.phone)}
                  readOnly={primaryMemberRole === "mother" && !!primaryMember?.phone}
                  placeholder="(614) 555-0100"
                  maxLength={14}
                  className={inputClsFor("motherPhone")}
                  data-field-error={errors.motherPhone ? "true" : undefined}
                />
              </Field>
              <Field label="Email" required error={errors.motherEmail}>
                <input
                  type="email"
                  value={registrationMother.email}
                  onChange={e => setMotherEmail(e.target.value)}
                  onBlur={() => blurField("motherEmail", registrationMother.email)}
                  readOnly={primaryMemberRole === "mother" && !!primaryMember?.email}
                  placeholder="mom@email.com"
                  className={inputClsFor("motherEmail")}
                  data-field-error={errors.motherEmail ? "true" : undefined}
                />
              </Field>
            </div>
            <Field
              label="Where do you work?"
              required
              error={errors.motherEmployer || errors.motherEmployerOther}
            >
              {primaryMemberRole === "mother" && primaryMember?.employer ? (
                <input value={primaryMember.employer} readOnly className={`${inputCls} bg-gray-50`} />
              ) : (
                <EmployerSelect
                  value={motherEmployer}
                  otherValue={motherEmployerOther}
                  onChange={v => { setMotherEmployer(v); setErrors(prev => ({ ...prev, motherEmployer: "" })); }}
                  onOtherChange={v => { setMotherEmployerOther(v); setErrors(prev => ({ ...prev, motherEmployerOther: "" })); }}
                  onBlur={() => blurField("motherEmployer", effectiveMotherEmployer)}
                  cls={`${selectCls} ${inputErr("motherEmployer")}`}
                />
              )}
            </Field>
          </div>

          {/* Father */}
          <div className="p-4 rounded-xl bg-blue-50 border border-blue-100 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">Father</p>
              {primaryMemberRole === "father" && primaryMember && (
                <span className="text-xs font-semibold rounded-full bg-green-100 border border-green-200 text-green-800 px-2.5 py-1">
                  Primary Member · {primaryMember.memberCode || `Member #${primaryMember.id}`}
                </span>
              )}
            </div>
            <Field label="Full Name" required error={errors.fatherName}>
              <input
                value={registrationFather.name}
                onChange={e => setFatherName(e.target.value)}
                onBlur={() => blurField("fatherName", registrationFather.name)}
                readOnly={primaryMemberRole === "father" && !!primaryMember?.name}
                placeholder="Father's full name"
                className={inputClsFor("fatherName")}
                data-field-error={errors.fatherName ? "true" : undefined}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Phone" required error={errors.fatherPhone}>
                <input
                  type="tel"
                  value={formatUSPhone(registrationFather.phone)}
                  onChange={e => setFatherPhone(formatUSPhone(e.target.value))}
                  onBlur={() => blurField("fatherPhone", registrationFather.phone)}
                  readOnly={primaryMemberRole === "father" && !!primaryMember?.phone}
                  placeholder="(614) 555-0101"
                  maxLength={14}
                  className={inputClsFor("fatherPhone")}
                  data-field-error={errors.fatherPhone ? "true" : undefined}
                />
              </Field>
              <Field label="Email" required error={errors.fatherEmail}>
                <input
                  type="email"
                  value={registrationFather.email}
                  onChange={e => setFatherEmail(e.target.value)}
                  onBlur={() => blurField("fatherEmail", registrationFather.email)}
                  readOnly={primaryMemberRole === "father" && !!primaryMember?.email}
                  placeholder="dad@email.com"
                  className={inputClsFor("fatherEmail")}
                  data-field-error={errors.fatherEmail ? "true" : undefined}
                />
              </Field>
            </div>
            <Field
              label="Where do you work?"
              required
              error={errors.fatherEmployer || errors.fatherEmployerOther}
            >
              {primaryMemberRole === "father" && primaryMember?.employer ? (
                <input value={primaryMember.employer} readOnly className={`${inputCls} bg-gray-50`} />
              ) : (
                <EmployerSelect
                  value={fatherEmployer}
                  otherValue={fatherEmployerOther}
                  onChange={v => { setFatherEmployer(v); setErrors(prev => ({ ...prev, fatherEmployer: "" })); }}
                  onOtherChange={v => { setFatherEmployerOther(v); setErrors(prev => ({ ...prev, fatherEmployerOther: "" })); }}
                  onBlur={() => blurField("fatherEmployer", effectiveFatherEmployer)}
                  cls={`${selectCls} ${inputErr("fatherEmployer")}`}
                />
              )}
            </Field>
          </div>

          {/* Address is confirmed in the member step, not overridden by an older student record. */}
          <div
            className="rounded-xl border border-green-200 bg-green-50 p-3"
            data-field-error={errors.address ? "true" : undefined}
            tabIndex={errors.address ? -1 : undefined}
          >
            {errors.address && <FieldError msg={errors.address} />}
            <p className="text-xs font-semibold text-green-800">Confirmed home address</p>
            <p className="text-sm text-secondary mt-1 whitespace-pre-wrap">{address}</p>
            <button type="button" onClick={() => setPhase("member-check")} className="text-xs text-primary underline mt-1">
              Change address in membership step
            </button>
          </div>

          {/* Volunteering — optional */}
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 space-y-3">
            <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Volunteering</p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={volunteerParent}
                onChange={e => { setVolunteerParent(e.target.checked); if (!e.target.checked) { setVolunteerArea(""); setErrors(prev => ({ ...prev, volunteerArea: "" })); } }}
                className="mt-0.5 w-4 h-4 accent-primary"
              />
              <span className="text-sm text-secondary">
                Do either of the parents currently volunteer at the Bhartiya Hindu Temple?
              </span>
            </label>
            {volunteerParent && (
              <Field label="In what area?" required error={errors.volunteerArea}>
                <input
                  value={volunteerArea}
                  onChange={e => setVolunteerArea(e.target.value)}
                  onBlur={() => blurField("volunteerArea", volunteerArea)}
                  placeholder="e.g. Mahaprasadam, Puja, Garland, Parking, etc."
                  className={inputClsFor("volunteerArea")}
                  data-field-error={errors.volunteerArea ? "true" : undefined}
                />
              </Field>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 3: Enrollments ── */}
      <div>
        <SectionLabel icon={<BookOpen className="w-4 h-4" />} title="Course Enrollment" />
        <p className="text-sm text-muted-foreground mb-4">
          Select the course(s) you would like to enroll your child in. You may add multiple courses below.
        </p>

        <div className="space-y-3">
          {enrollments.map((enr, idx) => {
            const selectedCourse = meta?.courses.find(c => c.id === enr.courseId) ?? null;
            const selectedLevel  = selectedCourse?.levels.find(l => l.id === enr.levelId) ?? null;

            return (
              <div key={enr.key} className="p-4 rounded-xl border border-border bg-gray-50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-secondary uppercase tracking-wide">
                    Course {idx + 1}
                  </span>
                  {enrollments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeEnrollment(enr.key)}
                      className="text-red-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                  <Field label="Course" required error={errors[`course-${enr.key}`]}>
                  <select
                    required
                    value={enr.courseId}
                    onChange={e => updateEnrollment(enr.key, { courseId: e.target.value ? Number(e.target.value) : "" })}
                    className={`${selectCls} ${errors[`course-${enr.key}`] ? "border-red-400" : ""}`}
                    aria-invalid={!!errors[`course-${enr.key}`]}
                    data-field-error={errors[`course-${enr.key}`] ? "true" : undefined}
                  >
                    <option value="">— Select a course —</option>
                    {meta?.courses.map(c => (
                      <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                    ))}
                  </select>
                  {selectedCourse && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Registration fee:{" "}
                      <span className="font-semibold text-secondary">
                        ${selectedCourse.fee != null ? selectedCourse.fee.toFixed(2) : courseFee.toFixed(2)}
                      </span>
                      {selectedCourse.fee != null && (
                        <span className="ml-1.5 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">course-specific</span>
                      )}
                    </p>
                  )}
                </Field>

                {selectedCourse && (
                  <Field label="Level" required error={errors[`level-${enr.key}`]}>
                    <select
                      required
                      value={enr.levelId}
                      onChange={e => updateEnrollment(enr.key, { levelId: e.target.value ? Number(e.target.value) : "" })}
                      className={`${selectCls} ${errors[`level-${enr.key}`] ? "border-red-400" : ""}`}
                      aria-invalid={!!errors[`level-${enr.key}`]}
                      data-field-error={errors[`level-${enr.key}`] ? "true" : undefined}
                    >
                      <option value="">— Select level —</option>
                      {selectedCourse.levels.map(l => {
                        const levelLabel = `Level ${l.levelNumber}`;
                        const classLabel = l.className?.trim();
                        return (
                        <option key={l.id} value={l.id}>
                          {classLabel?.toLowerCase() === levelLabel.toLowerCase() ? levelLabel : `${levelLabel} — ${classLabel}`}
                        </option>
                        );
                      })}
                    </select>
                  </Field>
                )}

                {selectedLevel && selectedLevel.sections.length > 0 && (
                  <Field label="Preferred Time Slot">
                    <select
                      value={enr.sectionId}
                      onChange={e => updateEnrollment(enr.key, { sectionId: e.target.value ? Number(e.target.value) : "" })}
                      className={selectCls}
                    >
                      <option value="">— No preference —</option>
                      {selectedLevel.sections.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.sectionName}{s.schedule ? ` · ${s.schedule}` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                {adminMode && (
                  <Field label="Registration Fee ($)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={enr.amountDue}
                      onChange={e => updateEnrollment(enr.key, { amountDue: e.target.value })}
                      className={`${inputCls} max-w-[120px]`}
                    />
                  </Field>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addEnrollment}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-primary/30 text-primary text-sm font-semibold hover:border-primary/60 hover:bg-primary/5 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Another Course
          </button>
        </div>
      </div>


      {/* ── Fee Summary ── */}
      {enrollments.some(e => e.courseId && e.levelId) && (
        <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Receipt className="w-4 h-4 text-indigo-700" />
            <span className="text-sm font-bold text-indigo-900 uppercase tracking-wide">Fee Summary</span>
          </div>
          {enrollments.filter(e => e.courseId && e.levelId).map((enr, idx) => {
            const course = meta?.courses.find(c => c.id === enr.courseId);
            const feeAmt = adminMode ? (parseFloat(enr.amountDue) || 0) : (course?.fee ?? courseFee);
            return (
              <div key={enr.key} className="flex justify-between items-center text-sm">
                <span className="text-secondary">{course ? `${course.icon} ${course.name}` : `Course ${idx + 1}`} — Registration</span>
                <span className="font-semibold text-secondary">${feeAmt.toFixed(2)}</span>
              </div>
            );
          })}
          {membershipRenewalOpted && (
            <div className="flex justify-between items-center text-sm border-t border-indigo-200 pt-2">
              <span className="text-secondary">🏛️ Annual Membership ({templeYear()})</span>
              <span className="font-semibold text-secondary">
                ${membershipFee.toFixed(2)}
              </span>
            </div>
          )}
          {isExistingMember === true && memberIsActive && foundMember?.memFeeStatus === "Paid" && (
            <div className="flex justify-between items-center text-sm border-t border-indigo-200 pt-2">
              <span className="text-secondary flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Annual Membership ({templeYear()})
              </span>
              <span className="font-semibold text-emerald-700">Already Paid ✓</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-2 border-t-2 border-indigo-300">
            <span className="text-base font-bold text-indigo-900">Total Due</span>
            <span className="text-xl font-bold text-indigo-900">
              ${(
                enrollments
                  .filter(e => e.courseId && e.levelId)
                  .reduce((sum, enr) => {
                    const course = meta?.courses.find(c => c.id === enr.courseId);
                    return sum + (adminMode ? (parseFloat(enr.amountDue) || 0) : (course?.fee ?? courseFee));
                  }, 0) +
                (membershipRenewalOpted ? membershipFee : 0)
              ).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* ── Temple Policies ── */}
      <div
        className="p-4 rounded-xl bg-gray-50 border border-border"
        data-field-error={errors.policyAgreed ? "true" : undefined}
        tabIndex={errors.policyAgreed ? -1 : undefined}
      >
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold text-secondary uppercase tracking-wide">Temple Policies</span>
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={policyAgreed}
            aria-invalid={!!errors.policyAgreed}
            onChange={e => {
              setPolicyAgreed(e.target.checked);
              setErrors(prev => ({ ...prev, policyAgreed: e.target.checked ? "" : "Please read and agree to the Temple policies before submitting." }));
            }}
            className="mt-0.5 w-4 h-4 accent-primary"
          />
          <span className="text-sm text-secondary leading-relaxed">
            I have read and agree to the{" "}
            <span className="font-semibold text-primary">Bhartiya Hindu Temple Gurukul policies</span>,
            including attendance requirements, code of conduct, and fee payment terms.
            <span className="text-red-500 ml-0.5">*</span>
          </span>
        </label>
        <FieldError msg={errors.policyAgreed} />
      </div>

      {/* ── Actions ── */}
      <div className="flex gap-3 justify-end pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setPhase("member-check")}
          disabled={saving}
        >
          Back
        </Button>
        {!adminMode && registrationOpen === false ? (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Registration is currently closed.
          </div>
        ) : (
          <Button type="submit" disabled={saving || (!adminMode && registrationOpen === null)} className="min-w-36 gap-2">
            {saving
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</>
              : submitLabel
            }
          </Button>
        )}
      </div>
    </form>
  );
}

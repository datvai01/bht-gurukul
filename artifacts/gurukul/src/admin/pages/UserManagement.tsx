import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ShieldCheck, Users, Phone, UserPlus, RefreshCw,
  Copy, Check, Eye, EyeOff, Loader2, Trash2, X, Edit2,
  AlertCircle, Clock, BookOpen,
  Search, Filter, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { adminApi } from "@/lib/adminApi";
import { useAuth } from "../AuthContext";
import { validatePersonName, validateUSPhone, formatUSPhone } from "@/lib/validators";
import { getRoleLabel, getRoleBadgeColor, type UserRole } from "../rbac";
import { usePortalSettings } from "@/admin/contexts/PortalSettingsContext";

type AdminUser = {
  id:                 number;
  name:               string;
  email:              string | null;
  phone:              string | null;
  role:               string;
  status:             string;
  assignedCourseId:   number | null;
  assignedCourseName: string | null;
  createdBy:          string | null;
  updatedBy:          string | null;
  lastLoginAt:        string | null;
  createdAt:          string | null;
  updatedAt:          string | null;
};

type CourseOption = { id: number; name: string; curriculumYear: string | null };

type PinReveal = { id: number; pin: string; name: string; copied: boolean };

const ASSIGNABLE_ROLES: { value: string; label: string }[] = [
  { value: "admin",              label: "Gurukul Admin" },
  { value: "course_coordinator", label: "Course Coordinator" },
  { value: "operations_manager", label: "Operations Manager" },
];

const BLANK_FORM = {
  name:             "",
  email:            "",
  phone:            "",
  role:             "admin",
  assignedCourseId: null as number | null,
  curriculumYear:   "",
};

const PAGE_SIZE = 25;
type SortKey = "name" | "role" | "status" | "lastLoginAt";

function formatPhone(p: string | null | undefined) {
  if (!p) return "—";
  if (p.length === 10) return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
  return p;
}

function formatLastLogin(dt: string | null | undefined): string {
  if (!dt) return "Never";
  const d = new Date(dt);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Initials({ name }: { name: string }) {
  const ini = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold shrink-0">
      {ini}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const label = getRoleLabel(role as UserRole);
  const color = getRoleBadgeColor(role as UserRole);
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${color}`}>
      {label}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { activeCurriculumYearLong, activeYearsListLong } = usePortalSettings();

  const [admins,        setAdmins]        = useState<AdminUser[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [courses,       setCourses]       = useState<CourseOption[]>([]);
  const [showForm,      setShowForm]      = useState(false);
  const [editTarget,    setEditTarget]    = useState<AdminUser | null>(null);
  const [submitting,    setSubmitting]    = useState(false);
  const [pinReveal,     setPinReveal]     = useState<PinReveal | null>(null);
  const [showPin,       setShowPin]       = useState(false);
  const [resetting,     setResetting]     = useState<number | null>(null);
  const [deleting,      setDeleting]      = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [showPerms,     setShowPerms]     = useState(false);

  const [form,        setForm]        = useState(BLANK_FORM);
  const [formError,   setFormError]   = useState("");
  const [search,      setSearch]      = useState("");
  const [filterRole,  setFilterRole]  = useState("All");
  const [filterStatus,setFilterStatus]= useState("All");
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey,     setSortKey]     = useState<SortKey>("name");
  const [sortAsc,     setSortAsc]     = useState(true);
  const [page,        setPage]        = useState(1);
  const [pageInput,   setPageInput]   = useState("1");
  const tableRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.adminUsers.list();
      setAdmins(data as AdminUser[]);
    } catch {
      toast.error("Failed to load admin users.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load courses for coordinator assignment dropdown
  useEffect(() => {
    adminApi.courses.list(false)
      .then((data) =>
        setCourses(
          (data as { id: number; name: string; curriculumYear: string | null }[])
            .map((c) => ({ id: c.id, name: c.name, curriculumYear: c.curriculumYear }))
        )
      )
      .catch(() => { /* silent — admin may not have course management */ });
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { setPage(1); setPageInput("1"); }, [search, filterRole, filterStatus, sortKey, sortAsc]);

  const regularAdmins = useMemo(() => {
    const base = admins.filter((a) => {
      if (a.role === "super_admin") return false;
      const q      = search.toLowerCase();
      const digits = search.replace(/\D/g, "");
      const matchesSearch =
        a.name.toLowerCase().includes(q) ||
        (digits.length > 0 && (a.phone ?? "").includes(digits));
      const matchesRole   = filterRole   === "All" || a.role   === filterRole;
      const matchesStatus = filterStatus === "All" || a.status === filterStatus;
      return matchesSearch && matchesRole && matchesStatus;
    });
    return [...base].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortKey === "name")        { av = a.name;                                              bv = b.name; }
      else if (sortKey === "role")   { av = a.role ?? "";                                        bv = b.role ?? ""; }
      else if (sortKey === "status") { av = a.status ?? "";                                      bv = b.status ?? ""; }
      else if (sortKey === "lastLoginAt") {
        av = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
        bv = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
      }
      if (av === bv) return 0;
      if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [admins, search, filterRole, filterStatus, sortKey, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(regularAdmins.length / PAGE_SIZE));
  const paginated  = regularAdmins.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function goToPage(n: number) {
    const clamped = Math.max(1, Math.min(n, totalPages));
    setPage(clamped);
    setPageInput(String(clamped));
    tableRef.current?.scrollTo({ top: 0 });
  }

  const activeFilterCount = (filterRole !== "All" ? 1 : 0) + (filterStatus !== "All" ? 1 : 0);
  const rawAdminCount = admins.filter((a) => a.role !== "super_admin").length;

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronUp className="w-3 h-3 opacity-20 inline ml-1" />;
    return sortAsc
      ? <ChevronUp className="w-3 h-3 inline ml-1 text-primary" />
      : <ChevronDown className="w-3 h-3 inline ml-1 text-primary" />;
  }

  // ── Form helpers ────────────────────────────────────────────────────────────
  function openAdd() {
    setEditTarget(null);
    setForm({ ...BLANK_FORM, curriculumYear: activeCurriculumYearLong });
    setFormError("");
    setShowForm(true);
  }

  function openEdit(a: AdminUser) {
    setEditTarget(a);
    setForm({
      name:             a.name,
      email:            a.email ?? "",
      phone:            a.phone ?? "",
      role:             a.role || "admin",
      assignedCourseId: a.assignedCourseId ?? null,
      curriculumYear:   activeCurriculumYearLong,
    });
    setFormError("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditTarget(null);
    setForm({ ...BLANK_FORM });
    setFormError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    const nameErr  = validatePersonName(form.name, "Full name");
    if (nameErr)  { setFormError(nameErr); return; }
    const phoneErr = validateUSPhone(form.phone);
    if (phoneErr) { setFormError(phoneErr); return; }
    if (form.role === "course_coordinator" && !form.assignedCourseId) {
      setFormError("Course Coordinators must be assigned to a specific course.");
      return;
    }
    if (form.role === "course_coordinator" && !form.email.trim()) {
      setFormError("Email is required for Course Coordinators — it links their admin account to their staff record.");
      return;
    }
    if (form.role === "course_coordinator" && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setFormError("Please enter a valid email address.");
      return;
    }

    const cleanPhone = form.phone.replace(/\D/g, "");
    setSubmitting(true);
    try {
      if (editTarget) {
        await adminApi.adminUsers.update(editTarget.id, {
          name:             form.name.trim(),
          email:            form.role === "course_coordinator" ? form.email.trim() : undefined,
          phone:            cleanPhone,
          role:             form.role,
          assignedCourseId: form.role === "course_coordinator" ? form.assignedCourseId : null,
          curriculumYear:   form.role === "course_coordinator" ? form.curriculumYear : undefined,
          updatedById:      currentUser?.id,
        });
        toast.success(`${form.name} updated.`);
        await load();
      } else {
        const result = await adminApi.adminUsers.create({
          name:             form.name.trim(),
          email:            form.role === "course_coordinator" ? form.email.trim() : undefined,
          phone:            cleanPhone,
          role:             form.role,
          assignedCourseId: form.role === "course_coordinator" ? form.assignedCourseId : null,
          curriculumYear:   form.role === "course_coordinator" ? form.curriculumYear : undefined,
          createdById:      currentUser?.id,
        }) as { admin: AdminUser; pin: string; linkedExistingTeacher?: boolean };
        toast.success(`Account created! Share the PIN with ${form.name}.`);
        if (result.linkedExistingTeacher) {
          toast.info(`Email matched an existing staff record — coordinator linked to that record instead of creating a new one.`, { duration: 8000 });
        }
        setPinReveal({ id: result.admin.id, pin: result.pin, name: result.admin.name, copied: false });
        setShowPin(true);
        await load();
      }
      closeForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPin(a: AdminUser) {
    setResetting(a.id);
    try {
      const result = await adminApi.adminUsers.resetPin(a.id, { updatedById: currentUser?.id }) as { pin: string };
      setPinReveal({ id: a.id, pin: result.pin, name: a.name, copied: false });
      setShowPin(true);
      toast.success("PIN reset. Share the new PIN securely.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reset PIN.");
    } finally {
      setResetting(null);
    }
  }

  async function handleToggleStatus(a: AdminUser) {
    const next = a.status === "active" ? "inactive" : "active";
    try {
      await adminApi.adminUsers.setStatus(a.id, next);
      setAdmins((prev) => prev.map((u) => (u.id === a.id ? { ...u, status: next } : u)));
      toast.success(`${a.name} is now ${next}.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update status.");
    }
  }

  async function handleDelete(a: AdminUser) {
    setDeleting(a.id);
    try {
      await adminApi.adminUsers.remove(a.id);
      setAdmins((prev) => prev.filter((u) => u.id !== a.id));
      setDeleteConfirm(null);
      toast.success(`${a.name} removed.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeleting(null);
    }
  }

  function copyPin() {
    if (!pinReveal) return;
    navigator.clipboard.writeText(pinReveal.pin).then(() => {
      setPinReveal((p) => (p ? { ...p, copied: true } : null));
      setTimeout(() => setPinReveal((p) => (p ? { ...p, copied: false } : null)), 2000);
    });
  }

  return (
    <div className="space-y-6">

      {/* ── PIN reveal banner ──────────────────────────────────────────── */}
      {pinReveal && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800 mb-1">
              New PIN for <strong>{pinReveal.name}</strong> — share this securely
            </p>
            <p className="text-xs text-amber-700">This PIN is shown only once. Copy it before dismissing.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-xl px-4 py-2">
              <span className="font-mono text-2xl font-bold text-secondary tracking-widest">
                {showPin ? pinReveal.pin : "••••"}
              </span>
              <button onClick={() => setShowPin((v) => !v)} className="text-muted-foreground hover:text-secondary">
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button size="sm" variant="outline" onClick={copyPin} className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100">
              {pinReveal.copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
            </Button>
            <button onClick={() => setPinReveal(null)} className="text-muted-foreground hover:text-secondary">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-secondary">User Management</h2>
          <p className="text-sm text-muted-foreground">
            Manage admin accounts · {regularAdmins.length} account{regularAdmins.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowPerms(true)} className="gap-1.5 text-xs">
            <ShieldCheck className="w-3.5 h-3.5" /> Permissions
          </Button>
          <Button onClick={openAdd} className="gap-2 rounded-xl shrink-0">
            <UserPlus className="w-4 h-4" /> Add User
          </Button>
        </div>
      </div>

      {/* ── Search bar + filter toggle ─────────────────────────────────── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or phone..."
            className="pl-9 rounded-xl"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-colors shrink-0 ${
            showFilters || activeFilterCount > 0
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-white border-border text-muted-foreground hover:border-primary"
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="bg-primary text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {/* ── Collapsible filter panel ────────────────────────────────────── */}
      {showFilters && (
        <div className="bg-gray-50 border border-border rounded-2xl p-4 flex flex-wrap gap-4">
          {/* Role */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Role</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: "All", label: "All" },
                ...ASSIGNABLE_ROLES,
              ].map((r) => (
                <button
                  key={r.value}
                  onClick={() => setFilterRole(r.value)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                    filterRole === r.value
                      ? "bg-primary text-white"
                      : "bg-white border border-border text-muted-foreground hover:border-primary"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {/* Status */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</span>
            <div className="flex flex-wrap gap-1.5">
              {["All", "active", "inactive"].map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors capitalize ${
                    filterStatus === s
                      ? "bg-primary text-white"
                      : "bg-white border border-border text-muted-foreground hover:border-primary"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex items-end">
              <button
                onClick={() => { setFilterRole("All"); setFilterStatus("All"); }}
                className="text-xs text-primary hover:underline font-medium"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Admin Management ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-bold text-secondary">Admin Accounts</h3>
            <span className="text-xs text-muted-foreground">Login: phone number + 4-digit PIN</span>
          </div>
          <Button size="sm" onClick={showForm ? closeForm : openAdd} className="gap-1.5 h-8 text-xs">
            <UserPlus className="w-3.5 h-3.5" />
            {showForm && !editTarget ? "Cancel" : "Add User"}
          </Button>
        </div>

        {/* Add / Edit form */}
        {showForm && (
          <div className="px-5 py-5 border-b border-border bg-gray-50">
            <h4 className="text-sm font-semibold text-secondary mb-4">
              {editTarget ? `Edit — ${editTarget.name}` : "New Admin Account"}
            </h4>
            {formError && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-xs mb-4">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {formError}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Row 1: Name | Phone | Role */}
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Full Name <span className="text-red-500">*</span></Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Pt. Ramesh Sharma"
                    required
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Phone / Username <span className="text-red-500">*</span>
                    <span className="font-normal text-muted-foreground ml-1">(US 10-digit)</span>
                  </Label>
                  <Input
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: formatUSPhone(e.target.value) }))}
                    placeholder="(614) 123-4567"
                    type="tel"
                    maxLength={14}
                    required
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Role <span className="text-red-500">*</span></Label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((f) => ({
                      ...f,
                      role:             e.target.value,
                      assignedCourseId: e.target.value !== "course_coordinator" ? null : f.assignedCourseId,
                    }))}
                    className="w-full h-9 text-sm border border-input rounded-md px-3 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    required
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Email + Course + Curriculum Year — visible only for Course Coordinator */}
              {form.role === "course_coordinator" && (
                <>
                  <div className="grid sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">
                        Email <span className="text-red-500">*</span>
                        <span className="font-normal text-muted-foreground ml-1">(links to staff record)</span>
                      </Label>
                      <Input
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="coordinator@example.com"
                        type="email"
                        required
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">
                        Curriculum Year <span className="text-red-500">*</span>
                      </Label>
                      <select
                        value={form.curriculumYear}
                        onChange={(e) => setForm((f) => ({ ...f, curriculumYear: e.target.value }))}
                        className="w-full h-9 text-sm border border-input rounded-md px-3 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        required
                      >
                        {activeYearsListLong.map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">
                        Assigned Course <span className="text-red-500">*</span>
                      </Label>
                      <select
                        value={form.assignedCourseId ?? ""}
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          assignedCourseId: e.target.value ? parseInt(e.target.value) : null,
                        }))}
                        className="w-full h-9 text-sm border border-input rounded-md px-3 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        required
                      >
                        <option value="" disabled>— Select course —</option>
                        {courses.length === 0 && (
                          <option value="" disabled>No courses available</option>
                        )}
                        {courses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.curriculumYear ? ` (${c.curriculumYear})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {/* Buttons */}
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" size="sm" onClick={closeForm} className="text-xs">
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={submitting} className="text-xs gap-1.5">
                  {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
                  {editTarget ? "Save Changes" : "Create Account"}
                </Button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-14 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : rawAdminCount === 0 ? (
          <div className="text-center py-14 text-muted-foreground text-sm">
            No admin accounts yet. Click <strong>Add User</strong> to create one.
          </div>
        ) : (
          <>
          <div ref={tableRef} className="overflow-auto max-h-[560px]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-border sticky top-0 z-10">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("name")}>
                    Name<SortIcon col="name" />
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("role")}>
                    Role<SortIcon col="role" />
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    Phone / Username
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("status")}>
                    Status<SortIcon col="status" />
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors" onClick={() => handleSort("lastLoginAt")}>
                    Last Login<SortIcon col="lastLoginAt" />
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    Created By
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {regularAdmins.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">No users match the current filters.</td></tr>
                )}
                {paginated.map((a) => {
                  const isSelf = currentUser?.id === a.id;
                  return (
                    <tr key={a.id} className={`hover:bg-gray-50 ${a.status === "inactive" ? "opacity-60" : ""}`}>
                      {/* Name */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <Initials name={a.name} />
                          <div>
                            <span className="font-medium text-secondary">{a.name}</span>
                            {isSelf && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">You</span>}
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-5 py-4">
                        <RoleBadge role={a.role} />
                        {a.role === "course_coordinator" && a.assignedCourseName && (
                          <div className="flex items-center gap-1 mt-1 text-[11px] text-purple-600">
                            <BookOpen className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate max-w-[120px]" title={a.assignedCourseName}>{a.assignedCourseName}</span>
                          </div>
                        )}
                        {a.role === "course_coordinator" && !a.assignedCourseName && (
                          <div className="mt-1 text-[11px] text-orange-500 italic">No course assigned</div>
                        )}
                      </td>

                      {/* Phone */}
                      <td className="px-5 py-4 text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5" />
                          {formatPhone(a.phone)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">username: {a.phone}</p>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          a.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                        }`}>
                          {a.status === "active" ? "Active" : "Inactive"}
                        </span>
                      </td>

                      {/* Last Login */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>{formatLastLogin(a.lastLoginAt)}</span>
                        </div>
                        {a.lastLoginAt && (
                          <div className="text-[11px] text-muted-foreground/60 mt-0.5 pl-5">
                            {new Date(a.lastLoginAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </div>
                        )}
                      </td>

                      {/* Created by */}
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {a.createdBy ?? "System"}
                        {a.createdAt && (
                          <div className="text-[11px] text-muted-foreground/70">
                            {new Date(a.createdAt).toLocaleDateString()}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            onClick={() => openEdit(a)}
                            className="text-xs px-2 py-1 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 flex items-center gap-1"
                          >
                            <Edit2 className="w-3 h-3" /> Edit
                          </button>
                          <button
                            onClick={() => handleResetPin(a)}
                            disabled={resetting === a.id}
                            className="text-xs px-2 py-1 rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 flex items-center gap-1 disabled:opacity-50"
                          >
                            {resetting === a.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <RefreshCw className="w-3 h-3" />}
                            Reset PIN
                          </button>
                          <button
                            onClick={() => handleToggleStatus(a)}
                            className={`text-xs px-2 py-1 rounded-lg border flex items-center gap-1 transition-colors ${
                              a.status === "active"
                                ? "border-orange-200 text-orange-600 hover:bg-orange-50"
                                : "border-green-200 text-green-600 hover:bg-green-50"
                            }`}
                          >
                            {a.status === "active" ? "Deactivate" : "Activate"}
                          </button>
                          {deleteConfirm === a.id ? (
                            <>
                              <button
                                onClick={() => handleDelete(a)}
                                disabled={deleting === a.id}
                                className="text-xs px-2 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 flex items-center gap-1 disabled:opacity-50"
                              >
                                {deleting === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Confirm
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-gray-100 flex items-center gap-1"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(a.id)}
                              className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination footer */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-gray-50/50">
              <span className="text-xs text-muted-foreground">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, regularAdmins.length)} of {regularAdmins.length}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => goToPage(page - 1)} disabled={page === 1} className="w-7 h-7 rounded-lg flex items-center justify-center border border-border bg-white disabled:opacity-40 hover:bg-gray-100 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1.5 px-1">
                  <span className="text-xs text-muted-foreground">Page</span>
                  <input
                    type="number" min={1} max={totalPages}
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && goToPage(parseInt(pageInput))}
                    onBlur={() => goToPage(parseInt(pageInput))}
                    className="w-12 text-center text-xs border border-border rounded-lg px-1 py-1 focus:outline-none focus:border-primary"
                  />
                  <span className="text-xs text-muted-foreground">of {totalPages}</span>
                </div>
                <button onClick={() => goToPage(page + 1)} disabled={page === totalPages} className="w-7 h-7 rounded-lg flex items-center justify-center border border-border bg-white disabled:opacity-40 hover:bg-gray-100 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {/* ── Permissions modal ───────────────────────────────────────────── */}
      {showPerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowPerms(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-border w-full max-w-3xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-secondary flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                Role Permissions Overview
              </h3>
              <button onClick={() => setShowPerms(false)} className="text-muted-foreground hover:text-secondary rounded-lg p-1 hover:bg-gray-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-x-auto px-6 py-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-semibold text-muted-foreground">Module</th>
                    <th className="text-center px-3 py-2 font-semibold text-red-700">Admin</th>
                    <th className="text-center px-3 py-2 font-semibold text-purple-700">Course<br/>Coord.</th>
                    <th className="text-center px-3 py-2 font-semibold text-orange-700">Ops<br/>Manager</th>
                    <th className="text-center px-3 py-2 font-semibold text-blue-700">Teacher</th>
                    <th className="text-center px-3 py-2 font-semibold text-green-700">Assistant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {([
                    // [Module, Admin, CourseCoord, OpsManager, Teacher, Assistant]
                    ["Dashboard",           true,  false, true,  false, false],
                    ["Student Registration",true,  false, true,  false, false],
                    ["Student Management",  true,  false, true,  false, false],
                    ["Member Management",   true,  false, true,  false, false],
                    ["Course Management",   true,  true,  false, false, false],
                    ["Staff Management",    true,  true,  false, false, false],
                    ["Inventory",           true,  true,  false, false, false],
                    ["Communication Hub",   true,  true,  false, true,  true ],
                    ["Calendar",            true,  true,  false, false, false],
                    ["Courses & Classes",   false, true,  false, true,  true ],
                    ["Attendance",          false, true,  false, true,  true ],
                    ["Course Documents",    false, true,  false, true,  true ],
                    ["Weekly Updates",      false, true,  false, true,  true ],
                    ["User Management",     true,  false, false, false, false],
                    ["Audit Log",           true,  false, false, false, false],
                    ["Settings",            true,  true,  false, true,  true ],
                  ] as [string, boolean, boolean, boolean, boolean, boolean][]).map(([mod, admin, cc, om, teacher, asst]) => (
                    <tr key={String(mod)} className="hover:bg-gray-50">
                      <td className="py-2.5 pr-4 font-medium text-secondary">{mod}</td>
                      {[admin, cc, om, teacher, asst].map((v, i) => (
                        <td key={i} className="text-center px-3 py-2.5">
                          {v ? <span className="text-green-600 font-bold">✓</span> : <span className="text-gray-300">–</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-border bg-gray-50">
              <p className="text-xs text-muted-foreground">Super Admin has full access to all modules and cannot be restricted.</p>
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowPerms(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

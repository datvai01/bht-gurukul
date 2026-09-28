import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { adminApi } from "@/lib/adminApi";
import { useAuth } from "../AuthContext";
import { canAccess } from "../rbac";
import {
  Search, Plus, Pencil, Trash2, X, Loader2,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Download,
  Phone, Mail, ExternalLink, ShieldAlert,
  AlertTriangle, RefreshCw, Building2, Filter,
  ShieldCheck, Clock, DollarSign, Receipt,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { formatUSPhone } from "@/lib/validators";
import { membershipExpiryLabel, membershipStatus, templeYear } from "@/lib/membership";

// ─── Types ────────────────────────────────────────────────────────────────────

type Member = {
  id: number;
  memberCode: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  membershipYear: number | null;
  createdAt: string;
  studentCount: number;
  isActive: boolean;
  expiringSoon: boolean;
  employer: string | null;
  address: string | null;
  // validation fields
  validationStatus: string;
  validationDate: string | null;
  validatedByAdminName: string | null;
  idCardTypeSeen: string | null;
  idCardNumberLast4: string | null;
  validationNotes: string | null;
  // membership fee
  memFeeStatus: string | null;
  memFeePaid: number;
  memFeeDue: number;
  feeUpdatedByAdminName: string | null;
  feeUpdatedAt: string | null; // only present on detail fetch
};

type MemFeeForm = {
  membershipYear: string;
  amountDue: string;
  amountPaid: string;
  paymentStatus: "Paid" | "Pending" | "Overdue";
  paymentMethod: string;
  receiptId: string;
  paymentDate: string;
  notes: string;
};

const EMPTY_MEM_FEE: MemFeeForm = {
  membershipYear: String(new Date().getFullYear()),
  amountDue: "150.00",
  amountPaid: "0.00",
  paymentStatus: "Pending",
  paymentMethod: "",
  receiptId: "",
  paymentDate: "",
  notes: "",
};

const PAYMENT_METHODS = ["Stripe", "Check", "Zelle", "Cash", "Other"];

type MemberDetail = Member & {
  students: { id: number; studentCode: string; name: string; dob: string | null; grade: string | null; isActive: boolean }[];
};


type FormData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  membershipYear: string;
  address: string;
};

type ValidateFormData = {
  idCardTypeSeen: string;
  idCardNumberLast4: string;
  idCardIssuingAuthority: string;
  validationNotes: string;
};

type SortKey = "id" | "name" | "email" | "createdAt" | "validation";

const EMPTY_FORM: FormData = { firstName: "", lastName: "", email: "", phone: "", membershipYear: "", address: "" };
const EMPTY_VALIDATE: ValidateFormData = {
  idCardTypeSeen: "",
  idCardNumberLast4: "",
  idCardIssuingAuthority: "",
  validationNotes: "",
};
const PAGE_SIZE    = 100;
const CURRENT_YEAR = templeYear();

const ID_CARD_TYPES = [
  "Driver's License",
  "Passport",
  "State ID",
  "Military ID",
  "Green Card / Permanent Resident Card",
  "Other",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string | null) {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function avatarColor(id: number) {
  const P = [
    "bg-red-100 text-red-700", "bg-amber-100 text-amber-700",
    "bg-emerald-100 text-emerald-700", "bg-sky-100 text-sky-700",
    "bg-violet-100 text-violet-700", "bg-pink-100 text-pink-700",
    "bg-orange-100 text-orange-700", "bg-teal-100 text-teal-700",
  ];
  return P[id % P.length];
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function isOverdue(m: Member): boolean {
  return m.validationStatus === "Invalidated" && daysSince(m.createdAt) > 90;
}

function validationSortScore(m: Member): number {
  if (isOverdue(m))                        return 0; // overdue first
  if (m.validationStatus === "Invalidated") return 1; // then invalidated
  return 2;                                            // validated last
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ isActive, expiringSoon, size = "sm" }: { isActive: boolean; expiringSoon: boolean; size?: "xs" | "sm" }) {
  const cls = size === "xs"
    ? "text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
    : "text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap";

  if (!isActive)    return <span className={`${cls} bg-red-100 text-red-600`}>Expired</span>;
  if (expiringSoon) return <span className={`${cls} bg-amber-100 text-amber-700`}>Expiring Soon</span>;
  return <span className={`${cls} bg-emerald-100 text-emerald-700`}>Active</span>;
}

// ─── Validation Badge ─────────────────────────────────────────────────────────

function ValidationBadge({ member, size = "sm" }: { member: Member; size?: "xs" | "sm" }) {
  const iconCls = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";
  const cls = size === "xs"
    ? "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
    : "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap";

  if (member.validationStatus === "Validated") {
    return (
      <span className={`${cls} bg-emerald-100 text-emerald-700`}>
        <ShieldCheck className={iconCls} />
        Verified
      </span>
    );
  }

  const days = daysSince(member.createdAt);
  const overdue = days > 90;

  return (
    <span className={`${cls} ${overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
      <Clock className={iconCls} />
      {overdue ? `${days}d overdue` : `${days}d · unverified`}
    </span>
  );
}

// ─── Membership Fee Badge ─────────────────────────────────────────────────────

function MemFeeBadge({ status, size = "sm" }: { status: string | null; size?: "xs" | "sm" }) {
  const cls = size === "xs"
    ? "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
    : "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap";
  if (!status) return <span className={`${cls} bg-gray-100 text-gray-400`}>—</span>;
  if (status === "Paid")    return <span className={`${cls} bg-emerald-100 text-emerald-700`}><DollarSign className="w-3 h-3" />Paid</span>;
  if (status === "Overdue") return <span className={`${cls} bg-red-100 text-red-700`}><DollarSign className="w-3 h-3" />Overdue</span>;
  return <span className={`${cls} bg-amber-100 text-amber-700`}><DollarSign className="w-3 h-3" />Pending</span>;
}

// ─── Membership Fee Payment Modal ─────────────────────────────────────────────

function MemFeePaymentModal({ member, onClose, onSaved }: {
  member: Member; onClose: () => void; onSaved: () => void;
}) {
  const curYear = templeYear();
  const [form, setForm] = useState<MemFeeForm>({
    ...EMPTY_MEM_FEE,
    membershipYear: String(curYear),
    amountDue:      member.memFeeDue > 0 ? String(member.memFeeDue) : "150.00",
    amountPaid:     member.memFeePaid > 0 ? String(member.memFeePaid) : "0.00",
    paymentStatus:  (member.memFeeStatus as "Paid" | "Pending" | "Overdue" | null) ?? "Pending",
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.members.getMembershipPayment(member.id)
      .then((rec) => {
        if (rec) {
          setForm({
            membershipYear: String(rec.membershipYear),
            amountDue:      rec.amountDue,
            amountPaid:     rec.amountPaid,
            paymentStatus:  rec.paymentStatus,
            paymentMethod:  rec.paymentMethod ?? "",
            receiptId:      rec.receiptId ?? "",
            paymentDate:    rec.paymentDate ?? "",
            notes:          rec.notes ?? "",
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [member.id]);

  function field<K extends keyof MemFeeForm>(key: K, value: MemFeeForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await adminApi.members.upsertMembershipPayment(member.id, {
        membershipYear: parseInt(form.membershipYear) || curYear,
        amountDue:      parseFloat(form.amountDue) || 0,
        amountPaid:     parseFloat(form.amountPaid) || 0,
        paymentStatus:  form.paymentStatus,
        paymentMethod:  form.paymentMethod || null,
        receiptId:      form.receiptId || null,
        paymentDate:    form.paymentDate || null,
        notes:          form.notes || null,
      });
      toast.success("Membership payment saved");
      onSaved();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to save payment");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-bold text-secondary">Membership Fee</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{member.name ?? `Member #${member.id}`}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">Membership Year</label>
                <Input type="number" value={form.membershipYear} onChange={(e) => field("membershipYear", e.target.value)} min={2020} max={2040} />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">Status <span className="text-red-500">*</span></label>
                <select value={form.paymentStatus} onChange={(e) => field("paymentStatus", e.target.value as "Paid"|"Pending"|"Overdue")}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white">
                  <option value="Paid">Paid</option>
                  <option value="Pending">Pending</option>
                  <option value="Overdue">Overdue</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">Amount Due ($)</label>
                <Input type="number" step="0.01" value={form.amountDue} onChange={(e) => field("amountDue", e.target.value)} placeholder="150.00" />
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">Amount Paid ($)</label>
                <Input type="number" step="0.01" value={form.amountPaid} onChange={(e) => field("amountPaid", e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">Payment Method</label>
                <select value={form.paymentMethod} onChange={(e) => field("paymentMethod", e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white">
                  <option value="">— Select —</option>
                  {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary mb-1">Payment Date</label>
                <Input type="date" value={form.paymentDate} onChange={(e) => field("paymentDate", e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Receipt / Confirmation ID</label>
              <Input value={form.receiptId} onChange={(e) => field("receiptId", e.target.value)} placeholder="e.g. pi_3xxxxxabc" />
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => field("notes", e.target.value)} rows={2}
                placeholder="Optional notes about this payment…"
                className="w-full text-sm px-3 py-2 rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
              <Button type="submit" disabled={saving} className="flex-1">
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Save Payment
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Quick Renew Modal (inline from table row) ────────────────────────────────

function QuickRenewModal({ member, onClose, onSaved }: {
  member: Member; onClose: () => void; onSaved: () => void;
}) {
  const curYear = templeYear();
  const [form, setForm] = useState<MemFeeForm>({
    ...EMPTY_MEM_FEE,
    membershipYear: String(curYear),
    amountDue: "150.00",
    amountPaid: "150.00",
    paymentStatus: "Paid",
  });
  const [saving, setSaving] = useState(false);
  const [skipPayment, setSkipPayment] = useState(false);

  function field<K extends keyof MemFeeForm>(key: K, value: MemFeeForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleRenew() {
    setSaving(true);
    try {
      const paymentData = skipPayment ? undefined : {
        amountDue:     parseFloat(form.amountDue) || 150,
        amountPaid:    parseFloat(form.amountPaid) || 0,
        paymentStatus: form.paymentStatus,
        paymentMethod: form.paymentMethod || undefined,
        receiptId:     form.receiptId || undefined,
        paymentDate:   form.paymentDate || undefined,
        notes:         form.notes || undefined,
      };
      await adminApi.members.renew(member.id, paymentData);
      toast.success("Membership renewed" + (skipPayment ? "" : " and payment recorded"));
      onSaved();
    } catch (err) {
      toast.error((err as Error).message ?? "Renewal failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-secondary">Renew Membership</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{member.name ?? `Member #${member.id}`}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
             Renewal is valid through <strong>December 31, {templeYear()}</strong>. Renew again next calendar year to remain active.
          </p>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={skipPayment} onChange={(e) => setSkipPayment(e.target.checked)} className="rounded" />
            <span className="text-sm text-secondary">Renew without recording a payment now</span>
          </label>

          {!skipPayment && (
            <div className="space-y-3 pt-1">
              <p className="text-xs font-bold text-secondary uppercase tracking-wide border-b border-border pb-1">Payment Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Amount Due ($)</label>
                  <Input type="number" step="0.01" value={form.amountDue} onChange={(e) => field("amountDue", e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Amount Paid ($)</label>
                  <Input type="number" step="0.01" value={form.amountPaid} onChange={(e) => field("amountPaid", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Status</label>
                  <select value={form.paymentStatus} onChange={(e) => field("paymentStatus", e.target.value as "Paid"|"Pending"|"Overdue")}
                    className="w-full text-xs border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white">
                    <option value="Paid">Paid</option>
                    <option value="Pending">Pending</option>
                    <option value="Overdue">Overdue</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">Method</label>
                  <select value={form.paymentMethod} onChange={(e) => field("paymentMethod", e.target.value)}
                    className="w-full text-xs border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white">
                    <option value="">— Select —</option>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Receipt / Confirmation ID</label>
                <Input value={form.receiptId} onChange={(e) => field("receiptId", e.target.value)} placeholder="Optional" />
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1" disabled={saving}>Cancel</Button>
            <Button onClick={handleRenew} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              <RefreshCw className="w-4 h-4 mr-2" />
              Renew{!skipPayment ? " & Record" : ""}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Member Form Modal ────────────────────────────────────────────────────────

function MemberModal({ editing, onClose, onSaved }: {
  editing: Member | null; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<FormData>(
    editing
      ? {
          // Older records without split names fall back to splitting the full name at its first space.
          firstName:      editing.firstName ?? (editing.name ?? "").trim().split(/\s+/)[0] ?? "",
          lastName:       editing.lastName ?? (editing.name ?? "").trim().split(/\s+/).slice(1).join(" "),
          email:          editing.email ?? "",
          phone:          editing.phone ? formatUSPhone(editing.phone.replace(/\D/g, "")) : "",
          membershipYear: editing.membershipYear?.toString() ?? "",
          address:        editing.address ?? "",
        }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function field(key: keyof FormData, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  function handlePhoneChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    field("phone", formatUSPhone(digits));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = "First name is required";
    if (!form.lastName.trim()) e.lastName = "Last name is required";
    if (!form.email.trim()) {
      e.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = "Invalid email address";
    }
    if (!form.phone.trim()) {
      e.phone = "Phone is required";
    } else {
      const digits = form.phone.replace(/\D/g, "");
      if (digits.length !== 10)      e.phone = "Phone must be 10 digits";
      else if (/^[01]/.test(digits)) e.phone = "US area codes cannot start with 0 or 1";
    }
    if (form.membershipYear) {
      const y = parseInt(form.membershipYear);
      if (isNaN(y) || y < 2000 || y > CURRENT_YEAR + 1)
        e.membershipYear = `Year must be 2000–${CURRENT_YEAR + 1}`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = {
        firstName:        form.firstName.trim(),
        lastName:         form.lastName.trim(),
        email:            form.email.trim(),
        phone:            form.phone.replace(/\D/g, ""),
        isExistingMember: true,
        policyAgreed:     true,
        membershipYear:   form.membershipYear ? parseInt(form.membershipYear) : null,
        address:          form.address.trim() || null,
      };
      if (editing) {
        await adminApi.members.fullUpdate(editing.id, payload);
        toast.success("Member updated");
      } else {
        await adminApi.members.create(payload);
        toast.success("Member added");
      }
      onSaved();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed to save member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="text-lg font-bold text-secondary">{editing ? "Edit Member" : "Add New Member"}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">First Name <span className="text-red-500">*</span></label>
              <Input value={form.firstName} onChange={(e) => field("firstName", e.target.value)} placeholder="e.g. Anita" />
              {errors.firstName && <p className="text-xs text-red-500 mt-1">{errors.firstName}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Last Name <span className="text-red-500">*</span></label>
              <Input value={form.lastName} onChange={(e) => field("lastName", e.target.value)} placeholder="e.g. Sharma" />
              {errors.lastName && <p className="text-xs text-red-500 mt-1">{errors.lastName}</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Email <span className="text-red-500">*</span></label>
            <Input type="email" value={form.email} onChange={(e) => field("email", e.target.value)} placeholder="anita@example.com" />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Phone <span className="text-red-500">*</span></label>
            <Input value={form.phone} onChange={(e) => handlePhoneChange(e.target.value)} placeholder="(555) 123-4567" maxLength={14} />
            {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Membership Year</label>
            <Input type="number" value={form.membershipYear} onChange={(e) => field("membershipYear", e.target.value)}
              placeholder={String(CURRENT_YEAR)} min={2000} max={CURRENT_YEAR + 1} />
            {errors.membershipYear && <p className="text-xs text-red-500 mt-1">{errors.membershipYear}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Home Address</label>
            <textarea
              value={form.address}
              onChange={(e) => field("address", e.target.value)}
              placeholder="e.g. 123 Main St, Columbus, OH 43085"
              rows={2}
              className="w-full text-sm px-3 py-2 rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 resize-none"
            />
          </div>
          <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Membership is valid through <strong>December 31 of the registration or renewal year</strong>. Renew each calendar year to stay active and register students.
          </p>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={saving} className="flex-1">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editing ? "Save Changes" : "Add Member"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Validate Member Modal ────────────────────────────────────────────────────

function ValidateMemberModal({ member, onClose, onSaved }: {
  member: Member; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<ValidateFormData>(EMPTY_VALIDATE);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function field(key: keyof ValidateFormData, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.idCardTypeSeen) e.idCardTypeSeen = "Please select the type of ID presented";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      await adminApi.members.validate(member.id, {
        idCardTypeSeen:         form.idCardTypeSeen,
        idCardNumberLast4:      form.idCardNumberLast4 || undefined,
        idCardIssuingAuthority: form.idCardIssuingAuthority || undefined,
        validationNotes:        form.validationNotes || undefined,
      });
      toast.success(`${member.name ?? "Member"} verified successfully`);
      onSaved();
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Validation failed");
    } finally {
      setSaving(false);
    }
  }

  const days = daysSince(member.createdAt);
  const overdue = days > 90;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-bold text-secondary">Verify Member Identity</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{member.name ?? `Member #${member.id}`}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Status notice */}
        <div className={`mx-6 mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${overdue ? "bg-red-50 border border-red-200 text-red-700" : "bg-amber-50 border border-amber-100 text-amber-800"}`}>
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            Registered <strong>{days} day{days !== 1 ? "s" : ""} ago</strong>.
            {overdue ? " This member is overdue for verification." : " Please check their photo ID and complete verification."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-secondary mb-1">
              ID Type Presented <span className="text-red-500">*</span>
            </label>
            <select
              value={form.idCardTypeSeen}
              onChange={(e) => field("idCardTypeSeen", e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white"
            >
              <option value="">Select ID type…</option>
              {ID_CARD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {errors.idCardTypeSeen && <p className="text-xs text-red-500 mt-1">{errors.idCardTypeSeen}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Last 4 of ID Number <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                value={form.idCardNumberLast4}
                onChange={(e) => field("idCardNumberLast4", e.target.value.slice(0, 4).toUpperCase())}
                placeholder="e.g. 7X2K"
                maxLength={4}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Last 4 characters only</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">Issuing Authority <span className="text-muted-foreground font-normal">(optional)</span></label>
              <Input
                value={form.idCardIssuingAuthority}
                onChange={(e) => field("idCardIssuingAuthority", e.target.value)}
                placeholder="e.g. Ohio BMV"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary mb-1">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
            <textarea
              value={form.validationNotes}
              onChange={(e) => field("validationNotes", e.target.value)}
              placeholder="Any additional observations…"
              rows={3}
              className="w-full text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white resize-none"
            />
          </div>

          <p className="text-xs text-muted-foreground bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            By marking this member as verified, you confirm you have physically checked a valid government-issued photo ID.
          </p>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              <ShieldCheck className="w-4 h-4 mr-2" />
              Mark as Verified
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ member, onClose, onEdit, onDelete, onRenew, onValidate, onFeeEdit, canEdit }: {
  member: MemberDetail; onClose: () => void; onEdit: () => void;
  onDelete: () => void; onRenew: () => void; onValidate: () => void; onFeeEdit: () => void; canEdit: boolean;
}) {
  const [showRenewModal, setShowRenewModal] = useState(false);
  const exp          = membershipExpiryLabel(member.createdAt, member.membershipYear);
  const { isActive: active, expiringSoon } = membershipStatus(member.createdAt, undefined, member.membershipYear);
  const validated    = member.validationStatus === "Validated";
  const days         = daysSince(member.createdAt);
  const overdue      = !validated && days > 90;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-full flex items-center justify-center text-base font-bold shrink-0 ${avatarColor(member.id)}`}>
              {initials(member.name)}
            </div>
            <div>
              <p className="font-bold text-secondary">{member.name ?? "—"}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-mono">{member.memberCode ?? `#${member.id}`}</span>
                <StatusBadge isActive={active} expiringSoon={expiringSoon} />
                <ValidationBadge member={member} />
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Overdue validation warning */}
        {overdue && (
          <div className="mx-6 mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p>This member has been registered for <strong>{days} days</strong> and has not yet been verified. Please ask them to present a photo ID.</p>
          </div>
        )}

        {!active && (
          <div className="mx-6 mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p>Expired on <strong>{exp}</strong>. Cannot register new students until renewed.</p>
          </div>
        )}
        {active && expiringSoon && (
          <div className="mx-6 mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>Expires on <strong>{exp}</strong> — within the next 30 days. Renew next calendar year to remain active.</p>
          </div>
        )}

        <div className="p-6 space-y-6">
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Contact Info</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-secondary">
                <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                {member.email ?? <span className="text-muted-foreground italic">No email</span>}
              </div>
              <div className="flex items-center gap-2 text-sm text-secondary">
                <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                {member.phone ? formatUSPhone(member.phone.replace(/\D/g, "")) : <span className="text-muted-foreground italic">No phone</span>}
              </div>
              {member.employer && (
                <div className="flex items-center gap-2 text-sm text-secondary">
                  <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  {member.employer}
                </div>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Membership Details</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Member Code</p>
                <p className="text-sm font-semibold font-mono text-primary">{member.memberCode ?? `#${member.id}`}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Membership Year</p>
                <p className="text-sm font-semibold text-secondary">{member.membershipYear ?? "Not recorded"}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-muted-foreground">Registered</p>
                <p className="text-sm font-semibold text-secondary">{fmtDate(member.createdAt)}</p>
              </div>
              <div className={`rounded-xl p-3 ${active ? "bg-emerald-50" : "bg-red-50"}`}>
                <p className="text-xs text-muted-foreground">Expires</p>
                <p className={`text-sm font-semibold ${active ? "text-emerald-700" : "text-red-700"}`}>{exp}</p>
              </div>
            </div>
          </section>

          {/* ── Membership Fee Section ────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Membership Fee ({new Date().getFullYear()})</h3>
              {canEdit && (
                <button onClick={onFeeEdit} className="text-xs text-primary hover:underline flex items-center gap-1">
                  <Receipt className="w-3 h-3" /> Edit Payment
                </button>
              )}
            </div>
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <MemFeeBadge status={member.memFeeStatus} />
              </div>
              {member.memFeeDue > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Amount Due</span>
                  <span className="font-semibold text-secondary">${Number(member.memFeeDue).toFixed(2)}</span>
                </div>
              )}
              {member.memFeePaid > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Amount Paid</span>
                  <span className="font-semibold text-emerald-700">${Number(member.memFeePaid).toFixed(2)}</span>
                </div>
              )}
              {member.feeUpdatedByAdminName && (
                <div className="pt-2 border-t border-border/50 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Last Updated By</span>
                    <span className="font-medium text-secondary">{member.feeUpdatedByAdminName}</span>
                  </div>
                  {member.feeUpdatedAt && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Updated On</span>
                      <span className="text-muted-foreground">
                        {new Date(member.feeUpdatedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {!member.memFeeStatus && (
                <p className="text-xs text-muted-foreground italic text-center py-1">No fee record for {new Date().getFullYear()} yet</p>
              )}
            </div>
          </section>

          {/* ── Validation Section ────────────────────────────────── */}
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Identity Verification</h3>
            {validated ? (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 font-medium text-sm">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  Verified
                  {member.validationDate && (
                    <span className="text-xs font-normal text-emerald-600 ml-1">on {fmtDate(member.validationDate)}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-secondary">
                  {member.idCardTypeSeen && (
                    <>
                      <span className="text-muted-foreground">ID Type</span>
                      <span className="font-medium">{member.idCardTypeSeen}</span>
                    </>
                  )}
                  {member.idCardNumberLast4 && (
                    <>
                      <span className="text-muted-foreground">ID Last 4</span>
                      <span className="font-mono font-medium">{member.idCardNumberLast4}</span>
                    </>
                  )}
                  {member.validatedByAdminName && (
                    <>
                      <span className="text-muted-foreground">Verified By</span>
                      <span className="font-medium">{member.validatedByAdminName}</span>
                    </>
                  )}
                </div>
                {member.validationNotes && (
                  <p className="text-xs text-emerald-700 mt-1 italic">"{member.validationNotes}"</p>
                )}
              </div>
            ) : (
              <div className={`rounded-xl p-4 ${overdue ? "bg-red-50 border border-red-200" : "bg-amber-50 border border-amber-100"}`}>
                <div className={`flex items-center gap-2 font-medium text-sm ${overdue ? "text-red-700" : "text-amber-800"}`}>
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  {overdue
                    ? `Registered but Not Verified — ${days} Days`
                    : `Not Yet Verified — ${days} day${days !== 1 ? "s" : ""} since registration`}
                </div>
                <p className={`text-xs mt-1.5 ${overdue ? "text-red-600" : "text-amber-700"}`}>
                  {overdue
                    ? "This member is overdue. Please verify their identity with a valid government-issued photo ID."
                    : "Member must present a valid photo ID within 90 days of registration."}
                </p>
                {canEdit && (
                  <Button
                    size="sm"
                    className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                    onClick={onValidate}
                  >
                    <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
                    Verify Now
                  </Button>
                )}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Linked Students ({member.students.length})
            </h3>
            {member.students.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No students linked.</p>
            ) : (
              <div className="space-y-2">
                {member.students.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor(s.id)}`}>
                      {initials(s.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-secondary truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground">{s.studentCode}{s.grade ? ` · Grade ${s.grade}` : ""}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-500"}`}>
                      {s.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {canEdit && (
          <div className="px-6 py-4 border-t border-border flex flex-wrap gap-2 sticky bottom-0 bg-white">
            <Button variant="outline" className="flex-1" onClick={onEdit}>
              <Pencil className="w-4 h-4 mr-2" /> Edit
            </Button>
            {(!active || expiringSoon) && (
              <Button variant="outline" className="flex-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                onClick={() => setShowRenewModal(true)}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Renew
              </Button>
            )}
            {member.students.length === 0 && (
              <Button variant="outline" className="flex-1 text-red-600 border-red-200 hover:bg-red-50" onClick={onDelete}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            )}
          </div>
        )}
      </div>
      {showRenewModal && (
        <QuickRenewModal
          member={member}
          onClose={() => setShowRenewModal(false)}
          onSaved={() => { setShowRenewModal(false); onRenew(); }}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Members() {
  const { user } = useAuth();
  const canEdit = canAccess(user?.role ?? "teacher", "members");

  // ── data
  const [rawMembers, setRawMembers] = useState<Member[]>([]);
  const [loading, setLoading]       = useState(true);

  // ── search & filters (client-side)
  const [search,           setSearch]          = useState("");
  const [statusFilter,     setStatusFilter]    = useState("all");
  const [validationFilter, setValidationFilter] = useState("all");
  const [studentsFilter,   setStudentsFilter]  = useState("all");
  const [employerFilter,   setEmployerFilter]  = useState("");
  const [feeFilter,        setFeeFilter]       = useState("all");
  const [showFilters,      setShowFilters]     = useState(false);

  // ── sort (client-side) — default: validation-aware (overdue → invalidated → validated)
  const [sortKey, setSortKey] = useState<SortKey>("validation");
  const [sortAsc, setSortAsc] = useState(true);

  // ── pagination
  const [page,      setPage]      = useState(1);
  const [pageInput, setPageInput] = useState("1");

  // ── panels / dialogs
  const [modalOpen,      setModalOpen]      = useState(false);
  const [editingMember,  setEditingMember]  = useState<Member | null>(null);
  const [detailMember,   setDetailMember]   = useState<MemberDetail | null>(null);
  const [detailLoading,  setDetailLoading]  = useState(false);
  const [deleting,       setDeleting]       = useState<number | null>(null);
  const [validateModal,  setValidateModal]  = useState<Member | null>(null);
  const [feeModal,       setFeeModal]       = useState<Member | null>(null);
  const [renewModal,     setRenewModal]     = useState<Member | null>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  const loadMembers = useCallback(() => {
    setLoading(true);
    adminApi.members.list({ limit: "9999" })
      .then((res) => {
        setRawMembers(res.data as Member[]);
      })
      .catch((err) => toast.error((err as Error).message ?? "Failed to load members"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  // ── filtered + sorted (entire dataset)
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let data = rawMembers.filter((m) => {
      if (statusFilter === "active"   && (!m.isActive || m.expiringSoon)) return false;
      if (statusFilter === "expiring" && (!m.isActive || !m.expiringSoon)) return false;
      if (statusFilter === "expired"  && m.isActive) return false;
      if (studentsFilter === "with"    && m.studentCount === 0) return false;
      if (studentsFilter === "without" && m.studentCount > 0)  return false;
      if (employerFilter.trim() && !(m.employer ?? "").toLowerCase().includes(employerFilter.toLowerCase())) return false;
      // validation filter
      if (validationFilter === "validated"   && m.validationStatus !== "Validated") return false;
      if (validationFilter === "invalidated" && m.validationStatus === "Validated") return false;
      if (validationFilter === "overdue"     && !isOverdue(m)) return false;
      if (feeFilter === "paid"    && m.memFeeStatus !== "Paid") return false;
      if (feeFilter === "pending" && m.memFeeStatus !== "Pending") return false;
      if (feeFilter === "overdue_fee" && m.memFeeStatus !== "Overdue") return false;
      if (feeFilter === "unpaid"  && !(m.memFeeStatus === "Pending" || m.memFeeStatus === "Overdue")) return false;
      const qDigits = q.replace(/\D/g, "");
      if (q && !(
        (m.name       ?? "").toLowerCase().includes(q) ||
        (m.phone      ?? "").toLowerCase().includes(q) ||
        (qDigits.length > 0 && (m.phone ?? "").replace(/\D/g, "").includes(qDigits))
      )) return false;
      return true;
    });

    data = [...data].sort((a, b) => {
      // Validation sort: overdue → invalidated → validated (within same score, sort by id desc)
      if (sortKey === "validation") {
        const scoreA = validationSortScore(a);
        const scoreB = validationSortScore(b);
        if (scoreA !== scoreB) return sortAsc ? scoreA - scoreB : scoreB - scoreA;
        return b.id - a.id; // secondary: newest first
      }

      let av: string | number, bv: string | number;
      if      (sortKey === "id")        { av = a.id;                      bv = b.id; }
      else if (sortKey === "name")      { av = (a.name  ?? "").toLowerCase(); bv = (b.name  ?? "").toLowerCase(); }
      else if (sortKey === "email")     { av = (a.email ?? "").toLowerCase(); bv = (b.email ?? "").toLowerCase(); }
      else                              { av = a.createdAt;               bv = b.createdAt; }
      if (av === bv) return 0;
      if (av < bv) return sortAsc ? -1 : 1;
      return sortAsc ? 1 : -1;
    });
    return data;
  }, [rawMembers, search, statusFilter, validationFilter, studentsFilter, employerFilter, feeFilter, sortKey, sortAsc]);

  // reset page when filters change
  useEffect(() => { setPage(1); setPageInput("1"); }, [search, statusFilter, validationFilter, studentsFilter, employerFilter, feeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const activeFilterCount = [
    statusFilter !== "all",
    validationFilter !== "all",
    studentsFilter !== "all",
    employerFilter.trim() !== "",
    feeFilter !== "all",
  ].filter(Boolean).length;

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="opacity-0 ml-1">↑</span>;
    return sortAsc
      ? <ChevronUp   className="w-3 h-3 inline ml-1 text-primary" />
      : <ChevronDown className="w-3 h-3 inline ml-1 text-primary" />;
  }

  function goToPage(p: number) {
    const clamped = Math.max(1, Math.min(totalPages, p));
    setPage(clamped);
    setPageInput(String(clamped));
    tableRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openDetail(member: Member) {
    setDetailLoading(true);
    try {
      const detail = await adminApi.members.getById(member.id);
      setDetailMember(detail as MemberDetail);
    } catch {
      toast.error("Failed to load member details");
    } finally {
      setDetailLoading(false);
    }
  }

  function openAdd()           { setEditingMember(null); setModalOpen(true); }
  function openEdit(m: Member) { setDetailMember(null); setEditingMember(m); setModalOpen(true); }

  async function handleDelete(member: Member) {
    if (!confirm(`Delete member "${member.name}"? This cannot be undone.`)) return;
    setDeleting(member.id);
    try {
      await adminApi.members.remove(member.id);
      toast.success("Member deleted");
      setDetailMember(null);
      loadMembers();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed to delete member");
    } finally {
      setDeleting(null);
    }
  }

  function handleSaved()   { setModalOpen(false); setEditingMember(null); loadMembers(); }
  function handleValidated() {
    setValidateModal(null);
    setDetailMember(null);
    loadMembers();
  }

  function exportCSV() {
    const header = ["Member Code", "ID", "Name", "Email", "Phone", "Employer", "Membership Status", "Validation Status", "Mem. Fee Status", "Days Since Reg.", "Expires", "Students", "Registered"];
    const rows = filtered.map((m) => [
      m.memberCode ?? `#${m.id}`, m.id, m.name ?? "", m.email ?? "",
      m.phone ? formatUSPhone(m.phone.replace(/\D/g, "")) : "",
      m.employer ?? "",
      !m.isActive ? "Expired" : m.expiringSoon ? "Expiring Soon" : "Active",
      m.validationStatus === "Validated" ? "Verified" : isOverdue(m) ? `Not Verified (${daysSince(m.createdAt)}d overdue)` : `Not Verified (${daysSince(m.createdAt)}d)`,
      m.memFeeStatus ?? "—",
      daysSince(m.createdAt),
      membershipExpiryLabel(m.createdAt, m.membershipYear),
      m.studentCount,
      fmtDate(m.createdAt),
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `members-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="flex flex-col h-full space-y-3">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-secondary">Member Management</h2>
          <p className="text-xs text-muted-foreground">
            {filtered.length} member{filtered.length !== 1 ? "s" : ""} found
            {filtered.length !== rawMembers.length && ` · ${rawMembers.length} total`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button onClick={openAdd} size="sm" className="gap-1.5 rounded-xl text-xs h-9">
              <Plus className="w-3.5 h-3.5" /> Add Member
            </Button>
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
            placeholder="Search by name or phone…"
            className="pl-9 rounded-xl h-9 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
          onClick={() => setShowFilters((f) => !f)}
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

            {/* Membership Status */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Membership Status</label>
              <div className="flex flex-wrap gap-1">
                {([["all","All"],["active","Active"],["expiring","Expiring Soon"],["expired","Expired"]] as [string,string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setStatusFilter(v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${statusFilter === v ? "bg-primary text-white" : "bg-gray-100 text-muted-foreground hover:bg-gray-200"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Verification Status */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Verification</label>
              <div className="flex flex-wrap gap-1">
                {([["all","All"],["validated","Verified"],["invalidated","Not Verified"],["overdue","Overdue"]] as [string,string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setValidationFilter(v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${validationFilter === v ? "bg-primary text-white" : "bg-gray-100 text-muted-foreground hover:bg-gray-200"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Students */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Students</label>
              <div className="flex flex-wrap gap-1">
                {([["all","All"],["with","With Students"],["without","Without Students"]] as [string,string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setStudentsFilter(v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${studentsFilter === v ? "bg-primary text-white" : "bg-gray-100 text-muted-foreground hover:bg-gray-200"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Fee Status */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Fee Status</label>
              <div className="flex flex-wrap gap-1">
                {([["all","All"],["paid","Paid"],["pending","Pending"],["overdue_fee","Overdue"]] as [string,string][]).map(([v, l]) => (
                  <button key={v} onClick={() => setFeeFilter(v)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${feeFilter === v ? "bg-primary text-white" : "bg-gray-100 text-muted-foreground hover:bg-gray-200"}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Employer */}
            <div className="space-y-1.5 shrink-0">
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Employer</label>
              <div className="relative">
                <Building2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={employerFilter}
                  onChange={(e) => setEmployerFilter(e.target.value)}
                  placeholder="e.g. Ohio State"
                  className="text-xs border border-border rounded-lg pl-7 pr-7 py-1.5 focus:outline-none focus:border-primary bg-white min-w-36"
                />
                {employerFilter && (
                  <button onClick={() => setEmployerFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-secondary">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

          </div>

          {activeFilterCount > 0 && (
            <div className="pt-1 border-t border-border">
              <button
                onClick={() => { setStatusFilter("all"); setValidationFilter("all"); setStudentsFilter("all"); setEmployerFilter(""); setFeeFilter("all"); }}
                className="text-xs text-red-500 hover:text-red-700 font-medium"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col flex-1 min-h-0">
        <div ref={tableRef} className="overflow-auto flex-1 min-h-[320px]">
          <table className="w-full min-w-[1020px] text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-border shadow-sm">
              <tr>
                {[
                  { label: "Member",     key: "name"       as SortKey, w: "w-48"  },
                  { label: "Contact",    noSort: true,                  w: "w-48"  },
                  { label: "Employer",   noSort: true,                  w: "w-32"  },
                  { label: "Status",     noSort: true,                  w: "w-24"  },
                  { label: "Verification", key: "validation" as SortKey, w: "w-32" },
                  { label: "Mem. Fee",   noSort: true,                  w: "w-24"  },
                  { label: "Students",   noSort: true,                  w: "w-16"  },
                  { label: "Registered", key: "createdAt"  as SortKey, w: "w-24"  },
                  { label: "",           noSort: true,                  w: "w-20"  },
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
                    No members found.
                    {canEdit && !search && activeFilterCount === 0 && (
                      <> <button onClick={openAdd} className="text-primary hover:underline ml-1">Add the first member</button></>
                    )}
                  </td>
                </tr>
              )}
              {paginated.map((m) => {
                const rowOverdue = isOverdue(m);
                return (
                  <tr
                    key={m.id}
                    className={`border-b border-border/50 hover:bg-gray-50 transition-colors cursor-pointer ${rowOverdue ? "bg-red-50/40" : ""}`}
                    onClick={() => openDetail(m)}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor(m.id)}`}>
                          {initials(m.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-secondary truncate max-w-[140px]">{m.name ?? "—"}</div>
                          <div className="font-mono text-[10px] text-primary/70 leading-tight">{m.memberCode ?? `#${m.id}`}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="space-y-0.5 min-w-0">
                        {m.email && (
                          <div className="flex items-center gap-1.5 text-muted-foreground truncate max-w-[200px]">
                            <Mail className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                            <span className="truncate">{m.email}</span>
                          </div>
                        )}
                        {m.phone && (
                          <div className="flex items-center gap-1.5 text-muted-foreground whitespace-nowrap">
                            <Phone className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                            {formatUSPhone(m.phone.replace(/\D/g, ""))}
                          </div>
                        )}
                        {!m.email && !m.phone && <span className="text-muted-foreground/40">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {m.employer
                        ? <div className="flex items-center gap-1.5 text-muted-foreground truncate max-w-[140px]">
                            <Building2 className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                            <span className="truncate">{m.employer}</span>
                          </div>
                        : <span className="text-muted-foreground/40">—</span>
                      }
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <StatusBadge isActive={m.isActive} expiringSoon={m.expiringSoon} size="xs" />
                        {m.isActive && m.createdAt && (
                          <span className="text-[10px] text-muted-foreground leading-tight">
                            until {membershipExpiryLabel(m.createdAt, m.membershipYear)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <ValidationBadge member={m} size="xs" />
                        {m.validationStatus === "Validated" && (m.validatedByAdminName || m.validationDate) && (
                          <div className="text-[9px] leading-tight text-muted-foreground/70 pl-0.5">
                            {m.validatedByAdminName && (
                              <span className="truncate block max-w-[110px]">{m.validatedByAdminName}</span>
                            )}
                            {m.validationDate && (
                              <span className="block">{fmtDate(m.validationDate)}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5 min-w-[70px]">
                        <MemFeeBadge status={m.memFeeStatus} size="xs" />
                        {m.memFeeDue > 0 && (
                          <span className="text-xs text-muted-foreground leading-none">
                            ${Number(m.memFeePaid).toFixed(0)}&nbsp;/&nbsp;${Number(m.memFeeDue).toFixed(0)}
                          </span>
                        )}
                        {m.feeUpdatedByAdminName && (
                          <span className="truncate block max-w-[110px] text-[9px] leading-tight text-muted-foreground/70 pl-0.5 mt-0.5">
                            {m.feeUpdatedByAdminName}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`font-semibold px-2 py-0.5 rounded-full ${m.studentCount > 0 ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-muted-foreground"}`}>
                        {m.studentCount}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {fmtDate(m.createdAt)}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 justify-end">
                        {canEdit && (!m.isActive || m.expiringSoon) && (
                          <button onClick={() => setRenewModal(m)} title="Renew membership"
                            className="p-1 rounded hover:bg-emerald-50 text-muted-foreground hover:text-emerald-600 transition-colors">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => setFeeModal(m)} title="Record membership fee"
                            className="p-1 rounded hover:bg-amber-50 text-muted-foreground hover:text-amber-600 transition-colors">
                            <DollarSign className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => openDetail(m)} title="View details"
                          className="p-1 rounded hover:bg-gray-100 text-muted-foreground hover:text-blue-600 transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        {canEdit && m.studentCount === 0 && (
                          <button onClick={() => handleDelete(m)} disabled={deleting === m.id} title="Delete member"
                            className="p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-40">
                            {deleting === m.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
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

        {/* ── Pagination ── */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-3 bg-gray-50 shrink-0 flex-wrap gap-y-2">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
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
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => goToPage(parseInt(pageInput) || 1)}
                onKeyDown={(e) => e.key === "Enter" && goToPage(parseInt(pageInput) || 1)}
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
      {detailLoading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <div className="bg-white rounded-2xl p-8 shadow-xl text-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
            <p className="text-sm text-muted-foreground mt-3">Loading…</p>
          </div>
        </div>
      )}

      {detailMember && !detailLoading && (
        <DetailPanel
          member={detailMember}
          onClose={() => setDetailMember(null)}
          onEdit={() => openEdit(detailMember)}
          onDelete={() => handleDelete(detailMember)}
          onRenew={() => { setDetailMember(null); loadMembers(); }}
          onValidate={() => { setValidateModal(detailMember); setDetailMember(null); }}
          onFeeEdit={() => { setFeeModal(detailMember); setDetailMember(null); }}
          canEdit={canEdit}
        />
      )}

      {modalOpen && (
        <MemberModal
          editing={editingMember}
          onClose={() => { setModalOpen(false); setEditingMember(null); }}
          onSaved={handleSaved}
        />
      )}

      {validateModal && (
        <ValidateMemberModal
          member={validateModal}
          onClose={() => setValidateModal(null)}
          onSaved={handleValidated}
        />
      )}

      {feeModal && (
        <MemFeePaymentModal
          member={feeModal}
          onClose={() => setFeeModal(null)}
          onSaved={() => { setFeeModal(null); loadMembers(); }}
        />
      )}

      {renewModal && (
        <QuickRenewModal
          member={renewModal}
          onClose={() => setRenewModal(null)}
          onSaved={() => { setRenewModal(null); loadMembers(); }}
        />
      )}
    </div>
  );
}

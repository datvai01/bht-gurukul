import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { adminApi } from "@/lib/adminApi";
import { useAuth } from "../AuthContext";
import { canAccess } from "../rbac";
import type { UserRole } from "../rbac";
import {
  BookOpen, Users, GraduationCap, Megaphone, Calendar, Package,
  AlertTriangle, CreditCard, ArrowRight, Inbox, ClipboardCheck,
  CheckCircle2, Bell, Plus, Loader2, X,
  TrendingUp, BarChart2, Trash2, UserCog, MessageSquare, Edit2,
} from "lucide-react";

type Student       = { paymentStatus: string; amountDue: number; amountPaid: number };
type Teacher       = { status: string };
type Announcement  = { isActive: boolean };
type InventoryItem = { id: number; name: string; category: string; currentStock: number; reorderLevel: number };
type AdminEvent    = { id: number; title: string; date: string; time: string };
type AdminCourse   = { id: number; name: string; icon: string; levels: { enrolled: number; capacity: number }[] };
type InboxMessage  = { id: number; isRead: boolean };
type AdminTask     = {
  id: number; title: string; status: string; priority: string;
  dueDate: string | null; reminderDate: string | null;
  assignedToId: number | null; assignedToName: string | null; createdById: number | null;
};
type AdminUser         = { id: number; name: string; role: string; status?: string };
type AttendanceSummary = { date: string; total: number; present: number; pct: number };

type DashboardStats = {
  enrollmentTrend: { month: string; label: string; count: number }[];
  paymentMonthly:  { month: string; label: string; gurukul: number; membership: number }[];
  curriculumYear?: string;
};

const PRIORITY_COLORS: Record<string, string> = {
  Low: "bg-gray-100 text-gray-600", Medium: "bg-blue-100 text-blue-700",
  High: "bg-orange-100 text-orange-700", Urgent: "bg-red-100 text-red-700",
};

const CHART_PRIMARY = "#b91c1c";
const CHART_ACCENT  = "#d97706";

function EnrollmentTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-md px-3 py-2 text-sm">
      <p className="font-semibold text-secondary">{label}</p>
      <p className="text-primary">{payload[0].value} enrollment{payload[0].value !== 1 ? "s" : ""}</p>
    </div>
  );
}

function PaymentMonthlyTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white border border-border rounded-xl shadow-md px-3 py-2.5 text-sm min-w-[170px]">
      <p className="font-semibold text-secondary text-xs mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
          </div>
          <span className="font-semibold text-secondary">${p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
      ))}
      {payload.length > 1 && total > 0 && (
        <div className="flex justify-between text-xs pt-1.5 mt-1 border-t border-border">
          <span className="text-muted-foreground">Total</span>
          <span className="font-bold text-secondary">${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  const [students,      setStudents]      = useState<Student[]>([]);
  const [teachers,      setTeachers]      = useState<Teacher[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [inventory,     setInventory]     = useState<InventoryItem[]>([]);
  const [events,        setEvents]        = useState<AdminEvent[]>([]);
  const [courses,       setCourses]       = useState<AdminCourse[]>([]);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [tasks,         setTasks]         = useState<AdminTask[]>([]);
  const [admins,        setAdmins]        = useState<AdminUser[]>([]);
  const [attSummary,    setAttSummary]    = useState<AttendanceSummary[]>([]);
  const [dashStats,     setDashStats]     = useState<DashboardStats | null>(null);
  const [loading,       setLoading]       = useState(true);

  const [quickAddOpen,       setQuickAddOpen]      = useState(false);
  const [quickAddTitle,      setQuickAddTitle]      = useState("");
  const [quickAddPriority,   setQuickAddPriority]   = useState("Medium");
  const [quickAddDue,        setQuickAddDue]        = useState("");
  const [quickAddAssigneeId, setQuickAddAssigneeId] = useState<string>("self");
  const [quickAdding,        setQuickAdding]        = useState(false);
  const quickAddRef = useRef<HTMLInputElement>(null);

  const [taskFilter,      setTaskFilter]      = useState<"mine" | "others" | "all">("mine");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [reassigningId,   setReassigningId]   = useState<number | null>(null);
  const [reassigning,     setReassigning]     = useState(false);
  const [deleting,        setDeleting]        = useState(false);

  const [editingTask, setEditingTask] = useState<AdminTask | null>(null);
  const [editForm,    setEditForm]    = useState({ title: "", priority: "Medium", status: "todo", dueDate: "", reminderDate: "", assignedToId: "" as string | number });
  const [editSaving,  setEditSaving]  = useState(false);

  useEffect(() => {
    Promise.all([
      adminApi.students.list().then((d) => setStudents(d as Student[])),
      adminApi.teachers.list().then((d) => setTeachers(d as Teacher[])),
      adminApi.announcements.list().then((d) => setAnnouncements(d as Announcement[])),
      adminApi.inventory.list().then((d) => setInventory(d as InventoryItem[])),
      adminApi.events.list().then((d) => setEvents(d as AdminEvent[])),
      adminApi.courses.list().then((d) => setCourses(d as AdminCourse[])),
      adminApi.messaging.inbox().then((d) => setInboxMessages(d as InboxMessage[])).catch(() => {}),
      adminApi.tasks.list().then((d) => setTasks(d as AdminTask[])).catch(() => {}),
      adminApi.adminUsers.list()
        .then((d) => setAdmins(
          (d as AdminUser[]).filter((u) => u.role !== "teacher" && u.role !== "assistant" && u.status !== "inactive")
        )).catch(() => {}),
      adminApi.attendance.summary().then((d) => setAttSummary(d as AttendanceSummary[])).catch(() => {}),
      adminApi.dashboard.stats().then((d) => setDashStats(d)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const today   = new Date().toISOString().slice(0, 10);
  const userId  = user?.id;

  const pendingPayments = students.filter((s) => s.paymentStatus !== "Paid").length;
  const overduePayments = students.filter((s) => s.paymentStatus === "Overdue").length;
  const lowStockItems   = inventory.filter((i) => i.currentStock <= i.reorderLevel).length;
  const unreadMessages  = inboxMessages.filter((m) => !m.isRead).length;
  const activeCourses   = courses.length;
  const totalEnrolled   = courses.reduce((a, c) => a + c.levels.reduce((b, l) => b + l.enrolled, 0), 0);

  const canSeeTasks = user?.isSuperAdmin || canAccess(user?.role as UserRole, "adminTasks");
  const taskAtLimit = tasks.length >= 10;

  const myOpenTasks   = tasks.filter((t) => t.status !== "done" && t.assignedToId === userId);
  const overdueTasks  = myOpenTasks.filter((t) => t.dueDate && t.dueDate < today);
  const dueTodayTasks = myOpenTasks.filter((t) => t.dueDate === today);
  const reminderTasks = tasks.filter((t) => t.status !== "done" && t.reminderDate === today && t.assignedToId === userId);

  const filteredTasks = tasks.filter((t) => {
    if (taskFilter === "mine")   return t.assignedToId === userId;
    if (taskFilter === "others") return t.assignedToId !== userId;
    return true;
  });
  const filteredOpenCount = filteredTasks.filter((t) => t.status !== "done").length;
  const displayedTasks    = [...filteredTasks]
    .sort((a, b) => {
      // Done tasks always float to the bottom
      const aDone = a.status === "done" ? 1 : 0;
      const bDone = b.status === "done" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      // Within non-done tasks, sort by due date ascending
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return 0;
    })
    .slice(0, 8);

  const upcomingEvents = [...events]
    .filter((e) => new Date(e.date) >= new Date())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4);

  const attChartData = attSummary.map((s) => ({
    date: new Date(s.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    "Attendance %": s.pct,
  }));

  const enrollChartData = courses.map((c) => ({
    name:     c.name.length > 14 ? c.name.slice(0, 13) + "…" : c.name,
    Enrolled: c.levels.reduce((a, l) => a + l.enrolled, 0),
    Capacity: c.levels.reduce((a, l) => a + l.capacity, 0),
  }));

  const stats = [
    { label: "Active Courses",       value: activeCourses,                                                icon: BookOpen,      color: "bg-blue-500",   link: "/admin/courses" },
    { label: "Total Enrollments",    value: totalEnrolled,                                                icon: GraduationCap, color: "bg-green-500",  link: "/admin/students" },
    { label: "Active Teachers",      value: teachers.filter((t) => t.status === "Active").length,         icon: Users,         color: "bg-purple-500", link: "/admin/teachers" },
    { label: "Pending Payments",     value: pendingPayments,                                              icon: CreditCard,    color: "bg-orange-500", link: "/admin/students" },
    { label: "Active Announcements", value: announcements.filter((a) => a.isActive).length,              icon: Megaphone,     color: "bg-primary",    link: "/admin/announcements" },
    { label: "Low Stock Alerts",     value: lowStockItems,                                                icon: Package,       color: "bg-red-500",    link: "/admin/inventory" },
  ];

  const quickLinks = [
    { label: "Students & Payments", icon: GraduationCap, href: "/admin/students",  color: "text-green-700 bg-green-50" },
    { label: "Teachers",            icon: Users,         href: "/admin/teachers",  color: "text-purple-700 bg-purple-50" },
    { label: "Inventory",           icon: Package,       href: "/admin/inventory", color: "text-red-700 bg-red-50" },
    { label: "Messaging",           icon: MessageSquare, href: "/admin/messaging", color: "text-blue-700 bg-blue-50" },
  ];

  // ── Chart data ─────────────────────────────────────────────────────────────
  const enrollmentData    = dashStats?.enrollmentTrend ?? [];
  const hasEnrollmentData = enrollmentData.some((d) => d.count > 0);

  const paymentMonthly = dashStats?.paymentMonthly ?? [];
  const hasPaymentData = paymentMonthly.some((p) => p.gurukul > 0 || p.membership > 0);

  async function handleQuickAdd() {
    if (!quickAddTitle.trim() || quickAdding) return;
    setQuickAdding(true);
    try {
      const isSelf   = quickAddAssigneeId === "self";
      const assignId = isSelf ? userId : Number(quickAddAssigneeId);
      const assignee = isSelf
        ? admins.find((a) => a.id === userId) ?? null
        : admins.find((a) => a.id === assignId) ?? null;
      const created = await adminApi.tasks.create({
        title: quickAddTitle.trim(), priority: quickAddPriority, status: "todo",
        dueDate: quickAddDue || null, assignedToId: assignId ?? null, assignedToName: assignee?.name ?? null,
      });
      setTasks((prev) => [created as AdminTask, ...prev]);
      setQuickAddTitle(""); setQuickAddDue(""); setQuickAddPriority("Medium");
      setQuickAddAssigneeId("self"); setQuickAddOpen(false);
    } catch { /* silent */ }
    finally { setQuickAdding(false); }
  }

  async function handleMarkDone(task: AdminTask) {
    try {
      const updated = await adminApi.tasks.setStatus(task.id, task.status === "done" ? "todo" : "done");
      setTasks((prev) => prev.map((t) => t.id === task.id ? updated as AdminTask : t));
    } catch { /* silent */ }
  }

  async function handleDelete(taskId: number) {
    setDeleting(true);
    try {
      await adminApi.tasks.remove(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      setDeleteConfirmId(null);
    } catch { /* silent */ }
    finally { setDeleting(false); }
  }

  function handleOpenEdit(task: AdminTask) {
    setEditingTask(task);
    setEditForm({
      title:        task.title,
      priority:     task.priority,
      status:       task.status,
      dueDate:      task.dueDate ?? "",
      reminderDate: task.reminderDate ?? "",
      assignedToId: task.assignedToId !== null ? task.assignedToId : "",
    });
  }

  async function handleSaveEdit() {
    if (!editingTask || !editForm.title.trim() || editSaving) return;
    setEditSaving(true);
    try {
      const assignId  = editForm.assignedToId !== "" ? Number(editForm.assignedToId) : null;
      const assignee  = assignId ? admins.find((a) => a.id === assignId) ?? null : null;
      const updated   = await adminApi.tasks.update(editingTask.id, {
        title:          editForm.title.trim(),
        priority:       editForm.priority,
        status:         editForm.status,
        dueDate:        editForm.dueDate  || null,
        reminderDate:   editForm.reminderDate || null,
        assignedToId:   assignId,
        assignedToName: assignee?.name ?? null,
      });
      setTasks((prev) => prev.map((t) => t.id === editingTask.id ? updated as AdminTask : t));
      setEditingTask(null);
    } catch { /* silent */ }
    finally { setEditSaving(false); }
  }

  async function handleReassign(task: AdminTask, newAssigneeId: string) {
    setReassigning(true);
    try {
      const assignId = newAssigneeId === "unassigned" ? null : Number(newAssigneeId);
      const assignee = assignId ? admins.find((a) => a.id === assignId) ?? null : null;
      const updated  = await adminApi.tasks.update(task.id, {
        title: task.title, priority: task.priority, status: task.status, dueDate: task.dueDate,
        assignedToId: assignId, assignedToName: assignee?.name ?? null,
      });
      setTasks((prev) => prev.map((t) => t.id === task.id ? updated as AdminTask : t));
      setReassigningId(null);
    } catch { /* silent */ }
    finally { setReassigning(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground text-sm">Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-2xl font-bold text-secondary">Welcome back, Admin</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Here's what's happening at Gurukul today —{" "}
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* ── Alert banners ───────────────────────────────────────────────────── */}
      {unreadMessages > 0 && (
        <Link href="/admin/messaging">
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center justify-between gap-3 cursor-pointer hover:bg-blue-100 transition-colors">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <Inbox className="w-5 h-5 text-blue-600" />
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none">
                  {unreadMessages > 9 ? "9+" : unreadMessages}
                </span>
              </div>
              <div className="text-sm text-blue-800">
                <span className="font-semibold">New Message{unreadMessages > 1 ? "s" : ""}: </span>
                You have {unreadMessages} unread message{unreadMessages > 1 ? "s" : ""} in your inbox.
              </div>
            </div>
            <div className="flex items-center gap-1 text-blue-600 text-xs font-semibold shrink-0">
              View Inbox <ArrowRight className="w-3 h-3" />
            </div>
          </div>
        </Link>
      )}

      {(overduePayments > 0 || lowStockItems > 0) && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
          <div className="text-sm text-orange-800">
            <span className="font-semibold">Action Required: </span>
            {overduePayments > 0 && `${overduePayments} student(s) have overdue payments. `}
            {lowStockItems > 0 && `${lowStockItems} inventory item(s) are at or below reorder level.`}
          </div>
        </div>
      )}

      {/* ── Compact stat strip ──────────────────────────────────────────────── */}
      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div className="flex gap-3 min-w-max">
          {stats.map((stat) => (
            <Link
              key={stat.label}
              href={stat.link}
              className="flex items-center gap-3 bg-white border border-border rounded-2xl px-4 py-3 shadow-sm hover:shadow-md transition-all group shrink-0"
            >
              <div className={`${stat.color} w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0`}>
                <stat.icon className="w-4 h-4" />
              </div>
              <div>
                <div className="text-2xl font-bold text-secondary leading-none">{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-0.5 whitespace-nowrap">{stat.label}</div>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all ml-1" />
            </Link>
          ))}
        </div>
      </div>

      {/* ── Task reminder banner ────────────────────────────────────────────── */}
      {reminderTasks.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3">
          <Bell className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              Reminder{reminderTasks.length > 1 ? "s" : ""} for today:
            </p>
            <ul className="mt-1 space-y-0.5">
              {reminderTasks.map((t) => (
                <li key={t.id} className="text-sm text-amber-700 truncate">· {t.title}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Admin Tasks widget ──────────────────────────────────────────────── */}
      {canSeeTasks && (
        <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-primary/10 rounded-xl flex items-center justify-center">
                <ClipboardCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-secondary leading-tight">Admin Tasks</h3>
                  {filteredOpenCount > 0 && (
                    <span className="text-[11px] font-bold bg-primary text-white rounded-full px-1.5 py-0.5 leading-none">
                      {filteredOpenCount}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {filteredOpenCount} open
                  {taskFilter === "mine" && overdueTasks.length > 0 && (
                    <span className="text-red-600 font-semibold"> · {overdueTasks.length} overdue</span>
                  )}
                  {taskFilter === "mine" && dueTodayTasks.length > 0 && (
                    <span className="text-orange-600 font-semibold"> · {dueTodayTasks.length} due today</span>
                  )}
                </p>
              </div>
            </div>
          </div>


          {/* Filter tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
            {([["mine", "My Tasks"], ["others", "Assigned to Others"], ["all", "All Tasks"]] as const).map(([f, label]) => (
              <button
                key={f}
                onClick={() => setTaskFilter(f)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${taskFilter === f ? "bg-white text-secondary shadow-sm" : "text-muted-foreground hover:text-secondary"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Quick-add */}
          {taskAtLimit && !quickAddOpen && (
            <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Task limit reached (10/10). Delete a task to add a new one.
            </div>
          )}
          {!quickAddOpen ? (
            <button
              onClick={() => { if (!taskAtLimit) { setQuickAddOpen(true); setTimeout(() => quickAddRef.current?.focus(), 50); } }}
              disabled={taskAtLimit}
              className="w-full flex items-center gap-2 text-sm text-muted-foreground border border-dashed border-border rounded-xl px-3 py-2.5 hover:border-primary hover:text-primary transition-colors mb-4 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground"
            >
              <Plus className="w-4 h-4 shrink-0" /> Add Task
            </button>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); handleQuickAdd(); }}
              className="space-y-2 mb-4 bg-primary/5 border border-primary/20 rounded-xl p-3"
            >
              <div className="flex gap-2">
                <input
                  ref={quickAddRef}
                  type="text"
                  placeholder="Task title…"
                  value={quickAddTitle}
                  maxLength={500}
                  onChange={(e) => setQuickAddTitle(e.target.value.slice(0, 500))}
                  className="flex-1 border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  type="submit"
                  disabled={!quickAddTitle.trim() || quickAdding}
                  className="w-9 h-9 rounded-xl bg-primary text-white flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {quickAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => { setQuickAddOpen(false); setQuickAddTitle(""); }}
                  className="w-9 h-9 rounded-xl border border-border bg-white text-muted-foreground flex items-center justify-center shrink-0 hover:bg-gray-50 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={quickAddPriority}
                  onChange={(e) => setQuickAddPriority(e.target.value)}
                  className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-secondary focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {["Low", "Medium", "High", "Urgent"].map((p) => <option key={p}>{p}</option>)}
                </select>
                <input
                  type="date" value={quickAddDue} min={today}
                  onChange={(e) => setQuickAddDue(e.target.value)}
                  className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-secondary focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <select
                  value={quickAddAssigneeId}
                  onChange={(e) => setQuickAddAssigneeId(e.target.value)}
                  className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-secondary focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="self">Assign to Myself</option>
                  {admins.filter((a) => a.id !== userId).map((a) => (
                    <option key={a.id} value={String(a.id)}>{a.name}</option>
                  ))}
                </select>
              </div>
            </form>
          )}

          {/* Task list */}
          {displayedTasks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              {taskFilter === "mine"
                ? "No open tasks assigned to you."
                : taskFilter === "others"
                ? "No tasks assigned to others."
                : "No open tasks."}
            </p>
          )}
          <div className="space-y-2">
            {displayedTasks.map((task) => {
              const isOver        = task.dueDate && task.dueDate < today;
              const isToday       = task.dueDate === today;
              const isDone        = task.status === "done";
              const canEdit       = user?.isSuperAdmin || task.createdById === userId;
              const isDelConf     = deleteConfirmId === task.id;
              const isReassigning = reassigningId === task.id;
              return (
                <div
                  key={task.id}
                  className={`rounded-xl transition-colors ${isOver ? "bg-red-50" : isToday ? "bg-orange-50" : "bg-gray-50"}`}
                >
                  <div className="flex items-center gap-3 p-3">
                    <button
                      onClick={() => handleMarkDone(task)}
                      title={isDone ? "Mark as to-do" : "Mark as done"}
                      className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isDone ? "bg-green-500 border-green-500 text-white" : "border-gray-300 hover:border-green-400"}`}
                    >
                      {isDone && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium truncate ${isDone ? "line-through text-muted-foreground" : "text-secondary"}`}>
                          {task.title}
                        </span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${PRIORITY_COLORS[task.priority] ?? ""}`}>
                          {task.priority}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {task.dueDate && (
                          <span className={`text-xs ${isOver ? "text-red-600 font-semibold" : isToday ? "text-orange-600 font-semibold" : "text-muted-foreground"}`}>
                            {isOver ? "Overdue · " : isToday ? "Due today · " : "Due "}
                            {new Date(task.dueDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                        {canEdit && !isReassigning ? (
                          <button
                            onClick={() => setReassigningId(task.id)}
                            title="Reassign task"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-white border border-border rounded-full px-2 py-0.5 hover:border-primary hover:text-primary transition-colors"
                          >
                            <UserCog className="w-3 h-3" />
                            {task.assignedToName ?? "Unassigned"}
                          </button>
                        ) : !isReassigning && task.assignedToName ? (
                          <span className="text-xs text-muted-foreground">{task.assignedToName}</span>
                        ) : null}
                        {isReassigning && (
                          <div className="flex items-center gap-1">
                            <select
                              autoFocus
                              defaultValue={task.assignedToId !== null ? String(task.assignedToId) : "unassigned"}
                              onChange={(e) => handleReassign(task, e.target.value)}
                              disabled={reassigning}
                              className="text-xs border border-primary rounded-lg px-2 py-0.5 bg-white focus:outline-none"
                            >
                              <option value="unassigned">Unassigned</option>
                              {admins.map((a) => (
                                <option key={a.id} value={String(a.id)}>
                                  {a.name}{a.id === userId ? " (me)" : ""}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => setReassigningId(null)}
                              className="text-muted-foreground hover:text-secondary"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {canEdit && !isDelConf && (
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => handleOpenEdit(task)}
                          title="Edit task"
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-blue-50 hover:text-blue-600 transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(task.id)}
                          title="Delete task"
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-red-100 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {isDelConf && (
                    <div className="flex items-center gap-2 px-3 pb-3 pt-0">
                      <span className="text-xs text-red-600 flex-1">Delete this task?</span>
                      <button
                        onClick={() => handleDelete(task.id)}
                        disabled={deleting}
                        className="text-xs bg-red-600 text-white px-2.5 py-1 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                      >
                        {deleting ? "Deleting…" : "Delete"}
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-xs text-muted-foreground px-2.5 py-1 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Enrollment Trend + Payment Breakdown ────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-green-50 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <h3 className="font-bold text-secondary leading-tight">Enrollment Trend</h3>
                <p className="text-xs text-muted-foreground">
                  New enrollments per month{dashStats?.curriculumYear ? ` — ${dashStats.curriculumYear}` : " — last 12 months"}
                </p>
              </div>
            </div>
            <Link href="/admin/students" className="text-primary text-xs font-medium flex items-center gap-1 hover:gap-2 transition-all">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {hasEnrollmentData ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={enrollmentData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip content={<EnrollmentTooltip />} />
                <Line type="monotone" dataKey="count" stroke="#7c3aed" strokeWidth={2.5}
                  dot={{ fill: "#7c3aed", r: 3, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No enrollment data for the last 12 months</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-orange-50 rounded-xl flex items-center justify-center">
                <BarChart2 className="w-4 h-4 text-orange-500" />
              </div>
              <div>
                <h3 className="font-bold text-secondary leading-tight">Payments by Month</h3>
                <p className="text-xs text-muted-foreground">Collected fees — last 12 months</p>
              </div>
            </div>
            <Link href="/admin/students" className="text-primary text-xs font-medium flex items-center gap-1 hover:gap-2 transition-all">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {hasPaymentData ? (
            <>
              <ResponsiveContainer width="100%" height={178}>
                <BarChart data={paymentMonthly} margin={{ top: 4, right: 4, left: -22, bottom: 28 }} barCategoryGap="20%" barGap={1}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false}
                    angle={-40} textAnchor="end" dy={5} dx={-2} />
                  <YAxis tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                    tick={{ fontSize: 9, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip content={<PaymentMonthlyTooltip />} />
                  <Bar dataKey="gurukul"    name="Gurukul Fees"    fill={CHART_PRIMARY} radius={[2, 2, 0, 0]} maxBarSize={10} />
                  <Bar dataKey="membership" name="Temple Membership" fill={CHART_ACCENT}  radius={[2, 2, 0, 0]} maxBarSize={10} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-4 mt-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CHART_PRIMARY }} />
                  <span>Gurukul Fees</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: CHART_ACCENT }} />
                  <span>Membership</span>
                </div>
              </div>
            </>
          ) : (
            <div className="h-[178px] flex items-center justify-center">
              <p className="text-sm text-muted-foreground">No payment data yet</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Attendance Trend by date + Upcoming Events ──────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6">

        {/* Attendance Trend — 2 cols */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-secondary">Attendance Trend</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Last 8 recorded session dates across all classes</p>
            </div>
            <Link href="/admin/attendance" className="text-primary text-xs font-medium flex items-center gap-1 hover:gap-2 transition-all">
              Attendance <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {attChartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
                <Users className="w-6 h-6 text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-secondary">No attendance data yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">Record attendance sessions to see the trend here.</p>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={attChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value: number) => [`${value}%`, "Attendance"]}
                  contentStyle={{ borderRadius: "12px", border: "1px solid #e5e7eb", fontSize: "12px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)" }}
                />
                <Bar dataKey="Attendance %" fill={CHART_PRIMARY} radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Upcoming Events — 1 col */}
        <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-secondary">Upcoming Events</h3>
            <Link href="/admin/calendar" className="text-primary text-xs font-medium flex items-center gap-1 hover:gap-2 transition-all">
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-2">
            {upcomingEvents.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No upcoming events</p>
            )}
            {upcomingEvents.map((event) => (
              <div key={event.id} className="flex gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center text-primary shrink-0">
                  <Calendar className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-secondary truncate">{event.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {event.time}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Enrollment vs Capacity + Quick Links ────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-6">

        {/* Enrollment vs Capacity chart — 2 cols */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-border shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-secondary">Enrollment vs Capacity</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Enrolled students compared to total capacity per course</p>
            </div>
            <Link href="/admin/courses" className="text-primary text-xs font-medium flex items-center gap-1 hover:gap-2 transition-all">
              Manage <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {enrollChartData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 gap-2 text-center">
              <p className="text-sm text-muted-foreground">No courses configured yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={enrollChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: "12px", border: "1px solid #e5e7eb", fontSize: "12px", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)" }}
                />
                <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                <Bar dataKey="Enrolled" fill={CHART_PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={36} />
                <Bar dataKey="Capacity" fill={CHART_ACCENT}  radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Quick Links — 1 col */}
        <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
          <h3 className="font-bold text-secondary mb-4">Quick Links</h3>
          <div className="space-y-1.5">
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${link.color}`}>
                  <link.icon className="w-4 h-4" />
                </div>
                <span className="text-sm font-medium text-secondary flex-1">{link.label}</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
              </Link>
            ))}
          </div>
        </div>

      </div>

      {/* ── Task Edit Drawer ─────────────────────────────────────────────────── */}
      {editingTask && (
        <>
          <div
            className="fixed inset-0 z-[59] bg-black/30 backdrop-blur-[1px]"
            onClick={() => !editSaving && setEditingTask(null)}
          />
          <div className="fixed inset-y-0 right-0 z-[60] w-full sm:w-[480px] bg-white shadow-2xl flex flex-col">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-gradient-to-r from-primary/5 to-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-secondary text-sm">Edit Task</h2>
                  <p className="text-xs text-muted-foreground truncate max-w-[260px]">{editingTask.title}</p>
                </div>
              </div>
              <button
                onClick={() => !editSaving && setEditingTask(null)}
                className="w-8 h-8 rounded-xl hover:bg-gray-100 flex items-center justify-center text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Title */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-secondary">Task Title *</label>
                  <span className={`text-xs tabular-nums ${editForm.title.length > 480 ? "text-orange-600 font-medium" : "text-muted-foreground"}`}>
                    {editForm.title.length}/500
                  </span>
                </div>
                <input
                  type="text"
                  autoFocus
                  value={editForm.title}
                  maxLength={500}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value.slice(0, 500) }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Priority + Status */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary">Priority</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value }))}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {["Low", "Medium", "High", "Urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary">Status</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
              </div>

              {/* Assignee */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-secondary">Assign To</label>
                <select
                  value={editForm.assignedToId}
                  onChange={(e) => setEditForm((f) => ({ ...f, assignedToId: e.target.value === "" ? "" : Number(e.target.value) }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— Unassigned —</option>
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.id === userId ? " (me)" : ""}</option>
                  ))}
                </select>
              </div>

              {/* Due date + Reminder */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary">Due Date</label>
                  <input
                    type="date"
                    value={editForm.dueDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary">Reminder Date</label>
                  <input
                    type="date"
                    value={editForm.reminderDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, reminderDate: e.target.value }))}
                    className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
            </div>

            {/* Drawer footer */}
            <div className="p-6 border-t border-border shrink-0 flex justify-end gap-3">
              <button
                onClick={() => !editSaving && setEditingTask(null)}
                disabled={editSaving}
                className="px-4 py-2 rounded-xl border border-border text-sm font-medium text-secondary hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editForm.title.trim() || editSaving}
                className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {editSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Save Changes
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import { useLocation, Link } from "wouter";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { canAccess, getRoleLabel, getRoleBadgeColor, type Permission } from "./rbac";
import {
  LayoutDashboard, Megaphone, Calendar, BookOpen, Users, GraduationCap,
  Package, Settings, LogOut, Menu, X, ChevronRight, FileText, ClipboardList,
  ShieldCheck, UserPlus, Layers, Newspaper, HelpCircle, StickyNote, Shield,
  KeyRound,
} from "lucide-react";
import NaradJiBot from "./components/NaradJiBot";
import NotesTab from "./components/NotesTab";
import Help from "./pages/Help";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Permission_ = Permission;

type NavItem = {
  label: string;
  icon: React.ElementType;
  path: string;
  permission: Permission_;
};

// One flat list; role permissions still control which pages are visible.
const ADMIN_NAV_ITEMS: NavItem[] = [
  { label: "Dashboard",            icon: LayoutDashboard, path: "/admin/dashboard",         permission: "dashboard" },
  { label: "Student Registration", icon: UserPlus,        path: "/admin/register",          permission: "registration" },
  { label: "Student Management",   icon: Users,           path: "/admin/students",          permission: "students" },
  { label: "Member Management",    icon: BookOpen,        path: "/admin/members",           permission: "members" },
  { label: "Course Management",    icon: Layers,          path: "/admin/course-management", permission: "courseManagement" },
  { label: "Staff Management",     icon: GraduationCap,   path: "/admin/teachers",          permission: "teachers" },
  { label: "Attendance",           icon: ClipboardList,   path: "/admin/attendance",        permission: "attendance" },
  { label: "Messaging Center",     icon: Newspaper,       path: "/admin/weekly-updates",    permission: "weeklyUpdates" },
  { label: "Course Documents",     icon: FileText,        path: "/admin/documents",         permission: "documents" },
  { label: "Communication Hub",    icon: Megaphone,       path: "/admin/messaging",         permission: "messaging" },
  { label: "Calendar",             icon: Calendar,        path: "/admin/calendar",          permission: "calendar" },
  { label: "Inventory",            icon: Package,         path: "/admin/inventory",         permission: "inventory" },
  { label: "User Management",      icon: ShieldCheck,     path: "/admin/roles",             permission: "roles" },
  { label: "Audit Log",            icon: Shield,          path: "/admin/audit",             permission: "audit" },
  { label: "Settings",             icon: Settings,        path: "/admin/settings",          permission: "settings" },
];

// ── Teacher flat nav ──────────────────────────────────────────────────────────

const TEACHER_NAV_ITEMS: NavItem[] = [
  { label: "Attendance",         icon: ClipboardList, path: "/admin/attendance",     permission: "attendance" },
  { label: "Courses & Classes",  icon: BookOpen,      path: "/admin/courses",        permission: "courses" },
  { label: "Course Documents",   icon: FileText,      path: "/admin/documents",      permission: "documents" },
  { label: "Messaging Center",   icon: Newspaper,     path: "/admin/weekly-updates", permission: "weeklyUpdates" },
  { label: "Settings",           icon: Settings,      path: "/admin/settings",       permission: "settings" },
];

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notesOpen,   setNotesOpen]   = useState(false);
  const [helpOpen,    setHelpOpen]    = useState(false);
  const { user, logout } = useAuth();

  useEffect(() => {
    if (!user) setLocation("/admin/login");
  }, [location, user]);

  async function handleLogout() {
    try {
      await logout();
      window.location.href = "/admin/login";
    } catch {
      toast.error("Could not sign out. Please try again.");
    }
  }

  const isAdmin =
    user?.role === "admin" ||
    user?.role === "course_coordinator" ||
    user?.role === "operations_manager";

  // For the header "current page" label — search both sources
  const allItems = [
    ...ADMIN_NAV_ITEMS,
    ...TEACHER_NAV_ITEMS,
  ];
  const currentPage = allItems.find(n => n.path === location)?.label ?? "Admin";

  function NavLink({ item }: { item: NavItem }) {
    const active = location === item.path;
    return (
      <Link
        href={item.path}
        onClick={() => setSidebarOpen(false)}
        className={`
          flex items-center gap-3 px-3 py-1.5 rounded-lg transition-all text-sm font-medium
          ${active
            ? "bg-primary/20 text-accent border border-primary/30"
            : "text-white/70 hover:bg-white/10 hover:text-white"
          }
        `}
      >
        <item.icon className="w-4 h-4 shrink-0" />
        {item.label}
        {active && <ChevronRight className="w-3 h-3 ml-auto" />}
      </Link>
    );
  }

  const Sidebar = () => (
    <aside className={`
      fixed inset-y-0 left-0 z-50 w-64 bg-secondary flex flex-col transform transition-transform duration-300
      ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      lg:relative lg:translate-x-0 lg:flex
    `}>
      {/* Logo */}
      <div className="px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-primary to-accent rounded-xl flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm leading-tight">Gurukul Portal</div>
            <div className="text-white/50 text-xs">BHT Powell, OH</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-2 px-3" aria-label="Admin pages">
        <div className="space-y-0.5">
          {(isAdmin ? ADMIN_NAV_ITEMS : TEACHER_NAV_ITEMS)
            .filter(item => user && canAccess(user.role, item.permission))
            .map(item => <NavLink key={item.path} item={item} />)}
        </div>
      </nav>

      {/* User footer */}
      <div className="p-3 border-t border-white/10">
        {user && (
          <div className="flex items-center gap-2.5 px-3 py-1.5 mb-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white text-xs font-bold shrink-0">
              {user.initials}
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-semibold truncate">{user.displayName}</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${getRoleBadgeColor(user.role)}`}>
                {getRoleLabel(user.role)}
              </span>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-1.5 rounded-lg w-full text-white/70 hover:bg-red-500/20 hover:text-red-300 transition-all text-sm font-medium"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-white border-b border-border px-4 lg:px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <div>
              <h1 className="text-lg font-bold text-secondary">{currentPage}</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">Bhartiya Hindu Temple Gurukul</p>
            </div>
          </div>

          {user && (
            <div className="flex items-center gap-2.5">

              {/* ── Quick-action buttons ── */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-2xl p-1">
                {/* Help & Guide */}
                <button
                  onClick={() => { setHelpOpen(v => !v); setNotesOpen(false); }}
                  title="Help & Guide"
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all ${
                    helpOpen
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-muted-foreground hover:text-secondary hover:bg-white hover:shadow-sm"
                  }`}
                >
                  <HelpCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Help</span>
                </button>

                {/* My Sticky Notes */}
                <button
                  onClick={() => { setNotesOpen(v => !v); setHelpOpen(false); }}
                  title="My Sticky Notes"
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all ${
                    notesOpen
                      ? "bg-amber-500 text-white shadow-sm"
                      : "text-muted-foreground hover:text-secondary hover:bg-white hover:shadow-sm"
                  }`}
                >
                  <StickyNote className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden sm:inline">Notes</span>
                </button>
              </div>

              {/* divider */}
              <div className="h-6 w-px bg-border hidden sm:block" />

              {/* User info */}
              <div className="text-right hidden sm:block">
                <div className="text-sm font-semibold text-secondary leading-tight">{user.displayName}</div>
                <div className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRoleBadgeColor(user.role)}`}>
                  {getRoleLabel(user.role)}
                </div>
              </div>
              <div className="w-9 h-9 bg-gradient-to-br from-primary to-accent rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0">
                {user.initials}
              </div>
            </div>
          )}
        </header>

        {/* ── PIN Change Reminder Banner ── */}
        {user && user.pinChanged === false && (
          <div className="shrink-0 bg-amber-50 border-b border-amber-200 px-4 lg:px-6 py-2.5 flex items-center gap-3">
            <div className="w-7 h-7 bg-amber-100 border border-amber-300 rounded-lg flex items-center justify-center shrink-0">
              <KeyRound className="w-3.5 h-3.5 text-amber-700" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800 leading-tight">
                Please change your system-generated {user.isSuperAdmin ? "password" : "PIN"} immediately
              </p>
              <p className="text-xs text-amber-700 mt-0.5 leading-tight hidden sm:block">
                Your account was created with a temporary {user.isSuperAdmin ? "password" : "4-digit PIN"}.
                Go to <strong>Settings → Account</strong> to set a secure one you remember.
              </p>
            </div>
            <Link href="/admin/settings?tab=account">
              <button
                className="shrink-0 flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Change {user.isSuperAdmin ? "Password" : "PIN"}</span>
              </button>
            </Link>
          </div>
        )}

        <main className={`flex-1 min-h-0 overflow-y-auto ${location === "/admin/students" || location === "/admin/members" ? "p-3 lg:p-4" : "p-4 lg:p-6"}`}>
          {children}
        </main>
      </div>

      <NaradJiBot />

      {/* ── shared backdrop ── */}
      {(notesOpen || helpOpen) && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
          onClick={() => { setNotesOpen(false); setHelpOpen(false); }}
        />
      )}

      {/* ── Help & Guide drawer ── */}
      <div className={`
        fixed inset-y-0 right-0 z-50 w-full sm:w-[680px] bg-white shadow-2xl flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${helpOpen ? "translate-x-0" : "translate-x-full"}
      `}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0 bg-gradient-to-r from-indigo-50 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-secondary text-sm">Help & Guide</h2>
              <p className="text-xs text-muted-foreground">Portal features, how-tos, and tips</p>
            </div>
          </div>
          <button
            onClick={() => setHelpOpen(false)}
            className="w-8 h-8 rounded-xl hover:bg-indigo-100 flex items-center justify-center text-muted-foreground hover:text-indigo-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <Help />
        </div>
      </div>

      {/* ── Sticky Notes drawer ── */}
      <div className={`
        fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] bg-white shadow-2xl flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${notesOpen ? "translate-x-0" : "translate-x-full"}
      `}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0 bg-gradient-to-r from-amber-50 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
              <StickyNote className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-secondary text-sm">My Sticky Notes</h2>
              <p className="text-xs text-muted-foreground">Private — only visible to you</p>
            </div>
          </div>
          <button
            onClick={() => setNotesOpen(false)}
            className="w-8 h-8 rounded-xl hover:bg-amber-100 flex items-center justify-center text-muted-foreground hover:text-amber-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <NotesTab />
        </div>
      </div>
    </div>
  );
}

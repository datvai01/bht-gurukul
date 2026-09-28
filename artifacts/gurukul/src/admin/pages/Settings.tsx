import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Check, Lock, Bell, Globe, School, CalendarDays,
  Loader2, AlertCircle, CreditCard, Eye, EyeOff,
  Home, Info, Phone, Shield, PlusCircle, Settings2,
} from "lucide-react";
import { RegistrationQRCard } from "@/admin/components/RegistrationQRCard";
import { usePortalSettings, longToShort, shortToLong } from "../contexts/PortalSettingsContext";
import { useAuth } from "../AuthContext";
import { changeAdminPin, changePin } from "../auth";
import { adminApi } from "@/lib/adminApi";
import { invalidateSiteContentCache } from "@/hooks/useSiteContent";

type AdminTab = "academic" | "account" | "payments" | "website" | "system";

const ADMIN_TABS: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
  { id: "academic",  label: "Academic",  icon: <CalendarDays className="w-4 h-4" /> },
  { id: "account",   label: "Account",   icon: <Lock className="w-4 h-4" /> },
  { id: "payments",  label: "Payments",  icon: <CreditCard className="w-4 h-4" /> },
  { id: "website",   label: "Website",   icon: <Globe className="w-4 h-4" /> },
  { id: "system",    label: "System",    icon: <Settings2 className="w-4 h-4" /> },
];

// Remap legacy ?tab= param values to new IDs so existing bookmarks still work
const LEGACY_TAB_MAP: Record<string, AdminTab> = {
  general:       "academic",
  content:       "website",
  organization:  "system",
  notifications: "system",
  audit:         "system",
};

export default function Settings() {
  const [saved, setSaved] = useState<string | null>(null);
  const { user, markPinChanged } = useAuth();
  const isAdmin = user?.role === "admin";

  const search = useSearch();
  const tabParam = new URLSearchParams(search).get("tab");
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    if (!tabParam) return "academic";
    if (ADMIN_TABS.some(t => t.id === tabParam)) return tabParam as AdminTab;
    return LEGACY_TAB_MAP[tabParam] ?? "academic";
  });

  const {
    activeCurriculumYear,
    setActiveYearLocally,
    loading: settingsLoading,
  } = usePortalSettings();

  // ── Active Curriculum Year list ──────────────────────────────────────────────
  const [activeYearsList,   setActiveYearsList]   = useState<string[]>(["2026-2027", "2027-2028"]);
  const [pendingYear,       setPendingYear]        = useState<string | null>(null);
  const [yearSaving,        setYearSaving]         = useState(false);
  const [yearError,         setYearError]          = useState<string | null>(null);
  const [addingActiveYear,  setAddingActiveYear]   = useState(false);
  const [nextYearDialog,    setNextYearDialog]     = useState<{ kind: "active" | "registration" } | null>(null);

  // ── Registration Window + list ────────────────────────────────────────────────
  const [regYearsList,  setRegYearsList]  = useState<string[]>(["2026-2027", "2027-2028"]);
  const [regCurrYear,   setRegCurrYear]   = useState("2027-2028");
  const [regOpenDate,   setRegOpenDate]   = useState("");
  const [regCloseDate,  setRegCloseDate]  = useState("");
  const [sessionStartDate, setSessionStartDate] = useState("");
  const [sessionEndDate,   setSessionEndDate]   = useState("");
  const [regWinSaving,  setRegWinSaving]  = useState(false);
  const [regWinSaved,   setRegWinSaved]   = useState(false);
  const [regWinError,   setRegWinError]   = useState<string | null>(null);
  const [addingRegYear, setAddingRegYear] = useState(false);

  const [currentPin, setCurrentPin] = useState("");
  const [newPin,     setNewPin]     = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinSaving,  setPinSaving]  = useState(false);
  const [pinError,   setPinError]   = useState<string | null>(null);
  const [pinSaved,   setPinSaved]   = useState(false);

  // ── Change Password (super admin) ──
  const [newPassword,    setNewPassword]    = useState("");
  const [confirmPassword,setConfirmPassword]= useState("");
  const [overridePin,    setOverridePin]    = useState("");
  const [showNewPw,      setShowNewPw]      = useState(false);
  const [showOverridePw, setShowOverridePw] = useState(false);
  const [pwSaving,       setPwSaving]       = useState(false);
  const [pwSaved,        setPwSaved]        = useState(false);
  const [pwError,        setPwError]        = useState<string | null>(null);

  async function savePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (newPassword.length < 8)             { setPwError("New password must be at least 8 characters."); return; }
    if (newPassword !== confirmPassword)    { setPwError("Passwords do not match."); return; }
    if (!overridePin.trim())                { setPwError("Security PIN is required."); return; }
    setPwSaving(true);
    try {
      await adminApi.adminUsers.changeSuperAdminPassword(overridePin.trim(), newPassword);
      markPinChanged();
      setPwSaved(true);
      setNewPassword(""); setConfirmPassword(""); setOverridePin("");
      setTimeout(() => setPwSaved(false), 3000);
    } catch (err: any) {
      setPwError(err?.message ?? "Failed to change password. Check your security PIN.");
    } finally {
      setPwSaving(false);
    }
  }

  const [auditRetentionDays,  setAuditRetentionDays]  = useState("7");
  const [auditRetSaving,      setAuditRetSaving]      = useState(false);
  const [auditRetSaved,       setAuditRetSaved]       = useState(false);
  const [auditRetError,       setAuditRetError]       = useState<string | null>(null);

  const [stripePubKey,    setStripePubKey]    = useState("");
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeSecretConfigured, setStripeSecretConfigured] = useState(false);
  const [stripeMemberFee, setStripeMemberFee] = useState("150");
  const [stripeCourseFee, setStripeCourseFee] = useState("35");
  const [showSecret,      setShowSecret]      = useState(false);
  const [stripeLoading,   setStripeLoading]   = useState(false);
  const [stripeSaving,    setStripeSaving]    = useState(false);
  const [stripeSaved,     setStripeSaved]     = useState(false);
  const [stripeError,     setStripeError]     = useState<string | null>(null);

  // ── Site Content state ──────────────────────────────────────────────────────
  const [scHomeHeadline,    setScHomeHeadline]    = useState("Rooted in Tradition, Growing in Wisdom.");
  const [scHomeSubtitle,    setScHomeSubtitle]    = useState("Empowering the next generation with cultural knowledge, spiritual values, and a profound understanding of Sanatana Dharma.");
  const [scCtaTitle,        setScCtaTitle]        = useState("Ready to join the Gurukul family?");
  const [scCtaSubtitle,     setScCtaSubtitle]     = useState("Enroll today and give your child the gift of cultural heritage.");
  const [scAboutHeader,     setScAboutHeader]     = useState("Preserving and passing on the rich heritage of Sanatana Dharma to the next generation.");
  const [scAboutMission1,   setScAboutMission1]   = useState("The Bhartiya Hindu Temple Gurukul is dedicated to providing a nurturing environment where children can learn, appreciate, and practice the values, culture, and traditions of Sanatana Dharma.");
  const [scAboutMission2,   setScAboutMission2]   = useState("We believe that early exposure to our spiritual heritage builds character, instills confidence, and creates a strong foundation for a meaningful life.");
  const [scAboutValues,     setScAboutValues]     = useState("Dharma (Righteousness & Duty)\nVidya (True Knowledge)\nSeva (Selfless Service)\nBhakti (Devotion)");
  const [scContactHeader,   setScContactHeader]   = useState("We are here to answer your questions and welcome you to our community.");
  const [scContactAddress,  setScContactAddress]  = useState("3671 Hyatts Rd\nPowell, OH 43065");
  const [scContactPhone,    setScContactPhone]    = useState("(740) 369-0717");
  const [scContactEmail,    setScContactEmail]    = useState("gurukul@bhtohio.org");
  const [scFooterTagline,   setScFooterTagline]   = useState("Nurturing the next generation with the profound wisdom, culture, and values of Sanatana Dharma in a welcoming community environment.");
  const [scFacebook,        setScFacebook]        = useState("");
  const [scInstagram,       setScInstagram]       = useState("");
  const [scLoading,         setScLoading]         = useState(false);
  const [scSaving,          setScSaving]          = useState<string | null>(null);
  const [scSaved,           setScSaved]           = useState<string | null>(null);
  const [scError,           setScError]           = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    setScLoading(true);
    adminApi.settings.getAll()
      .then((s: Record<string, string>) => {
        if (s.home_hero_headline)  setScHomeHeadline(s.home_hero_headline);
        if (s.home_hero_subtitle)  setScHomeSubtitle(s.home_hero_subtitle);
        if (s.home_cta_title)      setScCtaTitle(s.home_cta_title);
        if (s.home_cta_subtitle)   setScCtaSubtitle(s.home_cta_subtitle);
        if (s.about_header_desc)   setScAboutHeader(s.about_header_desc);
        if (s.about_mission_p1)    setScAboutMission1(s.about_mission_p1);
        if (s.about_mission_p2)    setScAboutMission2(s.about_mission_p2);
        if (s.about_core_values)   setScAboutValues(s.about_core_values);
        if (s.contact_header_desc) setScContactHeader(s.contact_header_desc);
        if (s.contact_address)     setScContactAddress(s.contact_address);
        if (s.contact_phone)       setScContactPhone(s.contact_phone);
        if (s.contact_email)       setScContactEmail(s.contact_email);
        if (s.footer_tagline)      setScFooterTagline(s.footer_tagline);
        if (s.footer_facebook_url !== undefined) setScFacebook(s.footer_facebook_url);
        if (s.footer_instagram_url !== undefined) setScInstagram(s.footer_instagram_url);
      })
      .catch(() => setScError("Failed to load site content."))
      .finally(() => setScLoading(false));
  }, [isAdmin]);

  async function saveSiteSection(section: string, settings: Record<string, string>) {
    setScSaving(section);
    setScError(null);
    try {
      await adminApi.settings.saveAll(settings);
      invalidateSiteContentCache();
      setScSaved(section);
      setTimeout(() => setScSaved(null), 3000);
    } catch {
      setScError("Failed to save. Please try again.");
    } finally {
      setScSaving(null);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    adminApi.settings.getAll()
      .then((s: Record<string, string>) => {
        if (s.audit_retention_days) setAuditRetentionDays(s.audit_retention_days);
      })
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    adminApi.settings.getAll()
      .then((s: Record<string, string>) => {
        if (s.active_curriculum_years_list) {
          setActiveYearsList(s.active_curriculum_years_list.split(",").map(y => y.trim()).filter(Boolean));
        }
        if (s.registration_curriculum_years_list) {
          setRegYearsList(s.registration_curriculum_years_list.split(",").map(y => y.trim()).filter(Boolean));
        }
        if (s.registration_curriculum_year) setRegCurrYear(s.registration_curriculum_year);
        if (s.registration_open_date  !== undefined) setRegOpenDate(s.registration_open_date);
        if (s.registration_close_date !== undefined) setRegCloseDate(s.registration_close_date);
        if (s.session_start_date !== undefined) setSessionStartDate(s.session_start_date);
        if (s.session_end_date   !== undefined) setSessionEndDate(s.session_end_date);
      })
      .catch(() => {});
  }, [isAdmin]);

  async function saveRegWindow() {
    if (regOpenDate && regCloseDate && regOpenDate > regCloseDate) {
      setRegWinError("Start date must be on or before the end date.");
      return;
    }
    if (sessionStartDate && sessionEndDate && sessionStartDate > sessionEndDate) {
      setRegWinError("Session Start Date must be on or before the Session End Date.");
      return;
    }
    setRegWinSaving(true);
    setRegWinError(null);
    try {
      await adminApi.settings.saveAll({
        registration_curriculum_year: regCurrYear,
        registration_open_date:       regOpenDate,
        registration_close_date:      regCloseDate,
        session_start_date:           sessionStartDate,
        session_end_date:             sessionEndDate,
      });
      setRegWinSaved(true);
      setTimeout(() => setRegWinSaved(false), 3000);
    } catch {
      setRegWinError("Failed to save. Please try again.");
    } finally {
      setRegWinSaving(false);
    }
  }

  async function saveAuditRetention() {
    const days = parseInt(auditRetentionDays);
    if (isNaN(days) || days < 1 || days > 15) {
      setAuditRetError("Please choose 7 days (default) or 15 days (max).");
      return;
    }
    setAuditRetSaving(true);
    setAuditRetError(null);
    try {
      await adminApi.settings.saveAll({ audit_retention_days: String(days) });
      setAuditRetSaved(true);
      setTimeout(() => setAuditRetSaved(false), 3000);
    } catch {
      setAuditRetError("Failed to save retention setting.");
    } finally {
      setAuditRetSaving(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    setStripeLoading(true);
    adminApi.settings.getAll()
      .then((s: Record<string, string>) => {
        setStripePubKey(s.stripe_publishable_key ?? "");
        setStripeSecretKey("");
        setStripeSecretConfigured(s.stripe_secret_key_configured === "true");
        setStripeMemberFee(s.stripe_membership_fee ?? "150");
        setStripeCourseFee(s.stripe_course_fee ?? "35");
      })
      .catch(() => setStripeError("Failed to load payment settings."))
      .finally(() => setStripeLoading(false));
  }, [isAdmin]);

  async function saveStripeSettings() {
    setStripeSaving(true);
    setStripeError(null);
    try {
      const newSecret = stripeSecretKey.trim();
      await adminApi.settings.saveAll({
        stripe_publishable_key: stripePubKey.trim(),
        stripe_membership_fee:  stripeMemberFee.trim(),
        stripe_course_fee:      stripeCourseFee.trim(),
        // The stored secret is never sent to the browser; only send one when the admin typed a new key.
        ...(newSecret ? { stripe_secret_key: newSecret } : {}),
      });
      if (newSecret) {
        setStripeSecretConfigured(newSecret !== "sk_test_placeholder");
        setStripeSecretKey("");
      }
      setStripeSaved(true);
      setTimeout(() => setStripeSaved(false), 3000);
    } catch {
      setStripeError("Failed to save payment settings. Please try again.");
    } finally {
      setStripeSaving(false);
    }
  }

  async function savePinChange(e: React.FormEvent) {
    e.preventDefault();
    setPinError(null);
    if (!/^\d{4}$/.test(newPin)) { setPinError("New PIN must be exactly 4 digits."); return; }
    if (newPin !== confirmPin)   { setPinError("New PIN and confirmation do not match."); return; }
    if (!user?.phone)            { setPinError("No phone number found on your account."); return; }
    setPinSaving(true);
    try {
      if (user.isSuperAdmin) {
        await changeAdminPin(user.phone, currentPin, newPin);
      } else if (user.role === "admin") {
        await changeAdminPin(user.phone, currentPin, newPin);
      } else {
        await changePin(user.phone, currentPin, newPin);
      }
      markPinChanged();
      setPinSaved(true);
      setCurrentPin(""); setNewPin(""); setConfirmPin("");
      setTimeout(() => setPinSaved(false), 3000);
    } catch (err: any) {
      setPinError(err?.message ?? "Failed to change PIN.");
    } finally {
      setPinSaving(false);
    }
  }

  // displayYear is always in LONG format for the Settings page
  const displayYear = pendingYear ?? shortToLong(activeCurriculumYear);

  async function saveYear() {
    if (!displayYear) return;
    setYearSaving(true);
    setYearError(null);
    try {
      const shortYear = longToShort(displayYear);
      await adminApi.settings.saveAll({ active_curriculum_year: shortYear });
      setActiveYearLocally(shortYear);
      setPendingYear(null);
      setSaved("year");
      setTimeout(() => setSaved(null), 3000);
    } catch {
      setYearError("Failed to save. Please try again.");
    } finally {
      setYearSaving(false);
    }
  }

  /**
   * Returns whether the next year can be added for a given list,
   * plus detail fields used by the confirmation dialog.
   * Rule: enabled when today >= (Dec 31 of the last year's end year) – 18 months.
   */
  function getAddNextYearStatus(list: string[]): {
    enabled: boolean; nextYear: string; endYear: number;
    enableDate: Date; alreadyInList: boolean;
  } {
    const empty = { enabled: false, nextYear: "", endYear: 0, enableDate: new Date(), alreadyInList: false };
    if (list.length === 0) return empty;
    const lastYear = list[list.length - 1];
    const parts = lastYear.split("-");
    if (parts.length !== 2) return empty;
    const endYear = parseInt(parts[1], 10);
    if (isNaN(endYear)) return empty;
    const nextYear = `${endYear}-${endYear + 1}`;
    const alreadyInList = list.includes(nextYear);
    const lastYearEnd = new Date(endYear, 11, 31);
    const enableDate  = new Date(lastYearEnd);
    enableDate.setMonth(enableDate.getMonth() - 18);
    const enabled = new Date() >= enableDate && !alreadyInList;
    return { enabled, nextYear, endYear, enableDate, alreadyInList };
  }

  async function addNextYear(kind: "active" | "registration") {
    const list   = kind === "active" ? activeYearsList : regYearsList;
    const status = getAddNextYearStatus(list);
    if (!status.nextYear || status.alreadyInList) return;
    const setSaving = kind === "active" ? setAddingActiveYear : setAddingRegYear;
    setSaving(true);
    try {
      const result = await adminApi.settings.addCurriculumYear(kind, status.nextYear);
      if (kind === "active") setActiveYearsList(result.list);
      else                   setRegYearsList(result.list);
    } catch {
      // silently ignore; user can retry
    } finally {
      setSaving(false);
    }
  }

  function save(section: string) {
    setSaved(section);
    setTimeout(() => setSaved(null), 2500);
  }

  const card = "bg-white rounded-2xl border border-border p-6 space-y-5";
  const sectionIcon = (bg: string, color: string, icon: React.ReactNode) => (
    <div className={`w-9 h-9 ${bg} ${color} rounded-xl flex items-center justify-center shrink-0`}>{icon}</div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-secondary">Settings</h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "Manage your admin portal preferences" : "Manage your account settings"}
        </p>
      </div>

      {/* ── Tab bar (admin only; teachers see just their account panel) ── */}
      {isAdmin && (
        <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 overflow-x-auto">
          {ADMIN_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? "bg-white text-secondary shadow-sm"
                  : "text-muted-foreground hover:text-secondary"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB: ACADEMIC  (Curriculum Year + Registration)
      ══════════════════════════════════════════════ */}
      {isAdmin && activeTab === "academic" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* Curriculum Year */}
          <div className={card}>
            <div className="flex items-center gap-3">
              {sectionIcon("bg-amber-100", "text-amber-600", <CalendarDays className="w-4 h-4" />)}
              <div>
                <h3 className="font-bold text-secondary">Active Curriculum Year</h3>
                <p className="text-xs text-muted-foreground">Active year used globally across courses, enrollment, reports, and all dropdowns.</p>
              </div>
            </div>

            {settingsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : (() => {
              return (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Active Year</Label>
                    <div className="flex gap-2">
                      <select
                        value={displayYear}
                        onChange={e => { setPendingYear(e.target.value); setSaved(null); setYearError(null); }}
                        className="flex-1 border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-primary"
                      >
                        {activeYearsList.map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setNextYearDialog({ kind: "active" })}
                        disabled={addingActiveYear}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-50 border-amber-300 text-amber-700"
                      >
                        {addingActiveYear
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <PlusCircle className="w-3.5 h-3.5" />}
                        Add Next Year
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Currently active: <strong>{shortToLong(activeCurriculumYear)}</strong>. Changing this updates all year-related dropdowns and filters portal-wide.
                    </p>
                  </div>
                  {yearError && (
                    <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{yearError}</p>
                  )}
                  <div className="flex justify-end">
                    <Button
                      onClick={saveYear}
                      disabled={yearSaving || displayYear === shortToLong(activeCurriculumYear)}
                      className="rounded-xl gap-2"
                    >
                      {yearSaving
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                        : saved === "year"
                          ? <><Check className="w-4 h-4" /> Saved!</>
                          : "Apply Year"}
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Registration Window */}
          <div className={card}>
            <div className="flex items-center gap-3">
              {sectionIcon("bg-green-100", "text-green-600", <CalendarDays className="w-4 h-4" />)}
              <div>
                <h3 className="font-bold text-secondary">Registration Window</h3>
                <p className="text-xs text-muted-foreground">
                  Controls when parents can submit the public registration form. Admin-created registrations are always allowed regardless of this window.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Registration curriculum year dropdown + Add Next Year */}
              {(() => {
                return (
                  <div className="space-y-1.5">
                    <Label>Registration Open for Curriculum Year</Label>
                    <div className="flex gap-2">
                      <select
                        value={regCurrYear}
                        onChange={e => { setRegCurrYear(e.target.value); setRegWinError(null); }}
                        className="flex-1 border border-border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:border-primary"
                      >
                        {regYearsList.map(y => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setNextYearDialog({ kind: "registration" })}
                        disabled={addingRegYear}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-50 border-green-300 text-green-700"
                      >
                        {addingRegYear
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <PlusCircle className="w-3.5 h-3.5" />}
                        Add Next Year
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This year is shown as a read-only value on the public registration form and cannot be changed by parents.
                    </p>
                  </div>
                );
              })()}

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Registration Opens</Label>
                  <Input
                    type="date"
                    value={regOpenDate}
                    onChange={e => { setRegOpenDate(e.target.value); setRegWinError(null); }}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Registration Closes</Label>
                  <Input
                    type="date"
                    value={regCloseDate}
                    onChange={e => { setRegCloseDate(e.target.value); setRegWinError(null); }}
                    className="rounded-xl"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Session Start Date</Label>
                  <Input
                    type="date"
                    value={sessionStartDate}
                    onChange={e => { setSessionStartDate(e.target.value); setRegWinError(null); }}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Session End Date</Label>
                  <Input
                    type="date"
                    value={sessionEndDate}
                    onChange={e => { setSessionEndDate(e.target.value); setRegWinError(null); }}
                    className="rounded-xl"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                Students must be at least 6 years old on the Session Start Date. Public registration stays closed until it is set.
              </p>

              {regOpenDate && regCloseDate && regOpenDate <= regCloseDate && (() => {
                const today = new Date().toISOString().slice(0, 10);
                const isOpen = today >= regOpenDate && today <= regCloseDate;
                return (
                  <div className={`border rounded-xl px-3 py-2 text-xs ${isOpen ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
                    {isOpen
                      ? <>Registration is currently <strong>open</strong> — window closes on <strong>{regCloseDate}</strong>.</>
                      : <>Registration is currently <strong>closed</strong>. Opens <strong>{regOpenDate}</strong>, closes <strong>{regCloseDate}</strong>.</>
                    }
                  </div>
                );
              })()}

              {(!regOpenDate || !regCloseDate) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
                  <strong>No window configured.</strong> Public registration is currently blocked until dates are set and saved.
                </div>
              )}

              {regWinError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {regWinError}
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button
                onClick={saveRegWindow}
                disabled={regWinSaving}
                className="rounded-xl gap-2"
              >
                {regWinSaving
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : regWinSaved
                    ? <><Check className="w-4 h-4" /> Saved!</>
                    : "Save Registration Window"}
              </Button>
            </div>
          </div>

          {/* Academic Settings */}
          <div className={card}>
            <div className="flex items-center gap-3">
              {sectionIcon("bg-purple-100", "text-purple-600", <Globe className="w-4 h-4" />)}
              <h3 className="font-bold text-secondary">Academic Settings</h3>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Class Duration</Label>
                <Input defaultValue="60 minutes" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label>Session Start Date</Label>
                <Input type="date" defaultValue="2026-06-01" className="rounded-xl" />
              </div>
              <div className="space-y-1.5">
                <Label>Session End Date</Label>
                <Input type="date" defaultValue="2026-09-30" className="rounded-xl" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => save("academic")} className="rounded-xl gap-2">
                {saved === "academic" ? <><Check className="w-4 h-4" /> Saved!</> : "Save Settings"}
              </Button>
            </div>
          </div>

          {/* Registration QR Code */}
          <RegistrationQRCard />
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB: ACCOUNT  (Change Password / Change PIN)
      ══════════════════════════════════════════════ */}
      {(activeTab === "account" || !isAdmin) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* Change PIN — teachers / assistants */}
          {user?.phone && (
            <div className={card}>
              <div className="flex items-center gap-3">
                {sectionIcon("bg-blue-100", "text-blue-600", <Lock className="w-4 h-4" />)}
                <div>
                  <h3 className="font-bold text-secondary">Change PIN</h3>
                  <p className="text-xs text-muted-foreground">Update your 4-digit login PIN.</p>
                </div>
              </div>
              <form onSubmit={savePinChange} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Current PIN</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="••••"
                    value={currentPin}
                    onChange={e => setCurrentPin(e.target.value)}
                    required
                    className="rounded-xl w-40"
                  />
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>New PIN</Label>
                    <Input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="••••"
                      value={newPin}
                      onChange={e => setNewPin(e.target.value)}
                      required
                      className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Confirm New PIN</Label>
                    <Input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="••••"
                      value={confirmPin}
                      onChange={e => setConfirmPin(e.target.value)}
                      required
                      className="rounded-xl"
                    />
                  </div>
                </div>
                {pinError && (
                  <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {pinError}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button type="submit" disabled={pinSaving} variant="outline" className="rounded-xl gap-2">
                    {pinSaving
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                      : pinSaved
                        ? <><Check className="w-4 h-4" /> PIN Updated!</>
                        : "Update PIN"}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Change Password — admin */}
          {isAdmin && !user?.phone && (
            <div className={card}>
              <div className="flex items-center gap-3">
                {sectionIcon("bg-blue-100", "text-blue-600", <Lock className="w-4 h-4" />)}
                <div>
                  <h3 className="font-bold text-secondary">Change Password</h3>
                  <p className="text-xs text-muted-foreground">Requires your system security PIN to confirm.</p>
                </div>
              </div>

              <form onSubmit={savePasswordChange} className="space-y-4">
                {/* New password */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>New Password</Label>
                    <div className="relative">
                      <Input
                        type={showNewPw ? "text" : "password"}
                        placeholder="Min. 8 characters"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        required
                        className="rounded-xl pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-secondary"
                      >
                        {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Confirm New Password</Label>
                    <Input
                      type="password"
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      required
                      className="rounded-xl"
                    />
                  </div>
                </div>

                {/* Security PIN */}
                <div className="border-t border-border pt-4 space-y-1.5">
                  <Label>
                    Security PIN
                    <span className="ml-1.5 text-xs text-muted-foreground font-normal">— required to authorise this change</span>
                  </Label>
                  <div className="relative max-w-xs">
                    <Input
                      type={showOverridePw ? "text" : "password"}
                      inputMode="numeric"
                      placeholder="Enter security PIN"
                      value={overridePin}
                      onChange={e => setOverridePin(e.target.value)}
                      required
                      className="rounded-xl pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOverridePw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-secondary"
                    >
                      {showOverridePw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {pwError && (
                  <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {pwError}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button type="submit" disabled={pwSaving} variant="outline" className="rounded-xl gap-2">
                    {pwSaving
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                      : pwSaved
                        ? <><Check className="w-4 h-4" /> Password Updated!</>
                        : "Update Password"}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB: PAYMENTS  (Fees + Stripe keys)
      ══════════════════════════════════════════════ */}
      {isAdmin && activeTab === "payments" && (
        <div className={card}>
          <div className="flex items-center gap-3">
            {sectionIcon("bg-violet-100", "text-violet-600", <CreditCard className="w-4 h-4" />)}
            <div>
              <h3 className="font-bold text-secondary">Payment Gateway — Stripe</h3>
              <p className="text-xs text-muted-foreground">
                Fee amounts and Stripe API keys. Get your keys from{" "}
                <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  dashboard.stripe.com/apikeys
                </a>.
              </p>
            </div>
          </div>

          {stripeLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading payment settings…
            </div>
          ) : (
            <div className="space-y-5">
              {/* Fee configuration */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Fee Configuration</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Annual Membership Fee ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={stripeMemberFee}
                      onChange={e => setStripeMemberFee(e.target.value)}
                      className="rounded-xl"
                    />
                    <p className="text-xs text-muted-foreground">Charged once per family per year.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Course Enrollment Fee ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={stripeCourseFee}
                      onChange={e => setStripeCourseFee(e.target.value)}
                      className="rounded-xl"
                    />
                    <p className="text-xs text-muted-foreground">Charged per course enrolled.</p>
                  </div>
                </div>
              </div>

              {/* Stripe keys */}
              <div className="border-t border-border pt-4 space-y-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stripe API Keys</p>

                {(stripePubKey === "pk_test_placeholder" || !stripePubKey || !stripeSecretConfigured) ? (
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    Using placeholder keys — online payments are disabled until real keys are entered.
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800">
                    <Check className="w-4 h-4 shrink-0" />
                    Stripe API keys are configured. Online payments are active.
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>Publishable Key <span className="text-xs text-muted-foreground">(starts with pk_)</span></Label>
                  <Input
                    value={stripePubKey}
                    onChange={e => setStripePubKey(e.target.value)}
                    placeholder="pk_live_... or pk_test_..."
                    className="rounded-xl font-mono text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Secret Key <span className="text-xs text-muted-foreground">(starts with sk_) — kept private</span></Label>
                  <div className="relative">
                    <Input
                      type={showSecret ? "text" : "password"}
                      value={stripeSecretKey}
                      onChange={e => setStripeSecretKey(e.target.value)}
                      placeholder={stripeSecretConfigured
                        ? "•••••••• (saved — leave blank to keep current key)"
                        : "sk_live_... or sk_test_..."}
                      className="rounded-xl font-mono text-sm pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-secondary"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {stripeError && (
                <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {stripeError}
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={saveStripeSettings} disabled={stripeSaving} className="rounded-xl gap-2">
                  {stripeSaving
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                    : stripeSaved
                      ? <><Check className="w-4 h-4" /> Saved!</>
                      : "Save Payment Settings"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB: SYSTEM  (Organization + Notifications + Audit)
      ══════════════════════════════════════════════ */}
      {isAdmin && activeTab === "system" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

          {/* ── Organization Info ── */}
          <div className={card}>
            <div className="flex items-center gap-3">
              {sectionIcon("bg-primary/10", "text-primary", <School className="w-4 h-4" />)}
              <div>
                <h3 className="font-bold text-secondary">Gurukul Information</h3>
                <p className="text-xs text-muted-foreground">Organization details displayed across the portal.</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Organization Name</Label><Input defaultValue="Bhartiya Hindu Temple Gurukul" className="rounded-xl" /></div>
              <div className="space-y-1.5"><Label>Address</Label><Input defaultValue="3671 Hyatts Rd, Powell, OH 43065" className="rounded-xl" /></div>
              <div className="space-y-1.5"><Label>Phone</Label><Input defaultValue="(740) 369-0717" className="rounded-xl" /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>Email</Label><Input defaultValue="gurukul@bhtohio.org" className="rounded-xl" /></div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => save("gurukul")} className="rounded-xl gap-2">
                {saved === "gurukul" ? <><Check className="w-4 h-4" /> Saved!</> : "Save Changes"}
              </Button>
            </div>
          </div>

          {/* ── Notification Preferences ── */}
          <div className={card}>
            <div className="flex items-center gap-3">
              {sectionIcon("bg-green-100", "text-green-600", <Bell className="w-4 h-4" />)}
              <div>
                <h3 className="font-bold text-secondary">Notification Preferences</h3>
                <p className="text-xs text-muted-foreground">Choose which system events trigger admin notifications.</p>
              </div>
            </div>
            <div className="space-y-1">
              {[
                { label: "Payment overdue alerts",       defaultChecked: true },
                { label: "Low inventory alerts",         defaultChecked: true },
                { label: "New enrollment notifications", defaultChecked: true },
                { label: "Upcoming event reminders",     defaultChecked: false },
                { label: "Weekly summary report",        defaultChecked: false },
              ].map(pref => (
                <label key={pref.label} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 cursor-pointer">
                  <span className="text-sm font-medium text-secondary">{pref.label}</span>
                  <input type="checkbox" defaultChecked={pref.defaultChecked} className="w-4 h-4 accent-primary" />
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => save("notifications")} className="rounded-xl gap-2">
                {saved === "notifications" ? <><Check className="w-4 h-4" /> Saved!</> : "Save Preferences"}
              </Button>
            </div>
          </div>

          {/* ── Audit Log Retention ── */}
          <div className={card}>
            <div className="flex items-center gap-3">
              {sectionIcon("bg-indigo-100", "text-indigo-600", <Shield className="w-4 h-4" />)}
              <div>
                <h3 className="font-bold text-secondary">Audit Log Retention</h3>
                <p className="text-xs text-muted-foreground">
                  Audit records older than the retention window are automatically purged. You can also trigger a manual purge from the Audit Log page.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Retention Period (days)</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    min={7}
                    max={15}
                    value={auditRetentionDays}
                    onChange={e => { setAuditRetentionDays(e.target.value); setAuditRetError(null); }}
                    className="rounded-xl w-40"
                    placeholder="7"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Default: 7 days. Maximum: 15 days. Records older than the retention window are automatically deleted every 6 hours.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {([{ v: "7", label: "7 Days (default)" }, { v: "15", label: "15 Days (max)" }] as const).map(({ v, label }) => (
                  <button
                    key={v}
                    onClick={() => { setAuditRetentionDays(v); setAuditRetError(null); }}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                      auditRetentionDays === v
                        ? "bg-primary text-white border-primary"
                        : "bg-white text-muted-foreground border-border hover:border-primary hover:text-primary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {auditRetError && (
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {auditRetError}
                </p>
              )}

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                <strong>Note:</strong> Deletion is irreversible. The system automatically purges records older than the retention window every 6 hours. You can also trigger a manual purge from the Audit Log page.
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={saveAuditRetention}
                disabled={auditRetSaving}
                className="rounded-xl gap-2"
              >
                {auditRetSaving
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  : auditRetSaved
                  ? <><Check className="w-4 h-4" /> Saved!</>
                  : "Save Retention Setting"}
              </Button>
            </div>
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════
          TAB: WEBSITE  (Site Content)
      ══════════════════════════════════════════════ */}
      {isAdmin && activeTab === "website" && (
        <div className="space-y-5">

          {scError && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 shrink-0" /> {scError}
            </div>
          )}

          {scLoading ? (
            <div className="flex justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading site content…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              {/* ── Home Page ── */}
              <div className={card}>
                <div className="flex items-center gap-3">
                  {sectionIcon("bg-orange-100", "text-orange-600", <Home className="w-4 h-4" />)}
                  <div>
                    <h3 className="font-bold text-secondary">Home Page</h3>
                    <p className="text-xs text-muted-foreground">Hero headline, subtitle, and the bottom call-to-action strip.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Hero Headline</Label>
                    <Input
                      value={scHomeHeadline}
                      onChange={e => setScHomeHeadline(e.target.value)}
                      className="rounded-xl"
                      placeholder="Main headline on the homepage"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Hero Subtitle</Label>
                    <Textarea
                      value={scHomeSubtitle}
                      onChange={e => setScHomeSubtitle(e.target.value)}
                      className="rounded-xl resize-none"
                      rows={2}
                      placeholder="Tagline below the headline"
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label>CTA Banner Title</Label>
                      <Input
                        value={scCtaTitle}
                        onChange={e => setScCtaTitle(e.target.value)}
                        className="rounded-xl"
                        placeholder="e.g. Ready to join the Gurukul family?"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>CTA Banner Subtitle</Label>
                      <Input
                        value={scCtaSubtitle}
                        onChange={e => setScCtaSubtitle(e.target.value)}
                        className="rounded-xl"
                        placeholder="Short supporting line under the CTA title"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    disabled={scSaving === "home"}
                    onClick={() => saveSiteSection("home", {
                      home_hero_headline: scHomeHeadline,
                      home_hero_subtitle: scHomeSubtitle,
                      home_cta_title:     scCtaTitle,
                      home_cta_subtitle:  scCtaSubtitle,
                    })}
                    className="rounded-xl gap-2"
                  >
                    {scSaving === "home" ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                      : scSaved === "home" ? <><Check className="w-4 h-4" /> Saved!</>
                      : "Save Home Content"}
                  </Button>
                </div>
              </div>

              {/* ── About Page ── */}
              <div className={card}>
                <div className="flex items-center gap-3">
                  {sectionIcon("bg-blue-100", "text-blue-600", <Info className="w-4 h-4" />)}
                  <div>
                    <h3 className="font-bold text-secondary">About Page</h3>
                    <p className="text-xs text-muted-foreground">Page description, mission paragraphs, and core values list.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Page Description <span className="text-xs text-muted-foreground font-normal">(shown below page title)</span></Label>
                    <Input
                      value={scAboutHeader}
                      onChange={e => setScAboutHeader(e.target.value)}
                      className="rounded-xl"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mission — First Paragraph</Label>
                    <Textarea
                      value={scAboutMission1}
                      onChange={e => setScAboutMission1(e.target.value)}
                      className="rounded-xl resize-none"
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mission — Second Paragraph</Label>
                    <Textarea
                      value={scAboutMission2}
                      onChange={e => setScAboutMission2(e.target.value)}
                      className="rounded-xl resize-none"
                      rows={3}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>
                      Core Values
                      <span className="ml-1.5 text-xs text-muted-foreground font-normal">— one value per line</span>
                    </Label>
                    <Textarea
                      value={scAboutValues}
                      onChange={e => setScAboutValues(e.target.value)}
                      className="rounded-xl resize-none font-mono text-xs"
                      rows={5}
                      placeholder={"Dharma (Righteousness & Duty)\nVidya (True Knowledge)\nSeva (Selfless Service)\nBhakti (Devotion)"}
                    />
                    <p className="text-xs text-muted-foreground">Each line becomes a bullet point on the About page.</p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    disabled={scSaving === "about"}
                    onClick={() => saveSiteSection("about", {
                      about_header_desc:  scAboutHeader,
                      about_mission_p1:   scAboutMission1,
                      about_mission_p2:   scAboutMission2,
                      about_core_values:  scAboutValues,
                    })}
                    className="rounded-xl gap-2"
                  >
                    {scSaving === "about" ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                      : scSaved === "about" ? <><Check className="w-4 h-4" /> Saved!</>
                      : "Save About Content"}
                  </Button>
                </div>
              </div>
              </div>{/* end Home+About grid */}

              {/* ── Contact & Footer ── */}
              <div className={card}>
                <div className="flex items-center gap-3">
                  {sectionIcon("bg-green-100", "text-green-600", <Phone className="w-4 h-4" />)}
                  <div>
                    <h3 className="font-bold text-secondary">Contact, Footer & Social</h3>
                    <p className="text-xs text-muted-foreground">Contact page info, footer tagline, and social media links.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>Contact Page Description</Label>
                    <Input
                      value={scContactHeader}
                      onChange={e => setScContactHeader(e.target.value)}
                      className="rounded-xl"
                    />
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-semibold text-secondary mb-3 uppercase tracking-widest">Contact Information</p>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>
                          Address
                          <span className="ml-1.5 text-xs text-muted-foreground font-normal">— two lines</span>
                        </Label>
                        <Textarea
                          value={scContactAddress}
                          onChange={e => setScContactAddress(e.target.value)}
                          className="rounded-xl resize-none font-mono text-sm"
                          rows={2}
                          placeholder={"3671 Hyatts Rd\nPowell, OH 43065"}
                        />
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <Label>Phone Number</Label>
                          <Input
                            value={scContactPhone}
                            onChange={e => setScContactPhone(e.target.value)}
                            className="rounded-xl"
                            placeholder="(740) 369-0717"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Email Address</Label>
                          <Input
                            type="email"
                            value={scContactEmail}
                            onChange={e => setScContactEmail(e.target.value)}
                            className="rounded-xl"
                            placeholder="gurukul@bhtohio.org"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-semibold text-secondary mb-3 uppercase tracking-widest">Footer</p>
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label>Footer Tagline</Label>
                        <Textarea
                          value={scFooterTagline}
                          onChange={e => setScFooterTagline(e.target.value)}
                          className="rounded-xl resize-none"
                          rows={2}
                        />
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Facebook URL <span className="text-xs text-muted-foreground font-normal">(leave blank to hide)</span></Label>
                          <Input
                            value={scFacebook}
                            onChange={e => setScFacebook(e.target.value)}
                            className="rounded-xl"
                            placeholder="https://facebook.com/yourpage"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Instagram URL <span className="text-xs text-muted-foreground font-normal">(leave blank to hide)</span></Label>
                          <Input
                            value={scInstagram}
                            onChange={e => setScInstagram(e.target.value)}
                            className="rounded-xl"
                            placeholder="https://instagram.com/yourhandle"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    disabled={scSaving === "contact"}
                    onClick={() => saveSiteSection("contact", {
                      contact_header_desc:  scContactHeader,
                      contact_address:      scContactAddress,
                      contact_phone:        scContactPhone,
                      contact_email:        scContactEmail,
                      footer_tagline:       scFooterTagline,
                      footer_facebook_url:  scFacebook,
                      footer_instagram_url: scInstagram,
                    })}
                    className="rounded-xl gap-2"
                  >
                    {scSaving === "contact" ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                      : scSaved === "contact" ? <><Check className="w-4 h-4" /> Saved!</>
                      : "Save Contact & Footer"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="bg-gray-50 rounded-2xl border border-border p-5 text-center">
        <p className="text-sm text-muted-foreground">Admin Portal v1.0 • Bhartiya Hindu Temple Gurukul • Powell, OH</p>
        <p className="text-xs text-muted-foreground mt-1">For technical support, contact the temple administration.</p>
      </div>

      {/* ── Add Next Year confirmation dialog ────────────────────────────────── */}
      {nextYearDialog && (() => {
        const isActive = nextYearDialog.kind === "active";
        const list = isActive ? activeYearsList : regYearsList;
        const status = getAddNextYearStatus(list);
        const adding = isActive ? addingActiveYear : addingRegYear;
        const today = new Date();
        const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setNextYearDialog(null)}
          >
            <div
              className="bg-white rounded-2xl border border-border shadow-xl p-6 max-w-sm w-full space-y-4"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isActive ? "bg-amber-100" : "bg-green-100"}`}>
                  <CalendarDays className={`w-4 h-4 ${isActive ? "text-amber-600" : "text-green-600"}`} />
                </div>
                <div>
                  <h3 className="font-bold text-secondary text-sm">Add Next Year</h3>
                  <p className="text-xs text-muted-foreground">{isActive ? "Active curriculum years" : "Registration years"}</p>
                </div>
              </div>

              {/* Body */}
              {!status.nextYear ? (
                <p className="text-sm text-muted-foreground">No years configured yet. Add at least one year first.</p>
              ) : status.alreadyInList ? (
                <div className="space-y-2">
                  <p className="text-sm text-secondary">
                    The next year <strong>{status.nextYear}</strong> is already in the list.
                  </p>
                  <div className="bg-green-50 rounded-xl px-3 py-2.5 text-xs text-green-700">
                    Nothing to add — the list is already up to date.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-secondary">
                    The next year to add is <strong>{status.nextYear}</strong>.
                  </p>

                  {/* 18-month rule explanation */}
                  <div className="bg-gray-50 rounded-xl p-3.5 space-y-1.5 text-xs">
                    <p className="font-semibold text-secondary uppercase tracking-wide text-[10px]">18-Month Rule</p>
                    <p className="text-muted-foreground">
                      A new year becomes available <strong>18 months before it ends</strong> — i.e., before
                      Dec 31, {status.endYear}.
                    </p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1 border-t border-border">
                      <span className="text-muted-foreground">Available from</span>
                      <span className="font-medium text-secondary">{fmtDate(status.enableDate)}</span>
                      <span className="text-muted-foreground">Today</span>
                      <span className="font-medium text-secondary">{fmtDate(today)}</span>
                    </div>
                  </div>

                  {/* Result */}
                  {status.enabled ? (
                    <div className="bg-green-50 rounded-xl px-3 py-2.5 text-xs text-green-700 flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">✅</span>
                      <span>Today is past the availability date — you can add <strong>{status.nextYear}</strong> now.</span>
                    </div>
                  ) : (
                    <div className="bg-amber-50 rounded-xl px-3 py-2.5 text-xs text-amber-700 flex items-start gap-2">
                      <span className="shrink-0 mt-0.5">⏳</span>
                      <span>Not yet available. Come back on <strong>{fmtDate(status.enableDate)}</strong>.</span>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => setNextYearDialog(null)}>
                  {status.enabled && !status.alreadyInList ? "Cancel" : "Close"}
                </Button>
                {status.enabled && !status.alreadyInList && (
                  <Button
                    size="sm"
                    className={`rounded-xl ${isActive ? "" : "bg-green-600 hover:bg-green-700"}`}
                    disabled={adding}
                    onClick={async () => {
                      setNextYearDialog(null);
                      await addNextYear(nextYearDialog.kind);
                    }}
                  >
                    {adding
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Adding…</>
                      : `Add ${status.nextYear}`}
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

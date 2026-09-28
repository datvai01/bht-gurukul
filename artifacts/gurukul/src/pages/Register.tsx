import { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { StudentRegistrationForm, type RegistrationPaymentInfo } from "@/components/StudentRegistrationForm";
import { StripePaymentForm, PaymentSuccessCard } from "@/components/StripePaymentForm";
import { adminApi, type RegistrationBalance } from "@/lib/adminApi";
import {
  CheckCircle2, BookOpen, CreditCard, Landmark, Loader2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

// Payment flow after submission:
//   Existing validated member → choose Pay Online or Pay at Temple Administration Desk.
//   New or not-yet-validated member → Temple Administration Desk only.
type SuccessState = {
  code:           string;
  name:           string;
  payment:        RegistrationPaymentInfo;
  stage:          "choose" | "online" | "done";
  paymentStatus?: string;
  paidAmount?:    number;
  recordError?:   string;
};

function BalanceTable({ balance }: { balance: RegistrationBalance }) {
  const outstanding = balance.items.filter(item => item.balance > 0);
  return (
    <div className="bg-white border border-border rounded-xl text-sm text-left divide-y divide-border">
      {outstanding.map(item => (
        <div key={`${item.kind}-${item.id}`} className="flex justify-between gap-3 px-4 py-2">
          <span className="text-muted-foreground">{item.label}</span>
          <span className="font-medium text-secondary">${item.balance.toFixed(2)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3 px-4 py-2 font-bold">
        <span>Balance Due</span>
        <span className="text-primary">${balance.total.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Register() {
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [curriculumYear, setCurriculumYear] = useState("");
  const [curriculumYearLoading, setCurriculumYearLoading] = useState(true);
  const [curriculumYearError, setCurriculumYearError] = useState("");
  const [choosingDesk, setChoosingDesk] = useState(false);
  const [deskError, setDeskError] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then(async response => {
        if (!response.ok) throw new Error("Registration settings could not be loaded.");
        return response.json() as Promise<Record<string, string>>;
      })
      .then(settings => {
        const year = settings.registration_curriculum_year?.trim();
        if (!year) throw new Error("The registration curriculum year is not configured.");
        const range = year.match(/^(\d{4})-(\d{4})$/);
        setCurriculumYear(range ? `${range[1]}–${range[2].slice(-2)}` : year);
      })
      .catch(error => {
        setCurriculumYearError(error instanceof Error ? error.message : "The registration curriculum year is unavailable.");
      })
      .finally(() => setCurriculumYearLoading(false));
  }, []);

  const balance = success?.payment.balance ?? null;
  const onlineEligible = Boolean(balance?.onlinePaymentEligible && !success?.payment.isNewMember);

  // Records the Temple Desk choice; registration stays submitted and unpaid rows are marked
  // "Pending – Temple Desk Payment" (or "Validation/Payment" for unvalidated members).
  async function chooseTempleDesk(state: SuccessState) {
    const memberId = state.payment.memberId;
    setChoosingDesk(true);
    setDeskError("");
    try {
      if (!memberId) throw new Error("Member record is missing.");
      const result = await adminApi.students.chooseTempleDeskPayment(state.code, memberId);
      setSuccess({
        ...state,
        stage: "done",
        paymentStatus: result.paymentStatus,
        payment: { ...state.payment, balance: result.balance ?? state.payment.balance },
      });
    } catch {
      setDeskError("Your registration is submitted, but we could not record your payment choice. Please mention it at the Temple Administration Desk.");
      setSuccess({ ...state, stage: "done" });
    } finally {
      setChoosingDesk(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function handleSuccess(studentCode: string, studentName: string, paymentInfo: RegistrationPaymentInfo) {
    const state: SuccessState = { code: studentCode, name: studentName, payment: paymentInfo, stage: "choose" };
    const eligible = Boolean(paymentInfo.balance?.onlinePaymentEligible && !paymentInfo.isNewMember);
    if (!paymentInfo.balance || paymentInfo.balance.total <= 0) {
      setSuccess({ ...state, stage: "done" });
    } else if (!eligible) {
      // New or unvalidated members pay only at the Temple Desk.
      void chooseTempleDesk(state);
      setSuccess(state);
    } else {
      setSuccess(state);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handlePaymentDone(didPay: boolean, paymentIntentId?: string) {
    if (!success) return;
    if (!didPay) {
      // Online payment was unavailable; fall back to the Temple Desk.
      await chooseTempleDesk(success);
      return;
    }
    try {
      const res = await fetch("/api/payments/record-membership", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ studentCode: success.code, paymentIntentId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg  = (body as { error?: string }).error ?? "Failed to record payment.";
        // Surface the error — do NOT mark as paid when recording failed
        setSuccess(prev => prev ? { ...prev, recordError: msg } : prev);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    } catch {
      // Network failure — surface an actionable error rather than silent success
      setSuccess(prev => prev ? { ...prev, recordError: "Network error while recording your payment. Please contact the Gurukul office." } : prev);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSuccess(prev => prev ? { ...prev, stage: "done", paidAmount: prev.payment.balance?.total ?? 0, paymentStatus: "Paid" } : prev);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/60 to-white">
      {/* ── Hero banner ── */}
      <div className="bg-secondary text-white py-14 px-4 text-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)", backgroundSize: "32px 32px" }} />
        <div className="relative max-w-2xl mx-auto">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold mb-3">
            Student Registration
          </h1>
          <p className="text-white/80 text-lg">
            Bhartiya Hindu Temple Gurukul — Powell, OH
          </p>
          {curriculumYearLoading ? (
            <p className="text-white/60 text-sm mt-2" aria-live="polite">Loading academic year…</p>
          ) : curriculumYearError ? (
            <p className="text-amber-200 text-sm mt-2" role="alert">{curriculumYearError}</p>
          ) : (
            <p className="text-white/60 text-sm mt-2">Academic Year {curriculumYear}</p>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10">

        <AnimatePresence mode="wait">

          {/* ── Final confirmation ── */}
          {success?.stage === "done" && (
            <motion.div
              key="final"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white rounded-3xl border border-border p-10 text-center space-y-6 shadow-sm"
            >
              <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-12 h-12 text-green-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-secondary">Registration Submitted</h2>
                <p className="text-muted-foreground mt-2 text-lg">
                  <span className="font-semibold text-secondary">{success.name}</span> is registered for Academic Year {curriculumYear}{" "}
                  (Student ID <span className="font-mono font-semibold text-secondary">{success.code}</span>).
                </p>
              </div>

              {success.paidAmount != null && success.paidAmount > 0 && (
                <PaymentSuccessCard amount={success.paidAmount} />
              )}

              {!success.paidAmount && balance && balance.total > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 text-left space-y-3">
                  <p className="font-semibold text-amber-900">
                    Payment status: {success.paymentStatus ?? "Pending – Temple Desk Payment"}
                  </p>
                  <BalanceTable balance={balance} />
                  <p>
                    Please pay at the <strong>Temple Administration Desk</strong> (Zelle, Check, or Cash). Questions? Email{" "}
                    <a href="mailto:gurukul@bhtohio.org" className="underline">gurukul@bhtohio.org</a>.
                  </p>
                </div>
              )}
              {deskError && <p className="text-sm text-red-700" role="alert">{deskError}</p>}

              {success.payment.isNewMember && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 text-sm text-left flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <p className="font-semibold text-amber-900">Next Step: Temple Member Validation</p>
                    <p className="mt-1 text-amber-700">
                      As a new member, please visit the Temple Administration Desk with your ID card (Driver's License, Passport, or State ID)
                      to validate your membership and pay your membership and course fees. Online payment becomes available only after
                      BHT administration validates your membership.
                    </p>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Subjects cannot be added, removed, or replaced from this site after submission. Contact the Gurukul Administration for any course or level changes.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button variant="outline" onClick={() => { setSuccess(null); setDeskError(""); }}>
                  Register Another Child
                </Button>
                <Button asChild>
                  <Link href="/contact">Contact Us</Link>
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Payment step ── */}
          {success && success.stage !== "done" && (
            <motion.div
              key="payment"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* ── Payment received but recording failed ── */}
              {/* Show this INSTEAD of the payment form to prevent a second charge */}
              {success.recordError ? (
                <div className="bg-white rounded-2xl border border-amber-200 p-8 text-center space-y-5 shadow-sm">
                  <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8 text-amber-600" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-secondary">Payment Received</h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                      Your card was charged successfully. We just had trouble recording it automatically.
                    </p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800 text-left space-y-2">
                    <p className="font-semibold">Action needed — please do not pay again</p>
                    <p>Email <a href="mailto:gurukul@bhtohio.org" className="underline font-medium">gurukul@bhtohio.org</a> with your student code <strong>{success.code}</strong> and we will manually confirm your payment within one business day.</p>
                    <p className="text-amber-600 text-xs">Technical detail: {success.recordError}</p>
                  </div>
                  <Button variant="outline" onClick={() => setSuccess(null)}>
                    Register Another Child
                  </Button>
                </div>
              ) : (
                <>
                  {/* Registration confirmed banner */}
                  <div className="bg-green-50 rounded-2xl border border-green-200 px-5 py-4 flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-green-800">Registration submitted!</p>
                      <p className="text-sm text-green-700 mt-0.5">
                        <span className="font-medium">{success.name}</span> has been registered. Payment is not required to
                        complete registration — choose how you would like to pay.
                      </p>
                    </div>
                  </div>

                  {!onlineEligible && (
                    <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 animate-spin" /> Recording Temple Desk payment…
                    </div>
                  )}

                  {onlineEligible && success.stage === "choose" && balance && (
                    <div className="space-y-4">
                      <BalanceTable balance={balance} />
                      <div className="grid sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setSuccess({ ...success, stage: "online" })}
                          className="rounded-2xl border-2 border-border bg-white p-5 text-left hover:border-primary transition-colors"
                        >
                          <CreditCard className="w-6 h-6 text-primary mb-2" />
                          <p className="font-semibold text-secondary">Pay Online</p>
                          <p className="text-sm text-muted-foreground mt-1">Pay ${balance.total.toFixed(2)} now by card.</p>
                        </button>
                        <button
                          type="button"
                          disabled={choosingDesk}
                          onClick={() => void chooseTempleDesk(success)}
                          className="rounded-2xl border-2 border-border bg-white p-5 text-left hover:border-primary transition-colors disabled:opacity-60"
                        >
                          {choosingDesk ? <Loader2 className="w-6 h-6 text-primary mb-2 animate-spin" /> : <Landmark className="w-6 h-6 text-primary mb-2" />}
                          <p className="font-semibold text-secondary">Pay at Temple Administration Desk</p>
                          <p className="text-sm text-muted-foreground mt-1">Your registration stays submitted; pay later in person.</p>
                        </button>
                      </div>
                    </div>
                  )}

                  {onlineEligible && success.stage === "online" && balance && (
                    <>
                      <StripePaymentForm
                        studentCode={success.code}
                        studentName={success.name}
                        balance={balance}
                        onPaymentDone={(didPay, paymentIntentId) =>
                          handlePaymentDone(didPay, paymentIntentId)
                        }
                      />
                      <Button variant="outline" onClick={() => setSuccess({ ...success, stage: "choose" })}>
                        Back to payment options
                      </Button>
                    </>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* ── Registration Form ── */}
           {!success && (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {/* Form card */}
              <div className="bg-white rounded-2xl border border-border p-6 sm:p-8 shadow-sm">
                <StudentRegistrationForm
                  onSuccess={handleSuccess}
                  submitLabel="Submit Registration"
                />
              </div>

              <p className="text-xs text-center text-muted-foreground">
                By submitting this form you agree to be contacted by Gurukul staff regarding enrollment.
                Questions? Email{" "}
                <a href="mailto:gurukul@bhtohio.org" className="text-primary hover:underline">
                  gurukul@bhtohio.org
                </a>
              </p>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

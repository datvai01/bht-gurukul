import { useState, useEffect } from "react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { StudentRegistrationForm, type RegistrationPaymentInfo } from "@/components/StudentRegistrationForm";
import { StripePaymentForm, PaymentSuccessCard } from "@/components/StripePaymentForm";
import {
  CheckCircle2, BookOpen,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Types ────────────────────────────────────────────────────────────────────

type SuccessState = {
  code:         string;
  name:         string;
  payment:      RegistrationPaymentInfo;
  paid:         boolean;
  paidAmount?:  number;
  recordError?: string;
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Register() {
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [curriculumYear, setCurriculumYear] = useState("");
  const [curriculumYearLoading, setCurriculumYearLoading] = useState(true);
  const [curriculumYearError, setCurriculumYearError] = useState("");

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

  function handleSuccess(studentCode: string, studentName: string, paymentInfo: RegistrationPaymentInfo) {
    setSuccess({ code: studentCode, name: studentName, payment: paymentInfo, paid: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handlePaymentDone(didPay: boolean, paymentIntentId?: string) {
    if (didPay && success) {
      try {
        const res = await fetch("/api/payments/record-membership", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            studentCode:     success.code,
            paymentIntentId: paymentIntentId,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg  = (body as { error?: string }).error ?? "Failed to record membership payment.";
          // Surface the error — do NOT mark as paid when recording failed
          setSuccess(prev =>
            prev
              ? { ...prev, paid: false, recordError: msg }
              : prev
          );
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
      } catch {
        // Network failure — surface an actionable error rather than silent success
        setSuccess(prev =>
          prev
            ? { ...prev, paid: false, recordError: "Network error while recording your payment. Please contact the Gurukul office." }
            : prev
        );
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
    }
    setSuccess(prev => prev ? { ...prev, paid: true, paidAmount: didPay ? totalDue : 0 } : prev);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const totalDue = success
    ? success.payment.membershipFee + success.payment.courseCount * success.payment.courseFee
    : 0;

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

          {/* ── Final confirmation (paid or skipped) ── */}
          {success?.paid && (
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
                <h2 className="text-2xl font-bold text-secondary">You're All Set!</h2>
                <p className="text-muted-foreground mt-2 text-lg">
                  <span className="font-semibold text-secondary">{success.name}</span> has been successfully registered.
                </p>
              </div>

              {success.paidAmount != null && success.paidAmount > 0 && (
                <PaymentSuccessCard amount={success.paidAmount} />
              )}

              {(success.paidAmount == null || success.paidAmount === 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 text-left space-y-1">
                  <p className="font-semibold text-amber-800">Balance due: ${totalDue.toFixed(2)}</p>
                  <p>Please bring payment (Zelle, Check, or Cash) to the first class or contact us at <a href="mailto:gurukul@bhtohio.org" className="underline">gurukul@bhtohio.org</a>.</p>
                </div>
              )}

              {success.payment.isNewMember && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 text-sm text-left flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <p className="font-semibold text-amber-900">Next Step: Temple Member Verification</p>
                    <p className="mt-1 text-amber-700">As a new member, please get your membership validated within <strong>90 days</strong> by visiting the temple registration desk and showing your ID card (Driver's License, Passport, or State ID).</p>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                 <Button variant="outline" onClick={() => setSuccess(null)}>
                  Register Another Child
                </Button>
                <Button asChild>
                  <Link href="/contact">Contact Us</Link>
                </Button>
              </div>
            </motion.div>
          )}

          {/* ── Payment step ── */}
          {success && !success.paid && (
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
                        <span className="font-medium">{success.name}</span> has been registered.
                        Please complete payment below to confirm your enrollment.
                      </p>
                    </div>
                  </div>

                  {/* New-member validation notice — only for brand-new temple members */}
                  {success.payment.isNewMember && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3 text-sm">
                      <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                      <p className="text-amber-800">
                        Your registration has been submitted. As a new member, please get your membership validated within <strong>90 days</strong> by visiting the temple registration desk and showing your ID card.
                      </p>
                    </div>
                  )}

                  <StripePaymentForm
                    studentCode={success.code}
                    studentName={success.name}
                    courseCount={success.payment.courseCount}
                    membershipFee={success.payment.membershipFee}
                    courseFee={success.payment.courseFee}
                    onPaymentDone={(didPay, paymentIntentId) =>
                      handlePaymentDone(didPay, paymentIntentId)
                    }
                  />
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

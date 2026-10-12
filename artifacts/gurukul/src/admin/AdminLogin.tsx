import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { SESSION_EXPIRED_FLAG, useAuth } from "./AuthContext";
import { getDefaultRoute } from "./rbac";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Lock, User, BookOpen, Home, RefreshCw, Mail, ArrowLeft } from "lucide-react";

// ── Simple Math CAPTCHA ────────────────────────────────────────────────────────

function generateCaptcha() {
  const ops = ["+", "-", "×"] as const;
  const op  = ops[Math.floor(Math.random() * ops.length)];
  let a: number, b: number, answer: number;
  if (op === "+") {
    a = Math.floor(Math.random() * 10) + 1;
    b = Math.floor(Math.random() * 10) + 1;
    answer = a + b;
  } else if (op === "-") {
    a = Math.floor(Math.random() * 10) + 5;
    b = Math.floor(Math.random() * 5)  + 1;
    answer = a - b;
  } else {
    a = Math.floor(Math.random() * 9)  + 2;
    b = Math.floor(Math.random() * 5)  + 2;
    answer = a * b;
  }
  return { question: `${a} ${op} ${b}`, answer };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminLogin() {
  const [, setLocation] = useLocation();
  const { login, verifyCode } = useAuth();

  const [credential, setCredential] = useState("");
  const [secret,     setSecret]     = useState("");
  const [error,      setError]      = useState("");
  const [loading,    setLoading]    = useState(false);

  // Step 2: the emailed sign-in code (admins only)
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code,       setCode]       = useState("");
  const [notice,     setNotice]     = useState("");

  // Explain why the admin is back on this page after the two-hour session ended.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_EXPIRED_FLAG)) {
        sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
        setNotice("Your session ended after 2 hours. Please sign in again.");
      }
    } catch { /* ignore */ }
  }, []);

  // CAPTCHA state
  const [captcha,      setCaptcha]      = useState(generateCaptcha);
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaError, setCaptchaError] = useState(false);

  const refreshCaptcha = useCallback(() => {
    setCaptcha(generateCaptcha());
    setCaptchaInput("");
    setCaptchaError(false);
  }, []);

  // Refresh CAPTCHA after a failed login attempt
  useEffect(() => {
    if (error && !codeSentTo) refreshCaptcha();
  }, [error, codeSentTo, refreshCaptcha]);

  function startOver() {
    setCodeSentTo(null);
    setCode("");
    setSecret("");
    setError("");
    setNotice("");
    refreshCaptcha();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCaptchaError(false);

    // Verify CAPTCHA
    if (parseInt(captchaInput, 10) !== captcha.answer) {
      setCaptchaError(true);
      refreshCaptcha();
      return;
    }

    setLoading(true);
    setNotice("");
    try {
      const result = await login(credential.trim(), secret);
      if (result.status === "signed-in") {
        setLocation(getDefaultRoute(result.user.role));
      } else {
        setCodeSentTo(result.maskedEmail);
        setCode("");
      }
    } catch (err: any) {
      setError(err?.message ?? "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const user = await verifyCode(code);
      setLocation(getDefaultRoute(user.role));
    } catch (err: any) {
      // An expired or locked code needs the password again.
      if (err?.status === 429 || /sign in again/i.test(err?.message ?? "")) {
        startOver();
      }
      setError(err?.message ?? "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function resendCode() {
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const result = await login(credential.trim(), secret);
      if (result.status === "code-sent") {
        setCodeSentTo(result.maskedEmail);
        setCode("");
        setNotice(`A new code was sent to ${result.maskedEmail}.`);
      }
    } catch (err: any) {
      setError(err?.message ?? "Could not send a new code.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-secondary via-secondary/90 to-secondary/80 flex items-center justify-center p-4">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-20 w-64 h-64 bg-accent/10 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-80 h-80 bg-primary/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="bg-gradient-to-r from-primary to-accent p-8 text-center text-white">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BookOpen className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold">Gurukul Admin Portal</h1>
            <p className="text-white/80 text-sm mt-1">Bhartiya Hindu Temple, Powell OH</p>
          </div>

          <div className="p-8">
            <h2 className="text-xl font-bold text-secondary mb-6 text-center">
              {codeSentTo ? "Check your email" : "Sign in to continue"}
            </h2>

            {notice && (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 mb-6 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {notice}
              </div>
            )}

            {/* Error alert */}
            {error && (
              <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {codeSentTo ? (
              <form onSubmit={handleVerify} className="space-y-5" data-testid="admin-code-form">
                <p className="text-sm text-muted-foreground text-center">
                  We emailed a 6-digit sign-in code to <span className="font-semibold text-secondary">{codeSentTo}</span>.
                  It expires in 10 minutes.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="admin-code" className="text-secondary font-medium">Sign-in code</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="admin-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="6-digit code"
                      className="pl-10 h-12 rounded-xl border-border focus:border-primary font-mono tracking-[0.3em]"
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-to-r from-primary to-accent hover:opacity-90"
                  disabled={loading || code.length !== 6}
                >
                  {loading ? "Verifying…" : "Verify and Sign In"}
                </Button>
                <div className="flex items-center justify-between text-sm">
                  <button type="button" onClick={startOver} className="flex items-center gap-1 text-muted-foreground hover:text-primary">
                    <ArrowLeft className="w-4 h-4" /> Start over
                  </button>
                  <button type="button" onClick={resendCode} disabled={loading} className="text-primary font-medium hover:underline disabled:opacity-50">
                    Resend code
                  </button>
                </div>
              </form>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Username / Phone */}
              <div className="space-y-2">
                <Label htmlFor="credential" className="text-secondary font-medium">
                  Username
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="credential"
                    type="text"
                    placeholder="Username"
                    className="pl-10 h-12 rounded-xl border-border focus:border-primary"
                    value={credential}
                    onChange={e => setCredential(e.target.value)}
                    required
                    autoComplete="username"
                  />
                </div>

              </div>

              {/* Password / PIN */}
              <div className="space-y-2">
                <Label htmlFor="secret" className="text-secondary font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="secret"
                    type="password"
                    placeholder="Password"
                    className="pl-10 h-12 rounded-xl border-border focus:border-primary"
                    value={secret}
                    onChange={e => setSecret(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {/* CAPTCHA */}
              <div className="space-y-2">
                <Label className="text-secondary font-medium">Verification</Label>
                <div className="flex items-center gap-3">
                  {/* CAPTCHA question box */}
                  <div className="flex-1 flex items-center justify-center bg-gray-50 border border-border rounded-xl h-12 px-4 select-none">
                    <span className="font-mono text-lg font-bold text-secondary tracking-widest">
                      {captcha.question} = ?
                    </span>
                  </div>
                  {/* Refresh button */}
                  <button
                    type="button"
                    onClick={refreshCaptcha}
                    title="New question"
                    className="w-12 h-12 flex items-center justify-center rounded-xl border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                <Input
                  type="number"
                  placeholder="Your answer"
                  className={`h-12 rounded-xl border-border focus:border-primary ${captchaError ? "border-red-400 bg-red-50" : ""}`}
                  value={captchaInput}
                  onChange={e => { setCaptchaInput(e.target.value); setCaptchaError(false); }}
                  required
                  autoComplete="off"
                  inputMode="numeric"
                />
                {captchaError && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Incorrect answer — a new question has been generated.
                  </p>
                )}
              </div>

              {/* Sign In button */}
              <Button
                type="submit"
                className="w-full h-12 rounded-xl text-base font-semibold bg-gradient-to-r from-primary to-accent hover:opacity-90"
                disabled={loading}
              >
                {loading ? "Signing in…" : "Sign In"}
              </Button>
            </form>
            )}

            {/* Back to Home */}
            <button
              type="button"
              onClick={() => setLocation("/")}
              className="mt-5 w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              <Home className="w-4 h-4" />
              Back to Home
            </button>

            <p className="text-center text-xs text-muted-foreground mt-4">
              Authorized staff only. All activity is monitored.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

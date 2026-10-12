import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Eye, Loader2, Mail, RefreshCw, Send, XCircle,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminApi, type BulkEmailRecipients, type BulkEmailSource, type BulkEmailStatus,
} from "@/lib/adminApi";
import { RichTextEditor, isEditorEmpty } from "./RichTextEditor";

// Compose → preview → confirm → send, then live results with "Retry failed". Recipients are
// resolved on the server from the selected record ids; each address gets its own email.

type Props = {
  source: BulkEmailSource;
  ids: number[];
  onClose: () => void;
};

const SOURCE_LABEL: Record<BulkEmailSource, string> = { students: "students", members: "members" };
const POLL_MS = 1500;

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function SendEmailDialog({ source, ids, onClose }: Props) {
  const [recipients, setRecipients] = useState<BulkEmailRecipients | null>(null);
  const [loadError, setLoadError] = useState("");
  const [showRecipients, setShowRecipients] = useState(false);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<{ subject?: string; body?: string; send?: string }>({});

  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<BulkEmailStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  // One id per compose session: a repeated submission returns the original send.
  const requestId = useRef(newRequestId());

  useEffect(() => {
    let cancelled = false;
    adminApi.bulkEmail.recipients(source, ids)
      .then(result => { if (!cancelled) setRecipients(result); })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load recipients."); });
    return () => { cancelled = true; };
  }, [source, ids]);

  // Follow delivery until it finishes.
  useEffect(() => {
    if (status?.status !== "sending") return;
    const timer = window.setTimeout(() => {
      adminApi.bulkEmail.status(status.id).then(setStatus).catch(() => { /* keep polling */ });
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const recipientCount = recipients?.recipientCount ?? 0;
  const canSend = recipientCount > 0 && !submitting;

  function validate(): boolean {
    const next = {
      subject: subject.trim() ? "" : "Enter a subject.",
      body: isEditorEmpty(body) ? "Enter a message." : "",
    };
    setErrors(next);
    return !next.subject && !next.body;
  }

  async function showPreview() {
    if (!validate()) return;
    setPreviewLoading(true);
    try {
      const preview = await adminApi.bulkEmail.preview(subject, body);
      setPreviewHtml(preview.html);
    } catch (err) {
      setErrors(prev => ({ ...prev, send: err instanceof Error ? err.message : "Could not show the preview." }));
    } finally {
      setPreviewLoading(false);
    }
  }

  function requestSend() {
    if (!validate() || !canSend) return;
    setConfirming(true);
  }

  async function send() {
    if (submitting) return;
    setSubmitting(true);
    setErrors({});
    try {
      const result = await adminApi.bulkEmail.send({ source, ids, subject, html: body, requestId: requestId.current });
      setStatus(result);
      setConfirming(false);
    } catch (err) {
      setConfirming(false);
      setErrors({ send: err instanceof Error ? err.message : "Could not send the email." });
    } finally {
      setSubmitting(false);
    }
  }

  async function retryFailed() {
    if (!status || retrying) return;
    setRetrying(true);
    try {
      setStatus(await adminApi.bulkEmail.retry(status.id));
    } catch (err) {
      setErrors({ send: err instanceof Error ? err.message : "Could not retry the failed recipients." });
    } finally {
      setRetrying(false);
    }
  }

  const skippedText = useMemo(() => {
    if (!recipients) return "";
    const parts = [];
    if (recipients.duplicateCount) parts.push(`${recipients.duplicateCount} duplicate${recipients.duplicateCount === 1 ? "" : "s"} merged`);
    if (recipients.missingCount) parts.push(`${recipients.missingCount} without a valid email`);
    if (recipients.notFoundCount) parts.push(`${recipients.notFoundCount} no longer on file`);
    return parts.join(" · ");
  }, [recipients]);

  return (
    <Dialog open onOpenChange={open => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto" data-testid="dialog-send-email">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Send Email</DialogTitle>
          <DialogDescription>
            {status
              ? "Each recipient receives a separate email, so no one sees another recipient's address."
              : `To the ${source === "students" ? "primary parents of the selected students" : "selected members"}.`}
          </DialogDescription>
        </DialogHeader>

        {/* ── Results ── */}
        {status ? (
          <div className="space-y-4" data-testid="email-results">
            <p className="text-sm text-secondary"><span className="font-semibold">Subject:</span> {status.subject}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <Stat label="Sent" value={status.sentCount} tone="green" testId="text-sent-count" />
              <Stat label="Failed" value={status.failedCount} tone="red" testId="text-failed-count" />
              <Stat label="Skipped" value={status.skippedCount} tone="gray" testId="text-skipped-count" />
              <Stat label="Sending" value={status.pendingCount} tone="blue" testId="text-pending-count" />
            </div>
            {status.status === "sending" && (
              <p className="flex items-center gap-2 text-sm text-blue-800"><Loader2 className="h-4 w-4 animate-spin" />
                Sending… You can close this window; delivery continues.</p>
            )}
            {status.status === "sent" && (
              <p className="flex items-center gap-2 text-sm text-green-800"><CheckCircle2 className="h-4 w-4" />
                Sent to all {status.sentCount} recipient{status.sentCount === 1 ? "" : "s"}.</p>
            )}
            {status.skippedCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Skipped: {status.duplicateCount} duplicate address{status.duplicateCount === 1 ? "" : "es"} (sent once) and {status.missingCount} record{status.missingCount === 1 ? "" : "s"} without a valid email.
              </p>
            )}
            {status.failures.length > 0 && status.status !== "sending" && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2">
                <p className="text-sm font-semibold text-red-800">Not delivered</p>
                <ul className="max-h-40 overflow-y-auto space-y-1 text-xs text-red-800">
                  {status.failures.map(failure => (
                    <li key={failure.email}><span className="font-medium">{failure.email}</span>{failure.names ? ` (${failure.names})` : ""}: {failure.error}</li>
                  ))}
                </ul>
                <Button size="sm" variant="outline" onClick={retryFailed} disabled={retrying} className="gap-1.5" data-testid="button-retry-failed">
                  {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Retry {status.failedCount} failed
                </Button>
                <p className="text-xs text-red-700">Successful recipients are not emailed again.</p>
              </div>
            )}
            {errors.send && <p className="text-sm text-red-700" role="alert">{errors.send}</p>}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ── Recipients ── */}
            <div className="rounded-xl border border-border bg-gray-50 p-3 text-sm" data-testid="email-recipients">
              {loadError ? (
                <p className="text-red-700" role="alert">{loadError}</p>
              ) : !recipients ? (
                <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Finding email addresses…</p>
              ) : (
                <>
                  <p className="text-secondary">
                    <span className="font-semibold" data-testid="text-recipient-count">{recipients.recipientCount}</span> unique recipient{recipients.recipientCount === 1 ? "" : "s"} from {recipients.selectedCount} selected {SOURCE_LABEL[source]}
                  </p>
                  {skippedText && <p className="mt-0.5 text-xs text-amber-800" data-testid="text-skipped-summary">{skippedText}</p>}
                  {recipients.recipientCount === 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-red-700" role="alert">
                      <AlertCircle className="h-4 w-4" /> None of the selected records has a valid email address.
                    </p>
                  )}
                  {(recipients.recipients.length > 0 || recipients.missing.length > 0) && (
                    <button type="button" onClick={() => setShowRecipients(v => !v)}
                      className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      {showRecipients ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      {showRecipients ? "Hide" : "Show"} recipients
                    </button>
                  )}
                  {showRecipients && (
                    <div className="mt-2 max-h-44 overflow-y-auto space-y-1 text-xs">
                      {recipients.recipients.map(r => (
                        <p key={r.email} className="text-secondary"><span className="font-medium">{r.email}</span> <span className="text-muted-foreground">— {r.names.join(", ")}</span></p>
                      ))}
                      {recipients.missing.map(m => (
                        <p key={`missing-${m.id}`} className="text-amber-800">{m.name} — no valid email (excluded)</p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Message ── */}
            <div className="space-y-1.5">
              <label htmlFor="email-subject" className="text-sm font-medium text-secondary">Subject <span className="text-red-500">*</span></label>
              <Input
                id="email-subject"
                value={subject}
                maxLength={200}
                onChange={event => { setSubject(event.target.value); setErrors(prev => ({ ...prev, subject: "" })); setPreviewHtml(null); }}
                placeholder="e.g. Gurukul classes resume this Sunday"
                aria-invalid={!!errors.subject}
                className={errors.subject ? "border-red-400" : ""}
                data-testid="input-email-subject"
              />
              {errors.subject && <p className="text-xs text-red-600" role="alert">{errors.subject}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="email-body" className="text-sm font-medium text-secondary">Message <span className="text-red-500">*</span></label>
              <RichTextEditor
                id="email-body"
                value={body}
                onChange={html => { setBody(html); setErrors(prev => ({ ...prev, body: "" })); setPreviewHtml(null); }}
                placeholder="Write your message…"
                invalid={!!errors.body}
              />
              {errors.body && <p className="text-xs text-red-600" role="alert">{errors.body}</p>}
            </div>

            {/* ── Preview ── */}
            {previewHtml && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-secondary">Preview</p>
                {/* Sandboxed: the preview cannot run scripts or navigate this page. */}
                <iframe title="Email preview" sandbox="" srcDoc={previewHtml}
                  className="h-72 w-full rounded-xl border border-border bg-white" data-testid="frame-email-preview" />
              </div>
            )}

            {errors.send && <p className="text-sm text-red-700" role="alert">{errors.send}</p>}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button variant="outline" onClick={showPreview} disabled={previewLoading} className="gap-1.5" data-testid="button-email-preview">
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Preview
              </Button>
              <Button onClick={requestSend} disabled={!canSend} className="gap-1.5" data-testid="button-email-send">
                <Send className="h-4 w-4" /> Send Email
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Final confirmation ── */}
        <AlertDialog open={confirming} onOpenChange={open => { if (!submitting) setConfirming(open); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Send to {recipientCount} recipient{recipientCount === 1 ? "" : "s"}?</AlertDialogTitle>
              <AlertDialogDescription>
                “{subject.trim()}” will be emailed separately to {recipientCount} unique address{recipientCount === 1 ? "" : "es"}.
                {skippedText ? ` Skipped: ${skippedText}.` : ""} This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Go back</AlertDialogCancel>
              <AlertDialogAction
                onClick={event => { event.preventDefault(); void send(); }}
                disabled={submitting}
                data-testid="button-confirm-send"
              >
                {submitting ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Sending…</> : `Send ${recipientCount} email${recipientCount === 1 ? "" : "s"}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone, testId }: { label: string; value: number; tone: "green" | "red" | "gray" | "blue"; testId: string }) {
  const tones = {
    green: "bg-green-50 text-green-800 border-green-200",
    red: "bg-red-50 text-red-800 border-red-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
    blue: "bg-blue-50 text-blue-800 border-blue-200",
  };
  const Icon = tone === "green" ? CheckCircle2 : tone === "red" ? XCircle : null;
  return (
    <div className={`rounded-xl border p-2 ${tones[tone]}`}>
      <p className="text-xl font-bold flex items-center justify-center gap-1" data-testid={testId}>{Icon && <Icon className="h-4 w-4" />}{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}

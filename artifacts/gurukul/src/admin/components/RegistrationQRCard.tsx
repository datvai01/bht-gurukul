import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Download, Copy, Check, QrCode } from "lucide-react";

export function RegistrationQRCard() {
  const registrationUrl = `${window.location.origin}/gurukul/register`;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);

  function handleDownload() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "gurukul-registration-qr.png";
    a.click();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(registrationUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm p-6">
      <div className="flex items-center gap-2 mb-5">
        <QrCode className="w-4 h-4 text-primary" />
        <h3 className="font-bold text-secondary">Registration QR Code</h3>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="shrink-0 p-3 bg-white border-2 border-border rounded-xl shadow-inner">
          <QRCodeCanvas
            ref={canvasRef}
            value={registrationUrl}
            size={180}
            level="M"
            includeMargin={false}
          />
        </div>

        <div className="flex-1 min-w-0 space-y-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Registration Link</p>
            <p className="text-xs text-secondary break-all font-mono bg-gray-50 border border-border rounded-lg px-3 py-2 leading-relaxed">
              {registrationUrl}
            </p>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            Share this QR code at temple events or on bulletin boards so parents can register students directly from their phones.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download PNG
            </button>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-secondary hover:bg-gray-50 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

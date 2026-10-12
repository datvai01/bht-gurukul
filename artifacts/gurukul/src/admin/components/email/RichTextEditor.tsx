import { useEffect, useRef } from "react";
import { Bold, Italic, Underline, List, ListOrdered, Link2, RemoveFormatting } from "lucide-react";

// Basic formatting editor for emails. The server sanitizes the HTML before anything is sent,
// so this only needs to offer the formats the server keeps (bold, italic, underline, lists, links).

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  invalid?: boolean;
  id?: string;
};

const TOOLS = [
  { command: "bold", icon: Bold, label: "Bold" },
  { command: "italic", icon: Italic, label: "Italic" },
  { command: "underline", icon: Underline, label: "Underline" },
  { command: "insertUnorderedList", icon: List, label: "Bulleted list" },
  { command: "insertOrderedList", icon: ListOrdered, label: "Numbered list" },
] as const;

export function isEditorEmpty(html: string): boolean {
  const div = document.createElement("div");
  div.innerHTML = html;
  return !div.textContent?.trim();
}

export function RichTextEditor({ value, onChange, placeholder, invalid, id }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Only push outside changes (such as a reset) into the editor, so typing keeps the cursor.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value;
  }, [value]);

  function run(command: string, argument?: string) {
    ref.current?.focus();
    document.execCommand(command, false, argument);
    onChange(ref.current?.innerHTML ?? "");
  }

  function addLink() {
    const url = window.prompt("Link address (https://… or mailto:…)", "https://");
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(url.trim())) {
      window.alert("Enter a link that starts with https://, http:// or mailto:");
      return;
    }
    run("createLink", url.trim());
  }

  const empty = isEditorEmpty(value);

  return (
    <div className={`rounded-xl border bg-white ${invalid ? "border-red-400" : "border-input"} focus-within:ring-2 focus-within:ring-ring`}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1" role="toolbar" aria-label="Formatting">
        {TOOLS.map(tool => (
          <button
            key={tool.command}
            type="button"
            title={tool.label}
            aria-label={tool.label}
            // Keep the text selection in the editor when a toolbar button is pressed.
            onMouseDown={event => event.preventDefault()}
            onClick={() => run(tool.command)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-gray-100 hover:text-secondary"
          >
            <tool.icon className="h-4 w-4" />
          </button>
        ))}
        <button type="button" title="Insert link" aria-label="Insert link" onMouseDown={event => event.preventDefault()} onClick={addLink}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-gray-100 hover:text-secondary">
          <Link2 className="h-4 w-4" />
        </button>
        <button type="button" title="Clear formatting" aria-label="Clear formatting" onMouseDown={event => event.preventDefault()}
          onClick={() => run("removeFormat")}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-gray-100 hover:text-secondary">
          <RemoveFormatting className="h-4 w-4" />
        </button>
      </div>
      <div className="relative">
        {empty && placeholder && (
          <p className="pointer-events-none absolute left-3 top-2.5 text-sm text-muted-foreground">{placeholder}</p>
        )}
        <div
          id={id}
          ref={ref}
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-invalid={invalid || undefined}
          suppressContentEditableWarning
          onInput={() => onChange(ref.current?.innerHTML ?? "")}
          // Pasted content arrives as plain text so outside styles do not leak into the email.
          onPaste={event => {
            event.preventDefault();
            document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          }}
          className="min-h-[180px] max-h-[320px] overflow-y-auto px-3 py-2.5 text-sm text-secondary outline-none [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-primary [&_a]:underline"
        />
      </div>
    </div>
  );
}

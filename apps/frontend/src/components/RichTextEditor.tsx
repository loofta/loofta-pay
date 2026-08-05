"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import EmojiPicker, { EmojiClickData, Theme } from "emoji-picker-react";
import { Bold, Italic, Strikethrough, Underline, Link2, Smile, Eye, Pencil } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormattedText } from "@/components/FormattedText";
import { cn } from "@/lib/utils";

/** Small rich-text editor for short user-entered text (giveaway descriptions, etc.) — a plain
 *  textarea with a formatting toolbar that wraps the current selection in markdown syntax (bold,
 *  italic, strikethrough, links) or a sanitized raw <u> tag (underline has no markdown syntax),
 *  plus an emoji picker. Pairs with FormattedText.tsx, which safely renders the result back out.
 *  Deliberately not a contentEditable WYSIWYG — that class of editor is far more state to get
 *  right (cursor/undo/paste) for what's meant to stay a "small" editor.
 *
 *  The textarea's rendered value is local state, not the `value` prop directly — the caller here
 *  (the giveaway create wizard) backs its draft with a TanStack Query cache + localStorage
 *  write-through on every keystroke, and feeding that round-tripped value straight back into the
 *  textarea's `value` was resetting the caret to the end on every character typed, not just
 *  toolbar actions. Local state renders synchronously off the actual keystroke, so the cursor
 *  follows normal (correct) controlled-input behavior regardless of how slow or laggy the
 *  external store's own round trip is; the `value` prop is only pulled back in when it changes
 *  for a reason other than this component's own last `onChange` call (e.g. draft cleared on
 *  submit, or switching between two different giveaways reusing the same mounted editor). */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  maxLength,
  rows = 6,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  className?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const lastEmitted = useRef(value);
  const [preview, setPreview] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setLocalValue(value);
      lastEmitted.current = value;
    }
  }, [value]);

  const emit = useCallback((next: string) => {
    lastEmitted.current = next;
    setLocalValue(next);
    onChange(next);
  }, [onChange]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    emit(e.target.value);
  }, [emit]);

  // Toolbar actions splice the string from outside a normal typing event, so (unlike plain
  // typing, which the browser positions correctly on its own) the resulting cursor position has
  // to be set explicitly, after the textarea re-renders with the new local value.
  const wrapSelection = useCallback((before: string, after: string = before) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = localValue.slice(start, end);
    const next = localValue.slice(0, start) + before + selected + after + localValue.slice(end);
    const cursor = selected
      ? { start: start + before.length, end: start + before.length + selected.length }
      : { start: start + before.length, end: start + before.length };
    emit(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(cursor.start, cursor.end); });
  }, [localValue, emit]);

  const insertAtCursor = useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = localValue.slice(0, start) + text + localValue.slice(end);
    const cursor = start + text.length;
    emit(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(cursor, cursor); });
  }, [localValue, emit]);

  const insertLink = useCallback(() => {
    const url = linkUrl.trim();
    if (!url) return;
    const el = textareaRef.current;
    const selected = el ? localValue.slice(el.selectionStart, el.selectionEnd) : "";
    const markdown = `[${selected || "link"}](${url})`;
    if (el) {
      const start = el.selectionStart;
      emit(localValue.slice(0, start) + markdown + localValue.slice(el.selectionEnd));
    } else {
      emit(localValue + markdown);
    }
    setLinkUrl("");
    setLinkOpen(false);
  }, [linkUrl, localValue, emit]);

  const toolbarButtonClass = "p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors";

  return (
    <div className={cn("rounded-xl border border-white/10 bg-white/5 overflow-hidden", className)}>
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-white/10">
        <button type="button" onClick={() => wrapSelection("**")} className={toolbarButtonClass} aria-label="Bold">
          <Bold className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => wrapSelection("*")} className={toolbarButtonClass} aria-label="Italic">
          <Italic className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => wrapSelection("~~")} className={toolbarButtonClass} aria-label="Strikethrough">
          <Strikethrough className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => wrapSelection("<u>", "</u>")} className={toolbarButtonClass} aria-label="Underline">
          <Underline className="w-4 h-4" />
        </button>

        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={toolbarButtonClass} aria-label="Add link">
              <Link2 className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 bg-[#17171a] border-white/10" align="start">
            <div className="space-y-2">
              <Input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); insertLink(); } }}
                placeholder="https://…"
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={insertLink}
                disabled={!linkUrl.trim()}
                className="w-full rounded-lg px-3 py-1.5 text-sm font-medium border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-40"
              >
                Add link
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button type="button" className={toolbarButtonClass} aria-label="Add emoji">
              <Smile className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-white/10 overflow-hidden" align="start">
            <EmojiPicker
              theme={Theme.DARK}
              onEmojiClick={(emoji: EmojiClickData) => { insertAtCursor(emoji.emoji); setEmojiOpen(false); }}
            />
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className={cn(toolbarButtonClass, "ml-auto flex items-center gap-1.5 text-sm font-medium")}
        >
          {preview ? <Pencil className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      {preview ? (
        <div className="px-3 py-2.5 text-base text-slate-300 leading-relaxed min-h-[8rem]">
          {localValue ? <FormattedText text={localValue} /> : <span className="text-slate-500">Nothing to preview yet</span>}
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          value={localValue}
          onChange={handleChange}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={rows}
          className="border-0 rounded-none bg-transparent focus-visible:ring-0 resize-none"
        />
      )}
    </div>
  );
}

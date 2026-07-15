'use client'

import { useEffect, useState, type CSSProperties } from "react";
import {
  EmailIcon,
  EmailShareButton,
  FacebookIcon,
  FacebookShareButton,
  TelegramIcon,
  TelegramShareButton,
  WhatsappIcon,
  WhatsappShareButton,
  XIcon,
  XShareButton,
} from "react-share";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Check, Copy, Instagram, MoreHorizontal, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";

// react-share's buttons apply their own inline `color: inherit` (to normalize native <button>
// styling). Inline styles always win over Tailwind classes, so `text-white/80` alone is
// silently ignored on those buttons — the color has to be passed via `style`, which react-share
// merges on top of its own default and therefore actually takes effect.
const OPTION_TEXT_STYLE: CSSProperties = { color: "rgba(255,255,255,0.8)" };

// Every option (icon + label) gets a fixed height so rows stay aligned even when a longer label
// ("WhatsApp", "Instagram") wraps to two lines while its neighbors ("X", "Email") stay on one.
const OPTION_CLASS =
  "flex w-full flex-col items-center justify-start gap-1.5 rounded-lg p-2 min-h-[78px] text-white/80 hover:bg-white/5 active:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#18181c]";
const OPTION_LABEL_CLASS = "text-sm leading-tight text-center";

/** Round icon wrapper for options without a react-share icon (Instagram, Copy, More). */
function OptionGlyph({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10", className)}>
      {children}
    </span>
  );
}

/**
 * Share sheet for a claim link — replaces relying on `navigator.share` alone (native share is
 * unavailable on desktop browsers and, even on mobile, buries the specific apps recipients
 * actually use). Offers direct share targets plus native share ("More") when supported.
 */
export function ShareLinkMenu({
  url,
  title,
  text,
  ogUrl,
  triggerClassName,
  triggerLabel = "Share",
  variant = "gradient",
}: {
  url: string;
  /** Subject-line-style summary (native share title, email subject). */
  title: string;
  /** Body copy shared alongside the link. */
  text: string;
  /** Explicit OG image URL to pre-warm. Defaults to the payment share route's
   *  `/api/share/:id/og` convention (derived from `url`'s last path segment) when omitted —
   *  pass this for any other OG route shape (e.g. `/api/gift/:id/og`). */
  ogUrl?: string;
  triggerClassName?: string;
  triggerLabel?: string;
  /** "gradient" (default): bold labeled CTA — use for a single, prominent share action.
   *  "subtle": icon-only outline button matching muted list-row actions (e.g. a copy-link
   *  button beside it) — use when this trigger repeats once per row in a list, where the
   *  gradient pill reads as visual noise when stacked. */
  variant?: "gradient" | "subtle";
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  // Pre-warm the OG image the moment this share UI appears (i.e. right when the payment
  // succeeds) rather than waiting for a link-preview crawler to trigger cold generation under
  // its own tight timeout. Cold rendering measured ~1.7-3s in production — fine for a person
  // sharing a few seconds later, but a real gamble against X's crawler timeout specifically
  // (WhatsApp's is more lenient, which is why it showed the thumbnail when X didn't). Fire-and-
  // forget: failures here just mean the crawler falls back to generating it itself.
  useEffect(() => {
    try {
      if (ogUrl) {
        fetch(ogUrl).catch(() => {});
        return;
      }
      const shortId = new URL(url).pathname.split("/").filter(Boolean).pop();
      if (shortId) {
        const defaultOgUrl = `${new URL(url).origin}/api/share/${shortId}/og`;
        fetch(defaultOgUrl).catch(() => {});
      }
    } catch {
      // url wasn't a valid absolute URL — nothing to pre-warm
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: "Link copied" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ variant: "destructive", title: "Copy failed" });
    }
  };

  const handleCopyOption = async () => {
    await copyLink();
    setOpen(false);
  };

  // Instagram has no web share intent for posts or DMs — the practical flow is to copy the
  // link and, on mobile, jump straight to the DM inbox so the user can paste it.
  const handleInstagram = async () => {
    await copyLink();
    toast({ title: "Link copied", description: "Paste it into an Instagram DM." });
    setOpen(false);
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      window.location.href = "instagram://direct/inbox";
    }
  };

  const handleNativeShare = async () => {
    setOpen(false);
    try {
      await navigator.share({ title, text, url });
    } catch {
      // user cancelled the native sheet — nothing to recover
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {variant === "subtle" ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={cn("shrink-0 bg-transparent border-white/10 text-slate-300 hover:bg-white/10 hover:text-white", triggerClassName)}
            title={triggerLabel}
          >
            <Share2 className="h-4 w-4" />
            <span className="sr-only">{triggerLabel}</span>
          </Button>
        ) : (
          <Button
            type="button"
            className={cn(
              "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-6 py-3 text-white font-semibold hover:opacity-90 shrink-0",
              triggerClassName,
            )}
          >
            <Share2 className="h-5 w-5" />
            {triggerLabel}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        collisionPadding={16}
        className="w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-white/10 bg-[#18181c] p-3 shadow-xl"
      >
        <p className="mb-2 px-1 text-sm text-white/50">Share via</p>
        <div className="grid grid-cols-3 gap-1">
          <XShareButton
            url={url}
            title={text}
            beforeOnClick={() => setOpen(false)}
            className={OPTION_CLASS}
            style={OPTION_TEXT_STYLE}
          >
            <XIcon round size={40} />
            <span className={OPTION_LABEL_CLASS}>X</span>
          </XShareButton>
          <WhatsappShareButton
            url={url}
            title={text}
            beforeOnClick={() => setOpen(false)}
            className={OPTION_CLASS}
            style={OPTION_TEXT_STYLE}
          >
            <WhatsappIcon round size={40} />
            <span className={OPTION_LABEL_CLASS}>WhatsApp</span>
          </WhatsappShareButton>
          <TelegramShareButton
            url={url}
            title={text}
            beforeOnClick={() => setOpen(false)}
            className={OPTION_CLASS}
            style={OPTION_TEXT_STYLE}
          >
            <TelegramIcon round size={40} />
            <span className={OPTION_LABEL_CLASS}>Telegram</span>
          </TelegramShareButton>
          <FacebookShareButton
            url={url}
            beforeOnClick={() => setOpen(false)}
            className={OPTION_CLASS}
            style={OPTION_TEXT_STYLE}
          >
            <FacebookIcon round size={40} />
            <span className={OPTION_LABEL_CLASS}>Facebook</span>
          </FacebookShareButton>
          <button type="button" onClick={handleInstagram} className={OPTION_CLASS}>
            <OptionGlyph className="bg-gradient-to-tr from-[#FEDA75] via-[#D62976] to-[#4F5BD5]">
              <Instagram className="h-5 w-5 text-white" aria-hidden />
            </OptionGlyph>
            <span className={OPTION_LABEL_CLASS}>Instagram</span>
          </button>
          <EmailShareButton
            url={url}
            subject={title}
            body={text}
            beforeOnClick={() => setOpen(false)}
            className={OPTION_CLASS}
            style={OPTION_TEXT_STYLE}
          >
            <EmailIcon round size={40} />
            <span className={OPTION_LABEL_CLASS}>Email</span>
          </EmailShareButton>
          <button type="button" onClick={handleCopyOption} className={OPTION_CLASS}>
            <OptionGlyph>
              {copied ? <Check className="h-5 w-5 text-green-400" aria-hidden /> : <Copy className="h-5 w-5" aria-hidden />}
            </OptionGlyph>
            <span className={OPTION_LABEL_CLASS}>Copy link</span>
          </button>
          {canNativeShare && (
            <button type="button" onClick={handleNativeShare} className={OPTION_CLASS}>
              <OptionGlyph>
                <MoreHorizontal className="h-5 w-5" aria-hidden />
              </OptionGlyph>
              <span className={OPTION_LABEL_CLASS}>More</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

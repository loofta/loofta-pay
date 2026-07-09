'use client';

// A note/description that may have a GIF URL appended to it (see MessageInput) — splits the
// two back apart for display. Shared by claim pages so the GIF-in-note behavior from the send
// flow renders identically everywhere it appears (payment claims, gift claims, gift share cards).
const GIF_REGEX = /(https?:\/\/(?:[^\s/]+\.)?(?:giphy\.com|tenor\.com|gfycat\.com)\/[^\s]*)/gi;

export function DescriptionWithGif({ text }: { text?: string | null }) {
  if (!text?.trim()) return null;
  const gifMatch = text.match(GIF_REGEX);
  const gifUrl = gifMatch ? gifMatch[0] : null;
  const textOnly = text.replace(GIF_REGEX, '').replace(/\s+/g, ' ').trim();

  let resolvedGifUrl = gifUrl;
  if (gifUrl?.includes('giphy.com') && !gifUrl.endsWith('.gif')) {
    const m = gifUrl.match(/giphy\.com\/media\/([^/]+)/);
    resolvedGifUrl = m
      ? `https://media.giphy.com/media/${m[1]}/giphy.gif`
      : gifUrl.replace(/\/$/, '') + '.gif';
  }

  return (
    <div className="space-y-3">
      {textOnly && (
        <div className="relative pl-5 pr-4 py-4 rounded-xl bg-white/[0.06] overflow-hidden">
          <span className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-[#FF1301] to-[#EAB308]" />
          <span className="absolute top-1 left-4 text-4xl font-serif text-white/10 select-none leading-none">&quot;</span>
          <p className="relative text-lg font-medium text-white italic leading-relaxed pl-3">{textOnly}</p>
        </div>
      )}
      {resolvedGifUrl && (
        <div className="rounded-xl overflow-hidden border border-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element -- GIF URLs from user message; remote patterns vary */}
          <img
            src={resolvedGifUrl}
            alt="GIF"
            className="w-full h-auto block"
            style={{ maxHeight: '220px', objectFit: 'cover' }}
          />
        </div>
      )}
    </div>
  );
}

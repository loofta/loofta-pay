import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";

/** Open Graph / LinkedIn (1.91:1) */
const SIZE_OG = { width: 1200, height: 630 };
/** X (Twitter) large image card (~2:1) */
const SIZE_TWITTER = { width: 1200, height: 600 };

const TAGLINE = "Send & Receive Private Payments.";

/** Same Fontshare files as `globals.css` (Clash Display 500, Clash Grotesk 600). */
const FONT_CLASH_DISPLAY_500 =
  "https://cdn.fontshare.com/wf/2GQIT54GKQY3JRFTSHS4ARTRNRQISSAA/3CIP5EBHRRHE5FVQU3VFROPUERNDSTDF/JTSL5QESUXATU47LCPUNHZQBDDIWDOSW.ttf";
const FONT_CLASH_GROTESK_600 =
  "https://cdn.fontshare.com/wf/MKEEQN57GWBZOSYWCRODNJOOZNPLMAKN/5SPTSZGHEACWWLF34DQ4WAA4OGU6PQIF/KN7DX4F6PXB74R6L2K2Y4NH3CB7FC53Q.ttf";

/**
 * Matches `MinimalHeader` → `LooftaPayLogoLink` placement; “pay” is solid brand orange (Satori: no inline-block, gradient text unreliable).
 */
const HEADER_LOGO_H = 36;
const HEADER_PAY_FONT_PX = 14;
const HEADER_PAY_TOP_PX = -14;
const HEADER_PAY_RIGHT_PX = -20;

async function loadFontData(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load font: ${url} (${res.status})`);
  }
  return res.arrayBuffer();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const variant = searchParams.get("variant") ?? "og";
  const isTwitter = variant === "twitter" || variant === "x";
  const { width, height } = isTwitter ? SIZE_TWITTER : SIZE_OG;

  const [logoBuffer, clashDisplay, clashGrotesk600] = await Promise.all([
    readFile(join(process.cwd(), "public", "loofta.svg")),
    loadFontData(FONT_CLASH_DISPLAY_500),
    loadFontData(FONT_CLASH_GROTESK_600),
  ]);

  const logoSrc = `data:image/svg+xml;base64,${logoBuffer.toString("base64")}`;

  const logoH = isTwitter ? 64 : 72;
  const scale = logoH / HEADER_LOGO_H;
  const logoW = Math.round((179 / 50) * logoH);
  const payFontSize = Math.round(HEADER_PAY_FONT_PX * scale);
  const payTop = HEADER_PAY_TOP_PX * scale;
  const payRight = HEADER_PAY_RIGHT_PX * scale;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f0f12",
          padding: 48,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: isTwitter ? 28 : 36,
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              width: logoW,
              height: logoH,
            }}
          >
            <img
              src={logoSrc}
              alt=""
              height={logoH}
              width={logoW}
              style={{ display: "flex", objectFit: "contain" }}
            />
            <span
              style={{
                position: "absolute",
                display: "flex",
                alignItems: "flex-end",
                top: payTop,
                right: payRight,
                paddingLeft: Math.round(4 * scale),
                paddingRight: Math.round(4 * scale),
                paddingTop: Math.round(2 * scale),
                paddingBottom: Math.round(2 * scale),
                fontSize: payFontSize,
                fontWeight: 600,
                fontFamily: "Clash Grotesk",
                letterSpacing: -0.02,
                lineHeight: 1,
                borderRadius: 9999,
                color: "#FF4A26",
              }}
            >
              pay
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            maxWidth: 920,
            textAlign: "center",
            fontSize: isTwitter ? 38 : 42,
            fontWeight: 500,
            lineHeight: 1.35,
            color: "rgba(245, 245, 247, 0.92)",
            fontFamily: "Clash Display",
            letterSpacing: -0.02,
          }}
        >
          {TAGLINE}
        </div>
      </div>
    ),
    {
      width,
      height,
      fonts: [
        {
          name: "Clash Display",
          data: clashDisplay,
          style: "normal",
          weight: 500,
        },
        {
          name: "Clash Grotesk",
          data: clashGrotesk600,
          style: "normal",
          weight: 600,
        },
      ],
    },
  );
}

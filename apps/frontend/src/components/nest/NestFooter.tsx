import { NestLogo } from "@/components/nest/NestLogo";

export function NestFooter({ dark, onToggleDark }: { dark: boolean; onToggleDark: () => void }) {
  return (
    <footer style={{ borderTop: "1px solid var(--line2)", marginTop: 56, padding: "32px var(--page-pad)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <NestLogo height={18} dark={dark} />
        <span style={{ fontSize: 13, color: "var(--ink3)" }}>© {new Date().getFullYear()} Loofta Nest</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 13, color: "var(--ink3)" }}>
        <a href="https://loofta.xyz" style={{ color: "var(--ink3)" }}>loofta.xyz</a>
        <a href="https://loofta.xyz/terms" style={{ color: "var(--ink3)" }}>Terms</a>
        <a href="https://loofta.xyz/privacy" style={{ color: "var(--ink3)" }}>Privacy</a>
        <button
          onClick={onToggleDark}
          aria-label="Toggle dark mode"
          style={{ border: "1px solid var(--line)", background: "transparent", borderRadius: 9999, padding: "6px 13px", cursor: "pointer", color: "var(--ink2)", fontSize: 12, fontWeight: 600 }}
        >
          {dark ? "Light mode" : "Dark mode"}
        </button>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink3)", maxWidth: 480, lineHeight: 1.5 }}>
        Tokenized stocks, not shares — provided by third-party issuers (Backed Finance, Backpack Securities). Not investment advice. Devnet demo only — no real money is at risk yet.
      </p>
    </footer>
  );
}

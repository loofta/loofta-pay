"use client";
import { clientApiBase } from "@/services/api/client";

import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { jetbrainsMono, manrope, sora } from "@/components/home-v4/fonts";
import template from "./spec-template.json";
import { SpecComponent } from "./specEngine";
import { RegionSelect } from "./RegionSelect";
import { RewardsDraftContext, type GiveawayDraft } from "./rewardsDraft";
import { GiveawayFundSheet } from "./GiveawayFundSheet";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import { useAuthStore } from "@/store/auth";

type SpecNode = { t: string; a: Record<string, string>; c: Array<SpecNode | string> };
type Scope = Record<string, unknown>;
type SpecGw = { tokQ?: string; prize?: string; tickets?: string; amount?: string; winners?: string | number; tasks?: unknown[] };
type SpecState = {
  gw?: SpecGw | null;
  mode?: string;
  reward?: string;
  raidTokQ?: string;
  scope?: string;
  xConnected?: boolean;
  xHandle?: string;
  tokHits?: unknown[] | null;
  tokStatus?: string;
  xPostsFor?: string;
  [key: string]: unknown;
};
type SpecInstance = {
  _privyHandle: string;
  state: SpecState;
  setState: (update: unknown) => void;
  componentDidMount: () => void;
  componentWillUnmount: () => void;
  renderVals: () => Scope;
};

const IMAGES: Record<string, string> = {
  "1ac1c4b2-ce57-406f-a26e-001273c631a5": "/images/loofta-rewards-logo.svg",
  "88291337-3169-4524-b973-656ec9a3678d": "/images/megapot-wordmark.svg",
};

const SKIP_ATTR = new Set(["hint-placeholder-count", "hint-placeholder-val", "style-hover"]);

const ATTR_NAME: Record<string, string> = {
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "sc-camel-view-box": "viewBox",
  "sc-camel-on-click": "onClick",
  "sc-camel-on-change": "onChange",
  "sc-camel-on-focus": "onFocus",
  inputmode: "inputMode",
  maxlength: "maxLength",
};

const FONTS = {
  sora: sora.style.fontFamily,
  body: manrope.style.fontFamily,
  mono: jetbrainsMono.style.fontFamily,
};

function lookup(expr: string, scope: Scope): unknown {
  if (expr === "true") return true;
  if (expr === "false") return false;
  let cur: unknown = scope;
  for (const part of expr.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function resolve(raw: string, scope: Scope): unknown {
  const whole = raw.match(/^\s*\{\{\s*(true|false|[A-Za-z_][\w.]*)\s*\}\}\s*$/);
  if (whole) return lookup(whole[1], scope);
  if (!raw.includes("{{")) return raw;
  return raw.replace(/\{\{\s*(true|false|[A-Za-z_][\w.]*)\s*\}\}/g, (_, expr: string) => {
    const value = lookup(expr, scope);
    if (value == null || typeof value === "object") return "";
    return String(value);
  });
}

function cssToReact(css: string): CSSProperties {
  const painted = css
    .replaceAll("font-family:'JetBrains Mono'", `font-family:${FONTS.mono}`)
    .replaceAll("font-family:Sora", `font-family:${FONTS.sora}`)
    .replaceAll("font-family:Manrope", `font-family:${FONTS.body}`);
  const style: Record<string, string> = {};
  let depth = 0;
  let buf = "";
  const decls: string[] = [];
  for (const ch of painted) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (ch === ";" && depth === 0) {
      decls.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) decls.push(buf);
  for (const decl of decls) {
    const split = decl.indexOf(":");
    if (split < 0) continue;
    const prop = decl.slice(0, split).trim();
    const value = decl.slice(split + 1).trim();
    if (!prop || !value) continue;
    const camel = prop.startsWith("--")
      ? prop
      : prop.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    style[camel] = value;
  }
  return style;
}

function SpecEl({
  tag,
  style,
  hover,
  domProps,
  children,
}: {
  tag: string;
  style?: CSSProperties;
  hover?: CSSProperties;
  domProps: Record<string, unknown>;
  children?: ReactNode;
}) {
  const [hot, setHot] = useState(false);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!hot) return;
    const move = (event: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) setHot(false);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [hot]);
  return createElement(
    tag,
    {
      ...domProps,
      ref: (node: HTMLElement | null) => {
        ref.current = node;
        const userRef = domProps.ref;
        if (typeof userRef === "function") userRef(node);
      },
      style: hot && hover ? { ...style, ...hover } : style,
      onMouseEnter: () => setHot(true),
      onMouseLeave: () => setHot(false),
      onMouseDown: (event: { preventDefault: () => void; currentTarget: { blur?: () => void } }) => {
        if (tag !== "button") return;
        event.preventDefault();
        event.currentTarget.blur?.();
      },
    },
    children,
  );
}

function renderNodes(nodes: Array<SpecNode | string>, scope: Scope, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((node, index) => {
    const rendered = renderNode(node, scope, `${key}.${index}`);
    if (Array.isArray(rendered)) out.push(...rendered);
    else if (rendered != null && rendered !== "") out.push(rendered);
  });
  return out;
}

const LOGIN_METHODS = ["email", "twitter", "discord", "github"] as const;

function HeaderLogin() {
  const { authenticated, login, user } = usePrivy();
  const handle = user?.twitter?.username?.replace(/^@/, "");
  const label = !authenticated ? "Sign in" : handle ? `@${handle}` : "Account";
  return (
    <button
      type="button"
      onClick={() => {
        if (authenticated) {
          window.location.href = "/app";
          return;
        }
        login({ loginMethods: [...LOGIN_METHODS], disableSignup: false });
      }}
      style={{
        flexShrink: 0,
        padding: "8px 16px",
        borderRadius: 999,
        background: "#F2EFE8",
        color: "#0B0B0E",
        fontWeight: 700,
        fontSize: 14,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

function renderNode(node: SpecNode | string, scope: Scope, key: string): ReactNode {
  if (typeof node === "string") return resolve(node, scope) as string;
  if (node.t === "x-region-select") return <RegionSelect key={key} />;
  if (node.t === "x-header-login") return <HeaderLogin key={key} />;

  if (node.t === "sc-for") {
    const list = resolve(node.a.list || "", scope);
    const as = node.a.as;
    if (!Array.isArray(list) || !as) return null;
    return list.flatMap((item, index) =>
      renderNodes(node.c, { ...scope, [as]: item }, `${key}.${index}`),
    );
  }

  if (node.t === "sc-if") {
    if (!resolve(node.a.value || "", scope)) return null;
    return renderNodes(node.c, scope, key);
  }

  const domProps: Record<string, unknown> = { key };
  let style: CSSProperties | undefined;
  let hover: CSSProperties | undefined;

  for (const [name, raw] of Object.entries(node.a)) {
    if (SKIP_ATTR.has(name)) continue;
    const value = resolve(raw, scope);
    if (name === "style") {
      if (typeof value === "string" && value) style = cssToReact(value);
      continue;
    }
    if (name === "src" && typeof value === "string") {
      domProps.src = IMAGES[value] || value;
      continue;
    }
    if (name === "ref") {
      if (typeof value === "function") domProps.ref = value;
      continue;
    }
    const prop = ATTR_NAME[name] || name;
    if (prop === "onClick" || prop === "onChange" || prop === "onFocus") {
      if (typeof value === "function") domProps[prop] = value;
      continue;
    }
    if ((node.t === "input" || node.t === "textarea") && prop === "value") {
      domProps.value = value == null ? "" : String(value);
      continue;
    }
    if (value != null && typeof value !== "object") domProps[prop] = value;
  }

  if (node.a["style-hover"]) {
    const hoverValue = resolve(node.a["style-hover"], scope);
    if (typeof hoverValue === "string" && hoverValue) hover = cssToReact(hoverValue);
  }

  if (node.t === "button" && domProps.type == null) domProps.type = "button";

  if (node.t === "img") {
    const src = typeof domProps.src === "string" ? domProps.src : "";
    if (src.includes("/api/giveaways/token-icon")) {
      return (
        <img
          key={key}
          src={src}
          alt=""
          style={style}
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      );
    }
  }

  const voidTag = node.t === "img" || node.t === "input" || node.t === "br" || node.t === "hr";
  const children = voidTag ? undefined : renderNodes(node.c, scope, key);
  const childArg = children && children.length > 0 ? children : undefined;
  if (hover) {
    return (
      <SpecEl
        key={key}
        tag={node.t}
        style={style}
        hover={hover}
        domProps={domProps}
        children={childArg}
      />
    );
  }
  return createElement(node.t, { ...domProps, style }, childArg);
}

const SPEC = template as unknown as SpecNode[];

function linkedXHandle(user: { twitter?: { username?: string | null }; linkedAccounts?: Array<{ type?: string; username?: string | null }> } | null): string {
  const direct = user?.twitter?.username;
  if (direct) return direct.replace(/^@/, "");
  const linked = user?.linkedAccounts?.find((a) => a.type === "twitter_oauth" || a.type === "twitter" || a.type === "x");
  return linked?.username ? linked.username.replace(/^@/, "") : "";
}

function walletNeed(gw: { prize?: string; tickets?: string; amount?: string; winners?: string | number; tasks?: unknown[] } | null | undefined): { prize: number; fee: number; ready: boolean } {
  const winners = Math.min(500, Math.max(1, parseInt(String(gw?.winners ?? ""), 10) || 1));
  const prize = gw?.prize === "tickets"
    ? (parseInt(String(gw.tickets ?? ""), 10) || 0) * winners
    : (parseFloat(String(gw?.amount ?? "")) || 0);
  const fee = prize > 0 ? Math.max(5, prize * 0.1) : 0;
  return { prize, fee, ready: prize > 0 && Array.isArray(gw?.tasks) && gw.tasks.length > 0 };
}

export function RewardsRail() {
  const { user, authenticated, login } = usePrivy();
  const [fundOpen, setFundOpen] = useState(false);
  const [awaitingLogin, setAwaitingLogin] = useState(false);
  const networkMode = useAuthStore((s) => s.networkMode);
  const { balanceUSD } = useEmbeddedSolanaUsdcBalance({ enabled: authenticated });
  const solanaAddress = deriveSolanaEmbeddedAddress(user ?? null);
  const inst = useRef<SpecInstance | null>(null);
  if (!inst.current) inst.current = new SpecComponent() as unknown as SpecInstance;
  inst.current._privyHandle = linkedXHandle(user);
  const [, bump] = useState(0);
  const tokQ = String(inst.current.state.gw?.tokQ || "");
  const tokPrize = String(inst.current.state.gw?.prize || "");
  const specMode = String(inst.current.state.mode || "oneoff");
  const raidReward = String(inst.current.state.reward || "");
  const raidTokQ = String(inst.current.state.raidTokQ || "");
  const tokQueryRef = useRef("");
  const raidScope = String(inst.current.state.scope || "");
  const raidConnected = Boolean(inst.current.state.xConnected);
  const raidHandle = String(inst.current.state.xHandle || inst.current._privyHandle || "looftaxyz").replace(/^@/, "");
  const postsInflight = useRef("");

  inst.current.setState = (update: unknown) => {
    const current = inst.current;
    if (!current) return;
    const prev = current.state;
    const partial = typeof update === "function" ? update(prev) : update;
    current.state = { ...prev, ...partial };
    bump((n) => n + 1);
  };

  useEffect(() => {
    const current = inst.current;
    if (!current) return;
    current.componentDidMount();
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlBg: html.style.background,
      bodyBg: body.style.background,
      bodyColor: body.style.color,
    };
    html.style.background = "#0B0B0E";
    body.style.background = "#0B0B0E";
    body.style.color = "#F2EFE8";
    return () => {
      current.componentWillUnmount();
      html.style.background = prev.htmlBg;
      body.style.background = prev.bodyBg;
      body.style.color = prev.bodyColor;
    };
  }, []);

  useEffect(() => {
    const current = inst.current;
    if (!current) return;
    if (raidScope !== "manual") return;
    if (!raidConnected) {
      postsInflight.current = "";
      current.setState({ postsNote: "Connect X to load your last 5 posts.", xPosts: [] });
      return;
    }
    if (postsInflight.current === raidHandle || current.state.xPostsFor === raidHandle) return;
    postsInflight.current = raidHandle;
    current.setState({ postsNote: "Loading your last 5 posts…" });
    const url = `${clientApiBase()}/giveaways/public/x-posts?handle=${encodeURIComponent(raidHandle)}`;
    let cancel = false;
    fetch(url)
      .then((res) => res.json())
      .then((body: { posts?: Array<{ id: string; text: string; url: string; when: string }> }) => {
        if (cancel || !inst.current) return;
        const posts = Array.isArray(body?.posts) ? body.posts : [];
        inst.current.setState((prev: { xPosts?: Array<{ id: string; added?: boolean }> }) => {
          const extra = (Array.isArray(prev.xPosts) ? prev.xPosts : []).filter((p) => p.added);
          const ids = new Set(posts.map((p) => p.id));
          const merged = [...posts, ...extra.filter((p) => !ids.has(p.id))];
          return {
            xPosts: merged,
            xPostsFor: raidHandle,
            postsNote: merged.length ? "" : "No recent posts yet. Paste a link below.",
          };
        });
      })
      .catch(() => {
        if (cancel || !inst.current) return;
        postsInflight.current = "";
        inst.current.setState({ postsNote: "Could not load posts. Paste a link below." });
      });
    return () => {
      cancel = true;
      if (postsInflight.current === raidHandle) postsInflight.current = "";
    };
  }, [raidScope, raidConnected, raidHandle]);

  useEffect(() => {
    const current = inst.current;
    if (!current) return;
    const searchingRaid = specMode === "auto" && raidReward === "token";
    const q = (searchingRaid ? raidTokQ : tokQ).trim();
    tokQueryRef.current = q;
    if ((searchingRaid ? false : tokPrize !== "token") || q.length < 2) {
      if (current.state.tokHits || current.state.tokStatus) current.setState({ tokHits: null, tokStatus: "" });
      return;
    }
    if (current.state.tokStatus !== "loading") current.setState({ tokStatus: "loading" });
    const handle = window.setTimeout(() => {
      const url = `${clientApiBase()}/giveaways/public/tokens?q=${encodeURIComponent(q)}`;
      fetch(url)
        .then((res) => res.json())
        .then((body: { tokens?: unknown[] }) => {
          if (!inst.current || tokQueryRef.current !== q) return;
          inst.current.setState({ tokHits: Array.isArray(body?.tokens) ? body.tokens : [], tokStatus: "" });
        })
        .catch(() => {
          if (!inst.current || tokQueryRef.current !== q) return;
          inst.current.setState({ tokHits: [], tokStatus: "" });
        });
    }, 280);
    return () => window.clearTimeout(handle);
  }, [tokQ, tokPrize, specMode, raidReward, raidTokQ]);

  useEffect(() => {
    if (authenticated && awaitingLogin) {
      setAwaitingLogin(false);
      setFundOpen(true);
    }
  }, [authenticated, awaitingLogin]);

  const vals = inst.current.renderVals() as Scope;
  const need = walletNeed(inst.current.state.gw);
  vals.launch = () => {
    const next = walletNeed(inst.current?.state.gw);
    if (!next.ready) return;
    if (authenticated) setFundOpen(true);
    else {
      setAwaitingLogin(true);
      login({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false });
    }
  };

  return (
    <div className={`loofta-rewards-spec ${sora.variable} ${manrope.variable} ${jetbrainsMono.variable} ${manrope.className}`}>
      <style>{`
        .loofta-rewards-spec { color:#F2EFE8; -webkit-font-smoothing:antialiased; }
        .loofta-rewards-spec a { color:#FF7A2A; text-decoration:none; }
        .loofta-rewards-spec a:hover { color:#F5B70C; }
        .loofta-rewards-spec input::placeholder,
        .loofta-rewards-spec textarea::placeholder { color:#5D5B66; }
        .loofta-rewards-spec button { font-family:inherit; color:inherit; background:transparent; border:0; padding:0; cursor:pointer; appearance:none; -webkit-appearance:none; outline:none; }
        .loofta-rewards-spec button:focus,
        .loofta-rewards-spec button:focus-visible,
        .loofta-rewards-spec button:active { outline:none; box-shadow:none; }
        .loofta-rewards-spec input,
        .loofta-rewards-spec textarea { font-family:inherit; color:inherit; }
      `}</style>
      <RewardsDraftContext.Provider
        value={{
          gw: (inst.current.state.gw || {}) as GiveawayDraft,
          patchGw: (partial) => {
            inst.current?.setState((prev: { gw?: GiveawayDraft }) => {
              const gw = { ...(prev.gw || {}), ...partial };
              try { localStorage.setItem("loofta-gw-draft", JSON.stringify(gw)); } catch { /* private mode */ }
              return { gw, savedAt: Date.now() };
            });
          },
        }}
      >
        {renderNodes(SPEC, vals, "spec")}
        <GiveawayFundSheet
          open={fundOpen}
          onClose={() => setFundOpen(false)}
          prizeUsd={need.prize}
          platformFeeUsd={need.fee}
          balanceUsd={balanceUSD}
          solanaAddress={solanaAddress}
          devnetMode={networkMode === "devnet"}
        />
      </RewardsDraftContext.Provider>
    </div>
  );
}

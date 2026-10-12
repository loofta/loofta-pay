"use client";

import type { CSSProperties } from "react";

/**
 * Chrome 3D mascot — adapted from loofta-pay-private HushBot with Loofta orange/gold accents
 * (not Hush purple). pose="head" for compact avatars; "full" for hero/marketing.
 */
export function LooftaBot({
  pose = "full",
  width = 200,
  animate = true,
}: {
  pose?: "full" | "head";
  width?: number;
  animate?: boolean;
}) {
  const full = pose === "full";
  const ab: CSSProperties = { position: "absolute" };
  const chrome =
    "radial-gradient(circle at 32% 24%,#ffffff 0%,#ececf1 12%,#a7a7b1 36%,#3a3a42 66%,#121216 82%,#5c5c66 100%)";
  const limb =
    "radial-gradient(circle at 35% 25%,#ffffff 0%,#d9d9e0 20%,#8a8a94 55%,#2c2c33 90%)";
  const accentGlow = "rgba(255,106,0,.75)";
  const eye = (side: "left" | "right"): CSSProperties => ({
    ...ab,
    [side]: "25%",
    top: "20%",
    width: "15%",
    height: "60%",
    borderRadius: 999,
    background: "linear-gradient(180deg,#ffe0b8 0%,#ff8a3a 100%)",
    boxShadow: `0 0 18px 4px ${accentGlow}`,
    animation: animate ? "looftaBotBlink 4.6s infinite" : undefined,
    transformOrigin: "50% 50%",
  });

  return (
    <div style={{ position: "relative", width, aspectRatio: full ? "10 / 13" : "1 / 1" }}>
      <style>{`
        @keyframes looftaBotFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes looftaBotBlink { 0%,92%,100% { transform: scaleY(1); } 96% { transform: scaleY(0.08); } }
        @keyframes looftaBotLook {
          0%,40%,100% { transform: translateX(0); }
          55% { transform: translateX(6%); }
          70% { transform: translateX(-4%); }
        }
      `}</style>
      {full && (
        <>
          <div
            style={{
              ...ab,
              left: "20%",
              width: "60%",
              bottom: 0,
              height: "6%",
              borderRadius: "50%",
              background: "radial-gradient(ellipse,rgba(255,106,0,.4),rgba(0,0,0,0) 70%)",
              filter: "blur(4px)",
            }}
          />
          <div
            style={{
              ...ab,
              left: "15%",
              top: "67%",
              width: "15%",
              height: "19%",
              borderRadius: 999,
              background: limb,
              transform: "rotate(22deg)",
            }}
          />
          <div
            style={{
              ...ab,
              right: "15%",
              top: "67%",
              width: "15%",
              height: "19%",
              borderRadius: 999,
              background: limb,
              transform: "rotate(-22deg)",
            }}
          />
          <div
            style={{
              ...ab,
              left: "43%",
              top: "58%",
              width: "14%",
              height: "9%",
              borderRadius: "30%",
              background: "linear-gradient(90deg,#1a1a1f,#55555e 50%,#1a1a1f)",
            }}
          />
          <div
            style={{
              ...ab,
              left: "28%",
              top: "64%",
              width: "44%",
              height: "28%",
              borderRadius: "46% 46% 50% 50% / 40% 40% 60% 60%",
              background: chrome,
              boxShadow:
                "inset 0 -10px 20px rgba(0,0,0,.55),inset 0 6px 10px rgba(255,255,255,.3)",
            }}
          >
            <div
              style={{
                ...ab,
                left: "36%",
                width: "28%",
                top: "30%",
                height: "12%",
                borderRadius: 999,
                background: "#07070a",
              }}
            >
              <div
                style={{
                  ...ab,
                  inset: "25% 18%",
                  borderRadius: 999,
                  background: "#FF6A00",
                  boxShadow: "0 0 10px 2px rgba(255,106,0,.8)",
                }}
              />
            </div>
          </div>
        </>
      )}
      <div
        style={{
          ...ab,
          left: full ? "6%" : "10%",
          top: full ? "9%" : "18%",
          width: full ? "88%" : "80%",
          height: full ? "67.7%" : "80%",
          animation: animate ? "looftaBotFloat 4.2s ease-in-out infinite" : undefined,
        }}
      >
        <div
          style={{
            ...ab,
            left: "48.5%",
            top: "-11%",
            width: "3%",
            height: "13%",
            borderRadius: 3,
            background: "linear-gradient(90deg,#3a3a42,#d8d8de,#3a3a42)",
          }}
        />
        <div
          style={{
            ...ab,
            left: "44%",
            top: "-19%",
            width: "12%",
            height: "12%",
            borderRadius: 999,
            background:
              "radial-gradient(circle at 35% 30%,#ffffff 0%,#ffe0b0 25%,#ff8a3a 70%,#e01a00 100%)",
            boxShadow: "0 0 24px 4px rgba(255,106,0,.55)",
          }}
        />
        <div
          style={{
            ...ab,
            left: "-5%",
            top: "40%",
            width: "12%",
            height: "20%",
            borderRadius: "40%",
            background: "linear-gradient(90deg,#2a2a31,#9a9aa4 60%,#3a3a42)",
          }}
        />
        <div
          style={{
            ...ab,
            right: "-5%",
            top: "40%",
            width: "12%",
            height: "20%",
            borderRadius: "40%",
            background: "linear-gradient(90deg,#3a3a42,#9a9aa4 40%,#2a2a31)",
          }}
        />
        <div
          style={{
            ...ab,
            inset: 0,
            borderRadius: 999,
            background: chrome,
            boxShadow:
              "inset 0 -18px 36px rgba(0,0,0,.6),inset 0 10px 20px rgba(255,255,255,.35),inset -10px -4px 18px rgba(255,106,0,.28),0 50px 80px -30px rgba(255,106,0,.45)",
          }}
        >
          <div
            style={{
              ...ab,
              left: "14%",
              right: "14%",
              top: "35%",
              height: "30%",
              borderRadius: 999,
              background: "linear-gradient(180deg,#0d0d12,#050507)",
              boxShadow: "inset 0 6px 12px rgba(0,0,0,.95),0 2px 0 rgba(255,255,255,.55)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                ...ab,
                inset: 0,
                animation: animate ? "looftaBotLook 7s ease-in-out infinite" : undefined,
              }}
            >
              <div style={eye("left")} />
              <div style={eye("right")} />
            </div>
          </div>
          <div
            style={{
              ...ab,
              left: "17%",
              top: "10%",
              width: "30%",
              height: "16%",
              borderRadius: 999,
              background:
                "radial-gradient(ellipse,rgba(255,255,255,.9),rgba(255,255,255,0) 70%)",
              filter: "blur(2px)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

// Increment this when a new mandatory update is deployed.
export const UPDATE_ID = "1";

// Users created at or after this date already have a fresh wallet — no upgrade needed.
const CUTOFF = new Date("2026-06-26T00:00:00Z");

function localKey(userId: string) {
  return `loofta_update_1_${userId}`;
}

function isNewUser(createdAt: Date | null | undefined): boolean {
  if (!createdAt) return false;
  return createdAt >= CUTOFF;
}

export function isUpdateDone(userId: string): boolean {
  try { return localStorage.getItem(localKey(userId)) === "1"; } catch { return false; }
}

export function markLocallyDone(userId: string) {
  try { localStorage.setItem(localKey(userId), "1"); } catch { /* */ }
}

export function useUpdateJun26() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const [show, setShow] = useState(false);
  const privyUserId = user?.id;

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !privyUserId) { setShow(false); return; }

    if (isUpdateDone(privyUserId)) return;

    if (isNewUser(user?.createdAt)) {
      markLocallyDone(privyUserId);
      return;
    }

    // Check DB before showing — avoids flash for users who already upgraded.
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) { setShow(true); return; }
        const res = await fetch(`/api/users/update-jun26?update_id=${UPDATE_ID}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.completed) {
            markLocallyDone(privyUserId);
            // leave show=false
          } else if (isUpdateDone(privyUserId)) {
            // localStorage says done but DB doesn't — backfill.
            fetch("/api/users/update-jun26/complete", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ update_id: UPDATE_ID }),
            }).catch(() => {});
            // leave show=false
          } else {
            setShow(true);
          }
        } else {
          setShow(true); // non-ok response — show modal as fallback
        }
      } catch {
        setShow(true); // Backend unreachable — show modal as fallback
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, privyUserId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!privyUserId) return;
      if (isUpdateDone(privyUserId) || isNewUser(user?.createdAt)) {
        setShow(false);
      } else if (authenticated) {
        setShow(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [authenticated, privyUserId, user?.createdAt]);

  return { show };
}

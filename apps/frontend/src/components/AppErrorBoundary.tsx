"use client";

import React from "react";

interface State {
  error: Error | null;
}

// Catches render-time crashes from Privy's internal components (e.g. MoonpayStatusScreen
// throwing when the user navigates back mid-flow). Auto-resets on known Privy errors so
// the app recovers silently instead of going blank.
export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    const isPrivyInternalCrash =
      error.message.includes("externalTransactionId") ||
      error.message.includes("Cannot destructure property") ||
      error.stack?.includes("MoonpayStatusScreen") ||
      error.stack?.includes("FundingMethod");

    if (isPrivyInternalCrash) {
      // Auto-reset on the next tick — remounts the tree so Privy re-reads its
      // persisted auth state from storage (user stays logged in).
      setTimeout(() => this.setState({ error: null }), 0);
    }
  }

  render() {
    if (this.state.error) {
      const isPrivy =
        this.state.error.message.includes("externalTransactionId") ||
        this.state.error.stack?.includes("MoonpayStatusScreen") ||
        this.state.error.stack?.includes("FundingMethod");

      if (isPrivy) {
        // Render nothing while we wait for the auto-reset on the next tick
        return null;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0f0f12]">
          <div className="text-center space-y-4 px-6">
            <p className="text-white font-semibold">Something went wrong</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="text-base md:text-sm text-slate-400 underline underline-offset-2 hover:text-white"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

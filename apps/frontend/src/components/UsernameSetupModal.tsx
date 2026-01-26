"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface UsernameSetupModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (username: string) => void;
  privyUserId: string;
}

export function UsernameSetupModal({
  open,
  onClose,
  onSuccess,
  privyUserId,
}: UsernameSetupModalProps) {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const validateUsername = (value: string): string | null => {
    if (value.length < 3) {
      return "Username must be at least 3 characters";
    }
    if (value.length > 20) {
      return "Username must be 20 characters or less";
    }
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      return "Username can only contain letters, numbers, and underscores";
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validateUsername(username);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/users/setup-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privyUserId,
          username: username.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to set username");
      }

      onSuccess(data.user.username);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to set username. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    setError(null);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[24px] w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-8">
          {/* Title */}
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Choose Your Username
          </h2>
          <p className="text-gray-600 mb-6 text-sm">
            Pick a unique username to get started. You can use letters, numbers, and underscores.
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                placeholder="your_username"
                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                disabled={loading}
                autoFocus
                pattern="[a-zA-Z0-9_]{3,20}"
                maxLength={20}
              />
              <p className="mt-1 text-xs text-gray-500">
                3-20 characters, letters, numbers, and underscores only
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={loading}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || !username.trim()}
                className="flex-1 font-semibold text-white border-0"
                style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)' }}
              >
                {loading ? "Setting up..." : "Continue"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

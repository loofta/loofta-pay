"use client";

import * as React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Empty state view: dark content area with centered icon + message, optional CTA (e.g. gradient button). */
export function EmptyState({ icon: Icon, message, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-gray-100/80 dark:bg-gray-800/50 px-8 py-12 text-center min-h-[200px]",
        className
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-200/80 dark:bg-gray-700/80 text-gray-500 dark:text-gray-400">
        <Icon className="h-7 w-7" strokeWidth={1.5} />
      </div>
      <p className="mt-4 text-base font-medium text-gray-700 dark:text-gray-200">{message}</p>
      {description && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { payrollApi, type PayrollContributor } from "@/services/api/payroll";

type Props = {
  orgId: string;
  userId: string | undefined;
  value: string;
  onChange: (email: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
};

function matchContributor(c: PayrollContributor, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  const email = (c.email ?? "").toLowerCase();
  const first = (c.first_name ?? "").toLowerCase();
  const last = (c.last_name ?? "").toLowerCase();
  const full = `${first} ${last}`.trim();
  return email.includes(q) || full.includes(q) || first.includes(q) || last.includes(q);
}

export function ContributorEmailInput({
  orgId,
  userId,
  value,
  onChange,
  placeholder = "freelancer@example.com",
  disabled,
  id,
  className,
}: Props) {
  const [contributors, setContributors] = useState<PayrollContributor[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!orgId || !userId) return;
    payrollApi.contributors.list(orgId, userId).then(setContributors).catch(() => {});
  }, [orgId, userId]);

  const matches = useMemo(() => {
    return contributors.filter((c) => matchContributor(c, value));
  }, [contributors, value]);

  const showDropdown = open && !disabled && matches.length > 0;

  useEffect(() => {
    if (!showDropdown) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showDropdown]);

  const label = (c: PayrollContributor) => {
    const name = [c.first_name, c.last_name].filter(Boolean).join(" ");
    return name ? `${name} (${c.email})` : c.email;
  };

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        type="email"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        autoComplete="off"
      />
      {showDropdown && (
        <ul
          className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-md"
          role="listbox"
        >
          {matches.map((c) => (
            <li
              key={c.id}
              role="option"
              className="cursor-pointer px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(c.email);
                setOpen(false);
              }}
            >
              {label(c)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

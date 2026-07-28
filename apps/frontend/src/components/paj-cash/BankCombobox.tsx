"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Landmark } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { PajBank } from "@/services/pajCash";

interface BankComboboxProps {
  dark: boolean;
  banks: PajBank[];
  value: string | null;
  onChange: (bankId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

/** Searchable bank picker for PAJ Cash — filters as you type instead of scrolling a long <select>. */
export function BankCombobox({ dark, banks, value, onChange, placeholder = "Select your bank…", disabled }: BankComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(() => banks.find((b) => b.id === value) ?? null, [banks, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            dark
              ? "bg-white/10 border-white/20 text-white hover:bg-white/[0.14]"
              : "bg-white border-gray-300 text-gray-900 hover:bg-gray-50"
          )}
        >
          <span className="flex items-center gap-2.5 min-w-0">
            {selected?.logo ? (
              <img src={selected.logo} alt="" className="h-5 w-5 rounded shrink-0 object-contain" />
            ) : (
              <Landmark className={`h-4 w-4 shrink-0 ${dark ? "text-slate-400" : "text-gray-400"}`} />
            )}
            <span className={cn("truncate", !selected && (dark ? "text-slate-400" : "text-gray-400"))}>
              {selected ? selected.name : placeholder}
            </span>
          </span>
          <ChevronsUpDown className={`h-4 w-4 shrink-0 ${dark ? "text-slate-500" : "text-gray-400"}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-[--radix-popover-trigger-width] p-0",
          dark ? "bg-[#15151c] border-white/10" : "bg-white border-gray-200"
        )}
      >
        <Command className={cn("bg-transparent", dark ? "text-white" : "text-gray-900")}>
          <CommandInput
            placeholder="Search banks…"
            className={dark ? "text-white placeholder:text-slate-500" : undefined}
          />
          <CommandList className="max-h-64">
            <CommandEmpty className={`py-6 text-center text-base ${dark ? "text-slate-400" : "text-gray-500"}`}>
              No bank found.
            </CommandEmpty>
            <CommandGroup>
              {banks.map((bank) => (
                <CommandItem
                  key={bank.id}
                  value={bank.name}
                  onSelect={() => { onChange(bank.id); setOpen(false); }}
                  className={cn(
                    "gap-2.5 py-2.5",
                    // The base CommandItem sets data-[selected=true]:text-accent-foreground (a
                    // light-theme color) which otherwise wins over a plain text-white class here
                    // due to selector specificity — must override it at the same data-attribute
                    // level or hovering an item goes dark-text-on-dark-background.
                    dark ? "text-white data-[selected=true]:bg-white/10 data-[selected=true]:text-white" : "data-[selected=true]:bg-gray-100"
                  )}
                >
                  {bank.logo ? (
                    <img src={bank.logo} alt="" className="h-5 w-5 rounded shrink-0 object-contain" />
                  ) : (
                    <Landmark className={`h-4 w-4 shrink-0 ${dark ? "text-slate-400" : "text-gray-400"}`} />
                  )}
                  <span className="flex-1 truncate">{bank.name}</span>
                  <Check className={cn("h-4 w-4 shrink-0", value === bank.id ? "opacity-100" : "opacity-0")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

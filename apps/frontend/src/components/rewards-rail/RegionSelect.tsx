"use client";

import { useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { CONTINENTS, COUNTRIES, type Continent } from "@/lib/countries";
import { useRewardsDraft } from "./rewardsDraft";

const labelStyle = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.06em",
  color: "#8A8893",
} as const;

function CountryMultiSelect({
  selected,
  onAdd,
  onRemove,
  placeholder,
}: {
  selected: string[];
  onAdd: (country: string) => void;
  onRemove: (country: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              background: "#0E0E12",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14,
              color: selected.length ? "#F2EFE8" : "#6E6C78",
              fontSize: 15,
              fontWeight: 600,
              padding: "13px 14px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selected.length ? `${selected.length} countr${selected.length === 1 ? "y" : "ies"} selected` : placeholder}
            </span>
            <ChevronDown size={16} color="#8A8893" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0 bg-[#17171b] border-white/15">
          <Command className="bg-transparent text-white">
            <CommandInput placeholder="Search countries…" className="text-white placeholder:text-slate-500" />
            <CommandList className="max-h-64">
              <CommandEmpty className="py-6 text-center text-base text-slate-400">No country found.</CommandEmpty>
              <CommandGroup>
                {COUNTRIES.map((country) => (
                  <CommandItem
                    key={country}
                    value={country}
                    onSelect={() => (selected.includes(country) ? onRemove(country) : onAdd(country))}
                    className="text-white data-[selected=true]:bg-white/10 data-[selected=true]:text-white"
                  >
                    <span className="flex-1 truncate">{country}</span>
                    <Check className={`h-4 w-4 shrink-0 ${selected.includes(country) ? "opacity-100" : "opacity-0"}`} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {selected.map((country) => (
            <button
              key={country}
              type="button"
              onClick={() => onRemove(country)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.06)",
                padding: "4px 10px",
                fontSize: 13,
                fontWeight: 700,
                color: "#E8E4DA",
                cursor: "pointer",
              }}
            >
              {country}
              <X size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RegionSelect() {
  const draft = useRewardsDraft();
  const gw = draft.gw || {};
  const mode = gw.locMode || "any";
  const blocking = mode === "except";
  const continents = blocking
    ? (Array.isArray(gw.excludedContinents) ? gw.excludedContinents : [])
    : (Array.isArray(gw.requiredContinents) ? gw.requiredContinents : []);
  const countries = blocking
    ? (Array.isArray(gw.excludedCountries) ? gw.excludedCountries : [])
    : (Array.isArray(gw.requiredCountries) ? gw.requiredCountries : []);

  const toggleContinent = (continent: Continent) => {
    const next = continents.includes(continent)
      ? continents.filter((c) => c !== continent)
      : [...continents, continent];
    draft.patchGw(blocking ? { excludedContinents: next } : { requiredContinents: next });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <span style={{ fontWeight: 700, fontSize: 16, color: "#F2EFE8" }}>Location</span>
      <span style={{ fontSize: 13.5, color: "#8A8893" }}>Where entrants can be based.</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 4, padding: 4, borderRadius: 16, background: "#0E0E12", border: "1px solid rgba(255,255,255,0.06)" }}>
        {([["any", "Anywhere"], ["only", "Only in"], ["except", "Everywhere except"]] as const).map(([key, label]) => {
          const on = mode === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => draft.patchGw({ locMode: key })}
              style={{
                cursor: "pointer",
                padding: "10px 8px",
                borderRadius: 12,
                border: 0,
                fontWeight: 700,
                fontSize: 14,
                background: on ? "#2A2A32" : "transparent",
                color: on ? "#F2EFE8" : "#8A8893",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      {mode !== "any" && (
        <>
          <span style={labelStyle}>{blocking ? "BLOCK THESE REGIONS" : "ALLOW THESE REGIONS"}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CONTINENTS.map((continent) => {
              const on = continents.includes(continent);
              return (
                <button
                  key={continent}
                  type="button"
                  onClick={() => toggleContinent(continent)}
                  style={{
                    cursor: "pointer",
                    padding: "9px 14px",
                    borderRadius: 999,
                    fontWeight: 700,
                    fontSize: 13.5,
                    background: on ? "rgba(255,90,26,0.12)" : "#0E0E12",
                    color: on ? "#F2EFE8" : "#9A98A3",
                    border: `1px solid ${on ? "rgba(255,122,42,0.7)" : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  {continent}
                </button>
              );
            })}
          </div>
          <CountryMultiSelect
            selected={countries}
            placeholder="Search countries..."
            onAdd={(country) => {
              const next = countries.includes(country) ? countries : [...countries, country];
              draft.patchGw(blocking ? { excludedCountries: next } : { requiredCountries: next });
            }}
            onRemove={(country) => {
              const next = countries.filter((c) => c !== country);
              draft.patchGw(blocking ? { excludedCountries: next } : { requiredCountries: next });
            }}
          />
        </>
      )}
    </div>
  );
}

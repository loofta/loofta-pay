"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

// This app is dark-themed throughout with no light-mode variant, so unlike shadcn's default
// (which leans on bg-accent/bg-primary CSS vars meant to work in both themes), every color here
// is a literal picked to read cleanly against this app's #17171b/#0f0f12 surfaces. The upstream
// default `cell` classes also included range-selection styling (bg-accent on any cell "having" an
// aria-selected day) that isn't needed — every Calendar usage in this app is mode="single" — and
// was the actual cause of a stray square block showing behind the (circular) selected day.
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-white text-base font-medium",
        nav: "space-x-1 flex items-center",
        nav_button:
          "h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none",
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell: "text-slate-500 rounded-md w-9 font-normal text-sm",
        row: "flex w-full mt-2",
        cell: "h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
        day: "h-9 w-9 p-0 rounded-full font-normal text-white hover:bg-white/10 transition-colors aria-selected:opacity-100",
        day_selected: "bg-[#FF7A2A] text-white hover:bg-[#FF7A2A] focus:bg-[#FF7A2A]",
        day_today: "border border-[#FF7A2A]/60 text-white",
        day_outside: "text-slate-600 opacity-60",
        day_disabled: "text-slate-700 opacity-40 hover:bg-transparent",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: () => <ChevronLeft className="h-4 w-4" />,
        IconRight: () => <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }

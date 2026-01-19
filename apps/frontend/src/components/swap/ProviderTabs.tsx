'use client'

import { cn } from "@/lib/utils";

type Provider = "near-intents" | "biconomy";

export function ProviderTabs({
	value,
	onChange,
	className,
}: {
	value: Provider;
	onChange: (v: Provider) => void;
	className?: string;
}) {
	return (
		<div className={cn("inline-flex items-center gap-1 rounded-2xl p-1 bg-gray-100", className)}>
			<button
				type="button"
				onClick={() => onChange("near-intents")}
				className={cn(
					"px-3 py-1.5 text-sm rounded-2xl transition-colors",
					value === "near-intents" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
				)}
				aria-pressed={value === "near-intents"}
			>
				NEAR Intents
			</button>
			<button
				type="button"
				onClick={() => onChange("biconomy")}
				className={cn(
					"px-3 py-1.5 text-sm rounded-2xl transition-colors",
					value === "biconomy" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
				)}
				aria-pressed={value === "biconomy"}
			>
				Biconomy
			</button>
		</div>
	);
}



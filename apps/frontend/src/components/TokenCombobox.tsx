'use client'

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Image from "next/image";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Dialog, DialogPortal, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { NearToken } from "@/services/nearIntents";
import { findTokenBySelection, formatChainLabel, groupTokensBySymbol, uniqueChains } from "@/lib/tokens";
import type { TokenSelection } from "@/app/utils/types";
import { TokenIcon } from "./TokenIcon";
import { getChainIcon } from "@/lib/chains";
import { resolveTokenLogo } from "@/lib/tokenImages";

type Props = {
	tokens: NearToken[];
	value?: TokenSelection;
	onChange: (selection: TokenSelection) => void;
	placeholder?: string;
	className?: string;
	onQuery?: (q: string) => Promise<NearToken[]>;
	hideChains?: string[];
	/** Placeholder for the search input inside the popup. */
	searchPlaceholder?: string;
	/** When true, "All networks" is selected by default so all chains are visible (e.g. for withdraw token picker). */
	defaultShowAllChains?: boolean;
	/**
	 * The closed trigger button's own text/icon colors are hardcoded white — fine when it sits on
	 * a dark host background (BalanceModal, ClaimPageContent, NearSwapWidget all fix their own
	 * container dark regardless of the caller's `className`), unreadable on a light one. Set this
	 * when embedding on a light-background card (e.g. guest checkout) so the trigger's own text
	 * switches to a dark color; the popup content itself stays dark either way, matching every
	 * other dropdown-style overlay in the app.
	 */
	light?: boolean;
};

const EMPTY_CHAINS: string[] = [];

export function TokenCombobox({
	tokens,
	value,
	onChange,
	placeholder = "Select token...",
	className,
	onQuery,
	hideChains = EMPTY_CHAINS,
	searchPlaceholder = "Search token or network…",
	defaultShowAllChains = false,
	light = false,
}: Props) {
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState("");
	const inputRef = React.useRef<HTMLInputElement>(null);

	React.useEffect(() => {
		if (!open) return;
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => { document.body.style.overflow = prev; };
	}, [open]);
	const filteredTokens = React.useMemo(() => {
		return tokens.filter(t => {
			if (hideChains.length > 0 && hideChains.includes(t.chain?.toLowerCase() || '')) return false;
			return resolveTokenLogo(t) != null;
		});
	}, [tokens, hideChains]);
	const [options, setOptions] = React.useState<NearToken[]>(filteredTokens);
	const [loading, setLoading] = React.useState(false);
	const selectedToken = React.useMemo(() => {
		return findTokenBySelection(tokens, value);
	}, [tokens, value]);
	const [selectedChain, setSelectedChain] = React.useState<string | undefined>(
		defaultShowAllChains ? undefined : value?.chain
	);

	React.useEffect(() => {
		if (!query) {
			setOptions(filteredTokens);
		}
	}, [filteredTokens, query]);

	React.useEffect(() => {
		const chains = uniqueChains(options);
		if (selectedChain && !chains.includes(selectedChain)) {
			setSelectedChain(value?.chain && chains.includes(value.chain) ? value.chain : chains[0]);
		}
	}, [options, selectedChain, value]);

	React.useEffect(() => {
		if (!onQuery) return;
		let active = true;
		const handle = setTimeout(async () => {
			setLoading(true);
			try {
				const next = await onQuery(query);
				if (active) setOptions(next);
			} finally {
				if (active) setLoading(false);
			}
		}, 250);
		return () => {
			active = false;
			clearTimeout(handle);
		};
	}, [query, onQuery]);

	React.useEffect(() => {
		const q = query.trim().toLowerCase();
		if (!q) return;
		const chans = uniqueChains(options);
		const matches = chans.filter(c => formatChainLabel(c).toLowerCase().includes(q) || c.toLowerCase().includes(q));
		if (matches.length === 1 && matches[0] !== selectedChain) {
			setSelectedChain(matches[0]);
		}
	}, [query, options, selectedChain]);

	const grouped = React.useMemo(() => groupTokensBySymbol(options), [options]);
	const chains = React.useMemo(() => uniqueChains(options), [options]);

	const visibleGroups = React.useMemo(() => {
		if (!selectedChain) return grouped;
		return grouped.filter(g => g.chains[selectedChain!]);
	}, [grouped, selectedChain]);
	const isSearching = React.useMemo(() => query.trim().length > 0, [query]);
	const searchItems = React.useMemo(() => {
		if (!isSearching) return [] as Array<{ symbol: string; name?: string; chain: string; token: NearToken }>
		const q = query.trim().toLowerCase();
		const items: Array<{ symbol: string; name?: string; chain: string; token: NearToken }> = [];
		for (const g of grouped) {
			const symbol = g.symbol || "";
			for (const c of Object.keys(g.chains)) {
				const tok = g.chains[c] as NearToken;
				const match = symbol.toLowerCase().includes(q)
					|| (g.name || "").toLowerCase().includes(q)
					|| c.toLowerCase().includes(q)
					|| formatChainLabel(c).toLowerCase().includes(q);
				if (match) items.push({ symbol, name: g.name, chain: c, token: tok });
			}
		}
		return items;
	}, [isSearching, query, grouped]);
	const filteredSearchItems = React.useMemo(() => {
		if (!isSearching) return [] as Array<{ symbol: string; name?: string; chain: string; token: NearToken }>;
		if (!selectedChain) return searchItems;
		return searchItems.filter((it) => it.chain === selectedChain);
	}, [isSearching, searchItems, selectedChain]);
	const filteredChains = React.useMemo(() => {
		if (!isSearching) return chains;
		const s = new Set<string>();
		for (const it of searchItems) s.add(it.chain);
		const arr = Array.from(s.values());
		return arr.length ? arr.sort((a, b) => a.localeCompare(b)) : chains;
	}, [isSearching, searchItems, chains]);

	return (
		// modal={false} prevents a second scroll-lock from conflicting with the
		// parent BalanceModal Dialog on iOS, which throws an unhandled exception.
		<Dialog open={open} onOpenChange={setOpen} modal={false}>
			<DialogTrigger asChild>
				<button
					type="button"
					role="combobox"
					aria-expanded={open}
					className={cn(
						"w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl",
						"bg-white/[0.06] border border-white/[0.09]",
						"hover:bg-white/[0.09] hover:border-white/[0.14]",
						"transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/20",
						className
					)}
				>
					<div className="flex items-center gap-2.5 min-w-0">
						<TokenIcon token={selectedToken ?? undefined} chain={selectedToken?.chain} size={26} />
						<span className={cn(
							"text-base font-medium truncate",
							light ? "text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100" : "text-white"
						)}>
							{selectedToken ? selectedToken.symbol : placeholder}
						</span>
						{selectedToken ? (
							<span className={cn(
								"text-sm ml-0.5 truncate",
								light ? "text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400" : "text-white/45"
							)}>
								{formatChainLabel(selectedToken.chain)}
							</span>
						) : null}
					</div>
					<ChevronsUpDown className={cn(
						"h-4 w-4 shrink-0",
						light ? "text-gray-400 [@media(prefers-color-scheme:dark)]:text-slate-500" : "text-white/35"
					)} />
				</button>
			</DialogTrigger>
			<DialogPortal>
				{/* Overlay */}
				<div
					// Above BalanceModal (z-[100]) and the deposit sheet (z-[120]), or the picker opens underneath them.
					className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-sm"
					onClick={() => setOpen(false)}
				/>
				{/* Centering shell — flex center on desktop, full-screen on mobile.
				    pointer-events-none so clicks outside the content hit the overlay. */}
				<div className="fixed inset-0 z-[131] flex items-center justify-center pointer-events-none sm:p-4">
				<DialogPrimitive.Content
					onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus(); }}
					className={cn(
						"pointer-events-auto outline-none flex flex-col",
						"bg-[#0d0d14]/90 backdrop-blur-2xl",
						"data-[state=open]:animate-in data-[state=closed]:animate-out",
						"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
						"data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
						// Mobile: fill the fixed wrapper
						"absolute inset-0 rounded-none border-0",
						// Desktop: natural size inside the flex center shell
						"sm:relative sm:inset-auto sm:h-[min(620px,88vh)] sm:w-[min(96vw,540px)] sm:max-w-[540px]",
						"sm:rounded-2xl sm:border sm:border-white/[0.08] sm:shadow-2xl sm:shadow-black/60",
						"p-0 overflow-hidden"
					)}
				>
					{/* Header */}
					<div className="px-5 py-4 border-b border-white/[0.07] shrink-0 flex items-center justify-between">
						<DialogTitle className="text-lg font-semibold text-white tracking-tight">Select token</DialogTitle>
						<DialogPrimitive.Close className="rounded-lg p-1.5 text-white/40 hover:text-white hover:bg-white/10 transition-all focus:outline-none">
							<X className="h-4 w-4" />
							<span className="sr-only">Close</span>
						</DialogPrimitive.Close>
					</div>

					{/* Body: stacked on mobile, side-by-side on desktop */}
					<div className="flex flex-col sm:flex-row flex-1 min-h-0 overflow-hidden">
						{/* Network selector: horizontal strip on mobile, vertical sidebar on desktop */}
						<div className={cn(
							"shrink-0 border-b sm:border-b-0 sm:border-r border-white/[0.07]",
							"flex flex-row sm:flex-col",
							"overflow-x-auto sm:overflow-x-hidden sm:overflow-y-auto",
							"sm:w-44 p-2 bg-white/[0.02]"
						)}>
							<div className="hidden sm:block px-3 py-2 text-sm font-semibold uppercase tracking-widest text-white/30">
								Network
							</div>
							<div className="flex flex-row sm:flex-col gap-1">
								<button
									key="__all__"
									type="button"
									onClick={() => setSelectedChain(undefined)}
									className={cn(
										"whitespace-nowrap text-left rounded-xl px-3 py-2 text-sm font-medium transition-all",
										!selectedChain
											? "bg-white/15 text-white shadow-sm"
											: "text-white/55 hover:bg-white/8 hover:text-white/90"
									)}
								>
									<span className="inline-flex items-center gap-2">All networks</span>
								</button>
								{filteredChains.map((c) => {
									const active = c === selectedChain;
									return (
										<button
											key={c}
											type="button"
											onClick={() => setSelectedChain(c)}
											className={cn(
												"whitespace-nowrap text-left rounded-xl px-3 py-2 text-sm font-medium transition-all",
												active
													? "bg-white/15 text-white shadow-sm"
													: "text-white/55 hover:bg-white/8 hover:text-white/90"
											)}
										>
											<span className="inline-flex items-center gap-2">
												{(() => {
													const src = getChainIcon(c);
													return src ? (
														<Image
															src={src}
															alt={`${formatChainLabel(c)} icon`}
															width={16}
															height={16}
															sizes="16px"
															unoptimized={/^https?:\/\//.test(src)}
														/>
													) : null;
												})()}
												{formatChainLabel(c)}
											</span>
										</button>
									);
								})}
							</div>
						</div>

						{/* Token list */}
						<div className="flex-1 min-w-0 min-h-0 overflow-hidden">
							<Command className={cn(
								"h-full flex flex-col bg-transparent text-white",
								"[&_[cmdk-input-wrapper]]:border-white/[0.07]",
								"[&_[cmdk-input]]:text-white [&_[cmdk-input]]:text-base [&_[cmdk-input]]:placeholder:text-white/30",
								"[&_[cmdk-group-heading]]:text-white/30 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest",
								"[&_[cmdk-item]]:text-white [&_[cmdk-item]]:rounded-xl [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-2.5",
								"[&_[cmdk-item][data-selected='true']]:bg-white/10",
							)}>
								<CommandInput ref={inputRef} placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
								<CommandList className="flex-1 max-h-none overflow-y-auto px-2 py-2">
									{loading ? (
										<div className="py-6 text-center text-sm text-white/40">Searching…</div>
									) : null}
									<CommandEmpty className="py-8 text-center text-sm text-white/40">No token found.</CommandEmpty>
									{isSearching ? (
										<CommandGroup heading="Results">
											{searchItems.map((it) => {
												const isSelected = value?.symbol === it.symbol && value?.chain === it.chain;
												const id = `${it.symbol}-${it.chain}`;
												return (
													<CommandItem
														key={id}
														value={`${it.symbol} ${it.name || ""} ${it.chain}`}
														onSelect={() => {
															onChange({ symbol: it.symbol, chain: it.chain });
															setOpen(false);
														}}
													>
														<div className="flex items-center gap-3.5 w-full">
															<TokenIcon token={it.token} chain={it.chain} size={32} />
															<div className="flex-1 overflow-hidden">
																<div className="text-base font-medium text-white truncate">{it.symbol}</div>
																<div className="text-sm text-white/45 truncate">
																	{it.name} · {formatChainLabel(it.chain)}
																</div>
															</div>
															<Check className={cn("h-4 w-4 text-white/60 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
														</div>
													</CommandItem>
												);
											})}
										</CommandGroup>
									) : (
										<CommandGroup heading="Tokens">
											{visibleGroups.map((g) => {
												const availableChains = Object.keys(g.chains);
												const effectiveChain = selectedChain || availableChains[0];
												const tok = effectiveChain ? g.chains[effectiveChain] : undefined;
												const id = `${g.symbol}-${effectiveChain || "any"}`;
												const isSelected = value?.symbol === g.symbol && value?.chain === effectiveChain;
												const showMultiChain = !selectedChain && availableChains.length > 1;

												return (
													<CommandItem
														key={id}
														value={`${g.symbol} ${g.name} ${effectiveChain}`}
														onSelect={() => {
															if (!effectiveChain || !tok) return;
															onChange({ symbol: g.symbol, chain: effectiveChain });
															setOpen(false);
														}}
													>
														<div className="flex items-center gap-3.5 w-full">
															<TokenIcon token={tok ?? g} chain={effectiveChain} size={32} />
															<div className="flex-1 overflow-hidden">
																<div className="text-base font-medium text-white truncate">{g.symbol}</div>
																<div className="text-sm text-white/45 truncate">
																	{g.name} · {formatChainLabel(effectiveChain)}
																	{showMultiChain && (
																		<span className="ml-1.5 text-white/30">+{availableChains.length - 1}</span>
																	)}
																</div>
															</div>
															<Check className={cn("h-4 w-4 text-white/60 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
														</div>
													</CommandItem>
												);
											})}
										</CommandGroup>
									)}
								</CommandList>
							</Command>
						</div>
					</div>
				</DialogPrimitive.Content>
				</div>
			</DialogPortal>
		</Dialog>
	);
}

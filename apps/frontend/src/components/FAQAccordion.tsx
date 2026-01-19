import { useState } from "react";

export type FAQItem = { question: string; answer: string };

export function FAQAccordion({ items }: { items: FAQItem[] }) {
	return (
		<div className="w-full max-w-4xl mx-auto">
			<div className="divide-y divide-gray-200 rounded-2xl bg-white shadow-sm">
				{items.map((it, idx) => (
					<AccordionRow key={idx} item={it} />
				))}
			</div>
		</div>
	);
}

function AccordionRow({ item }: { item: FAQItem }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="px-4 md:px-6">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="w-full py-4 md:py-5 flex items-center justify-between gap-3 text-left"
				aria-expanded={open}
				aria-controls={`faq-${item.question}`}
			>
				<span className="text-sm md:text-base font-semibold text-gray-900">{item.question}</span>
				<span
					className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-700"
					aria-hidden="true"
				>
					<span className={`transition-transform duration-200 ${open ? "rotate-45" : ""}`}>+</span>
				</span>
			</button>
			<div
				id={`faq-${item.question}`}
				className={`grid transition-all duration-200 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
			>
				<div className="overflow-hidden pb-4 md:pb-5 text-sm md:text-base text-gray-700">
					{item.answer}
				</div>
			</div>
		</div>
	);
}



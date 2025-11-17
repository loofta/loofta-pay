'use client';

interface SummarySectionProps {
    title: string;
    content: string;
    isCensored: boolean;
}

export default function SummarySection({ title, content, isCensored }: SummarySectionProps) {
    return (
        <div className="mb-4">
            <p className="font-medium text-lg mb-1">{title}</p>
            <p className={`text-gray-600 break-all ${isCensored ? 'relative overflow-hidden bg-gradient-to-r from-gray-100 via-gray-300 to-gray-100 bg-[length:200%_100%] bg-[position:0_0]  rounded-md px-3 py-2' : ''}`}>
                {isCensored ? 'Censored' : content}
            </p>
        </div>
    );
}

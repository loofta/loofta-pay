'use client'

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, Clock, Settings, Ticket } from "lucide-react";
import { useTranslations } from "next-intl";

type NavKey = 'send' | 'receive' | 'history' | 'settings' | 'megapot-buy' | 'megapot-redeem' | 'megapot-history';

function IconBubble({
    active,
    children,
}: {
    active: boolean;
    children: React.ReactNode;
}) {
    return (
        <span className="relative shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full">
            <span
                className={[
                    "absolute inset-0 rounded-full transition-all duration-300",
                    active
                        ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_10px_24px_rgba(255,122,42,0.22)]"
                        : "bg-white/[0.06]",
                ].join(" ")}
            />
            <span
                className={[
                    "relative z-10 flex items-center justify-center",
                    "[&>svg]:h-[18px] [&>svg]:w-[18px] [&>svg]:stroke-[2.25]",
                    active ? "text-white" : "text-slate-300",
                ].join(" ")}
            >
                {children}
            </span>
        </span>
    );
}

function NavItem({
    href,
    label,
    active,
    icon,
}: {
    href: string;
    label: string;
    active: boolean;
    icon: React.ReactNode;
}) {
    return (
        <Link
            href={href}
            className={[
                "flex flex-col items-center justify-center flex-1 py-2",
                "text-sm font-semibold",
                active ? "text-amber-300" : "text-slate-400 hover:text-slate-200",
            ].join(" ")}
        >
            <IconBubble active={active}>{icon}</IconBubble>
            <span className="mt-1">{label}</span>
        </Link>
    );
}

export function BottomNav() {
    const t = useTranslations('BottomNav');
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const tab = searchParams.get("tab");
    const isMegapot = pathname === "/app/megapot" || pathname === "/megapot";
    const isAppPath = pathname?.startsWith('/app');

    if (isMegapot) {
        let activeKey: NavKey = 'megapot-buy';
        if (tab === 'redeem' || tab === 'history') activeKey = 'megapot-history';

        // On pay.loofta.xyz, proxy.ts redirects any literal "/app/*" URL back to the clean
        // path — hardcoding "/app/megapot" here turned every tab click into an extra
        // redirect round trip (navigate -> 307 -> re-fetch clean path -> rewrite -> render).
        const megapotBase = isAppPath ? '/app/megapot' : '/megapot';
        const profileHref = isAppPath ? '/app/profile' : '/settings';

        return (
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 safe-area-pb bg-[#0f0f12]/70 backdrop-blur-xl border-t border-white/10 shadow-[0_-10px_30px_rgba(0,0,0,0.35)]">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1 mt-1">
                    <NavItem href={megapotBase} label="Buy" active={activeKey === 'megapot-buy'} icon={<Ticket />} />
                    <NavItem href={`${megapotBase}?tab=history`} label="Tickets" active={activeKey === 'megapot-history'} icon={<Clock />} />
                    <NavItem href={profileHref} label="Profile" active={false} icon={<Settings />} />
                </div>
            </nav>
        );
    }

    let activeKey: NavKey;
    if (pathname === "/history" || pathname === "/app/history") {
        activeKey = "history";
    } else if (pathname === "/settings" || pathname === "/app/settings" || pathname === "/app/profile") {
        activeKey = "settings";
    } else if ((pathname === "/" || pathname === "/app") && tab === "receive") {
        activeKey = "receive";
    } else {
        activeKey = "send";
    }

    const sendHref = isAppPath ? '/app' : '/';
    const receiveHref = isAppPath ? '/app?tab=receive' : '/?tab=receive';
    const historyHref = isAppPath ? '/app/history' : '/history';
    const settingsHref = isAppPath ? '/app/profile' : '/settings';

    return (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 safe-area-pb bg-[#0f0f12]/70 backdrop-blur-xl border-t border-white/10 shadow-[0_-10px_30px_rgba(0,0,0,0.35)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-1 mt-1">
                <NavItem href={sendHref} label={t('send')} active={activeKey === 'send'} icon={<ArrowUp />} />
                <NavItem href={receiveHref} label={t('receive')} active={activeKey === 'receive'} icon={<ArrowDown />} />
                <NavItem href={historyHref} label={t('history')} active={activeKey === 'history'} icon={<Clock />} />
                <NavItem href={settingsHref} label={t('profile')} active={activeKey === 'settings'} icon={<Settings />} />
            </div>
        </nav>
    );
}

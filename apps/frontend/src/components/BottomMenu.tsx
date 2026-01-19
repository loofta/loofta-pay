"use client";

import { BarChart, Gift, Layout, Zap, Users, Coins, MessageSquare, ArrowLeftRight } from "lucide-react";
import React from "react";
import { usePathname } from "next/navigation";
import classNames from "classnames";
import Link from 'next/link';
import { cn } from "@/lib/utils";

export default function MobilePillMenu() {
  const menuItems: Array<{
    icon: React.ReactNode;
    text: string;
    href: string;
    isExternal?: boolean;
  }> = [
      {
        icon: <BarChart className="h-6 w-6" />,
        text: "Dashboard",
        href: "/"
      },
      {
        icon: <Layout className="h-6 w-6" />,
        text: "Campaigns",
        href: "/advertise/history"
      },
      {
        icon: <ArrowLeftRight className="h-6 w-6" />,
        text: "Bridge",
        href: "/bridge"
      },
      {
        icon: <Users className="h-6 w-6" />,
        text: "Creators",
        href: "/creators"
      },
    ];

  return (
    <div className="w-full bg-white border-t flex justify-around p-2 z-50">
      {menuItems.map((item) => (
        <MenuItem
          key={item.href}
          icon={item.icon}
          text={item.text}
          href={item.href}
          isExternal={item.isExternal}
        />
      ))}
    </div>
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  text: string;
  href: string;
  disabled?: boolean;
  comingSoon?: boolean;
  isExternal?: boolean;
}

function MenuItem({ icon, text, href, disabled, comingSoon, isExternal }: MenuItemProps) {
  const pathname = usePathname();
  const isActive = pathname === href;

  const itemClasses = classNames(
    "flex flex-col items-center justify-center",
    {
      "text-orange-600 font-medium": isActive,
      "text-gray-500": !isActive,
    }
  );

  const iconClasses = classNames("h-6 w-6", {
    "text-orange-600": isActive,
    "text-gray-500": !isActive,
  });

  if (isExternal) {
    return (
      <button
        onClick={() => window.open(href, '_blank')}
        className={cn(
          itemClasses,
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className={iconClasses}>{icon}</div>
        <span className="text-xs mt-1">
          {text}
          {comingSoon && (
            <span className="absolute -top-2 -right-2 text-[8px] bg-orange-100 text-orange-600 px-1 py-0.5 rounded-full">
              Soon
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <Link
      href={disabled ? '#' : href}
      className={cn(
        itemClasses,
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <div className={iconClasses}>{icon}</div>
      <span className="text-xs mt-1">
        {text}
        {comingSoon && (
          <span className="absolute -top-2 -right-2 text-[8px] bg-orange-100 text-orange-600 px-1 py-0.5 rounded-full">
            Soon
          </span>
        )}
      </span>
    </Link>
  );
}

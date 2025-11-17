import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layout, BarChart, Gift, Zap, Users, LogOut, Coins, MessageSquare, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import MobilePillMenu from '@/components/BottomMenu';
import { usePrivy } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';

interface SidebarItem {
  icon: any;
  label: string;
  href: string;
  disabled?: boolean;
  comingSoon?: boolean;
}

const sidebarItems: SidebarItem[] = [
  {
    icon: BarChart,
    label: 'Dashboard',
    href: '/'
  },
  {
    icon: Layout,
    label: 'Campaigns',
    href: '/advertise/history'
  },
  {
    icon: Users,
    label: 'Creators',
    href: '/creators'
  },
  {
    icon: ArrowLeftRight,
    label: 'Bridge',
    href: '/bridge'
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = usePrivy();

  const handleLogout = async () => {
    await logout();
    window.location.href = '/';
  };

  return (
    <div className="h-screen flex">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex flex-col w-64 bg-white border-r">
        {/* Logo in sidebar */}
        <div className="p-6">
          <Image
            src="/loofta.svg"
            alt="Loofta"
            width={120}
            height={42}
            style={{ filter: 'brightness(0.95) contrast(1.1)' }}
          />
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 px-4 pb-4">
          <ul className="space-y-1">
            {sidebarItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.disabled ? '#' : item.href}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors relative",
                    pathname === item.href && "bg-orange-50 text-orange-600",
                    item.disabled && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                  {item.comingSoon && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
                      Coming Soon
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Help and Support */}
        <div className="p-4 border-t">
          <button
            onClick={() => window.open('https://t.me/looftaxyz', '_blank')}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors mb-4"
          >
            <MessageSquare className="h-5 w-5 text-blue-600" />
            <span className="font-medium">Get Help</span>
          </button>
        </div>

        {/* User Info and Logout */}
        <div className="p-4 border-t">
          <div className="mb-4">
            <p className="text-sm text-gray-500">Logged in as</p>
            <p className="text-sm font-medium text-gray-900 truncate">{user?.email?.address}</p>
          </div>
          <Button
            variant="outline"
            className="w-full flex items-center gap-2"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full">
        {/* Mobile Header */}
        <header className="md:hidden bg-white border-b px-4 py-3 flex-none">
          <Image
            src="/loofta.svg"
            alt="Loofta"
            width={100}
            height={35}
            className="mx-auto"
            style={{ filter: 'brightness(0.95) contrast(1.1)' }}
          />
        </header>

        {/* Scrollable Content Area */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        {/* Mobile Bottom Menu - Fixed at bottom */}
        <div className="md:hidden flex-none">
          <MobilePillMenu />
        </div>
      </div>
    </div>
  );
} 
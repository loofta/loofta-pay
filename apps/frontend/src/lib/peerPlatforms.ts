export interface PeerCurrency {
  code: string;
  label: string;
  flag: string;
  symbol: string;
  /** LP spread baked into the quoted rate. 0 = flat 1:1, >0 = % below market kept as LP incentive */
  spreadPercent: number;
}

export const PEER_CURRENCIES: PeerCurrency[] = [
  { code: 'USD', label: 'US Dollar',          flag: '🇺🇸', symbol: '$',  spreadPercent: 2 },
];

export function getPeerCurrency(code: string): PeerCurrency | undefined {
  return PEER_CURRENCIES.find(c => c.code === code);
}

export interface PeerPlatform {
  id: string;
  name: string;
  processorName: string;
  idLabel: string;
  placeholder: string;
  currencies: string[];
  logo: string;
  maxUSDC: number;
  cooldownHours: number | null; // null = no cooldown
}

export const PEER_PLATFORMS: PeerPlatform[] = [
  {
    id: 'venmo',
    name: 'Venmo',
    processorName: 'venmo',
    idLabel: 'Venmo handle',
    placeholder: '@yourusername',
    currencies: ['USD'],
    logo: "data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%20width='64'%20height='64'%3e%3cg%20transform='matrix(.124031%200%200%20.124031%20-.000001%2056.062016)'%3e%3crect%20y='-452'%20rx='61'%20height='516'%20width='516'%20fill='%233396cd'/%3e%3cpath%20d='M385.16-347c11.1%2018.3%2016.08%2037.17%2016.08%2061%200%2076-64.87%20174.7-117.52%20244H163.5l-48.2-288.35%20105.3-10%2025.6%20205.17C270-174%20299.43-235%20299.43-276.56c0-22.77-3.9-38.25-10-51z'%20fill='%23fff'/%3e%3c/g%3e%3c/svg%3e",
    maxUSDC: 5,
    cooldownHours: 12,
  },
  {
    id: 'cashapp',
    name: 'Cash App',
    processorName: 'cashapp',
    idLabel: 'Cashtag',
    placeholder: '$yourtag',
    currencies: ['USD'],
    logo: '/images/platforms/cashapp.webp',
    maxUSDC: 100,
    cooldownHours: 12,
  },
];

export function getPlatform(id: string): PeerPlatform | undefined {
  return PEER_PLATFORMS.find(p => p.id === id);
}

const COOLDOWN_KEY = (id: string) => `peer_last_withdraw_${id}`;

export function getPlatformCooldownRemaining(platformId: string, cooldownHours: number | null): number {
  if (!cooldownHours || typeof localStorage === 'undefined') return 0;
  const stored = localStorage.getItem(COOLDOWN_KEY(platformId));
  if (!stored) return 0;
  const elapsed = Date.now() - parseInt(stored, 10);
  const remaining = cooldownHours * 3600_000 - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 60_000) : 0;
}

export function recordPlatformWithdraw(platformId: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(COOLDOWN_KEY(platformId), Date.now().toString());
  }
}

export function clearPlatformWithdraw(platformId: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(COOLDOWN_KEY(platformId));
  }
}

export function formatCooldown(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  }
  return `${minutes}m left`;
}

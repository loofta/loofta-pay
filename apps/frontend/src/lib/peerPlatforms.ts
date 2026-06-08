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
  {
    id: 'chime',
    name: 'Chime',
    processorName: 'chime',
    idLabel: 'Chime username',
    placeholder: 'yourusername',
    currencies: ['USD'],
    logo: '/images/platforms/chime.png',
    maxUSDC: 100,
    cooldownHours: 12,
  },
  {
    id: 'revolut',
    name: 'Revolut',
    processorName: 'revolut',
    idLabel: 'Revolut tag',
    placeholder: '@yourtag',
    currencies: ['USD'],
    logo: 'data:image/png;base64,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',
    maxUSDC: 100,
    cooldownHours: 12,
  },
  {
    id: 'wise',
    name: 'Wise',
    processorName: 'wise',
    idLabel: 'Wise tag',
    placeholder: '@yourtag',
    currencies: ['USD'],
    logo: 'data:image/png;base64,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',
    maxUSDC: 500,
    cooldownHours: null,
  },
  {
    id: 'zelle',
    name: 'Zelle',
    processorName: 'zelle',
    idLabel: 'Zelle email or phone',
    placeholder: 'you@email.com',
    currencies: ['USD'],
    logo: '/images/platforms/zelle.png',
    maxUSDC: 150,
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

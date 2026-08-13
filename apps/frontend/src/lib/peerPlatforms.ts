export interface PeerCurrency {
  code: string;
  label: string;
  flag: string;
  symbol: string;
  /** LP spread baked into the quoted rate. 0 = flat 1:1, >0 = % below market kept as LP incentive */
  spreadPercent: number;
}

// Peer Cash (@zkp2p/cash) prices every cash-out at the live oracle rate with zero spread — there
// is no spread knob to configure anymore, so this stays 0. (The old @zkp2p/sdk integration let us
// bake in a spread to incentivize faster fills; that concept doesn't exist in the new SDK.)
export const PEER_CURRENCIES: PeerCurrency[] = [
  { code: 'USD', label: 'US Dollar',          flag: '🇺🇸', symbol: '$',  spreadPercent: 0 },
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
  /**
   * Loofta-side cap, not a Peer Cash protocol limit — Peer Cash itself applies no
   * platform-specific max or cooldown to Venmo/Cash App (or Revolut/Zelle). Chargeback risk on
   * those rails is the taker's, handled protocol-side by restricting fills to vetted buyer groups
   * (Plus: $2k+ fulfilled chargebackable volume, Pro: $10k+), not by capping the maker's deposit.
   * null = no Loofta-side cap either (bounded only by the user's spendable balance).
   */
  maxUSDC: number | null;
  cooldownHours: number | null; // null = no cooldown — also a Loofta-side choice, not protocol-required
}

export const PEER_PLATFORMS: PeerPlatform[] = [
  {
    id: 'venmo',
    name: 'Venmo',
    processorName: 'venmo',
    idLabel: 'Venmo handle',
    placeholder: '@yourusername',
    currencies: ['USD'],
    logo: '/images/platforms/venmo.png',
    maxUSDC: null,
    cooldownHours: null,
  },
  {
    id: 'cashapp',
    name: 'Cash App',
    processorName: 'cashapp',
    idLabel: 'Cashtag',
    placeholder: '$yourtag',
    currencies: ['USD'],
    logo: '/images/platforms/cashapp.webp',
    maxUSDC: null,
    cooldownHours: null,
  },
  {
    id: 'revolut',
    name: 'Revolut',
    processorName: 'revolut',
    idLabel: 'Revolut username',
    placeholder: '@yourusername',
    currencies: ['USD'],
    logo: '/images/platforms/revolut.png',
    maxUSDC: null,
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
    maxUSDC: null,
    cooldownHours: null,
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

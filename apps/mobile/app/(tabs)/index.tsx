import { usePrivy } from '@privy-io/expo';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { CheckCircle2, ChevronDown, ChevronUp, Lock, Shuffle, Store, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { AuthGate } from '../../components/AuthGate';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { GhostButton } from '../../components/ui/GhostButton';
import { Card } from '../../components/ui/Card';
import { CountdownTile } from '../../components/ui/CountdownTile';
import { GradientText } from '../../components/ui/GradientText';
import { buyTickets, cancelTicket, confirmBuy, getDashboard, getTicketStatus, type TicketStatus } from '../../lib/api/lottery';
import { fmt, mbFee, totalCost, TICKET_PRICE_USDC } from '../../lib/lottery/fees';
import { connectSeekerWallet, signAndSendTransactionWithSeeker } from '../../lib/wallet/mwa';
import { useBalances } from '../../lib/wallet/BalanceProvider';
import { color, radius, space } from '../../lib/theme';
import { FONT_TITLE, FONT_TITLE_SEMIBOLD, FONT_BODY, FONT_BODY_MEDIUM, FONT_BODY_SEMIBOLD, FONT_BODY_BOLD } from '../../lib/fonts';

const PRESETS = [5, 10, 50, 100];
const MIN_TICKETS = 1;
const MAX_TICKETS = 100;

// ── Prize pool + countdown ──────────────────────────────────────────────────
// Ported from apps/frontend/src/app/app/megapot/page.tsx's PrizePoolHero — same field names
// (nextDraw.prizePool / nextDraw.drawTime from the dashboard), same digit-box styling via
// CountdownTile, and the same top-to-bottom white → amber gradient on the amount (web's
// `bg-gradient-to-b from-white via-slate-100 to-amber-200 bg-clip-text`).
function PrizePoolHero({ prizePool, drawTime }: { prizePool: string | null; drawTime: string | null }) {
  const [cd, setCd] = useState({ h: 0, m: 0, s: 0, done: true });

  useEffect(() => {
    if (!drawTime) {
      setCd({ h: 0, m: 0, s: 0, done: true });
      return;
    }
    const target = new Date(drawTime).getTime();
    const tick = () => {
      const diff = target - Date.now();
      if (diff <= 0) {
        setCd({ h: 0, m: 0, s: 0, done: true });
        return;
      }
      setCd({
        h: Math.floor(diff / 3_600_000),
        m: Math.floor((diff % 3_600_000) / 60_000),
        s: Math.floor((diff % 60_000) / 1000),
        done: false,
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [drawTime]);

  const amount = prizePool ? Math.round(parseFloat(prizePool) / 100_000) * 100_000 : 1_100_000;
  const pad = (n: number) => String(n).padStart(2, '0');
  const segs = [
    { v: pad(cd.h), l: 'HRS' },
    { v: pad(cd.m), l: 'MIN' },
    { v: pad(cd.s), l: 'SEC' },
  ];

  return (
    <View style={styles.prizePool}>
      <Text style={styles.prizePoolLabel}>Prize Pool</Text>
      <GradientText
        style={styles.prizePoolAmount}
        colors={['#FFFFFF', '#F1F5F9', '#FDE68A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      >
        {`$${amount.toLocaleString('en-US')}`}
      </GradientText>
      <View style={styles.countdownRow}>
        {segs.map((seg, i) => (
          <CountdownTile key={seg.l} value={seg.v} label={seg.l} showColon={i > 0} />
        ))}
      </View>
    </View>
  );
}

// ── Ticket numbers (cosmetic — mirrors apps/frontend/src/app/app/megapot/page.tsx's "Choose
// numbers" feature exactly: one TicketNumbers per ticket, a collapsible row-list, "Shuffle all",
// tap a row to edit it in the full-screen picker, "Add ticket". Not sent to the backend — Megapot
// assigns real ball numbers at mint time, fetched back and shown after purchase. ──
interface TicketNumbers {
  main: number[];
  bonus: number;
}
const MAIN_MAX = 30;
const MAIN_COUNT = 5;
const BONUS_MAX = 12;
const NUMBER_PICKER_LIMIT = 10;

function randomTicket(): TicketNumbers {
  const s = new Set<number>();
  while (s.size < MAIN_COUNT) s.add(Math.ceil(Math.random() * MAIN_MAX));
  return { main: [...s].sort((a, b) => a - b), bonus: Math.ceil(Math.random() * BONUS_MAX) };
}

// ── Post-purchase success screen pieces — ported from apps/frontend's DrawSuccessModal ─────

/** Same "DRAW IN" countdown as DrawSuccessModal — separate from PrizePoolHero's countdown since
 *  this one hides itself once the draw time passes instead of freezing at 00:00:00. */
function DrawInCountdown({ drawTime }: { drawTime: string | null }) {
  const [msLeft, setMsLeft] = useState(() => (drawTime ? new Date(drawTime).getTime() - Date.now() : 0));

  useEffect(() => {
    if (!drawTime) return;
    const tick = () => setMsLeft(new Date(drawTime).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [drawTime]);

  if (!drawTime || msLeft <= 0) return null;

  const totalSecs = Math.floor(msLeft / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const segs = [
    { v: pad(Math.floor(totalSecs / 3600)), l: 'HRS' },
    { v: pad(Math.floor((totalSecs % 3600) / 60)), l: 'MIN' },
    { v: pad(totalSecs % 60), l: 'SEC' },
  ];
  const drawLocal = new Date(drawTime).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={{ gap: space[2] }}>
      <Text style={styles.drawInLabel}>Draw in</Text>
      <View style={styles.countdownRow}>
        {segs.map((seg, i) => (
          <CountdownTile key={seg.l} value={seg.v} label={seg.l} showColon={i > 0} />
        ))}
      </View>
      <Text style={styles.drawLocalText}>Draw {drawLocal}</Text>
    </View>
  );
}

/** Same "no win data yet" rendering as web's TicketNumberCard when used without a winningNumbers
 *  prop — plain numbers (not bubbles), only the bonus gets the amber circle treatment. */
function TicketNumberCard({ tn }: { tn: TicketNumbers }) {
  return (
    <View style={styles.numberCard}>
      <View style={styles.numberCardMain}>
        <Text style={styles.numberCardLabel}>Numbers</Text>
        <View style={styles.numberCardMainRow}>
          {tn.main.map((n) => (
            <Text key={n} style={styles.numberCardDigit}>{n}</Text>
          ))}
        </View>
      </View>
      <View style={styles.numberCardDivider} />
      <View style={styles.numberCardBonusCol}>
        <Text style={styles.numberCardLabel}>Bonus</Text>
        <View style={styles.numberCardBonusCircle}>
          <Text style={styles.numberCardBonusText}>{tn.bonus}</Text>
        </View>
      </View>
    </View>
  );
}

type BuyStep = 'idle' | 'signing' | 'sent' | 'bridging' | 'buying' | 'done' | 'error';

const STEP_LABEL: Partial<Record<BuyStep, string>> = {
  signing: 'Confirm in your wallet',
  sent: 'Payment sent',
  bridging: 'Bridging to Base',
  buying: 'Buying your tickets',
};

// Same copy as apps/frontend/src/app/app/megapot/page.tsx's PurchaseProgressModal — cycled every
// 3.5s while a purchase is in flight, purely cosmetic (independent of actual progress).
const STEALTH_PHRASES = [
  'nobody will know about your gambling addiction 🤫',
  "shh, it's between us 🤐",
  'ninjas are moving your money to megapot 🥷',
  'printing tickets in the basement... 🎟️',
  'cutting through back alleys so nobody can trace it 🕵️',
];

const STATUS_TO_STEP: Partial<Record<TicketStatus, BuyStep>> = {
  sent: 'sent',
  bridging: 'bridging',
  buying: 'buying',
  active: 'done',
  won: 'done',
  failed: 'error',
};

// ─── Hang-tight tap game ────────────────────────────────────────────────────
// A purely cosmetic diversion for the ~minute a purchase is in flight — taps have zero effect
// on the purchase itself. Charge + unlocked auras persist on-device (expo-secure-store) across
// every future wait, so it slowly becomes a little collection game instead of just a spinner.
// Mirrors apps/frontend's TapGame in apps/frontend/src/app/app/megapot/page.tsx.

const MAGICBLOCK_MARK_XML = `
<svg width="96" height="88" viewBox="0 0 96 88" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12.2048 58.8714C13.176 59.0257 14.1988 59.1499 15.2688 59.2528C14.1988 59.1542 13.176 59.0257 12.2048 58.8714Z" fill="white"/>
<path d="M21.0014 21.4288C21.7191 23.293 23.0856 24.583 24.7616 25.2944C25.939 25.7915 27.2712 25.7701 28.4615 25.3029C33.0124 23.5245 37.8597 21.9217 42.8962 20.5546C48.8694 18.9304 54.7868 17.7176 60.4335 16.9376L23.0383 0.331256C20.4127 -0.804405 17.4819 1.11979 17.4905 3.97394L17.5593 30.1113C20.4213 28.2771 21.9167 24.8144 21.0057 21.4288H21.0014Z" fill="white"/>
<path d="M95.8176 26.1943C94.7561 22.3074 88.77 19.7018 79.3932 19.0375C75.2506 18.7461 70.6482 18.8447 65.7622 19.3032C58.822 19.9589 51.3103 21.3431 43.6783 23.4173C39.1446 24.6515 34.7743 26.0743 30.6446 27.6428C30.0343 27.8743 29.4327 28.1057 28.8354 28.3457C27.8556 28.7314 27.0133 29.417 26.4762 30.317C25.4835 31.9883 25.1569 33.9982 25.7714 36.0596C25.4491 35.1553 25.0065 34.4268 24.4693 33.8568C22.9868 32.2798 20.5803 31.9755 18.6594 32.9783C15.7501 34.4954 13.0686 36.081 10.6836 37.7224C7.06953 40.2037 3.22774 43.195 1.09627 47.1205C0.417298 48.3761 -0.0897845 49.7989 0.0133509 51.2432C0.155162 53.2188 1.43146 54.5773 2.98709 55.6787C3.82077 56.2701 4.7232 56.7672 5.66861 57.1572C8.65094 58.3914 12.0501 58.9571 15.2731 59.2528V50.9989C15.2731 50.1932 15.879 49.4732 16.6826 49.4347C17.5421 49.3918 18.2511 50.0689 18.2511 50.9175C18.2511 50.9175 18.2511 60.607 18.2511 60.6027V71.2651C18.2511 73.1078 19.2438 74.8306 20.8424 75.7563L40.7475 87.2972C41.5468 87.76 42.4579 88 43.3732 88C44.0436 88 44.714 87.8714 45.3457 87.6143L74.5072 75.6963C76.4711 74.8949 77.7431 73.005 77.7431 70.888V45.192L78.0697 45.0377C90.4115 38.468 97.2099 31.2641 95.8218 26.1943H95.8176ZM56.9097 55.7601C56.9097 58.7899 55.9428 60.5513 54.2282 60.5513C52.5136 60.5513 51.3791 58.9228 51.3791 55.2115V49.3104C51.3791 46.2805 52.346 44.5192 54.0606 44.5192C55.7752 44.5192 56.9097 46.1477 56.9097 49.8589V55.7601ZM68.8562 52.7945C68.8562 55.8244 67.8893 57.5857 66.1747 57.5857C64.4601 57.5857 63.3256 55.9572 63.3256 52.246V46.3448C63.3256 43.315 64.2925 41.5536 66.0071 41.5536C67.7217 41.5536 68.8562 43.1821 68.8562 46.8934V52.7945Z" fill="white"/>
</svg>
`;

interface TapAura { id: string; name: string; price: number; colors: [string, string]; glow: string; }

const TAP_AURAS: TapAura[] = [
  { id: 'ember', name: 'Classic Ember', price: 0, colors: ['#FF4A26', '#E1A041'], glow: 'rgba(255,122,42,0.5)' },
  { id: 'mint', name: 'Neon Mint', price: 50, colors: ['#10b981', '#5eead4'], glow: 'rgba(45,212,191,0.5)' },
  { id: 'violet', name: 'Cosmic Violet', price: 150, colors: ['#7c3aed', '#e9d5ff'], glow: 'rgba(167,139,250,0.5)' },
  { id: 'gold', name: 'Solar Gold', price: 400, colors: ['#f59e0b', '#fef08a'], glow: 'rgba(251,191,36,0.5)' },
  { id: 'aurora', name: 'Aurora', price: 1000, colors: ['#34d399', '#22d3ee'], glow: 'rgba(34,211,238,0.5)' },
];

const TAP_KEYS = { charge: 'loofta_tap_charge', owned: 'loofta_tap_owned', active: 'loofta_tap_active' } as const;

interface TapParticle { id: number; value: number; crit: boolean; x: number; anim: Animated.Value; }

function TapGame() {
  const [ready, setReady] = useState(false);
  const [charge, setCharge] = useState(0);
  const [owned, setOwned] = useState<string[]>(['ember']);
  const [activeId, setActiveId] = useState('ember');
  const [storeOpen, setStoreOpen] = useState(false);
  const [particles, setParticles] = useState<TapParticle[]>([]);
  const [combo, setCombo] = useState(0);

  const lastTapRef = useRef(0);
  const particleIdRef = useRef(0);
  const comboTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bounce = useRef(new Animated.Value(1)).current;
  const glowPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      try {
        const [savedCharge, savedOwned, savedActive] = await Promise.all([
          SecureStore.getItemAsync(TAP_KEYS.charge),
          SecureStore.getItemAsync(TAP_KEYS.owned),
          SecureStore.getItemAsync(TAP_KEYS.active),
        ]);
        const parsedOwned: unknown = savedOwned ? JSON.parse(savedOwned) : ['ember'];
        const nextOwned = Array.isArray(parsedOwned) ? (parsedOwned as string[]) : ['ember'];
        setCharge(Number(savedCharge) || 0);
        setOwned(nextOwned.includes('ember') ? nextOwned : ['ember', ...nextOwned]);
        setActiveId(savedActive ?? 'ember');
      } catch {
        // keep defaults
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Debounced so a rapid tap burst doesn't hammer the native keychain with a write per tap.
  useEffect(() => {
    if (!ready) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      SecureStore.setItemAsync(TAP_KEYS.charge, String(Math.floor(charge))).catch(() => {});
      SecureStore.setItemAsync(TAP_KEYS.owned, JSON.stringify(owned)).catch(() => {});
      SecureStore.setItemAsync(TAP_KEYS.active, activeId).catch(() => {});
    }, 400);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [charge, owned, activeId, ready]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(glowPulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glowPulse]);

  useEffect(() => () => { if (comboTimeoutRef.current) clearTimeout(comboTimeoutRef.current); }, []);

  const active = TAP_AURAS.find((a) => a.id === activeId) ?? TAP_AURAS[0];
  const comboMultiplier = 1 + Math.floor(combo / 8);
  const glowScale = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const glowOpacity = glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.85] });

  function spawnParticle(value: number, crit: boolean) {
    const id = particleIdRef.current++;
    const anim = new Animated.Value(0);
    const x = 22 + Math.random() * 46;
    setParticles((ps) => [...ps, { id, value, crit, x, anim }]);
    Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }).start(() => {
      setParticles((ps) => ps.filter((p) => p.id !== id));
    });
  }

  function handleTap() {
    const now = Date.now();
    const withinCombo = now - lastTapRef.current < 550;
    lastTapRef.current = now;
    const nextCombo = withinCombo ? Math.min(combo + 1, 50) : 1;
    setCombo(nextCombo);
    if (comboTimeoutRef.current) clearTimeout(comboTimeoutRef.current);
    comboTimeoutRef.current = setTimeout(() => setCombo(0), 700);

    const multiplier = 1 + Math.floor(nextCombo / 8);
    const roll = Math.random();
    const crit = roll < 0.06;
    const gain = (crit ? 5 : roll < 0.22 ? 2 : 1) * multiplier;
    setCharge((c) => c + gain);
    spawnParticle(gain, crit);

    bounce.setValue(0.86);
    Animated.spring(bounce, { toValue: 1, friction: 3, tension: 140, useNativeDriver: true }).start();
  }

  function buyAura(a: TapAura) {
    if (owned.includes(a.id) || charge < a.price) return;
    setCharge((c) => c - a.price);
    setOwned((o) => [...o, a.id]);
    setActiveId(a.id);
  }

  if (!ready) return <View style={styles.tapWrap} />;

  return (
    <View style={styles.tapWrap}>
      <View style={styles.tapTopBar}>
        <View style={styles.chargePill}>
          <Text style={styles.chargePillText}>⚡ {charge.toLocaleString()}</Text>
        </View>
        <TouchableOpacity style={styles.tapStoreButton} onPress={() => setStoreOpen(true)} activeOpacity={0.7}>
          <Store size={16} color={color.fg2} />
        </TouchableOpacity>
      </View>

      <View style={styles.tapButtonZone}>
        <Animated.View
          style={[styles.tapGlow, { backgroundColor: active.glow, transform: [{ scale: glowScale }], opacity: glowOpacity }]}
        />
        <Animated.View style={{ transform: [{ scale: bounce }] }}>
          <TouchableOpacity activeOpacity={0.9} onPress={handleTap}>
            <LinearGradient colors={active.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tapButton}>
              <SvgXml xml={MAGICBLOCK_MARK_XML} width={40} height={37} />
              {particles.map((p) => {
                const translateY = p.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -46] });
                const opacity = p.anim.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] });
                return (
                  <Animated.Text
                    key={p.id}
                    style={[
                      styles.tapParticle,
                      p.crit && styles.tapParticleCrit,
                      { left: `${p.x}%`, transform: [{ translateY }], opacity },
                    ]}
                  >
                    {p.crit ? `CRIT +${p.value}!` : `+${p.value}`}
                  </Animated.Text>
                );
              })}
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
        <View style={styles.comboSlot}>
          {comboMultiplier > 1 && <Text style={styles.comboText}>x{comboMultiplier} combo!</Text>}
        </View>
      </View>

      <Text style={styles.tapHint}>tap to charge up ⚡</Text>

      <Modal visible={storeOpen} transparent animationType="slide" onRequestClose={() => setStoreOpen(false)}>
        <View style={styles.storeBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setStoreOpen(false)} />
          <View style={styles.storeSheet}>
            <View style={styles.storeGrabber} />
            <View style={styles.storeHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.storeTitle}>Aura store</Text>
                <Text style={styles.storeSubtitle}>Spend Charge on a new look — yours to keep</Text>
              </View>
              <TouchableOpacity style={styles.storeCloseButton} onPress={() => setStoreOpen(false)} activeOpacity={0.7}>
                <X size={18} color={color.fg3} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.storeList}>
              {TAP_AURAS.map((a) => {
                const isOwned = owned.includes(a.id);
                const isActive = activeId === a.id;
                const canAfford = charge >= a.price;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.storeRow, isActive && styles.storeRowActive, !isOwned && !canAfford && styles.storeRowDisabled]}
                    disabled={!isOwned && !canAfford}
                    onPress={() => (isOwned ? setActiveId(a.id) : buyAura(a))}
                    activeOpacity={0.8}
                  >
                    <LinearGradient colors={a.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.storeSwatch} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.storeRowName}>{a.name}</Text>
                      <Text style={styles.storeRowStatus}>
                        {isActive ? 'Equipped' : isOwned ? 'Owned — tap to equip' : a.price === 0 ? 'Free' : `⚡ ${a.price}`}
                      </Text>
                    </View>
                    {isActive && <CheckCircle2 size={18} color={color.success} />}
                    {!isOwned && !canAfford && <Lock size={16} color={color.fg4} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Dev-only: jump straight into the "Hang tight" purchase screen (so the tap game can be previewed)
// without going through a real buy. Mirrors redeem.tsx's DevPreviewPanel — same chip styling,
// same __DEV__ gate, never rendered in production/TestFlight builds.
type BuyPreviewMode = 'buying' | null;

const BUY_DEV_PREVIEW_OPTIONS: { key: BuyPreviewMode; label: string }[] = [
  { key: 'buying', label: 'Hang tight (tap game)' },
  { key: null, label: 'Reset (live)' },
];

function BuyDevPreviewPanel({ mode, onSelect }: { mode: BuyPreviewMode; onSelect: (m: BuyPreviewMode) => void }) {
  if (!__DEV__) return null;
  return (
    <View style={styles.devPanel}>
      <Text style={styles.devPanelTitle}>DEV PREVIEW</Text>
      <View style={styles.devPanelRow}>
        {BUY_DEV_PREVIEW_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={String(opt.key)}
            style={[styles.devPanelChip, mode === opt.key && styles.devPanelChipActive]}
            onPress={() => onSelect(opt.key)}
          >
            <Text style={[styles.devPanelChipText, mode === opt.key && styles.devPanelChipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function BuyScreenInner() {
  const { getAccessToken } = usePrivy();
  const router = useRouter();
  const { refreshBalances } = useBalances();

  const [numTickets, setNumTicketsRaw] = useState(5);
  const [tickets, setTickets] = useState<TicketNumbers[]>(() => Array.from({ length: 5 }, randomTicket));
  const [chooseOpen, setChooseOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [showAllTickets, setShowAllTickets] = useState(false);

  const setTicketCount = (n: number) => {
    const c = Math.max(MIN_TICKETS, Math.min(MAX_TICKETS, n));
    setNumTicketsRaw(c);
    setTickets((prev) => {
      if (prev.length === c) return prev;
      if (c > prev.length) return [...prev, ...Array.from({ length: c - prev.length }, randomTicket)];
      return prev.slice(0, c);
    });
  };
  const updateTicket = (idx: number, t: TicketNumbers) => setTickets((prev) => prev.map((tt, i) => (i === idx ? t : tt)));

  const [step, setStep] = useState<BuyStep>('idle');
  const [stepError, setStepError] = useState('');
  const isRunning = !['idle', 'done', 'error'].includes(step);

  const [previewMode, setPreviewMode] = useState<BuyPreviewMode>(null);
  useEffect(() => {
    if (previewMode === 'buying') setStep('buying');
    else if (previewMode === null) setStep('idle');
  }, [previewMode]);
  const devPanel = <BuyDevPreviewPanel mode={previewMode} onSelect={setPreviewMode} />;

  // Which ticket a poll/AppState-triggered check should look at — a ref (not state) since it's
  // read from a setInterval callback and an AppState listener, neither of which should re-subscribe
  // every time the in-flight ticket changes.
  const activeTicketIdRef = useRef<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => () => stopPoll(), [stopPoll]);

  const checkStatusOnce = useCallback(
    async (ticketId: string) => {
      try {
        const accessToken = await getAccessToken();
        const t = await getTicketStatus(ticketId, accessToken);
        if (!t) return;
        const next = STATUS_TO_STEP[t.status];
        if (next === 'done' || next === 'error') {
          stopPoll();
          activeTicketIdRef.current = null;
          // Covers the resumed-purchase path (app was killed/backgrounded mid-buy and this poll
          // picks it up on relaunch) — the immediate refresh below the signed transaction only
          // fires on the live handleBuy() path, not this one.
          if (next === 'done') void refreshBalances();
        }
        if (next) setStep(next);
      } catch {
        // transient — next tick / next foreground will retry
      }
    },
    [getAccessToken, stopPoll, refreshBalances],
  );

  const pollStatus = useCallback(
    (ticketId: string) => {
      activeTicketIdRef.current = ticketId;
      stopPoll();
      pollRef.current = setInterval(() => checkStatusOnce(ticketId), 5_000);
    },
    [stopPoll, checkStatusOnce],
  );

  // The Seed Vault signing prompt backgrounds the app — JS timers are commonly throttled or
  // paused while backgrounded, so the 5s poll above can silently die mid-purchase even though the
  // backend keeps processing normally. Re-checking immediately on every foreground transition
  // closes that gap without waiting for the next (possibly-never-arriving) interval tick.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && activeTicketIdRef.current) {
        checkStatusOnce(activeTicketIdRef.current);
      }
    });
    return () => sub.remove();
  }, [checkStatusOnce]);

  const [nextDraw, setNextDraw] = useState<{ prizePool: string | null; drawTime: string | null }>({
    prizePool: null,
    drawTime: null,
  });
  useEffect(() => {
    // Mount-once: fetches the prize pool/countdown, and separately resumes any purchase left
    // in-flight from a prior session (app killed/backgrounded, or this screen simply remounted)
    // — mirrors the web app's dashboard-based restore. Without this, losing the local `step`/poll
    // for any reason leaves the buyer stuck on "Hang tight" forever with no local memory of the
    // ticket, even though the backend is still processing (or already finished) it.
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const dashboard = await getDashboard(accessToken);
        setNextDraw({ prizePool: dashboard.nextDraw?.prizePool ?? null, drawTime: dashboard.nextDraw?.drawTime ?? null });

        const resumable = dashboard.activeTickets.find((t) => ['sent', 'bridging', 'buying'].includes(t.status));
        if (resumable && activeTicketIdRef.current == null) {
          const next = STATUS_TO_STEP[resumable.status];
          if (next) setStep(next);
          pollStatus(resumable.id);
        }
      } catch {
        // keep defaults — PrizePoolHero falls back to a static amount, hides the countdown
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAccessToken]);

  // Cosmetic phrase rotation, only while a purchase is actually in flight.
  const [phraseIdx, setPhraseIdx] = useState(0);
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setPhraseIdx((i) => (i + 1) % STEALTH_PHRASES.length), 3_500);
    return () => clearInterval(id);
  }, [isRunning]);

  // If a purchase sits in the same step for 90s+, it's very likely still fine server-side (cron
  // ticks every 5s in the happy path) — but the buyer deserves an escape hatch rather than an
  // indefinite unlabeled spinner. History now shows in-flight tickets too (see history.tsx), so
  // it's a real answer, not a dead end.
  const [stuckHint, setStuckHint] = useState(false);
  useEffect(() => {
    if (!isRunning) {
      setStuckHint(false);
      return;
    }
    const t = setTimeout(() => setStuckHint(true), 90_000);
    return () => clearTimeout(t);
  }, [isRunning, step]);

  const cost = totalCost(numTickets);

  const resetBuy = () => {
    setStep('idle');
    setStepError('');
  };

  async function handleBuy() {
    setStep('signing');
    setStepError('');
    // Tracked outside the try so the catch block can decide what's actually safe to do: cancel a
    // ticket ONLY if we're certain no signature was ever requested for it. Once
    // signAndSendTransactionWithSeeker has been called, a thrown error (including a
    // CancellationException from the Android/MWA side) does NOT mean the transfer failed — MWA
    // can report cancellation even after the wallet already signed and broadcast successfully.
    // Auto-cancelling in that case would mark a real, funded purchase as failed and delete it
    // while the money has already left the wallet. So past that point, the only safe thing to do
    // is fall back to polling — the backend's on-chain balance check is the actual ground truth.
    let createdTicketId: string | null = null;
    let signAttempted = false;
    let accessToken: string | null = null;
    try {
      const { base58Address } = await connectSeekerWallet();
      accessToken = await getAccessToken();

      // Only the MagicBlock private transfer to sign now — no separate Loofta fee tx.
      const { ticketId, txBase64 } = await buyTickets(numTickets, base58Address, accessToken);
      createdTicketId = ticketId;
      signAttempted = true;
      const signature = await signAndSendTransactionWithSeeker(txBase64);
      setStep('sent');
      // The transfer has already landed on-chain at this point — refresh now instead of waiting
      // for the header chip's next mount, so the balance doesn't sit stale through the rest of
      // the purchase flow (bridging/buying can take a while).
      void refreshBalances();
      await confirmBuy(ticketId, signature, accessToken);
      pollStatus(ticketId);
    } catch (e: any) {
      setStep('error');
      setStepError(e?.message ?? 'Unknown error');
      if (createdTicketId && !signAttempted) {
        // Never reached the wallet prompt at all (e.g. ticket creation itself failed) — no
        // signature could possibly exist, safe to cancel outright.
        cancelTicket(createdTicketId, accessToken)
          .then(() => cancelTicket(createdTicketId!, accessToken))
          .catch(() => { });
      } else if (createdTicketId && signAttempted) {
        // Unknown outcome — poll instead of guessing. If the transfer actually landed, the
        // backend's burner-balance check promotes it to 'sent' on its own within a few seconds
        // and this poll picks that up; if it genuinely never went through, the ticket stays
        // pending_send and a backend cron cleans it up later (also balance-checked, same safety).
        pollStatus(createdTicketId);
      }
    }
  }

  // ── Purchase in progress ──────────────────────────────────────────────────
  if (isRunning) {
    return (
      <View style={styles.progressScreen}>
        <View style={styles.progressMain}>
          <Text style={styles.progressEmoji}>🎟️</Text>
          <Text style={styles.progressLabel}>{STEP_LABEL[step] ?? 'Processing'}</Text>
          <Text style={styles.progressTitle}>Hang tight</Text>
          <Text style={styles.progressHint}>{STEALTH_PHRASES[phraseIdx]}</Text>
          <TapGame />
          {stuckHint && (
            <TouchableOpacity onPress={() => router.push('/history')}>
              <Text style={styles.stuckHint}>Taking longer than usual — check History for status</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.progressSubHint}>🔒 Don&apos;t close the app — usually takes a minute.</Text>
        {devPanel}
      </View>
    );
  }

  // ── Purchase done — mirrors apps/frontend's DrawSuccessModal ────────────────
  if (step === 'done') {
    const showPicks = tickets.length > 0 && tickets[0].main.length > 0;
    const shownTickets = showAllTickets ? tickets : tickets.slice(0, 5);
    const prizePoolAmount = nextDraw.prizePool ? Math.round(parseFloat(nextDraw.prizePool)).toLocaleString('en-US') : null;

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.doneScreen}>
        <TouchableOpacity style={styles.doneCloseButton} onPress={resetBuy}>
          <X size={20} color={color.fg3} />
        </TouchableOpacity>

        <View style={styles.doneHeader}>
          <Text style={styles.doneEmoji}>🎟️✨</Text>
          <Text style={styles.doneEyebrow}>Tickets confirmed</Text>
          <GradientText
            style={styles.doneHeadline}
            colors={['#FFFFFF', '#F1F5F9', '#FDE68A']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          >
            Good luck! 🍀
          </GradientText>
          {prizePoolAmount && <Text style={styles.donePrizePool}>${prizePoolAmount} prize pool</Text>}
        </View>

        <DrawInCountdown drawTime={nextDraw.drawTime} />

        {showPicks && (
          <View style={{ gap: space[2] }}>
            <Text style={styles.drawInLabel}>Your tickets</Text>
            {shownTickets.map((t, i) => (
              <TicketNumberCard key={i} tn={t} />
            ))}
            {!showAllTickets && tickets.length > 5 && (
              <TouchableOpacity style={styles.moreTicketsButton} onPress={() => setShowAllTickets(true)}>
                <Text style={styles.moreTicketsText}>+{tickets.length - 5} more tickets</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={styles.doneCheckBack}>Check back soon to see if you&apos;ve won 🤞</Text>

        <GhostButton label="Buy more tickets" onPress={resetBuy} />
      </ScrollView>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  const base = numTickets * TICKET_PRICE_USDC;

  return (
    <View style={styles.screen}>
      <PrizePoolHero prizePool={nextDraw.prizePool} drawTime={nextDraw.drawTime} />

      <View style={styles.card}>
        <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.formTitle}>Buy tickets privately</Text>

          {/* Ticket count */}
          <View>
            <View style={styles.presetRow}>
              <Text style={styles.sectionTitle}>Tickets</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {PRESETS.map((n) => (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setTicketCount(n)}
                    style={[styles.presetChip, numTickets === n && styles.presetChipActive]}
                  >
                    <Text style={[styles.presetChipText, numTickets === n && styles.presetChipTextActive]}>{n}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.stepper}>
              <TouchableOpacity style={styles.stepperButton} onPress={() => setTicketCount(numTickets - 1)}>
                <Text style={styles.stepperButtonText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepperValue}>{numTickets}</Text>
              <TouchableOpacity style={styles.stepperButton} onPress={() => setTicketCount(numTickets + 1)}>
                <Text style={styles.stepperButtonText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Choose numbers (cosmetic preview only — see comment near TicketNumbers above) */}
          {numTickets <= NUMBER_PICKER_LIMIT ? (
            <Card style={styles.chooseCard}>
              <TouchableOpacity style={styles.chooseHeader} onPress={() => setChooseOpen((o) => !o)}>
                <Text style={styles.chooseHeaderText}>Choose numbers</Text>
                {chooseOpen ? <ChevronUp size={18} color={color.fg3} /> : <ChevronDown size={18} color={color.fg3} />}
              </TouchableOpacity>
              {chooseOpen && (
                <View style={styles.chooseBody}>
                  <TouchableOpacity style={styles.shuffleAllButton} onPress={() => setTickets(tickets.map(() => randomTicket()))}>
                    <Shuffle size={14} color={color.fg2} />
                    <Text style={styles.shuffleAllText}>Shuffle all</Text>
                  </TouchableOpacity>
                  <View style={styles.ticketList}>
                    {tickets.map((t, i) => (
                      <TouchableOpacity key={i} style={styles.ticketRow} onPress={() => setEditingIdx(i)}>
                        <View style={styles.ticketRowNumbers}>
                          {t.main.map((n) => (
                            <View key={n} style={styles.numberBubbleSmall}>
                              <Text style={styles.numberBubbleSmallText}>{n}</Text>
                            </View>
                          ))}
                          <View style={styles.ticketDivider} />
                          <View style={styles.bonusBubbleSmall}>
                            <Text style={styles.bonusBubbleSmallText}>{t.bonus}</Text>
                          </View>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={styles.addTicketButton}
                    onPress={() => {
                      if (tickets.length >= NUMBER_PICKER_LIMIT) return;
                      setTicketCount(numTickets + 1);
                    }}
                  >
                    <Text style={styles.addTicketButtonText}>+  Add ticket</Text>
                  </TouchableOpacity>
                  <Text style={styles.chooseHint}>Tap any row to edit numbers</Text>
                </View>
              )}
            </Card>
          ) : (
            <View style={styles.field}>
              <Shuffle size={16} color={color.fg2} style={{ marginRight: 8 }} />
              <Text style={styles.fieldHint}>Numbers picked randomly for {NUMBER_PICKER_LIMIT + 1}+ tickets</Text>
            </View>
          )}

          {/* Fee breakdown */}
          <View style={styles.feeCard}>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>{numTickets} ticket{numTickets === 1 ? '' : 's'}</Text>
              <Text style={styles.feeValue}>{fmt(base)}</Text>
            </View>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>Private transfer fee</Text>
              <Text style={styles.feeValue}>{fmt(mbFee(base))}</Text>
            </View>
            <View style={[styles.feeRow, styles.feeTotalRow]}>
              <Text style={styles.feeTotalLabel}>Total</Text>
              <Text style={styles.feeTotalValue}>{fmt(cost)}</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.cardFooter}>
          {step === 'error' && stepError ? <Text style={styles.error}>{stepError}</Text> : null}
          <PrimaryButton onPress={handleBuy} label={`Pay ${fmt(cost)}`} />
          <Text style={styles.shieldedNote}>🔒 Shielded via MagicBlock. Paid from your Seeker wallet.</Text>
        </View>
      </View>

      {editingIdx !== null && (
        <NumberPickerModal
          visible
          ticket={tickets[editingIdx]}
          onSave={(t) => updateTicket(editingIdx, t)}
          onClose={() => setEditingIdx(null)}
        />
      )}
      {devPanel}
    </View>
  );
}

// ── Number picker modal (full screen) ───────────────────────────────────────

function NumberPickerModal({
  visible,
  ticket,
  onSave,
  onClose,
}: {
  visible: boolean;
  ticket: TicketNumbers;
  onSave: (t: TicketNumbers) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TicketNumbers>(ticket);
  useEffect(() => {
    if (visible) setDraft(ticket);
  }, [visible, ticket]);

  function toggleMain(n: number) {
    setDraft((d) => {
      if (d.main.includes(n)) return { ...d, main: d.main.filter((x) => x !== n) };
      if (d.main.length >= MAIN_COUNT) return { ...d, main: [...d.main.slice(0, -1), n].sort((a, b) => a - b) };
      return { ...d, main: [...d.main, n].sort((a, b) => a - b) };
    });
  }

  function toggleBonus(n: number) {
    setDraft((d) => ({ ...d, bonus: d.bonus === n ? 0 : n }));
  }

  const isComplete = draft.main.length === MAIN_COUNT && draft.bonus > 0;
  const mainRemaining = MAIN_COUNT - draft.main.length;
  const saveLabel = !isComplete
    ? [mainRemaining > 0 && `${mainRemaining} main`, draft.bonus === 0 && 'bonus'].filter(Boolean).join(' + ') + ' left'
    : 'Save numbers';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.pickerScreen}>
        <View style={styles.pickerHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pickerTitle}>Choose numbers</Text>
            <Text style={styles.pickerProgress}>{draft.main.length}/{MAIN_COUNT} main · {draft.bonus > 0 ? 1 : 0}/1 bonus</Text>
          </View>
          <View style={styles.pickerHeaderActions}>
            <TouchableOpacity onPress={() => setDraft(randomTicket())} style={styles.pickerIconButton}>
              <Shuffle size={18} color={color.fg2} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={styles.pickerIconButton}>
              <Text style={styles.pickerCloseGlyph}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.pickerBody}>
          <Text style={styles.pickerSectionLabel}>Main numbers (pick {MAIN_COUNT})</Text>
          <View style={styles.numberGrid}>
            {Array.from({ length: MAIN_MAX }, (_, i) => i + 1).map((n) => {
              const selected = draft.main.includes(n);
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => toggleMain(n)}
                  style={[styles.numberBubble, selected && styles.numberBubbleActive]}
                >
                  <Text style={[styles.numberBubbleText, selected && styles.numberBubbleTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.pickerSectionLabel}>Bonus number (pick 1)</Text>
          <View style={styles.numberGrid}>
            {Array.from({ length: BONUS_MAX }, (_, i) => i + 1).map((n) => {
              const selected = draft.bonus === n;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => toggleBonus(n)}
                  style={[styles.numberBubble, selected && styles.numberBubbleActive]}
                >
                  <Text style={[styles.numberBubbleText, selected && styles.numberBubbleTextActive]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.pickerFooter}>
          <PrimaryButton
            disabled={!isComplete}
            label={saveLabel}
            onPress={() => {
              onSave(draft);
              onClose();
            }}
          />
          <TouchableOpacity onPress={onClose} style={styles.pickerCancel}>
            <Text style={styles.pickerCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function BuyScreen() {
  return (
    <View style={styles.container}>
      <AuthGate>
        <BuyScreenInner />
      </AuthGate>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: color.bgInk },
  screen: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[4], gap: space[2] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgInk, padding: space[6], gap: 10 },
  progressScreen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', backgroundColor: color.bgInk, paddingHorizontal: space[6], paddingTop: space[8], paddingBottom: space[8] },
  progressMain: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },

  // Prize pool
  prizePool: { alignItems: 'center', paddingVertical: space[2] },
  prizePoolLabel: { color: color.fg3, fontFamily: FONT_BODY_BOLD, fontSize: 13, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 10 },
  prizePoolAmount: { color: color.fg, fontFamily: FONT_TITLE, fontSize: 48 },
  countdownRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', marginTop: space[4] },

  // Unified card
  card: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.xl,
    backgroundColor: color.surface1,
    overflow: 'hidden',
  },
  cardScroll: { padding: space[5], paddingBottom: space[2], gap: space[4] },
  cardFooter: { padding: space[5], paddingTop: space[2], gap: 10 },

  formTitle: { color: color.fg, fontSize: 22, fontFamily: FONT_TITLE_SEMIBOLD },
  shieldedNote: { color: color.fg3, fontSize: 12, fontFamily: FONT_BODY, textAlign: 'center', marginTop: 2 },
  sectionTitle: { color: '#e2e8f0', fontSize: 17, fontFamily: FONT_BODY_SEMIBOLD },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md + 2,
    backgroundColor: color.surface3,
    paddingHorizontal: space[4],
    paddingVertical: space[4] - 2,
    gap: space[3],
  },
  fieldHint: { color: color.fg3, fontSize: 12, fontFamily: FONT_BODY, marginTop: 2, flexShrink: 1 },

  presetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm + 2, borderWidth: 1, borderColor: color.borderSoft, backgroundColor: color.surface1 },
  presetChipActive: { backgroundColor: 'rgba(255,74,38,0.16)', borderColor: color.brandOrange },
  presetChipText: { color: '#cbd5e1', fontSize: 14, fontFamily: FONT_BODY_MEDIUM },
  presetChipTextActive: { color: color.brandOrange },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.borderSoft, borderRadius: radius.md + 2, backgroundColor: color.surface1, overflow: 'hidden' },
  stepperButton: { width: 56, height: 48, alignItems: 'center', justifyContent: 'center' },
  stepperButtonText: { color: '#e2e8f0', fontSize: 24 },
  stepperValue: { flex: 1, textAlign: 'center', color: color.fg, fontSize: 22, fontFamily: FONT_BODY_BOLD },

  // Choose numbers
  chooseCard: { padding: 0 },
  chooseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[4] },
  chooseHeaderText: { color: color.fg, fontSize: 16, fontFamily: FONT_BODY_SEMIBOLD },
  chooseBody: { paddingHorizontal: space[4], paddingBottom: space[4], gap: space[3], borderTopWidth: 1, borderTopColor: color.borderSofter, paddingTop: space[3] },
  shuffleAllButton: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: color.borderSoft, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: space[2] },
  shuffleAllText: { color: color.fg2, fontSize: 13, fontFamily: FONT_BODY_MEDIUM },
  ticketList: { borderWidth: 1, borderColor: color.borderSofter, borderRadius: radius.md, overflow: 'hidden' },
  ticketRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: space[3] + 2, paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: color.borderSofter },
  ticketRowNumbers: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  ticketDivider: { width: 1, height: 24, backgroundColor: color.borderSoft, marginHorizontal: 4 },
  numberBubbleSmall: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: color.surface3, alignItems: 'center', justifyContent: 'center' },
  numberBubbleSmallText: { color: color.fg, fontSize: 15, fontFamily: FONT_BODY_BOLD },
  bonusBubbleSmall: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: color.fg, alignItems: 'center', justifyContent: 'center' },
  bonusBubbleSmallText: { color: color.bgInk, fontSize: 15, fontFamily: FONT_BODY_BOLD },
  addTicketButton: { alignItems: 'center', paddingVertical: space[3], borderWidth: 1, borderColor: color.borderSofter, borderRadius: radius.md },
  addTicketButtonText: { color: color.fg2, fontSize: 14, fontFamily: FONT_BODY_MEDIUM },
  chooseHint: { color: color.fg4, fontSize: 12, fontFamily: FONT_BODY, textAlign: 'center' },

  feeCard: {
    borderWidth: 1,
    borderColor: color.borderSofter,
    borderRadius: radius.md + 2,
    backgroundColor: color.surface1,
    overflow: 'hidden',
  },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space[4], paddingVertical: space[2] },
  feeLabel: { color: color.fg2, fontSize: 14, fontFamily: FONT_BODY },
  feeValue: { color: '#e2e8f0', fontSize: 14, fontFamily: FONT_BODY_MEDIUM },
  feeTotalRow: { borderTopWidth: 1, borderTopColor: color.borderSofter, marginTop: 4, paddingTop: space[3], paddingBottom: space[4] - 2 },
  feeTotalLabel: { color: color.fg, fontSize: 15, fontFamily: FONT_BODY_SEMIBOLD },
  feeTotalValue: { color: color.fg, fontSize: 15, fontFamily: FONT_BODY_SEMIBOLD },

  error: { color: color.danger, fontSize: 13, fontFamily: FONT_BODY, textAlign: 'center' },

  progressEmoji: { fontSize: 56 },
  progressLabel: { color: color.warn, fontSize: 14, fontFamily: FONT_BODY_BOLD, letterSpacing: 2, textTransform: 'uppercase' },
  progressTitle: { color: color.fg, fontSize: 28, fontFamily: FONT_TITLE },
  progressHint: { color: color.fg2, fontSize: 19, fontFamily: FONT_BODY_MEDIUM, textAlign: 'center' },
  progressSubHint: { color: color.fg3, fontSize: 14, fontFamily: FONT_BODY, textAlign: 'center' },
  stuckHint: { color: color.brandOrange, fontSize: 15, fontFamily: FONT_BODY_MEDIUM, textAlign: 'center', textDecorationLine: 'underline', marginTop: space[2] },

  // Hang-tight tap game
  tapWrap: { width: '100%', alignItems: 'center', gap: space[2], marginTop: space[2] },
  tapTopBar: { width: '100%', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: space[2] },
  chargePill: { paddingHorizontal: space[3], paddingVertical: 5, borderRadius: radius.pill, backgroundColor: color.surface3, borderWidth: 1, borderColor: color.borderSoft },
  chargePillText: { color: '#e2e8f0', fontSize: 12, fontFamily: FONT_BODY_BOLD, fontVariant: ['tabular-nums'] },
  tapStoreButton: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface3, borderWidth: 1, borderColor: color.borderSoft },
  tapButtonZone: { alignItems: 'center', justifyContent: 'center', marginTop: space[2] },
  tapGlow: { position: 'absolute', width: 128, height: 128, borderRadius: 64 },
  tapButton: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center' },
  tapParticle: { position: 'absolute', top: 8, color: '#fff', fontSize: 14, fontFamily: FONT_BODY_BOLD },
  tapParticleCrit: { color: '#fbbf24' },
  comboSlot: { height: 20, marginTop: space[1], alignItems: 'center', justifyContent: 'center' },
  comboText: { color: '#fbbf24', fontSize: 12, fontFamily: FONT_BODY_BOLD, letterSpacing: 0.5, textTransform: 'uppercase' },
  tapHint: { color: color.fg4, fontSize: 12, fontFamily: FONT_BODY },

  storeBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  storeSheet: {
    backgroundColor: color.bgInkSoft,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[6],
    paddingTop: space[3],
    paddingBottom: space[8],
    maxHeight: '75%',
    gap: space[4],
  },
  storeGrabber: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: color.borderStrong, alignSelf: 'center', marginBottom: space[2] },
  storeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  storeTitle: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 20 },
  storeSubtitle: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 13, marginTop: 2 },
  storeCloseButton: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface3 },
  storeList: { gap: space[2], paddingBottom: space[2] },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3] + 1,
    paddingVertical: space[3],
    borderRadius: radius.md + 2,
    borderWidth: 1,
    borderColor: color.borderSoft,
    backgroundColor: color.surface1,
  },
  storeRowActive: { borderColor: color.borderStrong, backgroundColor: color.surface3 },
  storeRowDisabled: { opacity: 0.4 },
  storeSwatch: { width: 40, height: 40, borderRadius: 20 },
  storeRowName: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 15 },
  storeRowStatus: { color: color.fg3, fontFamily: FONT_BODY, fontSize: 12, marginTop: 2 },

  // Dev preview panel (Buy tab) — mirrors redeem.tsx's devPanel exactly
  devPanel: {
    borderTopWidth: 1,
    borderTopColor: color.borderSofter,
    backgroundColor: color.bgInkSoft,
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[3],
    gap: space[2],
  },
  devPanelTitle: { color: color.fg4, fontFamily: FONT_BODY_BOLD, fontSize: 10, letterSpacing: 1.5 },
  devPanelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  devPanelChip: { paddingHorizontal: space[2] + 2, paddingVertical: 6, borderRadius: radius.sm + 2, borderWidth: 1, borderColor: color.borderSoft, backgroundColor: color.surface1 },
  devPanelChipActive: { borderColor: color.brandOrange, backgroundColor: 'rgba(255,74,38,0.16)' },
  devPanelChipText: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 11 },
  devPanelChipTextActive: { color: color.brandOrange },

  // number picker (full screen)
  pickerScreen: { flex: 1, backgroundColor: color.bgInk, paddingTop: 60 },
  pickerHeader: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space[5], paddingBottom: space[4] - 2, borderBottomWidth: 1, borderBottomColor: color.borderSofter, gap: space[3] },
  pickerTitle: { color: color.fg, fontSize: 20, fontFamily: FONT_TITLE_SEMIBOLD },
  pickerProgress: { color: color.fg2, fontSize: 13, fontFamily: FONT_BODY, marginTop: 4 },
  pickerHeaderActions: { flexDirection: 'row', gap: space[2] },
  pickerIconButton: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: color.surface3, borderWidth: 1, borderColor: color.borderSoft, alignItems: 'center', justifyContent: 'center' },
  pickerCloseGlyph: { color: color.fg2, fontSize: 16 },
  pickerBody: { padding: space[5], gap: space[5] },
  pickerSectionLabel: { color: '#e2e8f0', fontSize: 14, fontFamily: FONT_BODY_SEMIBOLD, marginBottom: 10 },
  numberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  numberBubble: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface3, borderWidth: 1, borderColor: color.borderSoft },
  numberBubbleActive: { backgroundColor: color.brandOrange, borderColor: color.brandOrange },
  numberBubbleText: { color: '#cbd5e1', fontSize: 15, fontFamily: FONT_BODY_SEMIBOLD },
  numberBubbleTextActive: { color: color.fg },
  pickerFooter: { padding: space[5], gap: 8, borderTopWidth: 1, borderTopColor: color.borderSofter },
  pickerCancel: { alignItems: 'center', paddingVertical: 10 },
  pickerCancelText: { color: color.fg3, fontSize: 15, fontFamily: FONT_BODY },

  // Purchase done — mirrors DrawSuccessModal
  doneScreen: { padding: space[5], paddingTop: space[2], gap: space[5], flexGrow: 1 },
  doneCloseButton: { alignSelf: 'flex-end', padding: space[2] },
  doneHeader: { alignItems: 'center', gap: space[2] },
  doneEmoji: { fontSize: 52 },
  doneEyebrow: { color: color.success, fontFamily: FONT_BODY_BOLD, fontSize: 13, letterSpacing: 3, textTransform: 'uppercase', marginTop: 4 },
  doneHeadline: { fontFamily: FONT_TITLE, fontSize: 40, textAlign: 'center' },
  donePrizePool: { color: '#fcd34d', fontFamily: FONT_BODY_SEMIBOLD, fontSize: 17 },
  drawInLabel: { color: color.fg2, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center' },
  drawLocalText: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 13, textAlign: 'center', marginTop: 2 },

  numberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.md + 2,
    backgroundColor: color.surface1,
    paddingHorizontal: space[3],
    minHeight: 58,
  },
  numberCardMain: { flex: 1, gap: 6, paddingVertical: space[3] },
  numberCardLabel: { color: color.fg4, fontFamily: FONT_BODY_BOLD, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase' },
  numberCardMainRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  numberCardDigit: { color: color.fg2, fontFamily: FONT_BODY_BOLD, fontSize: 14, fontVariant: ['tabular-nums'] },
  numberCardDivider: { alignSelf: 'stretch', width: 1, borderLeftWidth: 1, borderLeftColor: color.borderSoft, borderStyle: 'dashed', marginHorizontal: space[2] },
  numberCardBonusCol: { alignItems: 'center', gap: 6, paddingVertical: space[3] },
  numberCardBonusCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(245,158,11,0.5)', backgroundColor: 'rgba(245,158,11,0.1)', alignItems: 'center', justifyContent: 'center' },
  numberCardBonusText: { color: '#fbbf24', fontFamily: FONT_BODY_BOLD, fontSize: 13, fontVariant: ['tabular-nums'] },

  moreTicketsButton: { alignItems: 'center', paddingVertical: space[2] + 2, borderWidth: 1, borderColor: color.borderSoft, borderRadius: radius.md + 2 },
  moreTicketsText: { color: color.fg2, fontFamily: FONT_BODY_MEDIUM, fontSize: 14 },
  doneCheckBack: { color: '#cbd5e1', fontFamily: FONT_BODY_MEDIUM, fontSize: 16, textAlign: 'center' },
});

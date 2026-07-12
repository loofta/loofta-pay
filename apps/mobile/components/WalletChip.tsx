import { usePrivy } from '@privy-io/expo';
import { useRouter } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getWalletBalances } from '../lib/api/users';
import { color, radius, space } from '../lib/theme';
import { FONT_BODY_SEMIBOLD } from '../lib/fonts';
import { UsdcIcon } from './TokenIcons';

/** Live USDC balance chip — dot + USDC mark + amount + chevron. Taps route to the Profile tab,
 *  which already has the full wallet detail card + Disconnect (no separate detail sheet needed). */
export function WalletChip() {
  const { user, getAccessToken } = usePrivy();
  const router = useRouter();
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setUsdcBalance(null);
      return;
    }
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const balances = await getWalletBalances(accessToken);
        setUsdcBalance(balances.usdcBalance);
      } catch {
        // chip just shows a dash — Profile tab is the source of truth
      }
    })();
  }, [user, getAccessToken]);

  if (!user) return null;

  return (
    <TouchableOpacity style={styles.chip} onPress={() => router.push('/profile')} activeOpacity={0.8}>
      <View style={styles.dot} />
      <UsdcIcon size={14} />
      <Text style={styles.amount}>{usdcBalance == null ? '—' : usdcBalance.toFixed(2)}</Text>
      <ChevronRight size={14} color={color.fg3} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2] - 2,
    paddingHorizontal: space[3],
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: color.bgInkSoft,
    borderWidth: 1,
    borderColor: color.borderSoft,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.success },
  amount: { color: color.fg, fontFamily: FONT_BODY_SEMIBOLD, fontSize: 13, fontVariant: ['tabular-nums'] },
});

import { usePrivy } from '@privy-io/expo';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AuthGate } from '../components/AuthGate';
import { claimLotteryGift, getLotteryGiftPublic, parseGiftToken, type LotteryGiftPublic } from '../lib/api/lotteryGift';
import { FONT_TITLE } from '../lib/fonts';

function ClaimGiftInner() {
  const { getAccessToken } = usePrivy();

  const [input, setInput] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [gift, setGift] = useState<LotteryGiftPublic | null>(null);
  const [looking, setLooking] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimedTickets, setClaimedTickets] = useState<number | null>(null);

  const handleLookup = async () => {
    const parsed = parseGiftToken(input);
    if (!parsed) {
      setError('Enter a gift link or code.');
      return;
    }
    setError(null);
    setLooking(true);
    setGift(null);
    try {
      const accessToken = await getAccessToken();
      const result = await getLotteryGiftPublic(parsed, accessToken);
      setToken(parsed);
      setGift(result);
    } catch (e: any) {
      // Backend already distinguishes "bad token" from "wrong account" in the message — show it
      // as-is rather than a generic "not found" (see lottery.service.ts getGiftPublic).
      setError(e?.message ?? 'Gift not found');
    } finally {
      setLooking(false);
    }
  };

  const handleClaim = async () => {
    if (!token) return;
    setClaiming(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      const result = await claimLotteryGift(token, accessToken);
      setClaimedTickets(result.numTickets);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't claim");
    } finally {
      setClaiming(false);
    }
  };

  if (claimedTickets != null) {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>🎉</Text>
        <Text style={styles.title}>Claimed!</Text>
        <Text style={styles.hint}>
          {claimedTickets} Megapot ticket{claimedTickets === 1 ? '' : 's'} on the way — check the History tab in a couple minutes.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Claim a gift</Text>
      <Text style={styles.hint}>Paste the gift link or code someone sent you.</Text>

      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder="pay.loofta.xyz/gift/… or the code"
        placeholderTextColor="#6b7280"
        autoCapitalize="none"
      />

      {error && <Text style={styles.error}>{error}</Text>}

      {!gift ? (
        <TouchableOpacity style={styles.button} disabled={looking || !input.trim()} onPress={handleLookup}>
          {looking ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Look up</Text>}
        </TouchableOpacity>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {gift.numTickets} Megapot ticket{gift.numTickets === 1 ? '' : 's'}
          </Text>
          <Text style={styles.hint}>From {gift.senderUsername ? `@${gift.senderUsername}` : 'someone'}</Text>

          {gift.status === 'claimed' ? (
            <Text style={styles.hint}>{gift.isClaimant ? 'You already claimed this.' : 'Already claimed.'}</Text>
          ) : gift.isSender ? (
            <Text style={styles.hint}>You sent this gift — nothing to claim.</Text>
          ) : (
            <TouchableOpacity style={styles.button} disabled={claiming} onPress={handleClaim}>
              {claiming ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Claim {gift.numTickets} ticket{gift.numTickets === 1 ? '' : 's'}</Text>}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

export default function ClaimGiftScreen() {
  return (
    <View style={styles.container}>
      <AuthGate>
        <ClaimGiftInner />
      </AuthGate>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f12', padding: 20, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f0f12', padding: 24, gap: 10 },
  title: { color: '#fff', fontSize: 22, fontFamily: FONT_TITLE, marginTop: 4 },
  hint: { color: '#9ca3af', fontSize: 13, textAlign: 'center' },
  emoji: { fontSize: 56 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.03)',
    fontSize: 15,
  },
  card: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 16,
    gap: 8,
    alignItems: 'center',
  },
  cardTitle: { color: '#fff', fontSize: 18, fontFamily: FONT_TITLE },
  button: { backgroundColor: '#FF7A2A', borderRadius: 12, padding: 16, alignItems: 'center', width: '100%' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: '#f87171', fontSize: 14 },
});

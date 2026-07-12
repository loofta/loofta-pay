/**
 * On-device personal best for the "hang-tight" tap game (apps/(tabs)/index.tsx TapGame).
 * Unlike `charge`, which resets every purchase wait, this survives across every future wait.
 */
import * as SecureStore from 'expo-secure-store';

const TAP_HIGH_SCORE_KEY = 'tap_high_score';

export async function getTapHighScore(): Promise<number> {
  const raw = await SecureStore.getItemAsync(TAP_HIGH_SCORE_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function setTapHighScore(value: number): Promise<void> {
  await SecureStore.setItemAsync(TAP_HIGH_SCORE_KEY, String(Math.floor(value)));
}

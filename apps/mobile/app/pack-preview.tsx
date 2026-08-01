/**
 * TEMPORARY __DEV__-only diagnostic route for visually iterating on MegapotPackGL without needing
 * Seeker/MWA auth (which can't work on a plain emulator, no Seed Vault). Reach it via:
 *   adb shell am start -a android.intent.action.VIEW -d "loofta://pack-preview"
 * Delete before shipping.
 */
import { useCallback } from 'react';
import { View } from 'react-native';
import MegapotPackGL from '../components/MegapotPackGL';
import type { PackOpenResult } from '../lib/api/pack';

export default function PackPreviewScreen() {
  const resolveOpen = useCallback(async (): Promise<PackOpenResult> => {
    await new Promise((r) => setTimeout(r, 800));
    return { id: 'preview', tierKey: '5', ticketsAwarded: 5, rarity: 'rare' };
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: '#08060A', justifyContent: 'center', padding: 20 }}>
      <MegapotPackGL canOpen resolveOpen={resolveOpen} onOpened={() => {}} onError={(e) => console.warn('[preview] error', e)} />
    </View>
  );
}

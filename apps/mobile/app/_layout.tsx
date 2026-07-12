// Actual entry point is index.js, which imports these before expo-router/entry — see there for
// why. Re-imported here too since ES module imports are idempotent and cheap insurance.
import '../polyfills';
import { PrivyProvider } from '@privy-io/expo';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { useCallback, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AnimatedSplash } from '../components/SplashScreen';
import { FONT_ASSETS, FONT_TITLE } from '../lib/fonts';

// Held until fonts are loaded and the animated intro below has mounted, so the native splash
// hands off to it with no gap/flash (and no font swap) in between.
ExpoSplashScreen.preventAutoHideAsync().catch(() => {});

const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID!;
const PRIVY_CLIENT_ID = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID!;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const [showIntro, setShowIntro] = useState(true);
  const ready = fontsLoaded || !!fontError;

  const onRootLayout = useCallback(() => {
    if (ready) ExpoSplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <PrivyProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID}>
      <SafeAreaProvider onLayout={onRootLayout}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="claim-gift"
            options={{
              headerShown: true,
              presentation: 'modal',
              title: 'Claim a gift',
              headerStyle: { backgroundColor: '#0f0f12' },
              headerTintColor: '#fff',
              headerTitleStyle: { fontFamily: FONT_TITLE },
            }}
          />
        </Stack>
        {showIntro && <AnimatedSplash onFinish={() => setShowIntro(false)} />}
      </SafeAreaProvider>
    </PrivyProvider>
  );
}

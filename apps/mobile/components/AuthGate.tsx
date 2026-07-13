import { usePrivy } from '@privy-io/expo';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../lib/i18n/LanguageProvider';
import { FONT_TITLE } from '../lib/fonts';

/**
 * Login UI lives in one place (the Profile tab) — every other tab wraps its content in this
 * gate instead of duplicating a login form, and just points here when unauthenticated.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, isReady } = usePrivy();
  const router = useRouter();
  const { t } = useTranslation();

  if (!isReady) {
    return <View style={styles.center} />;
  }

  if (!user) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{t.authGateTitle}</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.push('/profile')}>
          <Text style={styles.buttonText}>{t.authGateButton}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f0f12', gap: 16 },
  title: { color: '#fff', fontSize: 18, fontFamily: FONT_TITLE },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#FF7A2A',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});

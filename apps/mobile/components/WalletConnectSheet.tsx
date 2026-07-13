import { Modal, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../lib/i18n/LanguageProvider';
import { color, radius, space } from '../lib/theme';
import { FONT_BODY, FONT_BODY_SEMIBOLD, FONT_TITLE_SEMIBOLD } from '../lib/fonts';
import { SolIcon } from './TokenIcons';
import { PrimaryButton } from './ui/PrimaryButton';
import { GhostButton } from './ui/GhostButton';

/**
 * App-level "confirm you want to connect" step shown before the real native Seed Vault prompt
 * (that OS-level UI can't be skinned — this sheet is what precedes it). Deliberately shows no
 * fabricated address/balance: that data doesn't exist until after the real connect succeeds.
 */
export function WalletConnectSheet({
  visible,
  busy,
  statusLabel,
  onCancel,
  onConnect,
}: {
  visible: boolean;
  busy: boolean;
  statusLabel: string;
  onCancel: () => void;
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <SolIcon size={32} />
          <Text style={styles.title}>{t.walletConnectTitle}</Text>
          <View style={styles.accountRow}>
            <Text style={styles.accountLabel}>{t.walletConnectYourWallet}</Text>
          </View>
          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <GhostButton label={t.cancel} onPress={onCancel} disabled={busy} />
            </View>
            <View style={{ flex: 1 }}>
              <PrimaryButton label={busy ? statusLabel : t.connect} onPress={onConnect} disabled={busy} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: color.bgInkSoft,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[6],
    paddingBottom: space[8],
    alignItems: 'center',
    gap: space[3],
  },
  grabber: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: color.borderStrong, marginBottom: space[2] },
  title: { color: color.fg, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 18, textAlign: 'center' },
  accountRow: {
    width: '100%',
    borderWidth: 1,
    borderColor: color.borderSoft,
    borderRadius: radius.md,
    backgroundColor: color.surface1,
    padding: space[4],
    alignItems: 'center',
  },
  accountLabel: { color: color.fg2, fontFamily: FONT_BODY, fontSize: 14 },
  actions: { flexDirection: 'row', gap: space[3], width: '100%', marginTop: space[2] },
});

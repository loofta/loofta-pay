import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, space } from '../lib/theme';
import { Wordmark } from './Wordmark';
import { WalletChip } from './WalletChip';

export function Header() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Wordmark width={92} />
        <WalletChip />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: color.bgInk, borderBottomWidth: 1, borderBottomColor: color.borderSofter },
  bar: { height: 52, paddingHorizontal: space[4], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

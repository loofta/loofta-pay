import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui';
import { View, StyleSheet } from 'react-native';
import { Header } from '../../components/Header';
import { TabBar } from '../../components/TabBar';
import { BalanceProvider } from '../../lib/wallet/BalanceProvider';
import { color } from '../../lib/theme';

// SDK 57 replaced the old @react-navigation/bottom-tabs-based `Tabs`/`tabBar` render prop with
// this headless expo-router/ui API. Route discovery (`parseTriggersFromChildren` in expo-router's
// own source) only recurses into Fragment and TabList children of <Tabs> — an extra wrapping
// <View> around TabList makes it invisible to that scan ("Couldn't find any screens for the
// navigator"). So Header/TabSlot/TabList/TabBar must be direct (Fragment-nested) children of
// <Tabs>; the flex column layout instead comes from `style` passed straight to <Tabs> itself
// (it's ViewProps under the hood). TabSlot may still be wrapped in its own View for sizing — only
// TabList's own nesting matters. Names here must match components/TabBar.tsx's TAB_ITEMS names.
export default function TabsLayout() {
  return (
    <BalanceProvider>
      <Tabs style={styles.root}>
        <Header />
        <View style={styles.content}>
          <TabSlot />
        </View>
        <TabList style={styles.hidden}>
          <TabTrigger name="buy" href="/" />
          <TabTrigger name="redeem" href="/redeem" />
          <TabTrigger name="history" href="/history" />
          <TabTrigger name="profile" href="/profile" />
        </TabList>
        <TabBar />
      </Tabs>
    </BalanceProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bgInk },
  content: { flex: 1 },
  hidden: { display: 'none' },
});

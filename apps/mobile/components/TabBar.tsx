import { TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Award, Clock, Settings, Ticket, type LucideIcon } from 'lucide-react-native';
import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, space } from '../lib/theme';
import { FONT_TITLE_SEMIBOLD } from '../lib/fonts';

export const TAB_ITEMS: { name: string; label: string; icon: LucideIcon }[] = [
  { name: 'buy', label: 'Buy', icon: Ticket },
  { name: 'redeem', label: 'Redeem', icon: Award },
  { name: 'history', label: 'History', icon: Clock },
  { name: 'profile', label: 'Settings', icon: Settings },
];

/** TabTrigger's `asChild` clones this element, injecting `isFocused` as a prop (not a render-prop
 *  — expo-router/ui's Pressable slot type overrides children to plain ReactNode). */
const TabButton = forwardRef<View, TabTriggerSlotProps & { icon: LucideIcon; label: string }>(
  ({ isFocused, icon: Icon, label, ...pressableProps }, ref) => (
    <Pressable ref={ref} {...pressableProps} style={styles.tab}>
      <View style={styles.tabInner}>
        <View style={[styles.iconWrap, isFocused && styles.iconWrapActive]}>
          <Icon size={20} color={isFocused ? color.fg : color.fg3} />
        </View>
        <Text style={[styles.label, isFocused && styles.labelActive]}>{label}</Text>
      </View>
    </Pressable>
  ),
);

/** Active tab = icon in a solid brandOrange circle + brandYellow label; inactive = fg3. Built on
 *  expo-router/ui's headless Tabs (SDK 57 replaced the old @react-navigation/bottom-tabs-based
 *  `tabBar` render prop with this TabTrigger/isFocused pattern — see app/(tabs)/_layout.tsx). */
export function TabBar() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space[2]) }]}>
      {TAB_ITEMS.map(({ name, label, icon }) => (
        <TabTrigger key={name} name={name} asChild>
          <TabButton icon={icon} label={label} />
        </TabTrigger>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: color.bgInk,
    borderTopWidth: 1,
    borderTopColor: color.borderSofter,
    paddingTop: space[2],
  },
  tab: { flex: 1 },
  tabInner: { alignItems: 'center', gap: 5 },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconWrapActive: { backgroundColor: color.brandOrange },
  label: { color: color.fg3, fontFamily: FONT_TITLE_SEMIBOLD, fontSize: 13 },
  labelActive: { color: color.brandYellow },
});

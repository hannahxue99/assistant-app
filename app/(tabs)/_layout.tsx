import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { XiaozhiMascot } from '@/src/components/XiaozhiMascot';
import { theme } from '@/src/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textDim,
        sceneStyle: styles.scene,
        tabBarBackground: () => <View style={styles.tabBarBackground} />,
        tabBarStyle: {
          backgroundColor: theme.colors.tabBar,
          borderTopColor: theme.colors.border,
          shadowColor: '#8A5B3D',
          shadowOpacity: 0.06,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -4 },
          elevation: 8,
          height: 70,
          paddingBottom: 9,
          paddingTop: 7,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '首页',
          tabBarIcon: ({ size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={focused ? theme.colors.accent : theme.colors.textDim} />
          ),
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: '小知',
          tabBarLabel: () => null,
          tabBarIconStyle: styles.xiaozhiTabIcon,
          tabBarIcon: ({ focused }) => (
            <View style={styles.xiaozhiTabSlot}>
              <View style={[styles.xiaozhiTabGlyph, focused && styles.xiaozhiTabGlyphFocused]}>
                <XiaozhiMascot size={64} />
              </View>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={focused ? theme.colors.accent : theme.colors.textDim} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: '#FFFFFF' },
  tabBarBackground: { flex: 1, backgroundColor: '#FFFFFF' },
  xiaozhiTabIcon: { width: 70, height: 54, marginTop: -1, overflow: 'visible' },
  xiaozhiTabSlot: { width: 70, height: 54, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  xiaozhiTabGlyph: { position: 'absolute', bottom: 0, width: 64, height: 64, alignItems: 'center', justifyContent: 'center', transformOrigin: 'center bottom' },
  xiaozhiTabGlyphFocused: { transform: [{ scale: 1.28 }] },
});

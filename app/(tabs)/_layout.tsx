import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { XiaozhiEyesIcon } from '@/src/components/XiaozhiEyesIcon';
import { theme } from '@/src/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.accent,
        sceneStyle: styles.scene,
        tabBarBackground: () => <View style={styles.tabBarBackground} />,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#F1EEE9',
          shadowColor: 'transparent',
          elevation: 0,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
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
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={theme.colors.accent} />
          ),
        }}
      />
      <Tabs.Screen
        name="assistant"
        options={{
          title: '小知',
          tabBarIcon: ({ size, focused }) => (
            <XiaozhiEyesIcon size={size} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={theme.colors.accent} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: '#FFFFFF' },
  tabBarBackground: { flex: 1, backgroundColor: '#FFFFFF' },
});

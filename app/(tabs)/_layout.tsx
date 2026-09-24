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
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={focused ? theme.colors.accent : theme.colors.textDim} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: { backgroundColor: theme.colors.bg },
  tabBarBackground: { flex: 1, backgroundColor: theme.colors.tabBar },
});

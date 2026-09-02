import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { useApp } from '../../src/context/AppContext';
import { useAuth } from '../../src/context/AuthContext';
import FeatureIcon from '../../src/components/FeatureIcon';
import { spacing, type, useTheme } from '../../src/theme';

const LABELS = {
  home: '\u0e2b\u0e19\u0e49\u0e32\u0e2b\u0e25\u0e31\u0e01',
  discover: '\u0e04\u0e49\u0e19\u0e2b\u0e32\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e19',
  chat: '\u0e41\u0e0a\u0e15',
  meetup: '\u0e01\u0e34\u0e08\u0e01\u0e23\u0e23\u0e21',
};

const SYMBOLS = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  discover: { ios: 'line.3.horizontal', android: 'group', web: 'group' },
  chat: { ios: 'message.fill', android: 'chat_bubble', web: 'chat_bubble' },
  meetup: { ios: 'calendar', android: 'event', web: 'event' },
};

function iconFor(name) {
  return ({ color }) => (
    <FeatureIcon color={color} name={SYMBOLS[name]} size={22} />
  );
}

export default function FallbackTabLayout() {
  const { isLoggedIn, user } = useAuth();
  const { pendingIncomingLikes, profile, conversations } = useApp();
  const activeUserId = user?.id || profile?.id;
  const unreadCount = (conversations || []).reduce((sum, item) => sum + (activeUserId ? (item.unreadCounts?.[activeUserId] || 0) : 0), 0);
  const { colors } = useTheme();

  if (!isLoggedIn) return <Redirect href="/" />;
  if (!profile) return null;

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkSoft,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: type.micro, fontWeight: '700' },
        tabBarItemStyle: { borderRadius: 18, marginHorizontal: 2, marginVertical: 5 },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderColor: colors.line,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderTopWidth: 1,
          height: 78,
          paddingBottom: spacing.sm,
          paddingTop: spacing.xs,
          ...({ elevation: 10, shadowColor: '#000000', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { height: -4, width: 0 } }),
        },
      }}
    >
      <Tabs.Screen name="home" options={{ title: LABELS.home, tabBarIcon: iconFor('home') }} />
      <Tabs.Screen name="discover" options={{ title: LABELS.discover, tabBarBadge: pendingIncomingLikes.length || undefined, tabBarIcon: iconFor('discover') }} />
      <Tabs.Screen name="chat" options={{ title: LABELS.chat, tabBarBadge: unreadCount || undefined, tabBarIcon: iconFor('chat') }} />
      <Tabs.Screen name="meetup" options={{ title: LABELS.meetup, tabBarIcon: iconFor('meetup') }} />
    </Tabs>
  );
}

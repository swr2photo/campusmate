import React from 'react';
import { Redirect, Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useApp } from '../../src/context/AppContext';
import { useAuth } from '../../src/context/AuthContext';
import { spacing, type, useTheme } from '../../src/theme';

const LABELS = {
  home: '\u0e2b\u0e19\u0e49\u0e32\u0e2b\u0e25\u0e31\u0e01',
  discover: '\u0e04\u0e49\u0e19\u0e2b\u0e32\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e19',
  chat: '\u0e41\u0e0a\u0e15',
  meetup: '\u0e01\u0e34\u0e08\u0e01\u0e23\u0e23\u0e21',
};

const SYMBOLS = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  discover: { ios: 'line.3.horizontal', android: 'menu', web: 'menu' },
  chat: { ios: 'message.fill', android: 'chat_bubble', web: 'chat_bubble' },
  meetup: { ios: 'calendar', android: 'event', web: 'event' },
};

function iconFor(name) {
  return ({ color }) => (
    <SymbolView name={SYMBOLS[name]} size={22} style={{ height: 24, width: 24 }} tintColor={color} />
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
        tabBarLabelStyle: { fontSize: type.micro, fontWeight: '700' },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line, height: 72, paddingBottom: spacing.sm },
      }}
    >
      <Tabs.Screen name="home" options={{ title: LABELS.home, tabBarIcon: iconFor('home') }} />
      <Tabs.Screen name="discover" options={{ title: LABELS.discover, tabBarBadge: pendingIncomingLikes.length || undefined, tabBarIcon: iconFor('discover') }} />
      <Tabs.Screen name="chat" options={{ title: LABELS.chat, tabBarBadge: unreadCount || undefined, tabBarIcon: iconFor('chat') }} />
      <Tabs.Screen name="meetup" options={{ title: LABELS.meetup, tabBarIcon: iconFor('meetup') }} />
    </Tabs>
  );
}

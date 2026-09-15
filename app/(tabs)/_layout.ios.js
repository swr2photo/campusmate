import React from 'react';
import { useColorScheme } from 'react-native';
import { DefaultTheme, Redirect, ThemeProvider } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useApp } from '../../src/context/AppContext';
import { useAuth } from '../../src/context/AuthContext';
import { colors } from '../../src/theme';

const LABELS = {
  home: '\u0e2b\u0e19\u0e49\u0e32\u0e2b\u0e25\u0e31\u0e01',
  discover: '\u0e04\u0e49\u0e19\u0e2b\u0e32\u0e40\u0e1e\u0e37\u0e48\u0e2d\u0e19',
  chat: '\u0e41\u0e0a\u0e15',
  meetup: '\u0e01\u0e34\u0e08\u0e01\u0e23\u0e23\u0e21',
};

export default function NativeTabLayout() {
  const { isLoggedIn } = useAuth();
  const { pendingIncomingLikes, profile, totalUnreadMessages = 0 } = useApp();
  const colorScheme = useColorScheme();
  const tabTint = colorScheme === 'dark' ? '#A9AAFF' : colors.primary;
  const unreadCount = totalUnreadMessages;

  if (!isLoggedIn) return <Redirect href="/" />;

  return (
    <ThemeProvider value={DefaultTheme}>
      <NativeTabs
        disableTransparentOnScrollEdge
        tintColor={tabTint}
        badgeBackgroundColor="#FF3B30"
        sidebarAdaptable={false}
        minimizeBehavior="automatic"
        unstable_nativeProps={{
          ios: {
            tabBarControllerMode: 'tabBar',
          },
        }}
      >
        <NativeTabs.Trigger name="home" contentStyle={{ backgroundColor: colors.canvas }}>
          <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
          <NativeTabs.Trigger.Label>{LABELS.home}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="discover" contentStyle={{ backgroundColor: colors.canvas }}>
          <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
          <NativeTabs.Trigger.Label>{LABELS.discover}</NativeTabs.Trigger.Label>
          {pendingIncomingLikes.length > 0 && (
            <NativeTabs.Trigger.Badge>{String(Math.min(pendingIncomingLikes.length, 99))}</NativeTabs.Trigger.Badge>
          )}
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="chat" contentStyle={{ backgroundColor: colors.canvas }}>
          <NativeTabs.Trigger.Icon sf={{ default: 'message', selected: 'message.fill' }} />
          <NativeTabs.Trigger.Label>{LABELS.chat}</NativeTabs.Trigger.Label>
          {unreadCount > 0 && (
            <NativeTabs.Trigger.Badge>{String(Math.min(unreadCount, 99))}</NativeTabs.Trigger.Badge>
          )}
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="meetup" contentStyle={{ backgroundColor: colors.canvas }}>
          <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar.badge.clock' }} />
          <NativeTabs.Trigger.Label>{LABELS.meetup}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </ThemeProvider>
  );
}



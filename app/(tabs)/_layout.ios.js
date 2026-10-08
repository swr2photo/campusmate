import React, { useEffect } from 'react';
import { Redirect, ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { useAppBadges, useAppProfile } from '../../src/context/AppContext';
import { useAuth } from '../../src/context/AuthContext';
import { createNavigationTheme, useTheme } from '../../src/theme';
import { getDisplayImageUri, useRemoteImage } from '../../src/utils/useRemoteImage';
import { isBlockedCampusAccount, needsCampusEmailMigration } from '../../src/utils/campusEmail';
import AppSplashScreen from '../../src/components/AppSplashScreen';

const LABELS = {
  home: 'หาเพื่อน',
  discover: 'ถูกใจ',
  chat: 'แชต',
  meetup: 'กิจกรรม',
  me: 'โปรไฟล์',
};

export default function NativeTabLayout() {
  const { isLoggedIn, user, logout } = useAuth();
  const { profile } = useAppProfile();
  const { pendingLikeCount, totalUnreadMessages = 0 } = useAppBadges();
  const { colors, isDark } = useTheme();
  const unreadCount = totalUnreadMessages;
  const tabTint = colors.primary;
  const navigationTheme = createNavigationTheme(isDark ? DarkTheme : DefaultTheme, colors);
  const cachedAvatar = useRemoteImage(profile?.avatarUri, profile?.avatarRevision, profile?.id);
  const avatarUri = getDisplayImageUri(cachedAvatar, profile?.avatarUri);
  const blocked = isBlockedCampusAccount(user, profile);

  useEffect(() => {
    if (!blocked) return undefined;
    logout().catch(() => {});
    return undefined;
  }, [blocked, logout]);

  if (!isLoggedIn) return <Redirect href="/" />;
  if (blocked) return <AppSplashScreen />;
  if (needsCampusEmailMigration(user, profile)) return <Redirect href="/verify-campus-email" />;
  if (!profile) return <AppSplashScreen />;
  if (profile.isNewUser) return <Redirect href="/setup" />;

  return (
    <ThemeProvider value={navigationTheme}>
      <NativeTabs
        backgroundColor={colors.card}
        blurEffect={isDark ? 'systemMaterialDark' : 'systemMaterial'}
        disableTransparentOnScrollEdge
        iconColor={{ default: colors.inkSoft, selected: tabTint }}
        labelStyle={{
          default: { color: colors.inkSoft },
          selected: { color: tabTint },
        }}
        tintColor={tabTint}
        badgeBackgroundColor={isDark ? colors.coral : '#FF3B30'}
        shadowColor={isDark ? 'transparent' : undefined}
        sidebarAdaptable={false}
        minimizeBehavior="automatic"
        unstable_nativeProps={{
          ios: {
            tabBarControllerMode: 'tabBar',
          },
        }}
      >
        <NativeTabs.Trigger name="home" contentStyle={{ backgroundColor: colors.canvas }}>
          <NativeTabs.Trigger.Icon sf={{ default: 'person.2', selected: 'person.2.fill' }} />
          <NativeTabs.Trigger.Label>{LABELS.home}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="discover" contentStyle={{ backgroundColor: colors.canvas }}>
          <NativeTabs.Trigger.Icon sf={{ default: 'heart', selected: 'heart.fill' }} />
          <NativeTabs.Trigger.Label>{LABELS.discover}</NativeTabs.Trigger.Label>
          {pendingLikeCount > 0 && (
            <NativeTabs.Trigger.Badge>{String(Math.min(pendingLikeCount, 99))}</NativeTabs.Trigger.Badge>
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
        <NativeTabs.Trigger name="me" contentStyle={{ backgroundColor: colors.canvas }}>
          {avatarUri ? (
            <NativeTabs.Trigger.Icon renderingMode="original" src={{ uri: avatarUri }} />
          ) : (
            <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} />
          )}
          <NativeTabs.Trigger.Label>{LABELS.me}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </ThemeProvider>
  );
}

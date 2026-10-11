import React, { useEffect, useState } from 'react';
import { Redirect, ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router';
import CircularTabAvatar from '../../src/components/CircularTabAvatar.ios';
import { useRemoteImage } from '../../src/utils/useRemoteImage';
import { NativeTabs } from 'expo-router/native-tabs';
import { useAppBadges, useAppProfile } from '../../src/context/AppContext';
import { useAuth } from '../../src/context/AuthContext';
import { createNavigationTheme, useTheme } from '../../src/theme';
import { isBlockedCampusAccount, needsCampusEmailMigration } from '../../src/utils/campusEmail';
import AppSplashScreen from '../../src/components/AppSplashScreen';
import TabsBlurTargetContext from '../../src/context/TabsBlurTargetContext';

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
  const avatarUri = useRemoteImage(profile?.avatarUri || profile?.photoURL || user?.photoURL, profile?.avatarRevision);
  const [tabAvatar, setTabAvatar] = useState(null);

  const { pendingLikeCount, totalUnreadMessages = 0 } = useAppBadges();
  const { colors, isDark } = useTheme();
  const unreadCount = totalUnreadMessages;
  const tabTint = colors.primary;
  const navigationTheme = createNavigationTheme(isDark ? DarkTheme : DefaultTheme, colors);
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
    <TabsBlurTargetContext.Provider value={null}>
      <ThemeProvider value={navigationTheme}>
        {avatarUri ? <CircularTabAvatar key={avatarUri} uri={avatarUri} onReady={setTabAvatar} /> : null}
        <NativeTabs
          backgroundColor={colors.card}
          blurEffect={isDark ? 'systemMaterialDark' : 'systemMaterial'}
          disableTransparentOnScrollEdge
          iconColor={{ default: colors.inkSoft, selected: tabTint }}
          labelStyle={{
            default: { color: colors.inkSoft, fontFamily: 'NotoSansThai_500Medium' },
            selected: { color: tabTint, fontFamily: 'NotoSansThai_600SemiBold' },
          }}
          tintColor={tabTint}
          badgeBackgroundColor={isDark ? colors.coral : '#FF3B30'}
          shadowColor={isDark ? 'transparent' : undefined}
          sidebarAdaptable={false}
          minimizeBehavior="never"
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
            <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }} />
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
            {tabAvatar?.input === avatarUri && tabAvatar?.source ? (
              <NativeTabs.Trigger.Icon src={tabAvatar.source} renderingMode="original" />
            ) : null}
            <NativeTabs.Trigger.Label>{LABELS.me}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        </NativeTabs>
      </ThemeProvider>
    </TabsBlurTargetContext.Provider>
  );
}

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';
import { Redirect, Tabs } from 'expo-router';
import { PlatformPressable } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppBadges, useAppProfile } from '../../src/context/AppContext';
import { useAuth } from '../../src/context/AuthContext';
import FeatureIcon from '../../src/components/FeatureIcon';
import ProfileTabIcon from '../../src/components/ProfileTabIcon';
import AppSplashScreen from '../../src/components/AppSplashScreen';
import TabsBlurTargetContext from '../../src/context/TabsBlurTargetContext';
import { spacing, type, useTheme } from '../../src/theme';
import { isBlockedCampusAccount, needsCampusEmailMigration } from '../../src/utils/campusEmail';

const TAB_BAR_CONTENT_HEIGHT = 68;

const LABELS = {
  home: 'หาเพื่อน',
  discover: 'ถูกใจ',
  chat: 'แชต',
  meetup: 'กิจกรรม',
  me: 'โปรไฟล์',
};

const SYMBOLS = {
  home: { ios: 'person.2.fill', android: 'group', web: 'group' },
  discover: { ios: 'heart.fill', android: 'favorite', web: 'favorite' },
  chat: { ios: 'message.fill', android: 'chat_bubble', web: 'chat_bubble' },
  meetup: { ios: 'calendar', android: 'event', web: 'event' },
};

const TAB_ICONS = {
  discover: ({ color }) => <FeatureIcon color={color} name={SYMBOLS.discover} size={22} />,
  chat: ({ color }) => <FeatureIcon color={color} name={SYMBOLS.chat} size={22} />,
  meetup: ({ color }) => <FeatureIcon color={color} name={SYMBOLS.meetup} size={22} />,
};

const MEETUP_OPTIONS = { title: LABELS.meetup, tabBarIcon: TAB_ICONS.meetup };
const ME_OPTIONS = { title: LABELS.me, tabBarIcon: ProfileTabIcon };

function SilentTabBarButton(props) {
  return <PlatformPressable {...props} android_ripple={{ borderless: true, color: 'transparent' }} />;
}

export default function FallbackTabLayout() {
  const { isLoggedIn, user, logout } = useAuth();
  const { profile } = useAppProfile();
  const { pendingLikeCount, totalUnreadMessages = 0 } = useAppBadges();
  const unreadCount = totalUnreadMessages;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabsBlurTargetRef = useRef(null);
  const tabBarBottomInset = Math.max(insets.bottom, spacing.sm);
  const blocked = isBlockedCampusAccount(user, profile);

  useEffect(() => {
    if (!blocked) return undefined;
    logout().catch(() => {});
    return undefined;
  }, [blocked, logout]);

  const screenOptions = useMemo(() => ({
    headerShown: false,
    sceneStyle: { backgroundColor: colors.canvas },
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.inkSoft,
    tabBarHideOnKeyboard: true,
    tabBarButton: SilentTabBarButton,
    tabBarLabelStyle: { color: colors.inkSoft, fontSize: type.micro, fontWeight: 'normal', fontFamily: 'NotoSansThai_600SemiBold' },
    tabBarItemStyle: { paddingVertical: 2 },
    tabBarBadgeStyle: {
      backgroundColor: colors.coral,
      color: colors.onPrimary,
    },
    tabBarStyle: {
      backgroundColor: colors.card,
      borderTopColor: colors.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      elevation: 0,
      height: TAB_BAR_CONTENT_HEIGHT + tabBarBottomInset,
      paddingBottom: tabBarBottomInset,
      paddingTop: spacing.xs,
    },
  }), [colors, tabBarBottomInset]);

  const discoverOptions = useMemo(
    () => ({ title: LABELS.discover, tabBarBadge: pendingLikeCount || undefined, tabBarIcon: TAB_ICONS.discover }),
    [pendingLikeCount],
  );

  const chatOptions = useMemo(
    () => ({ title: LABELS.chat, tabBarBadge: unreadCount || undefined, tabBarIcon: TAB_ICONS.chat }),
    [unreadCount],
  );

  const homeOptions = useMemo(
    () => ({
      title: LABELS.home,
      tabBarIcon: () => <CenterFindFriendsIcon colors={colors} />,
    }),
    [colors],
  );

  if (!isLoggedIn) return <Redirect href="/" />;
  if (blocked) return <AppSplashScreen />;
  if (needsCampusEmailMigration(user, profile)) return <Redirect href="/verify-campus-email" />;
  if (!profile) return <AppSplashScreen />;
  if (profile.isNewUser) return <Redirect href="/setup" />;

  return (
    <TabsBlurTargetContext.Provider value={tabsBlurTargetRef}>
      <BlurTargetView ref={tabsBlurTargetRef} style={styles.tabsBlurTarget}>
        <Tabs initialRouteName="home" screenOptions={screenOptions}>
          <Tabs.Screen name="discover" options={discoverOptions} />
          <Tabs.Screen name="chat" options={chatOptions} />
          <Tabs.Screen name="home" options={homeOptions} />
          <Tabs.Screen name="meetup" options={MEETUP_OPTIONS} />
          <Tabs.Screen name="me" options={ME_OPTIONS} />
        </Tabs>
      </BlurTargetView>
    </TabsBlurTargetContext.Provider>
  );
}

function CenterFindFriendsIcon({ colors }) {
  return (
    <View
      style={[
        styles.centerAction,
        {
          backgroundColor: colors.primary,
          borderColor: colors.card,
        },
      ]}
    >
      <FeatureIcon color={colors.onPrimary} name={SYMBOLS.home} size={24} />
    </View>
  );
}

const styles = StyleSheet.create({
  tabsBlurTarget: { flex: 1 },
  centerAction: {
    alignItems: 'center',
    borderRadius: 28,
    borderWidth: 4,
    elevation: 5,
    height: 54,
    justifyContent: 'center',
    marginBottom: 6,
    marginTop: -16,
    shadowColor: '#25272B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    width: 54,
  },
});

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
import AnimatedTabIcon from '../../src/components/AnimatedTabIcon';
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
  home: ({ color, focused }) => <FeatureIcon color={color} name={focused ? SYMBOLS.home : { ios: 'person.2', android: 'group', web: 'group' }} size={24} />,
  discover: ({ color }) => <FeatureIcon color={color} name={SYMBOLS.discover} size={22} />,
  chat: ({ color }) => <FeatureIcon color={color} name={SYMBOLS.chat} size={22} />,
  meetup: ({ color }) => <FeatureIcon color={color} name={SYMBOLS.meetup} size={22} />,
};

function Material3TabIcon({ color, focused, iconName, size = 22, colors, gesture }) {
  return <AnimatedTabIcon color={color} focused={focused} gesture={gesture} iconName={iconName} indicatorColor={colors.primarySoft} size={size} />;
}

function Material3ProfileIcon({ color, focused, colors }) {
  return (
    <AnimatedTabIcon focused={focused} gesture="bounce" indicatorColor={colors.primarySoft}>
      <ProfileTabIcon color={color} focused={focused} />
    </AnimatedTabIcon>
  );
}

function SilentTabBarButton(props) {
  return <PlatformPressable {...props} android_ripple={{ borderless: true, color: 'rgba(98,168,255,0.16)' }} />;
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
    tabBarActiveTintColor: colors.accentText,
    tabBarInactiveTintColor: colors.inkSoft,
    tabBarHideOnKeyboard: true,
    tabBarButton: SilentTabBarButton,
    tabBarLabelStyle: {
      fontSize: type.micro,
      fontWeight: 'normal',
      fontFamily: 'NotoSansThai_600SemiBold',
      marginTop: 2,
    },
    tabBarItemStyle: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 2,
    },
    tabBarBadgeStyle: {
      backgroundColor: colors.coral,
      color: colors.onPrimary,
      top: 2,
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
    () => ({
      title: LABELS.discover,
      tabBarBadge: pendingLikeCount || undefined,
      tabBarIcon: ({ color, focused }) => (
        <Material3TabIcon
          color={color}
          colors={colors}
          focused={focused}
          gesture="beat"
          iconName={SYMBOLS.discover}
          size={22}
        />
      ),
    }),
    [colors, pendingLikeCount],
  );

  const chatOptions = useMemo(
    () => ({
      title: LABELS.chat,
      tabBarBadge: unreadCount || undefined,
      tabBarIcon: ({ color, focused }) => (
        <Material3TabIcon
          color={color}
          colors={colors}
          focused={focused}
          gesture="wiggle"
          iconName={SYMBOLS.chat}
          size={22}
        />
      ),
    }),
    [colors, unreadCount],
  );

  const meetupOptions = useMemo(
    () => ({
      title: LABELS.meetup,
      tabBarIcon: ({ color, focused }) => (
        <Material3TabIcon
          color={color}
          colors={colors}
          focused={focused}
          gesture="flip"
          iconName={SYMBOLS.meetup}
          size={22}
        />
      ),
    }),
    [colors],
  );

  const meOptions = useMemo(
    () => ({
      title: LABELS.me,
      tabBarIcon: ({ color, focused }) => (
        <Material3ProfileIcon
          color={color}
          colors={colors}
          focused={focused}
        />
      ),
    }),
    [colors],
  );

  const homeOptions = useMemo(
    () => ({
      title: LABELS.home,
      tabBarIcon: ({ color, focused }) => (
        <Material3TabIcon
          color={color}
          colors={colors}
          focused={focused}
          gesture="bounce"
          iconName={focused ? SYMBOLS.home : { ios: 'person.2', android: 'group', web: 'group' }}
          size={24}
        />
      ),
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
          <Tabs.Screen name="home" options={homeOptions} />
          <Tabs.Screen name="discover" options={discoverOptions} />
          <Tabs.Screen name="chat" options={chatOptions} />
          <Tabs.Screen name="meetup" options={meetupOptions} />
          <Tabs.Screen name="me" options={meOptions} />
        </Tabs>
      </BlurTargetView>
    </TabsBlurTargetContext.Provider>
  );
}

const styles = StyleSheet.create({
  tabsBlurTarget: { flex: 1 },
  tabCapsule: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 60,
  },
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

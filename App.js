import React, { useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import ChatScreen from './src/screens/ChatScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import MeetupScreen from './src/screens/MeetupScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { AppProvider, useApp } from './src/context/AppContext';
import { colors, radius, spacing, type } from './src/theme';

const TABS = [
  { id: 'match', icon: '✦', label: 'จับคู่' },
  { id: 'chat', icon: '◌', label: 'แชท' },
  { id: 'meetup', icon: '⌖', label: 'นัดหมาย' },
  { id: 'profile', icon: '◯', label: 'โปรไฟล์' },
];

function AppShell({ onLogout }) {
  const { conversations } = useApp();
  const [currentTab, setCurrentTab] = useState('match');
  const [toast, setToast] = useState(null);

  const showToast = (message, tone = 'success') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2600);
  };

  const renderContent = () => {
    switch (currentTab) {
      case 'chat':
        return <ChatScreen />;
      case 'meetup':
        return <MeetupScreen onToast={showToast} />;
      case 'profile':
        return <ProfileScreen onLogout={onLogout} onToast={showToast} />;
      case 'match':
      default:
        return <HomeScreen onToast={showToast} />;
    }
  };

  const unreadCount = conversations.reduce((sum, item) => sum + (item.unread || 0), 0);

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.canvas} />
      <View style={styles.content}>{renderContent()}</View>

      {toast && (
        <View style={[styles.toast, toast.tone === 'info' && styles.toastInfo]}>
          <Text style={styles.toastIcon}>{toast.tone === 'info' ? 'i' : '✓'}</Text>
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      )}

      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = tab.id === currentTab;
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setCurrentTab(tab.id)}
              style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            >
              <View style={[styles.tabIconWrap, active && styles.tabIconWrapActive]}>
                <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{tab.icon}</Text>
                {tab.id === 'chat' && unreadCount > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount}</Text></View>
                )}
              </View>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function AppContent() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  if (!isLoggedIn) {
    return <LoginScreen onLoginSuccess={() => setIsLoggedIn(true)} />;
  }

  return <AppShell onLogout={() => setIsLoggedIn(false)} />;
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  app: { backgroundColor: colors.canvas, flex: 1 },
  content: { flex: 1 },
  tabBar: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 76,
    justifyContent: 'space-around',
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  tab: { alignItems: 'center', justifyContent: 'center', minWidth: 68 },
  tabPressed: { opacity: 0.7 },
  tabIconWrap: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 34,
    justifyContent: 'center',
    marginBottom: 2,
    width: 48,
  },
  tabIconWrapActive: { backgroundColor: colors.primarySoft },
  tabIcon: { color: colors.inkSoft, fontSize: 23, fontWeight: '700' },
  tabIconActive: { color: colors.primary },
  tabLabel: { color: colors.inkSoft, fontSize: type.micro, fontWeight: '700' },
  tabLabelActive: { color: colors.primary },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.coral,
    borderColor: colors.card,
    borderRadius: 9,
    borderWidth: 2,
    height: 19,
    justifyContent: 'center',
    minWidth: 19,
    position: 'absolute',
    right: 1,
    top: -3,
  },
  badgeText: { color: colors.card, fontSize: 9, fontWeight: '900' },
  toast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    bottom: 88,
    flexDirection: 'row',
    maxWidth: '92%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    position: 'absolute',
    zIndex: 3,
  },
  toastInfo: { backgroundColor: colors.primary },
  toastIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 10,
    color: colors.card,
    fontSize: 12,
    fontWeight: '900',
    height: 20,
    lineHeight: 20,
    marginRight: spacing.sm,
    textAlign: 'center',
    width: 20,
  },
  toastText: { color: colors.card, flexShrink: 1, fontSize: type.caption, fontWeight: '800' },
});

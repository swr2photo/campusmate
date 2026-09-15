import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import FeatureIcon from '../src/components/FeatureIcon';
import ProfileScreen from '../src/screens/ProfileScreen';
import { useAuth } from '../src/context/AuthContext';
import { useToast } from '../src/context/ToastContext';
import { colors, radius, spacing, type, useTheme } from '../src/theme';

export default function ProfileRoute() {
  const { logout } = useAuth();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const closeGuardRef = React.useRef(null);

  const close = () => {
    if (closeGuardRef.current) {
      closeGuardRef.current();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="ย้อนกลับ"
          accessibilityRole="button"
          hitSlop={12}
          onPress={close}
          style={styles.backButton}
        >
          <FeatureIcon color={colors.ink} name="chevron.left" size={22} />
        </Pressable>
        <Text style={styles.title}>ตั้งค่าโปรไฟล์</Text>
        <View style={styles.headerRight} />
      </View>
      <View style={styles.content}>
        <ProfileScreen
          onCloseGuardReady={(handler) => {
            closeGuardRef.current = handler;
          }}
          onClose={() => {
            if (router.canGoBack()) router.back();
            else router.replace('/home');
          }}
          onLogout={async () => {
            await logout();
            router.replace('/');
          }}
          onToast={showToast}
        />
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerRight: {
    height: 40,
    width: 40,
  },
  title: {
    color: colors.ink,
    fontSize: type.section,
    fontWeight: '900',
  },
  content: { flex: 1 },
});


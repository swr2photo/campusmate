import React from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import ProfileScreen from '../src/screens/ProfileScreen';
import { useAuth } from '../src/context/AuthContext';
import { useToast } from '../src/context/ToastContext';
import { colors, radius, spacing, type, useTheme } from '../src/theme';

export default function ProfileRoute() {
  const { logout } = useAuth();
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.grabber} />
      <View style={styles.header}>
        <Text style={styles.title}>{'\u0e42\u0e1b\u0e23\u0e44\u0e1f\u0e25\u0e4c\u0e41\u0e25\u0e30\u0e01\u0e32\u0e23\u0e15\u0e31\u0e49\u0e07\u0e04\u0e48\u0e32'}</Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={close} style={styles.closeButton}>
          <Text style={styles.closeText}>{'\u0e1b\u0e34\u0e14'}</Text>
        </Pressable>
      </View>
      <View style={styles.content}>
        <ProfileScreen
          onLogout={() => {
            logout();
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
  grabber: { alignSelf: 'center', backgroundColor: colors.inkSoft, borderRadius: 3, height: 5, marginTop: spacing.sm, opacity: 0.45, width: 36 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { color: colors.ink, fontSize: type.section, fontWeight: '900' },
  closeButton: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.line, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: 44, minWidth: 60, paddingHorizontal: spacing.md },
  closeText: { color: colors.primary, fontSize: type.caption, fontWeight: '900' },
  content: { flex: 1 },
});


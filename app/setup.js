import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import ProfileScreen from '../src/screens/ProfileScreen';
import { useAuth } from '../src/context/AuthContext';
import { useToast } from '../src/context/ToastContext';
import { useApp } from '../src/context/AppContext';
import { colors, spacing, type, useTheme } from '../src/theme';

export default function SetupRoute() {
  const { logout } = useAuth();
  const { showToast } = useToast();
  const { profile, saveProfile } = useApp();
  const { colors } = useTheme();
  const styles = getStyles(colors);

  if (!profile) return null;

  const handleSave = async (profileData) => {
    // We override saveProfile locally to change isNewUser to false
    await saveProfile({ ...profileData, isNewUser: false });
    showToast('สร้างโปรไฟล์สำเร็จ!');
    router.replace('/discover');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>ตั้งค่าโปรไฟล์ครั้งแรก</Text>
        <Text style={styles.subtitle}>กรุณากรอกข้อมูลของคุณเพื่อให้เพื่อนๆ รู้จักคุณมากขึ้น</Text>
      </View>
      <View style={styles.content}>
        <ProfileScreen
          onLogout={() => {
            logout();
            router.replace('/');
          }}
          onToast={showToast}
          showHeader={false}
          overrideSave={handleSave}
        />
      </View>
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  header: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  title: { color: colors.ink, fontSize: type.h2, fontWeight: '900', marginBottom: spacing.xs },
  subtitle: { color: colors.inkMuted, fontSize: type.body, textAlign: 'center' },
  content: { flex: 1 },
});

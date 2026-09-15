import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Image,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import FeatureIcon from './FeatureIcon';
import { checkAppUpdate, openAppStore, snoozeUpdate } from '../services/versionCheckService';

const heroImage = require('../../assets/login-campus-hero.png');
const appIcon = require('../../assets/icon.png');

export default function AppUpdateModal() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [visible, setVisible] = useState(false);

  const runCheck = useCallback(async () => {
    try {
      // Always check the remote version on launch/foreground. A snooze may
      // dismiss this session, but must not hide the prompt on the next launch.
      const result = await checkAppUpdate({ ignoreSnooze: true });
      if (result?.needsUpdate) {
        setUpdateInfo(result);
        setVisible(true);
      } else {
        setUpdateInfo(null);
        setVisible(false);
      }
    } catch (error) {
      console.warn('[AppUpdateModal] Check update failed:', error);
    }
  }, []);

  useEffect(() => {
    // Let the first app screen render before querying Firestore.
    const timer = setTimeout(runCheck, 1200);

    // Check again whenever the app returns from the background.
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        runCheck();
      }
    });

    return () => {
      clearTimeout(timer);
      subscription?.remove?.();
    };
  }, [runCheck]);

  const handleUpdate = () => {
    if (!updateInfo) return;
    const targetUrl = Platform.OS === 'ios' ? updateInfo.appStoreUrl : updateInfo.playStoreUrl;
    openAppStore(targetUrl, updateInfo.playStoreWebUrl);
  };

  const handleLater = async () => {
    if (updateInfo?.isForce) return;
    await snoozeUpdate();
    setVisible(false);
  };

  const styles = useMemo(() => getStyles(Boolean(updateInfo?.isForce)), [updateInfo?.isForce]);

  if (!visible || !updateInfo) {
    return null;
  }

  const isForce = Boolean(updateInfo.isForce);
  const storeLabel = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
  const releaseNotes = String(updateInfo.releaseNotes || '').trim();

  return (
    <Modal
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      transparent={false}
      visible={visible}
      onRequestClose={isForce ? () => {} : handleLater}
    >
      <ImageBackground
        source={heroImage}
        style={styles.screen}
        imageStyle={styles.backgroundImage}
      >
        <LinearGradient
          colors={['rgba(9,12,18,0.42)', 'rgba(9,12,18,0.78)', 'rgba(9,12,18,0.98)']}
          locations={[0, 0.48, 1]}
          style={styles.gradient}
        >
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.topBar}>
              {!isForce ? (
                <Pressable
                  accessibilityLabel="ปิดหน้าต่างอัปเดต"
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={handleLater}
                  style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                >
                  <FeatureIcon color="#FFFFFF" name="xmark" size={17} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.content}>
              <View style={styles.logoShadow}>
                <Image accessibilityLabel="โลโก้ CampusMate" source={appIcon} style={styles.appLogo} />
              </View>

              <Text style={styles.title}>{updateInfo.title || 'ถึงเวลาอัปเดต CampusMate'}</Text>
              <Text style={styles.versionText}>
                เวอร์ชัน {updateInfo.latestVersion} พร้อมใช้งานแล้ว
              </Text>
              <Text style={styles.message}>
                {updateInfo.message || `อัปเดต CampusMate ผ่าน ${storeLabel} เพื่อใช้งานฟีเจอร์ล่าสุด`}
              </Text>

              {releaseNotes ? (
                <View style={styles.notesBox}>
                  <Text style={styles.notesLabel}>สิ่งที่ปรับปรุง</Text>
                  <Text style={styles.notesText}>{releaseNotes}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.footer}>
              <Pressable
                accessibilityLabel={`อัปเดตแอปผ่าน ${storeLabel}`}
                accessibilityRole="button"
                onPress={handleUpdate}
                style={({ pressed }) => [styles.updateButton, pressed && styles.pressed]}
              >
                <Text style={styles.updateButtonText}>อัปเดต CampusMate</Text>
                <FeatureIcon color="#1A1D25" name="arrow.right" size={16} />
              </Pressable>

              <Text style={styles.currentVersion}>ติดตั้งอยู่: v{updateInfo.currentVersion}</Text>

              {!isForce ? (
                <Pressable
                  accessibilityLabel="เตือนฉันภายหลัง"
                  accessibilityRole="button"
                  onPress={handleLater}
                  style={({ pressed }) => [styles.laterButton, pressed && styles.pressed]}
                >
                  <Text style={styles.laterText}>ไว้คราวหลัง</Text>
                </Pressable>
              ) : (
                <Text style={styles.forceText}>จำเป็นต้องอัปเดตเพื่อใช้งานต่อ</Text>
              )}
            </View>
          </SafeAreaView>
        </LinearGradient>
      </ImageBackground>
    </Modal>
  );
}

const getStyles = (isForce) => StyleSheet.create({
  screen: {
    backgroundColor: '#0B0D14',
    flex: 1,
  },
  backgroundImage: {
    opacity: 0.38,
    resizeMode: 'cover',
  },
  gradient: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  topBar: {
    alignItems: 'flex-end',
    height: 44,
    justifyContent: 'center',
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    marginTop: -28,
    paddingHorizontal: 8,
  },
  logoShadow: {
    borderRadius: 30,
    elevation: 12,
    shadowColor: '#5B5CE2',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 22,
  },
  appLogo: {
    borderRadius: 28,
    height: 112,
    width: 112,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 36,
    marginTop: 24,
    textAlign: 'center',
  },
  versionText: {
    color: 'rgba(255,255,255,0.94)',
    fontSize: 17,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  message: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 20,
    maxWidth: 360,
    textAlign: 'center',
  },
  notesBox: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 24,
    maxWidth: 370,
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '100%',
  },
  notesLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  notesText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12,
    lineHeight: 19,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 20,
  },
  updateButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 30,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 58,
    paddingHorizontal: 22,
    width: '100%',
  },
  updateButtonText: {
    color: '#1A1D25',
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  currentVersion: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 11,
    marginTop: 11,
  },
  laterButton: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  laterText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    fontWeight: '600',
  },
  forceText: {
    color: isForce ? 'rgba(255,255,255,0.72)' : 'transparent',
    fontSize: 12,
    marginTop: 10,
  },
  pressed: {
    opacity: 0.82,
  },
});

import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import LiquidGlassView from './LiquidGlassView';
import NotificationDetailContent from './NotificationDetailContent';
import { useTheme } from '../theme';

export default function NotificationDetail(props) {
  const { isDark } = useTheme();

  return (
    <Modal
      animationType="fade"
      onRequestClose={props.onClose}
      transparent
      visible={Boolean(props.notification)}
    >
      <View style={styles.scrim}>
        <BlurView
          intensity={isDark ? 28 : 22}
          style={StyleSheet.absoluteFill}
          tint={isDark ? 'dark' : 'systemMaterial'}
        />
        <Pressable
          accessibilityLabel="ปิดรายละเอียดแจ้งเตือน"
          onPress={props.onClose}
          style={StyleSheet.absoluteFill}
        />
        <LiquidGlassView
          glassEffectStyle="regular"
          style={styles.dialogGlass}
        >
          <NotificationDetailContent {...props} />
        </LiquidGlassView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    alignItems: 'center',
    backgroundColor: 'rgba(12, 22, 40, 0.35)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  dialogGlass: {
    borderRadius: 28,
    borderCurve: 'continuous',
    maxWidth: 520,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.24,
    shadowRadius: 32,
    elevation: 20,
  },
});

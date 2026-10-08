import Text from '../src/components/AppText';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import DiscoverProfileScreen from '../src/screens/DiscoverProfileScreen';
import { useToast } from '../src/context/ToastContext';

class DiscoverProfileErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('[DiscoverProfileRoute] Failed to render profile detail:', error?.message || error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.errorState}>
        <Text style={styles.errorTitle}>เปิดรายละเอียดโปรไฟล์ไม่ได้</Text>
        <Text style={styles.errorMessage}>กรุณากลับไปค้นหาเพื่อนแล้วลองเปิดอีกครั้ง</Text>
        <Pressable onPress={this.props.onClose} style={styles.errorButton}>
          <Text style={styles.errorButtonText}>กลับไปค้นหาเพื่อน</Text>
        </Pressable>
      </View>
    );
  }
}

export default function DiscoverProfileRoute() {
  const params = useLocalSearchParams();
  const rawId = params?.profileId || params?.id;
  const normalizedProfileId = Array.isArray(rawId) ? rawId[0] : rawId;
  const isExplicitViewOnly = params?.viewOnly === 'true' || params?.mode === 'view';
  const { showToast } = useToast();
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <DiscoverProfileErrorBoundary onClose={close}>
      <DiscoverProfileScreen
        isViewOnlyParam={isExplicitViewOnly}
        onClose={close}
        onToast={showToast}
        profileId={normalizedProfileId}
      />
    </DiscoverProfileErrorBoundary>
  );
}

const styles = StyleSheet.create({
  errorState: { alignItems: 'center', backgroundColor: '#F7F7F8', flex: 1, justifyContent: 'center', padding: 24 },
  errorTitle: { color: '#25272B', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  errorMessage: { color: '#6B7078', fontSize: 14, marginTop: 8, textAlign: 'center' },
  errorButton: { backgroundColor: '#2869C7', borderRadius: 999, marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 },
  errorButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});

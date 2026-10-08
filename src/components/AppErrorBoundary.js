import Text from './AppText';
import React from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import FeatureIcon from './FeatureIcon';

/**
 * AppErrorBoundary
 *
 * Catches unhandled JavaScript runtime errors in child component trees,
 * logs diagnostic details, and renders a graceful recovery view instead
 * of crashing the entire mobile app to a white screen.
 */
export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('[AppErrorBoundary] Uncaught UI error:', error?.message || error, errorInfo?.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback({
          error: this.state.error,
          reset: this.handleReset,
        });
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <View style={{ marginBottom: 12 }}>
              <FeatureIcon name="exclamationmark.triangle" size={36} color="#DC2626" />
            </View>
            <Text style={styles.title}>ขออภัย มีบางอย่างขัดข้อง</Text>
            <Text style={styles.subtitle}>
              {this.props.message || 'หน้าจอนี้เกิดข้อผิดพลาดชั่วคราว คุณสามารถลองใหม่อีกครั้งได้'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={this.handleReset}
              style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            >
              <Text style={styles.buttonText}>ลองใหม่อีกครั้ง</Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F8FAFC',
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  icon: {
    fontSize: 28,
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#006699',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import ImageModerationNotice from '../components/ImageModerationNotice';
import { showInAppNotification } from '../components/InAppNotificationBanner';

export { showInAppNotification } from '../components/InAppNotificationBanner';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [imageNotice, setImageNotice] = useState(null);
  const showImageModeration = useCallback((error) => setImageNotice(error), []);

  const showToast = useCallback((message, tone = 'success', options = {}) => {
    showInAppNotification({
      message: String(message ?? ''),
      tone,
      ...(typeof options === 'object' ? options : {}),
    });
  }, []);

  const value = useMemo(
    () => ({ showToast, showInAppNotification, showImageModeration }),
    [showToast, showImageModeration],
  );

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <ImageModerationNotice notice={imageNotice} onClose={() => setImageNotice(null)} />
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}

const styles = StyleSheet.create({
  root: { flex: 1, position: 'relative' },
});

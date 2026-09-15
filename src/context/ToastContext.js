import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';
import ImageModerationNotice from '../components/ImageModerationNotice';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [imageNotice, setImageNotice] = useState(null);
  const showImageModeration = useCallback((error) => setImageNotice(error), []);
  const timerRef = useRef(null);

  const showToast = useCallback((message, tone = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message: String(message ?? ''), tone });
    timerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, showImageModeration }}>
      <View style={styles.root}>
        {children}
        <ImageModerationNotice notice={imageNotice} onClose={() => setImageNotice(null)} />
        {toast && (
          <View pointerEvents="none" style={styles.toastLayer}>
            <View pointerEvents="none" style={[styles.toast, toast.tone === 'info' && styles.toastInfo]}>
              <Text style={styles.icon}>{toast.tone === 'info' ? 'i' : '\u2713'}</Text>
              <Text style={styles.text}>{toast.message}</Text>
            </View>
          </View>
        )}
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
  toastLayer: {
    alignItems: 'center',
    bottom: 0,
    flex: 1,
    left: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? 58 : 42,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  toast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    flexDirection: 'row',
    maxWidth: '92%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  toastInfo: { backgroundColor: colors.primary },
  icon: {
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
  text: { color: colors.card, flexShrink: 1, fontSize: type.caption, fontWeight: '800' },
});

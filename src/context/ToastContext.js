import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((message, tone = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, tone });
    timerRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      <View style={styles.root}>
        {children}
        {toast && (
          <View pointerEvents="none" style={[styles.toast, toast.tone === 'info' && styles.toastInfo]}>
            <Text style={styles.icon}>{toast.tone === 'info' ? 'i' : '\u2713'}</Text>
            <Text style={styles.text}>{toast.message}</Text>
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
  root: { flex: 1 },
  toast: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.green,
    borderRadius: radius.pill,
    bottom: 106,
    flexDirection: 'row',
    maxWidth: '92%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    position: 'absolute',
    zIndex: 100,
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


import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import AppDialog from '../components/AppDialog';

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);
  dialogRef.current = dialog;

  const close = useCallback((result) => {
    const current = dialogRef.current;
    setBusy(false);
    setDialog(null);
    current?.resolve?.(result);
  }, []);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      const current = dialogRef.current;
      if (current) current.resolve(false);
      setBusy(false);
      setDialog({
        cancelLabel: 'ยกเลิก',
        confirmLabel: 'ยืนยัน',
        destructive: true,
        icon: 'exclamationmark.triangle.fill',
        ...options,
        resolve,
      });
    });
  }, []);

  const handleCancel = useCallback(() => {
    if (busy) return;
    close(false);
  }, [busy, close]);

  const handleConfirm = useCallback(async () => {
    const current = dialogRef.current;
    if (!current || busy) return;
    if (!current.onConfirm) {
      close(true);
      return;
    }
    setBusy(true);
    try {
      await current.onConfirm();
      close(true);
    } catch {
      setBusy(false);
    }
  }, [busy, close]);

  const value = useMemo(() => ({ confirm }), [confirm]);
  const isDestructive = dialog?.destructive !== false;

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AppDialog
        buttons={dialog ? [
          { disabled: busy, onPress: handleCancel, style: 'cancel', text: dialog.cancelLabel },
          {
            loading: busy,
            onPress: handleConfirm,
            style: isDestructive ? 'destructive' : 'default',
            text: dialog.confirmLabel,
          },
        ] : []}
        icon={dialog?.icon}
        message={dialog?.body}
        onBackdropPress={busy ? undefined : handleCancel}
        onRequestClose={handleCancel}
        title={dialog?.title}
        tone={isDestructive ? 'danger' : 'info'}
        visible={Boolean(dialog)}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider');
  return context;
}

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import AppDialog from './AppDialog';
import { closeAlert, getCurrentAlert, removeAlert, subscribeAlerts } from '../utils/appAlert';

/**
 * Renders the queue from src/utils/appAlert.js one alert at a time.
 * Mount exactly once near the app root (app/_layout.js).
 */
export default function AppAlertHost() {
  const current = useSyncExternalStore(subscribeAlerts, getCurrentAlert, getCurrentAlert);
  const [promptValue, setPromptValue] = useState('');
  const promptValueRef = useRef('');
  const handledRef = useRef(null);
  const shownIdRef = useRef(null);
  if (current && !current.closing) shownIdRef.current = current.id;

  useEffect(() => {
    // Dismissed programmatically before it was ever shown: nothing to animate out.
    if (current?.closing && shownIdRef.current !== current.id) removeAlert(current.id);
  }, [current]);

  useEffect(() => {
    if (!current || current.closing) return;
    const initial = current.kind === 'prompt' ? current.defaultValue || '' : '';
    promptValueRef.current = initial;
    setPromptValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const finish = useCallback((entry, callback) => {
    if (!entry || entry.closing || handledRef.current === entry.id) return;
    handledRef.current = entry.id;
    closeAlert(entry.id);
    if (typeof callback === 'function') {
      try {
        callback(entry.kind === 'prompt' ? promptValueRef.current : undefined);
      } catch (error) {
        if (__DEV__) console.warn('[AppAlert] button handler failed', error);
      }
    }
  }, []);

  const handlePress = useCallback((button) => finish(current, button?.onPress), [current, finish]);

  const cancelButton = current?.buttons?.find((button) => button.style === 'cancel');

  const handleRequestClose = useCallback(() => {
    if (!current) return;
    if (cancelButton) finish(current, cancelButton.onPress);
    else if (current.cancelable) finish(current, current.onDismiss);
  }, [cancelButton, current, finish]);

  const handleBackdropPress = useCallback(() => {
    if (!current?.cancelable) return;
    finish(current, cancelButton ? cancelButton.onPress : current.onDismiss);
  }, [cancelButton, current, finish]);

  const handleExited = useCallback(() => {
    const entry = getCurrentAlert();
    if (entry?.closing) removeAlert(entry.id);
  }, []);

  const handleChangeText = useCallback((text) => {
    promptValueRef.current = text;
    setPromptValue(text);
  }, []);

  const buttons = current?.buttons?.map((button) => ({
    ...button,
    onPress: () => handlePress(button),
  }));

  const primaryButton = current?.buttons?.filter((button) => button.style !== 'cancel').slice(-1)[0];

  return (
    <AppDialog
      buttons={buttons}
      icon={current?.icon}
      input={current?.kind === 'prompt' ? {
        keyboardType: current.keyboardType,
        onChangeText: handleChangeText,
        onSubmitEditing: primaryButton ? () => handlePress(primaryButton) : undefined,
        placeholder: current.placeholder,
        secureTextEntry: current.secureTextEntry,
        value: promptValue,
      } : null}
      message={current?.message}
      onBackdropPress={current?.cancelable ? handleBackdropPress : undefined}
      onExited={handleExited}
      onRequestClose={handleRequestClose}
      title={current?.title}
      tone={current?.tone}
      visible={Boolean(current) && !current.closing}
    />
  );
}

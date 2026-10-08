import React from 'react';
import AppDialog from './AppDialog';

/**
 * Controlled alert component (kept for existing screens). Uses the same visual as
 * the global in-app alert (src/utils/appAlert.js + AppAlertHost).
 */
export default function AppAlert({
  visible,
  title,
  message,
  onClose,
  tone = 'success',
  icon = 'checkmark.circle.fill',
  buttonLabel = 'ตกลง',
  showCancelButton = false,
  onCancel,
  cancelLabel = 'ยกเลิก',
}) {
  const dialogTone = tone === 'error' ? 'danger' : tone === 'success' ? 'success' : tone;
  const buttons = [];
  if (showCancelButton) {
    buttons.push({ onPress: onCancel || onClose, style: 'cancel', text: cancelLabel });
  }
  buttons.push({
    onPress: onClose,
    style: tone === 'error' && showCancelButton ? 'destructive' : 'default',
    text: buttonLabel,
  });

  return (
    <AppDialog
      buttons={buttons}
      icon={tone === 'error' && icon === 'checkmark.circle.fill' ? undefined : icon}
      message={message}
      onRequestClose={onCancel || onClose}
      title={title}
      tone={dialogTone}
      visible={Boolean(visible)}
    />
  );
}

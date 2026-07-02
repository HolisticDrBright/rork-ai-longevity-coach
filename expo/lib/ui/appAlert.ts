import { Alert, AlertButton, Platform } from 'react-native';

/**
 * Cross-platform replacement for Alert.alert.
 * react-native-web's Alert.alert is a no-op, which silently kills every
 * confirmation/validation flow on web. On web we fall back to
 * window.alert / window.confirm; on native we delegate to Alert.alert.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }

  const text = message ? `${title}\n\n${message}` : title;

  if (!buttons || buttons.length === 0) {
    window.alert(text);
    return;
  }

  if (buttons.length === 1) {
    window.alert(text);
    buttons[0].onPress?.();
    return;
  }

  // Two or more buttons: treat the last non-cancel button as the affirmative
  // action and any 'cancel' style button as the negative one.
  const cancelButton = buttons.find(b => b.style === 'cancel');
  const actionButtons = buttons.filter(b => b !== cancelButton);

  if (actionButtons.length === 1) {
    const confirmed = window.confirm(text);
    if (confirmed) {
      actionButtons[0].onPress?.();
    } else {
      cancelButton?.onPress?.();
    }
    return;
  }

  // Three-way choice: walk the action buttons with sequential confirms.
  for (const button of actionButtons) {
    const confirmed = window.confirm(`${text}\n\n→ ${button.text ?? 'OK'}?`);
    if (confirmed) {
      button.onPress?.();
      return;
    }
  }
  cancelButton?.onPress?.();
}

/** Promise-based yes/no confirmation that works on native and web. */
export function confirmAsync(
  title: string,
  message?: string,
  options?: { confirmText?: string; cancelText?: string; destructive?: boolean },
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    return Promise.resolve(window.confirm(text));
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: options?.cancelText ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      {
        text: options?.confirmText ?? 'OK',
        style: options?.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}

import { Alert, Platform } from 'react-native';

// react-native-web ships Alert.alert as an empty function, so on the web every message
// and every confirmation (buy, delete account, leave the queue...) was silently dropped.
// Map it to the browser's own dialogs.
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  Alert.alert = (title, message, buttons) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    const list = buttons || [];

    if (list.length <= 1) {
      window.alert(text);
      list[0]?.onPress?.();
      return;
    }

    // Several buttons: "Aceptar" runs the main (last non-cancel) action, "Cancelar" the cancel one
    const main = [...list].reverse().find(b => b.style !== 'cancel');
    const cancel = list.find(b => b.style === 'cancel');
    const prompt = main?.text ? `${text}\n\n(Aceptar = ${main.text})` : text;
    if (window.confirm(prompt)) {
      main?.onPress?.();
    } else {
      cancel?.onPress?.();
    }
  };
}

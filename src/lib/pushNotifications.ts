import { Platform } from 'react-native';
import { supabase } from './supabase';

// Public by design: it identifies the sender. The private half lives only in Supabase secrets.
const VAPID_PUBLIC_KEY = 'BLDiVNsKzh0Il5bUEuYY5CclQGauaoibpQpiTIGF-BFkL7R10ByzaunTEQ2VYIc2cEzgdaOKEe51iNLSe958s0Q';

const isSupported = () =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator &&
  'PushManager' in window;

const keyBytes = (base64Url: string) => {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

/** Saves this device for the signed-in user, so the server can reach it with the app closed. */
export const syncPushSubscription = async (): Promise<boolean> => {
  if (!isSupported() || Notification.permission !== 'granted') return false;

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
    }));

  const { endpoint, keys } = subscription.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: keys?.p256dh,
    p_auth: keys?.auth,
  });
  if (error) console.warn('Could not save the push subscription:', error.message);
  return !error;
};

/** Asks for permission and shows one notification, so the person sees it working right away. */
export const activatePushNotifications = async (): Promise<NotificationPermission | null> => {
  if (!isSupported()) return null;

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    await syncPushSubscription();
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification('✅ Notificaciones activadas', {
      body: 'Te avisaremos aunque tengas la app cerrada.',
      icon: '/icon.png',
    });
  }
  return permission;
};

/** The next person to sign in on this phone must not get the previous one's notices. */
export const removePushSubscription = async (): Promise<void> => {
  if (!isSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await supabase.rpc('remove_push_subscription', { p_endpoint: subscription.endpoint });
  }
};

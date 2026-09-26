import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const current = await Notifications.getPermissionsAsync();
  const granted =
    current.status === 'granted' ? current : await Notifications.requestPermissionsAsync();
  if (granted.status !== 'granted') return null;
  const token = await Notifications.getExpoPushTokenAsync();
  await api('/me', { method: 'PATCH', body: { expoPushToken: token.data } });
  return token.data;
}

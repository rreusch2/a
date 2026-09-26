import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const CHUNK = 1800;

const storage = {
  async getItem(key: string): Promise<string | null> {
    const countRaw = await SecureStore.getItemAsync(`${key}.chunks`);
    if (!countRaw) return SecureStore.getItemAsync(key);
    const count = Number(countRaw);
    let value = '';
    for (let index = 0; index < count; index += 1) {
      value += (await SecureStore.getItemAsync(`${key}.${index}`)) ?? '';
    }
    return value || null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      await SecureStore.deleteItemAsync(`${key}.chunks`);
      return;
    }
    const count = Math.ceil(value.length / CHUNK);
    await SecureStore.setItemAsync(`${key}.chunks`, String(count));
    for (let index = 0; index < count; index += 1) {
      await SecureStore.setItemAsync(`${key}.${index}`, value.slice(index * CHUNK, (index + 1) * CHUNK));
    }
  },
  async removeItem(key: string): Promise<void> {
    const countRaw = await SecureStore.getItemAsync(`${key}.chunks`);
    await SecureStore.deleteItemAsync(key);
    await SecureStore.deleteItemAsync(`${key}.chunks`);
    const count = Number(countRaw ?? 0);
    for (let index = 0; index < count; index += 1) {
      await SecureStore.deleteItemAsync(`${key}.${index}`);
    }
  },
};

export const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(supabaseUrl || 'https://example.supabase.co', supabaseKey || 'missing-key', {
  auth: {
    storage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export const localStore = AsyncStorage;

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// TODO: Reemplaza estas variables con las de tu proyecto en Supabase.
// Puedes encontrarlas en Configuración > API en tu Dashboard de Supabase.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://jnejvuprgreghfucnswv.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_1W7d7LCLp30WJjNgS-Dpwg_luvIT1R4';

export const isSupabaseConfigured = true;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

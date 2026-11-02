import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { isVipActive } from './vip';

export { isVipActive, vipDaysLeft } from './vip';

/**
 * Monthly VIP (migration 17). Purely cosmetic: a golden ring, a crown and a card
 * that flips. Every write goes through an RPC; nobody can make themselves VIP.
 */

export interface VipInfo {
  user_id: string;
  vip_until: string;
  media_path: string | null;
  tagline: string | null;
  // Migration 19; missing before it is run
  streak_months?: number | null;
  ring_style?: string | null;
  founder_number?: number | null;
  // Migration 20
  win_style?: string | null;
}

export interface MyVip {
  vip_until: string | null;
  active: boolean;
  media_path: string | null;
  pending_media_path: string | null;
  tagline: string | null;
  request: { status: 'pending' | 'approved' | 'rejected'; reason: string | null; created_at: string } | null;
}

export interface VipConfig {
  priceText: string;
  paymentInfo: string;
  days: number;
}

export interface VipRequestRow {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  reference: string;
  receipt_path: string;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  created_at: string;
  vip_until: string | null;
}

export interface VipMediaRow {
  user_id: string;
  display_name: string | null;
  pending_media_path: string;
  updated_at: string;
}

export const MAX_VIP_FILE_BYTES = 4 * 1024 * 1024;

export const vipMediaUrl = (path: string | null | undefined): string | null =>
  path ? supabase.storage.from('vip-media').getPublicUrl(path).data.publicUrl : null;


// ---------------------------------------------------------------------------
// Who is VIP right now: one small list shared by every screen
// ---------------------------------------------------------------------------
let vipMap: Record<string, VipInfo> = {};
let loadedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const STALE_MS = 60_000;

// Coming back to the app (or the tab) picks up approvals and expiries at once
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshVips(true);
  });
}

const emit = () => listeners.forEach((l) => l());

export const refreshVips = (force = false): Promise<void> => {
  if (!force && Date.now() - loadedAt < STALE_MS) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const since = new Date().toISOString();
      // Newest columns first; before migrations 20 and 19 fall back to fewer
      const COLUMN_SETS = [
        'user_id, vip_until, media_path, tagline, streak_months, ring_style, founder_number, win_style',
        'user_id, vip_until, media_path, tagline, streak_months, ring_style, founder_number',
        'user_id, vip_until, media_path, tagline',
      ];
      let data: any[] | null = null;
      let error: unknown = true;
      for (const cols of COLUMN_SETS) {
        const res = await supabase.from('vip_members').select(cols).gt('vip_until', since);
        if (!res.error) {
          data = res.data as any[];
          error = null;
          break;
        }
      }
      // Before migration 17 the table does not exist: nobody is VIP
      if (!error && data) {
        vipMap = Object.fromEntries((data as VipInfo[]).map((v) => [v.user_id, v]));
        loadedAt = Date.now();
        emit();
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

/** The VIP info of one player, or null. Re-renders when the list changes. */
export const useVip = (userId: string | null | undefined): VipInfo | null => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    refreshVips();
    return () => {
      listeners.delete(l);
    };
  }, []);
  const info = userId ? vipMap[userId] : undefined;
  return info && isVipActive(info) ? info : null;
};

/** The VIPs among a list of players (ids may repeat or be empty). */
export const useVipList = (userIds: (string | null | undefined)[]): VipInfo[] => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    refreshVips();
    return () => {
      listeners.delete(l);
    };
  }, []);
  const seen = new Set<string>();
  return userIds
    .filter((id): id is string => !!id && !seen.has(id) && (seen.add(id), true))
    .map((id) => vipMap[id])
    .filter((v): v is VipInfo => !!v && isVipActive(v));
};

// ---------------------------------------------------------------------------
// Picking and uploading an image (GIFs stay animated: no editing, no re-encoding)
// ---------------------------------------------------------------------------
export interface PickedImage {
  body: Blob | ArrayBuffer;
  contentType: string;
  ext: string;
  size: number;
  previewUri: string;
}

const extOf = (mime: string) => {
  const sub = (mime.split('/')[1] || 'jpeg').toLowerCase();
  return sub === 'jpeg' ? 'jpg' : sub.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
};

export const pickImage = async (opts: { keepAnimation?: boolean } = {}): Promise<PickedImage | null> => {
  if (Platform.OS !== 'web') {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') throw new Error('Necesitamos acceso a tu galería para elegir la imagen.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: !opts.keepAnimation,
    quality: opts.keepAnimation ? 1 : 0.6,
    base64: Platform.OS !== 'web',
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];

  if (Platform.OS === 'web') {
    const blob = await (await fetch(asset.uri)).blob();
    const contentType = blob.type || asset.mimeType || 'image/jpeg';
    return { body: blob, contentType, ext: extOf(contentType), size: blob.size, previewUri: asset.uri };
  }
  if (!asset.base64) throw new Error('No se pudo leer la imagen.');
  const fromUri = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
  const contentType = asset.mimeType || `image/${fromUri === 'jpg' ? 'jpeg' : fromUri}`;
  const body = decode(asset.base64);
  return { body, contentType, ext: extOf(contentType), size: body.byteLength, previewUri: asset.uri };
};

const upload = async (bucket: string, userId: string, image: PickedImage) => {
  if (image.size > MAX_VIP_FILE_BYTES) throw new Error('La imagen pesa más de 4 MB. Elige una más liviana.');
  const path = `${userId}/${Date.now()}.${image.ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, image.body, { contentType: image.contentType });
  if (error) throw new Error(error.message);
  return path;
};

const rpcError = (error: { message?: string } | null) => {
  if (error) throw new Error(error.message || 'No se pudo completar.');
};

// ---------------------------------------------------------------------------
// Member side
// ---------------------------------------------------------------------------
export const fetchVipConfig = async (): Promise<VipConfig | null> => {
  const { data, error } = await supabase
    .from('system_config')
    .select('vip_price_text, vip_payment_info, vip_days')
    .order('id')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return { priceText: data.vip_price_text, paymentInfo: data.vip_payment_info || '', days: Number(data.vip_days) || 30 };
};

export const getMyVip = async (): Promise<MyVip | null> => {
  const { data, error } = await supabase.rpc('get_my_vip');
  return error || !data ? null : (data as MyVip);
};

export const requestVip = async (userId: string, reference: string, receipt: PickedImage) => {
  const path = await upload('vip-receipts', userId, receipt);
  const { error } = await supabase.rpc('request_vip', { p_reference: reference, p_receipt_path: path });
  rpcError(error);
};

export const submitVipMedia = async (userId: string, image: PickedImage, keep: (string | null)[]) => {
  const path = await upload('vip-media', userId, image);
  const { error } = await supabase.rpc('set_vip_media', { p_path: path });
  rpcError(error);
  // Old files nobody will show again
  const { data: files } = await supabase.storage.from('vip-media').list(userId);
  const stale = (files || []).map((f) => `${userId}/${f.name}`).filter((p) => p !== path && !keep.includes(p));
  if (stale.length) await supabase.storage.from('vip-media').remove(stale);
};

export const setVipWinStyle = async (style: string) => {
  const { error } = await supabase.rpc('set_vip_win_style', { p_style: style });
  rpcError(error);
  await refreshVips(true);
};

export const setVipRingStyle = async (style: string) => {
  const { error } = await supabase.rpc('set_vip_ring_style', { p_style: style });
  rpcError(error);
  await refreshVips(true);
};

export const setVipTagline = async (text: string) => {
  const { error } = await supabase.rpc('set_vip_tagline', { p_text: text });
  rpcError(error);
  await refreshVips(true);
};

// ---------------------------------------------------------------------------
// Admin side
// ---------------------------------------------------------------------------
export const listVipRequests = async (status: 'pending' | null): Promise<VipRequestRow[]> => {
  const { data, error } = await supabase.rpc('list_vip_requests', { p_status: status });
  rpcError(error);
  return (data || []) as VipRequestRow[];
};

export const reviewVipRequest = async (id: string, approve: boolean, reason?: string) => {
  const { error } = await supabase.rpc('review_vip_request', { p_id: id, p_approve: approve, p_reason: reason ?? null });
  rpcError(error);
  await refreshVips(true);
};

export const listVipMediaPending = async (): Promise<VipMediaRow[]> => {
  const { data, error } = await supabase.rpc('list_vip_media_pending');
  rpcError(error);
  return (data || []) as VipMediaRow[];
};

export const reviewVipMedia = async (userId: string, approve: boolean) => {
  const { error } = await supabase.rpc('review_vip_media', { p_user: userId, p_approve: approve });
  rpcError(error);
  await refreshVips(true);
};

export const receiptUrl = async (path: string): Promise<string | null> => {
  const { data } = await supabase.storage.from('vip-receipts').createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
};

export const saveVipSettings = async (priceText: string, paymentInfo: string) => {
  const { error } = await supabase.rpc('set_vip_settings', { p_price_text: priceText, p_payment_info: paymentInfo });
  rpcError(error);
};

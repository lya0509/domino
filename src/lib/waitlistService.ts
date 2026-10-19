import { supabase } from './supabase';
import { offlineSync } from './offlineSync';
import { realtimeManager } from './realtimeManager';
import { Profile } from '../types';

export interface WaitlistEntry {
  id: string;
  created_at: string;
  status: string;
  creator_id?: string;
  player1_id: string;
  player2_id: string;
  player1?: Profile;
  player2?: Profile;
}

/**
 * Fetches the active waitlist without relying on fragile PostgREST foreign key names.
 * Enriches player1 and player2 from the fast profile cache (or fetches on demand).
 */
export const fetchActiveWaitlist = async (): Promise<WaitlistEntry[]> => {
  try {
    const { data, error } = await supabase
      .from('waitlist')
      .select('*')
      .eq('status', 'waiting')
      .order('created_at', { ascending: true });

    if (error || !data) {
      if (error) console.warn('Waitlist fetch warning:', error.message);
      return [];
    }

    const { profileMap } = await offlineSync.getProfiles(false);

    // Check if any player ID in waitlist is missing from cache
    const missingIds = new Set<string>();
    data.forEach((row: any) => {
      if (row.player1_id && !profileMap[row.player1_id]) missingIds.add(row.player1_id);
      if (row.player2_id && !profileMap[row.player2_id]) missingIds.add(row.player2_id);
    });

    if (missingIds.size > 0) {
      const { profileMap: refreshedMap } = await offlineSync.getProfiles(true);
      Object.assign(profileMap, refreshedMap);
    }

    return data.map((row: any) => ({
      id: row.id,
      created_at: row.created_at,
      status: row.status,
      creator_id: row.creator_id || row.player1_id,
      player1_id: row.player1_id,
      player2_id: row.player2_id,
      player1: profileMap[row.player1_id] || {
        id: row.player1_id,
        display_name: 'Jugador 1',
        initials: 'J1',
      },
      player2: profileMap[row.player2_id] || {
        id: row.player2_id,
        display_name: 'Jugador 2',
        initials: 'J2',
      },
    }));
  } catch (e) {
    console.warn('Error fetching active waitlist:', e);
    return [];
  }
};

export const joinOrUpdateWaitlist = async (params: {
  userId?: string;
  currentUserId?: string;
  partnerId: string;
  editingEntryId?: string | null;
  existingWaitlistId?: string | null;
}): Promise<{ ok: boolean; success: boolean; error?: string }> => {
  const userId = params.userId || params.currentUserId || '';
  const { partnerId } = params;
  const editingEntryId = params.editingEntryId ?? params.existingWaitlistId ?? null;

  if (!userId || !partnerId) {
    return { ok: false, success: false, error: 'Selecciona un compañero válido.' };
  }
  if (userId === partnerId) {
    return { ok: false, success: false, error: 'No puedes seleccionarte a ti mismo como compañero.' };
  }

  try {
    // Check if user or partner is already in an active waiting slot (excluding editingEntryId)
    const currentQueue = await fetchActiveWaitlist();
    const conflict = currentQueue.find(
      (item) =>
        item.id !== editingEntryId &&
        (item.player1_id === userId ||
          item.player2_id === userId ||
          item.player1_id === partnerId ||
          item.player2_id === partnerId)
    );

    if (conflict) {
      const conflictName =
        conflict.player1_id === partnerId || conflict.player2_id === partnerId
          ? 'Tu compañero seleccionado ya está anotado en la lista de espera.'
          : 'Ya tienes un turno activo en la lista de espera.';
      return { ok: false, success: false, error: conflictName };
    }

    if (editingEntryId) {
      const { error } = await supabase
        .from('waitlist')
        .update({
          player1_id: userId,
          player2_id: partnerId,
        })
        .eq('id', editingEntryId);

      if (error) {
        return { ok: false, success: false, error: error.message };
      }
    } else {
      // Try inserting with creator_id first, fallback without creator_id if column is absent
      const { error: errWithCreator } = await supabase.from('waitlist').insert({
        creator_id: userId,
        player1_id: userId,
        player2_id: partnerId,
        status: 'waiting',
      });

      if (errWithCreator) {
        const { error: errFallback } = await supabase.from('waitlist').insert({
          player1_id: userId,
          player2_id: partnerId,
          status: 'waiting',
        });

        if (errFallback) {
          return { ok: false, success: false, error: errFallback.message };
        }
      }
    }

    await realtimeManager.sendWaitlistBroadcast('waitlist_refresh', {
      timestamp: Date.now(),
    });
    return { ok: true, success: true };
  } catch (e: any) {
    return {
      ok: false,
      success: false,
      error: e?.message || 'Error al guardar en la lista de espera.',
    };
  }
};

export const removeWaitlistEntry = async (
  entryId: string
): Promise<{ ok: boolean; success: boolean; error?: string }> => {
  if (!entryId) return { ok: false, success: false, error: 'ID inválido' };
  try {
    const { error } = await supabase
      .from('waitlist')
      .update({ status: 'cancelled' })
      .eq('id', entryId);

    if (error) {
      // Fallback: delete row if status check or RLS prefers delete
      const { error: delErr } = await supabase
        .from('waitlist')
        .delete()
        .eq('id', entryId);
      if (delErr) {
        return { ok: false, success: false, error: delErr.message };
      }
    }

    await realtimeManager.sendWaitlistBroadcast('waitlist_refresh', {
      timestamp: Date.now(),
    });
    return { ok: true, success: true };
  } catch (e: any) {
    return { ok: false, success: false, error: e?.message || 'No se pudo salir de la fila.' };
  }
};

export const callWaitlistDuo = async (
  entry: WaitlistEntry,
  callerName: string
): Promise<boolean> => {
  const p1Name = entry.player1?.display_name || 'Jugador 1';
  const p2Name = entry.player2?.display_name || 'Jugador 2';

  return await realtimeManager.sendWaitlistBroadcast('call_duo', {
    duoId: entry.id,
    p1Id: entry.player1_id || entry.player1?.id,
    p2Id: entry.player2_id || entry.player2?.id,
    p1Name,
    p2Name,
    callerName: callerName || 'La Mesa',
    timestamp: Date.now(),
  });
};

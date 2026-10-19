import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { Match, Profile } from '../types';

const STORAGE_KEYS = {
  OFFLINE_QUEUE: '@domino_offline_queue_v1',
  PROFILES_CACHE: '@domino_cache_profiles_v1',
  MATCHES_CACHE: '@domino_cache_matches_v1',
  WAITLIST_CACHE: '@domino_cache_waitlist_v1',
  USER_PROFILE_CACHE: '@domino_cache_user_profile_v1',
};

export type OfflineOperationType =
  | 'UPSERT_MATCH'
  | 'COMPLETE_MATCH'
  | 'WAITLIST_JOIN'
  | 'WAITLIST_CANCEL';

export interface OfflineQueueItem {
  id: string;
  type: OfflineOperationType;
  payload: any;
  createdAt: number;
  retryCount: number;
}

export interface SyncStatus {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

type SyncListener = (status: SyncStatus) => void;

/**
 * Generates a RFC4122 v4 UUID so matches created offline have a valid Supabase UUID immediately.
 */
export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const isValidUUID = (id?: string | null): boolean => {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

class OfflineSyncEngine {
  private memoryProfiles: Profile[] | null = null;
  private memoryProfileMap: Record<string, Profile> = {};
  private memoryMatches: any[] | null = null;
  private queue: OfflineQueueItem[] = [];
  private listeners: Set<SyncListener> = new Set();
  private status: SyncStatus = {
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null,
  };
  private syncInterval: any = null;
  private initialized = false;

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    await this.loadQueueFromStorage();
    await this.loadProfilesCacheFromStorage();

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      this.status.isOnline = navigator.onLine !== false;
      window.addEventListener('online', () => {
        this.updateStatus({ isOnline: true });
        this.flushQueue();
      });
      window.addEventListener('offline', () => {
        this.updateStatus({ isOnline: false });
      });
    }

    // Periodic background flush every 15 seconds if there are pending items
    this.syncInterval = setInterval(() => {
      if (this.queue.length > 0 && !this.status.isSyncing) {
        this.flushQueue();
      }
    }, 15000);

    if (this.queue.length > 0 && this.status.isOnline) {
      this.flushQueue();
    }
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  getIsOnline(): boolean {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      return false;
    }
    return this.status.isOnline;
  }

  getQueue(): OfflineQueueItem[] {
    return [...this.queue];
  }

  private updateStatus(partial: Partial<SyncStatus>) {
    this.status = {
      ...this.status,
      ...partial,
      pendingCount: this.queue.length,
    };
    this.listeners.forEach((l) => l(this.status));
  }

  private async getItem(key: string): Promise<string | null> {
    try {
      const val = await AsyncStorage.getItem(key);
      if (val) return val;
    } catch {}
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        return window.localStorage.getItem(key);
      } catch {}
    }
    return null;
  }

  private async setItem(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {}
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(key, value);
      } catch {}
    }
  }

  private async loadQueueFromStorage() {
    try {
      const raw = await this.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.queue = parsed;
          this.updateStatus({ pendingCount: this.queue.length });
        }
      }
    } catch (e) {
      console.warn('Error loading offline queue:', e);
    }
  }

  private async persistQueue() {
    try {
      await this.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(this.queue));
      this.updateStatus({ pendingCount: this.queue.length });
    } catch (e) {
      console.warn('Error persisting offline queue:', e);
    }
  }

  // ============================================================================
  // FAST CACHE LAYER (Stale-While-Revalidate for Profiles & Matches)
  // ============================================================================

  private async loadProfilesCacheFromStorage() {
    try {
      const raw = await this.getItem(STORAGE_KEYS.PROFILES_CACHE);
      if (raw) {
        const list = JSON.parse(raw) as Profile[];
        if (Array.isArray(list)) {
          this.memoryProfiles = list;
          this.memoryProfileMap = {};
          list.forEach((p) => {
            this.memoryProfileMap[p.id] = p;
          });
        }
      }
    } catch {}
  }

  getCachedProfilesSync(): Profile[] {
    return this.memoryProfiles || [];
  }

  getCachedProfileMapSync(): Record<string, Profile> {
    return this.memoryProfileMap;
  }

  private createHybridProfilesResult(
    list: Profile[],
    map: Record<string, Profile>
  ): Profile[] & { profiles: Profile[]; profileMap: Record<string, Profile> } {
    const arr = [...list] as any;
    arr.profiles = list;
    arr.profileMap = map;
    return arr;
  }

  async getProfiles(
    forceRefresh = false
  ): Promise<Profile[] & { profiles: Profile[]; profileMap: Record<string, Profile> }> {
    if (!forceRefresh && this.memoryProfiles && this.memoryProfiles.length > 0) {
      this.refreshProfilesInBackground();
      return this.createHybridProfilesResult(this.memoryProfiles, this.memoryProfileMap);
    }

    return await this.refreshProfilesInBackground();
  }

  async refreshProfilesInBackground(): Promise<
    Profile[] & { profiles: Profile[]; profileMap: Record<string, Profile> }
  > {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, initials, avatar_url, betting_points, streak_count, last_daily_bonus_at, last_streak_update_at, equipped_items, achievements, inventory, is_admin, created_at')
        .order('display_name');

      if (!error && data) {
        const list = data as Profile[];
        this.memoryProfiles = list;
        const map: Record<string, Profile> = {};
        list.forEach((p) => {
          map[p.id] = p;
        });
        this.memoryProfileMap = map;
        this.updateStatus({ isOnline: true });
        await this.setItem(STORAGE_KEYS.PROFILES_CACHE, JSON.stringify(list));
      }
    } catch (err) {
      this.updateStatus({ isOnline: false });
    }

    return this.createHybridProfilesResult(
      this.memoryProfiles || [],
      this.memoryProfileMap || {}
    );
  }

  updateCachedProfile(updated: Partial<Profile> & { id: string }) {
    const existing = this.memoryProfileMap[updated.id];
    if (existing) {
      const merged = { ...existing, ...updated };
      this.memoryProfileMap[updated.id] = merged;
      if (this.memoryProfiles) {
        this.memoryProfiles = this.memoryProfiles.map((p) =>
          p.id === updated.id ? merged : p
        );
      }
    } else if (updated.id && updated.display_name) {
      const asProf = updated as Profile;
      this.memoryProfileMap[updated.id] = asProf;
      this.memoryProfiles = [...(this.memoryProfiles || []), asProf];
    }
  }

  updateProfileInCache(updated: Partial<Profile> & { id: string }) {
    this.updateCachedProfile(updated);
  }

  async getCachedMatches(): Promise<any[]> {
    if (this.memoryMatches) return this.memoryMatches;
    try {
      const raw = await this.getItem(STORAGE_KEYS.MATCHES_CACHE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.memoryMatches = parsed;
          return parsed;
        }
      }
    } catch {}
    return [];
  }

  async setCachedMatches(matches: any[]): Promise<void> {
    this.memoryMatches = matches;
    // Persist the most recent matches (input order from Supabase is not guaranteed)
    const newestFirst = [...matches].sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || ''))
    );
    const light = newestFirst.slice(0, 150).map((m) => ({
      id: m.id,
      status: m.status,
      game_mode: m.game_mode,
      limit_score: m.limit_score,
      team1_total: m.team1_total,
      team2_total: m.team2_total,
      winner_team: m.winner_team,
      is_zapato: m.is_zapato,
      team1_player1: m.team1_player1,
      team1_player2: m.team1_player2,
      team2_player1: m.team2_player1,
      team2_player2: m.team2_player2,
      created_at: m.created_at,
      wager_amount: m.wager_amount,
      is_wager_match: m.is_wager_match,
      tournament_id: m.tournament_id,
    }));
    await this.setItem(STORAGE_KEYS.MATCHES_CACHE, JSON.stringify(light));
  }

  // ============================================================================
  // OFFLINE QUEUE & SYNC OPERATIONS
  // ============================================================================

  async enqueueMatchUpsert(matchData: any) {
    const existingIndex = this.queue.findIndex(
      (item) =>
        item.type === 'UPSERT_MATCH' && item.payload?.id === matchData.id
    );

    if (existingIndex >= 0) {
      this.queue[existingIndex].payload = {
        ...this.queue[existingIndex].payload,
        ...matchData,
      };
      this.queue[existingIndex].createdAt = Date.now();
    } else {
      this.queue.push({
        id: generateUUID(),
        type: 'UPSERT_MATCH',
        payload: matchData,
        createdAt: Date.now(),
        retryCount: 0,
      });
    }

    await this.persistQueue();
  }

  async enqueueMatchComplete(completeInput: any) {
    const matchData = completeInput?.matchData ? completeInput.matchData : completeInput;
    const winnerTeam =
      completeInput?.winnerTeam !== undefined
        ? completeInput.winnerTeam
        : matchData?.winner_team ?? null;

    this.queue = this.queue.filter(
      (item) =>
        !(
          item.type === 'UPSERT_MATCH' &&
          item.payload?.id === matchData.id
        )
    );

    this.queue.push({
      id: generateUUID(),
      type: 'COMPLETE_MATCH',
      payload: {
        matchData,
        winnerTeam,
      },
      createdAt: Date.now(),
      retryCount: 0,
    });

    await this.persistQueue();
  }

  /**
   * Saves or updates an active match online first; if offline or network error occurs,
   * queues it in the persistent outbox so the game continues without interruption.
   */
  async syncActiveMatch(matchOrPayload: any): Promise<boolean> {
    if (!matchOrPayload || matchOrPayload.isGuestMode) return true;

    let matchPayload: any;
    if (matchOrPayload.game_mode !== undefined || matchOrPayload.players_json !== undefined) {
      matchPayload = {
        ...matchOrPayload,
        id: isValidUUID(matchOrPayload.id) ? matchOrPayload.id : generateUUID(),
      };
    } else {
      const match = matchOrPayload as Match;
      const getValidId = (id?: string) =>
        id && !id.startsWith('guest-') && isValidUUID(id) ? id : null;

      const team1Players = (match.players || []).filter((p) => p.teamNumber === 1);
      const team2Players = (match.players || []).filter((p) => p.teamNumber === 2);

      const totals = { team1: 0, team2: 0 };
      (match.rounds || []).forEach((r) => {
        if (r.scorerId === 'tie') return;
        if (r.scorerId === 'team1' || r.scorerId === 'team2') {
          totals[r.scorerId] += r.points;
        } else {
          const player = (match.players || []).find((p) => p.id === r.scorerId);
          if (player && (player.teamNumber === 1 || player.teamNumber === 2)) {
            totals[`team${player.teamNumber}`] += r.points;
          }
        }
      });

      matchPayload = {
        id: isValidUUID(match.id) ? match.id : generateUUID(),
        status: match.status || 'active',
        game_mode: match.gameMode,
        limit_score: match.limitScore,
        rounds: match.rounds || [],
        substitutions: match.substitutions || [],
        team1_total: totals.team1,
        team2_total: totals.team2,
        players_json: match.players,
        wager_amount: match.wager_amount || 0,
        is_wager_match: match.is_wager_match || false,
        tournament_id: match.tournament_id || null,
        team1_player1: getValidId(team1Players[0]?.profileId),
        team1_player2: getValidId(team1Players[1]?.profileId),
        team2_player1: getValidId(team2Players[0]?.profileId),
        team2_player2: getValidId(team2Players[1]?.profileId),
      };
    }

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.updateStatus({ isOnline: false });
      await this.enqueueMatchUpsert(matchPayload);
      return false;
    }

    try {
      const { error } = await supabase
        .from('matches')
        .upsert(matchPayload, { onConflict: 'id' });

      if (error) {
        const { data: existing } = await supabase
          .from('matches')
          .select('id')
          .eq('id', matchPayload.id)
          .maybeSingle();

        if (existing) {
          const { error: updErr } = await supabase
            .from('matches')
            .update(matchPayload)
            .eq('id', matchPayload.id);
          if (updErr) throw updErr;
        } else {
          const { error: insErr } = await supabase
            .from('matches')
            .insert(matchPayload);
          if (insErr) throw insErr;
        }
      }

      this.updateStatus({ isOnline: true, lastSyncedAt: Date.now(), lastError: null });
      return true;
    } catch (err: any) {
      console.warn('Network/Supabase error syncing active match, queuing offline:', err?.message);
      this.updateStatus({ isOnline: false, lastError: err?.message || 'Offline' });
      await this.enqueueMatchUpsert(matchPayload);
      return false;
    }
  }

  /**
   * Flushes all queued offline operations to Supabase in FIFO order.
   */
  async flushQueue(): Promise<{ synced: number; remaining: number }> {
    if (this.status.isSyncing || this.queue.length === 0) {
      return { synced: 0, remaining: this.queue.length };
    }

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.updateStatus({ isOnline: false });
      return { synced: 0, remaining: this.queue.length };
    }

    this.updateStatus({ isSyncing: true, lastError: null });
    let syncedCount = 0;
    const remainingItems: OfflineQueueItem[] = [];

    for (const item of this.queue) {
      try {
        if (item.type === 'UPSERT_MATCH') {
          const payload = item.payload;
          const { data: existing } = await supabase
            .from('matches')
            .select('id, status')
            .eq('id', payload.id)
            .maybeSingle();

          if (existing) {
            if (existing.status !== 'completed') {
              const { error } = await supabase
                .from('matches')
                .update(payload)
                .eq('id', payload.id);
              if (error) throw error;
            }
          } else {
            const { error } = await supabase.from('matches').insert(payload);
            if (error) throw error;
          }
          syncedCount++;
        } else if (item.type === 'COMPLETE_MATCH') {
          const matchData = item.payload?.matchData || item.payload;
          const winnerTeam =
            item.payload?.winnerTeam !== undefined
              ? item.payload.winnerTeam
              : matchData?.winner_team ?? null;

          const { data: existing } = await supabase
            .from('matches')
            .select('id')
            .eq('id', matchData.id)
            .maybeSingle();

          if (existing) {
            const { error } = await supabase
              .from('matches')
              .update(matchData)
              .eq('id', matchData.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from('matches').insert(matchData);
            if (error) throw error;
          }

          if (isValidUUID(matchData.id)) {
            const { settleMatchBetsAndWagers } = require('./bettingService');
            await settleMatchBetsAndWagers(matchData, winnerTeam);
            try {
              await supabase.rpc('update_player_streaks_for_match', {
                p_match_id: matchData.id,
              });
            } catch {}
          }
          syncedCount++;
        }
      } catch (err: any) {
        console.warn(`Failed to flush offline item ${item.id} (${item.type}):`, err?.message);
        item.retryCount = (item.retryCount || 0) + 1;
        if (item.retryCount <= 20) {
          remainingItems.push(item);
        }
        this.updateStatus({ lastError: err?.message || 'Sync error' });
      }
    }

    this.queue = remainingItems;
    await this.persistQueue();
    this.updateStatus({
      isSyncing: false,
      isOnline: remainingItems.length === 0,
      lastSyncedAt: syncedCount > 0 ? Date.now() : this.status.lastSyncedAt,
    });

    return { synced: syncedCount, remaining: this.queue.length };
  }
}

export const offlineSync = new OfflineSyncEngine();

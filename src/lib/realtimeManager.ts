import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type SignalHandler = (payload: any) => void;

// A row update can carry an old notice: anything older than this was already handled
const SIGNAL_MAX_AGE_MS = 10 * 60 * 1000;

class RealtimeManager {
  private waitlistChannel: RealtimeChannel | null = null;
  private seenCalls: Map<string, string> = new Map();
  private seenNearTurns: Map<string, string> = new Map();
  private callDuoListeners: Set<SignalHandler> = new Set();
  private proximityListeners: Set<SignalHandler> = new Set();
  private waitlistChangeListeners: Set<() => void> = new Set();

  private matchChannels: Map<string, RealtimeChannel> = new Map();
  private matchListeners: Map<string, Set<(newData: any) => void>> = new Map();

  /**
   * Initializes or returns the singleton waitlist channel.
   */
  ensureWaitlistChannel(): RealtimeChannel {
    if (this.waitlistChannel) {
      return this.waitlistChannel;
    }

    const channel = supabase
      .channel('domino_waitlist_calls')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'waitlist' },
        (payload: any) => {
          this.waitlistChangeListeners.forEach((cb) => cb());
          if (payload?.eventType === 'UPDATE' && payload.new) this.emitQueueSignals(payload.new);
        }
      )
      .subscribe();

    this.waitlistChannel = channel;
    return channel;
  }

  onCallDuo(cb: SignalHandler): () => void {
    this.ensureWaitlistChannel();
    this.callDuoListeners.add(cb);
    return () => {
      this.callDuoListeners.delete(cb);
    };
  }

  onProximityAlert(cb: SignalHandler): () => void {
    this.ensureWaitlistChannel();
    this.proximityListeners.add(cb);
    return () => {
      this.proximityListeners.delete(cb);
    };
  }

  onWaitlistChange(cb: () => void): () => void {
    this.ensureWaitlistChannel();
    this.waitlistChangeListeners.add(cb);
    return () => {
      this.waitlistChangeListeners.delete(cb);
    };
  }

  /**
   * Table calls and near-turn notices come from waitlist columns only the server can write.
   * Broadcast is not used for them: anyone with the public key could send one.
   */
  private emitQueueSignals(row: any) {
    if (row.status !== 'waiting') return;
    const isFresh = (at: string) => Date.now() - new Date(at).getTime() < SIGNAL_MAX_AGE_MS;

    if (row.called_at && isFresh(row.called_at) && this.seenCalls.get(row.id) !== row.called_at) {
      this.seenCalls.set(row.id, row.called_at);
      const data = {
        duoId: row.id,
        p1Id: row.player1_id,
        p2Id: row.player2_id,
        callerName: row.called_by_name || 'La Mesa',
      };
      this.callDuoListeners.forEach((cb) => cb(data));
    }

    if (row.near_turn_at && isFresh(row.near_turn_at) && this.seenNearTurns.get(row.id) !== row.near_turn_at) {
      this.seenNearTurns.set(row.id, row.near_turn_at);
      const data = {
        highestScore: row.near_turn_score,
        limitScore: row.near_turn_limit,
        pointsLeft: Math.max(1, row.near_turn_limit - row.near_turn_score),
      };
      this.proximityListeners.forEach((cb) => cb(data));
    }
  }

  /**
   * One long-lived channel per match topic, shared by every screen via listener sets.
   * supabase.channel(topic) returns a
   * still-closing channel after removeChannel(), where adding .on() throws — so we never recreate it.
   */
  private ensureMatchChannel(matchId: string): RealtimeChannel {
    const topic = `sync_match_${matchId}`;
    const existing = this.matchChannels.get(topic);
    if (existing) return existing;

    const listeners = new Set<(newData: any) => void>();
    this.matchListeners.set(topic, listeners);

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matches',
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          if (payload?.new) {
            listeners.forEach((cb) => cb(payload.new));
          }
        }
      )
      .subscribe();

    this.matchChannels.set(topic, channel);
    return channel;
  }

  /**
   * Live score updates. Only database changes count: the server already checked who wrote them.
   */
  subscribeToMatch(matchId: string, onMatchUpdate: (newData: any) => void): () => void {
    this.ensureMatchChannel(matchId);
    const listeners = this.matchListeners.get(`sync_match_${matchId}`)!;
    listeners.add(onMatchUpdate);
    return () => {
      listeners.delete(onMatchUpdate);
    };
  }
}

export const realtimeManager = new RealtimeManager();

import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type BroadcastHandler = (payload: any) => void;

class RealtimeManager {
  private waitlistChannel: RealtimeChannel | null = null;
  private waitlistSubscribed = false;
  private callDuoListeners: Set<BroadcastHandler> = new Set();
  private proximityListeners: Set<BroadcastHandler> = new Set();
  private waitlistChangeListeners: Set<() => void> = new Set();

  private matchChannels: Map<string, RealtimeChannel> = new Map();
  private matchListeners: Map<string, Set<(newData: any, source: 'broadcast' | 'postgres') => void>> = new Map();
  private matchSubscribed: Set<string> = new Set();

  /**
   * Initializes or returns the singleton waitlist broadcast & postgres channel.
   */
  ensureWaitlistChannel(): RealtimeChannel {
    if (this.waitlistChannel) {
      return this.waitlistChannel;
    }

    const channel = supabase
      .channel('domino_waitlist_calls', {
        config: {
          broadcast: { self: true },
        },
      })
      .on('broadcast', { event: 'call_duo' }, (msg) => {
        const data = msg?.payload;
        if (data) {
          this.callDuoListeners.forEach((cb) => cb(data));
        }
      })
      .on('broadcast', { event: 'proximity_alert' }, (msg) => {
        const data = msg?.payload;
        if (data) {
          this.proximityListeners.forEach((cb) => cb(data));
        }
      })
      .on('broadcast', { event: 'waitlist_refresh' }, () => {
        this.waitlistChangeListeners.forEach((cb) => cb());
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'waitlist' },
        () => {
          this.waitlistChangeListeners.forEach((cb) => cb());
        }
      )
      .subscribe((status) => {
        this.waitlistSubscribed = status === 'SUBSCRIBED';
      });

    this.waitlistChannel = channel;
    return channel;
  }

  onCallDuo(cb: BroadcastHandler): () => void {
    this.ensureWaitlistChannel();
    this.callDuoListeners.add(cb);
    return () => {
      this.callDuoListeners.delete(cb);
    };
  }

  onProximityAlert(cb: BroadcastHandler): () => void {
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

  async sendWaitlistBroadcast(
    event: 'call_duo' | 'proximity_alert' | 'waitlist_refresh',
    payload: any
  ): Promise<boolean> {
    try {
      const channel = this.ensureWaitlistChannel();
      // Wait briefly if channel is still connecting
      if (!this.waitlistSubscribed) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await channel.send({
        type: 'broadcast',
        event,
        payload,
      });
      return true;
    } catch (e) {
      console.warn(`Error sending broadcast ${event}:`, e);
      return false;
    }
  }

  async broadcastCallDuo(payload: any): Promise<boolean> {
    return this.sendWaitlistBroadcast('call_duo', payload);
  }

  async broadcastProximityAlert(payload: any): Promise<boolean> {
    return this.sendWaitlistBroadcast('proximity_alert', payload);
  }

  async notifyWaitlistRefresh(): Promise<boolean> {
    return this.sendWaitlistBroadcast('waitlist_refresh', { timestamp: Date.now() });
  }

  /**
   * One long-lived channel per match topic, shared by every screen via listener sets.
   * The topic must stay fixed (peers broadcast on it), and supabase.channel(topic) returns a
   * still-closing channel after removeChannel(), where adding .on() throws — so we never recreate it.
   */
  private ensureMatchChannel(matchId: string): RealtimeChannel {
    const topic = `sync_match_${matchId}`;
    const existing = this.matchChannels.get(topic);
    if (existing) return existing;

    const listeners = new Set<(newData: any, source: 'broadcast' | 'postgres') => void>();
    this.matchListeners.set(topic, listeners);

    const channel = supabase
      .channel(topic, {
        config: {
          broadcast: { self: false },
        },
      })
      .on('broadcast', { event: 'match_update' }, (msg) => {
        if (msg?.payload) {
          listeners.forEach((cb) => cb(msg.payload, 'broadcast'));
        }
      })
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
            listeners.forEach((cb) => cb(payload.new, 'postgres'));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.matchSubscribed.add(topic);
      });

    this.matchChannels.set(topic, channel);
    return channel;
  }

  /**
   * Subscribes to ultra-low-latency match updates (both Broadcast and Postgres Changes).
   */
  subscribeToMatch(
    matchId: string,
    onMatchUpdate: (newData: any, source: 'broadcast' | 'postgres') => void
  ): () => void {
    this.ensureMatchChannel(matchId);
    const listeners = this.matchListeners.get(`sync_match_${matchId}`)!;
    listeners.add(onMatchUpdate);
    return () => {
      listeners.delete(onMatchUpdate);
    };
  }

  /**
   * Broadcasts instant match state to all connected peers (<100ms latency)
   * alongside the database update.
   */
  async broadcastMatchUpdate(matchId: string, matchPayload: any) {
    try {
      const topic = `sync_match_${matchId}`;
      const channel = this.ensureMatchChannel(matchId);
      if (!this.matchSubscribed.has(topic)) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      await channel.send({
        type: 'broadcast',
        event: 'match_update',
        payload: matchPayload,
      });
    } catch (e) {
      // Ignore broadcast errors; Postgres changes + DB sync still persist
    }
  }
}

export const realtimeManager = new RealtimeManager();

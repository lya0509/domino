import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { realtimeManager } from '../lib/realtimeManager';
import { fetchActiveWaitlist } from '../lib/waitlistService';
import { syncPushSubscription } from '../lib/pushNotifications';
import { sounds } from '../lib/sounds';
import { betPlacedNotice, firstInLineNotice, matchStartedNotice, Notice } from '../lib/matchRivals';

interface Props {
  currentUserProfileId: string | null;
  showToast: (name: string, text: string, color?: string, durationMs?: number) => void;
}

const NOTICE_COLOR = '#f59e0b';
const NOTICE_MS = 6000;

/**
 * Toasts while the app is open: a match started, someone bet, you're first in line.
 * The phone's notifications come from the server, so it also keeps this device registered.
 */
export const ClubNotices = ({ currentUserProfileId, showToast }: Props) => {
  const wasFirst = useRef<boolean | null>(null);

  useEffect(() => {
    if (!currentUserProfileId) return;

    syncPushSubscription().catch((e) => console.warn('Push sync failed:', e));

    const announce = ({ title, text }: Notice) => {
      sounds.playSound('pop');
      showToast(title, text, NOTICE_COLOR, NOTICE_MS);
    };

    const onBet = async (bet: any) => {
      if (bet.user_id === currentUserProfileId) return;
      const [{ data: match }, { data: bets }] = await Promise.all([
        supabase.from('matches').select('players_json, status').eq('id', bet.match_id).maybeSingle(),
        supabase.from('bets').select('amount_wagered').eq('match_id', bet.match_id).eq('bet_on_team', bet.bet_on_team).neq('status', 'cancelled'),
      ]);
      if (!match || match.status !== 'active') return;
      const total = (bets || []).reduce((sum: number, b: any) => sum + Number(b.amount_wagered || 0), 0);
      announce(betPlacedNotice(match, bet.bet_on_team, total));
    };

    const checkLine = async () => {
      const [first] = await fetchActiveWaitlist();
      const isFirst = !!first && (first.player1_id === currentUserProfileId || first.player2_id === currentUserProfileId);
      if (wasFirst.current === false && isFirst) announce(firstInLineNotice);
      wasFirst.current = isFirst;
    };

    const channel = supabase
      .channel(`club-notices-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'matches' }, (payload: any) => {
        if (payload.new?.status !== 'active') return;
        const notice = matchStartedNotice(payload.new, currentUserProfileId);
        if (notice) announce(notice);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bets' }, (payload: any) => {
        if (payload.new) onBet(payload.new);
      })
      .subscribe();

    checkLine();
    const unsubLine = realtimeManager.onWaitlistChange(checkLine);

    return () => {
      unsubLine();
      supabase.removeChannel(channel);
    };
  }, [currentUserProfileId, showToast]);

  return null;
};

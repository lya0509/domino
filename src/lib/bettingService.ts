import { supabase } from './supabase';
import { isValidUUID, offlineSync } from './offlineSync';

// Points only change on the server (see fix_points_security.sql): the client
// can no longer write profiles.betting_points or bets, so every operation here is an RPC.

export interface PlaceBetResult {
  ok: boolean;
  success: boolean;
  newBalance: number;
  multiplier?: number;
  bet?: any;
  error?: string;
}

/**
 * Places a bet on an active match through the `place_bet` RPC, which checks the balance,
 * computes the multiplier, inserts the bet and deducts the points in one transaction.
 * `multiplier` is only the value shown in the UI; the server's value is returned.
 */
export const placeMatchBet = async (params: {
  userId: string;
  matchId: string;
  betTeam?: 1 | 2;
  betOnTeam?: 1 | 2;
  amount: number;
  multiplier?: number;
}): Promise<PlaceBetResult> => {
  const { userId, matchId, amount } = params;
  const betTeam = params.betTeam ?? params.betOnTeam;

  if (!userId || !isValidUUID(matchId) || (betTeam !== 1 && betTeam !== 2)) {
    return { ok: false, success: false, newBalance: 0, error: 'Partida o usuario inválido.' };
  }
  if (isNaN(amount) || amount <= 0) {
    return { ok: false, success: false, newBalance: 0, error: 'Ingresa una cantidad válida mayor a 0.' };
  }

  try {
    const { data, error } = await supabase.rpc('place_bet', {
      p_match_id: matchId,
      p_bet_on_team: betTeam,
      p_amount: Math.floor(amount),
    });

    if (error || !data) {
      return {
        ok: false,
        success: false,
        newBalance: 0,
        error: error?.message || 'No se pudo registrar la apuesta.',
      };
    }

    const newBalance = Number(data.new_balance || 0);
    offlineSync.updateCachedProfile({ id: userId, betting_points: newBalance });
    return {
      ok: true,
      success: true,
      newBalance,
      multiplier: Number(data.multiplier),
      bet: data.bet,
    };
  } catch (err: any) {
    return {
      ok: false,
      success: false,
      newBalance: 0,
      error: err?.message || 'Error de conexión al registrar apuesta.',
    };
  }
};

/**
 * Settles spectator bets and VIP wagers of a finished match.
 * The server trigger already settles when the match row becomes 'completed'; this call is a
 * safety net (e.g. matches completed before the trigger existed). The server takes the winner
 * from the match row itself, so the winner/players passed here are ignored. Signature kept for callers.
 */
export const settleMatchBetsAndWagers = async (
  matchOrParams: {
    id?: string;
    matchId?: string;
    winnerTeam?: number | null;
    is_wager_match?: boolean;
    isWagerMatch?: boolean;
    wager_amount?: number;
    wagerAmount?: number;
    team1_player1?: string | null;
    team1_player2?: string | null;
    team2_player1?: string | null;
    team2_player2?: string | null;
    team1Player1?: string | null;
    team1Player2?: string | null;
    team2Player1?: string | null;
    team2Player2?: string | null;
    team1Players?: (string | null | undefined)[];
    team2Players?: (string | null | undefined)[];
  },
  _winnerTeamArg?: number | null,
  currentUserId?: string | null
): Promise<void> => {
  const matchId = matchOrParams.id || matchOrParams.matchId || '';
  if (!isValidUUID(matchId)) return;

  try {
    const { error } = await supabase.rpc('settle_completed_match', { p_match_id: matchId });
    if (error) console.warn('settle_completed_match warning:', error.message);
  } catch (err) {
    console.warn('settle_completed_match warning:', err);
  }

  if (currentUserId) {
    await reconcileUserPendingBets(currentUserId);
  }
};

/**
 * Settles the current user's pending bets whose matches already finished
 * (`settle_my_pending_bets` RPC) and returns what was credited.
 */
export const reconcileUserPendingBets = async (
  userId: string
): Promise<{
  newlyWonBets: number;
  totalPointsCredited: number;
  settledCount: number;
  totalCredited: number;
  updatedBalance: number | null;
}> => {
  const empty = {
    newlyWonBets: 0,
    totalPointsCredited: 0,
    settledCount: 0,
    totalCredited: 0,
    updatedBalance: null,
  };
  if (!userId) return empty;

  try {
    const { data, error } = await supabase.rpc('settle_my_pending_bets');
    if (error || !data) return empty;

    const won = Number(data.won_count || 0);
    const credited = Number(data.total_credited || 0);
    const balance = data.new_balance === null || data.new_balance === undefined ? null : Number(data.new_balance);
    if (balance !== null) {
      offlineSync.updateCachedProfile({ id: userId, betting_points: balance });
    }
    return {
      newlyWonBets: won,
      totalPointsCredited: credited,
      settledCount: won,
      totalCredited: credited,
      updatedBalance: balance,
    };
  } catch (err) {
    console.warn('Error reconciling user pending bets:', err);
    return empty;
  }
};

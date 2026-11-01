import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { confirmMatchResult, disputeMatchResult, finishExpiredMatch } from '../lib/bettingService';
import { CONFIRMATION_COLUMNS, isMatchRival, matchTeamLabel, secondsUntil } from '../lib/matchRivals';
import { sounds } from '../lib/sounds';

const RELOAD_MS = 20000;
const FINISH_RETRY_MS = 3000;

const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Full-screen window over any screen: the rival must say whether the result is right. */
export const ResultConfirmationPrompt: React.FC<{ currentUserProfileId: string | null }> = ({ currentUserProfileId }) => {
  const [queue, setQueue] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const announced = useRef<Set<string>>(new Set());

  const match = queue[0];
  const secondsLeft = match?.auto_confirm_at ? secondsUntil(match.auto_confirm_at) : null;

  const load = useCallback(async () => {
    if (!currentUserProfileId) return;
    const { data } = await supabase
      .from('matches')
      .select(CONFIRMATION_COLUMNS)
      .eq('status', 'pending_confirmation')
      .order('closed_at', { ascending: true })
      .limit(30);
    setQueue((data || []).filter((m: any) => isMatchRival(m, currentUserProfileId)));
  }, [currentUserProfileId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`result-confirmation-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload: any) => {
        const row = payload.new || {};
        if (row.status === 'pending_confirmation' || row.confirmed_at || row.disputed_at) load();
      })
      .subscribe();
    // Realtime can drop on a phone that went to sleep
    const reload = setInterval(load, RELOAD_MS);
    return () => {
      clearInterval(reload);
      supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    if (!match) return;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [match?.id]);

  // At zero the phone closes it right away; the server's minute job is only the backup.
  // A phone clock ahead of the server just gets false and tries again.
  const countdownEnded = secondsLeft === 0;
  useEffect(() => {
    if (!countdownEnded || !match) return;
    let active = true;
    const finish = async () => {
      if (await finishExpiredMatch(match.id)) {
        if (active) setQueue((q) => q.filter((m) => m.id !== match.id));
      }
    };
    finish();
    const retry = setInterval(finish, FINISH_RETRY_MS);
    return () => {
      active = false;
      clearInterval(retry);
    };
  }, [countdownEnded, match?.id]);

  useEffect(() => {
    if (!match || announced.current.has(match.id)) return;
    announced.current.add(match.id);
    sounds.playSound('slap');
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('🏁 Confirma el resultado', { body: 'Tu partida terminó. Revisa quién ganó.', icon: '/favicon.ico' });
      } catch (e) {
        console.warn('Notif error', e);
      }
    }
  }, [match?.id]);

  if (!match) return null;

  const closeCurrent = () => setQueue((q) => q.filter((m) => m.id !== match.id));

  const confirm = async () => {
    setBusy(true);
    const res = await confirmMatchResult(match.id);
    setBusy(false);
    closeCurrent();
    if (res.ok) sounds.playSound('chaching');
    else Alert.alert('No se pudo confirmar', res.error || 'Inténtalo de nuevo.');
    load();
  };

  const dispute = () => {
    Alert.alert('¿El resultado está mal?', 'Se quitará la última mano y la partida volverá a estar activa para corregirla.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Reabrir',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const res = await disputeMatchResult(match.id);
          setBusy(false);
          closeCurrent();
          if (!res.ok) Alert.alert('No se pudo reabrir', res.error || 'Inténtalo de nuevo.');
          load();
        },
      },
    ]);
  };

  const winner = match.winner_team === 1 || match.winner_team === 2 ? matchTeamLabel(match, match.winner_team) : null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.emoji}>🏁</Text>
          <Text style={styles.title}>¿Este resultado es correcto?</Text>
          <Text style={styles.winnerLabel}>Ganó</Text>
          <Text style={styles.winner}>{winner || 'Nadie: partida anulada'}</Text>
          <Text style={styles.score}>
            {matchTeamLabel(match, 1)}  {match.team1_total} – {match.team2_total}  {matchTeamLabel(match, 2)}
          </Text>

          {secondsLeft !== null ? (
            <Text style={[styles.clock, secondsLeft <= 30 && { color: theme.colors.danger }]}>
              {secondsLeft > 0 ? `Se confirma sola en ${formatClock(secondsLeft)}` : 'Confirmando…'}
            </Text>
          ) : (
            <Text style={styles.stakes}>Hay puntos en juego: no se paga nada hasta que respondas.</Text>
          )}

          {busy ? (
            <ActivityIndicator color={theme.colors.accent} size="large" style={styles.spinner} />
          ) : (
            <>
              <TouchableOpacity style={[styles.button, styles.confirm]} onPress={confirm} accessibilityRole="button">
                <Text style={styles.buttonText}>✅ Sí, es correcto</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.reject]} onPress={dispute} accessibilityRole="button">
                <Text style={styles.buttonText}>✋ No, hay un error</Text>
              </TouchableOpacity>
            </>
          )}

          {queue.length > 1 && <Text style={styles.more}>Te faltan {queue.length - 1} más por revisar</Text>}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.m,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#14161c',
    borderColor: theme.colors.accent,
    borderWidth: 2,
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.l,
    alignItems: 'center',
  },
  emoji: { fontSize: 44, marginBottom: theme.spacing.s },
  title: { color: theme.colors.text, fontSize: 21, fontWeight: '900', textAlign: 'center' },
  winnerLabel: { color: theme.colors.textDim, fontSize: 14, marginTop: theme.spacing.m },
  winner: { color: theme.colors.accent, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  score: { color: theme.colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: theme.spacing.s },
  clock: { color: theme.colors.accent, fontSize: 16, fontWeight: 'bold', marginTop: theme.spacing.m, fontVariant: ['tabular-nums'] },
  stakes: { color: theme.colors.accent, fontSize: 14, textAlign: 'center', marginTop: theme.spacing.m },
  spinner: { marginTop: theme.spacing.l },
  button: {
    width: '100%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.m,
    marginTop: theme.spacing.m,
  },
  confirm: { backgroundColor: theme.colors.success },
  reject: { backgroundColor: theme.colors.danger },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  more: { color: theme.colors.textDim, fontSize: 13, marginTop: theme.spacing.m },
});

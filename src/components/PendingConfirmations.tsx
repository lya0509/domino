import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { confirmMatchResult, disputeMatchResult } from '../lib/bettingService';
import { CONFIRMATION_COLUMNS, isInMatch, isMatchRival, matchTeamLabel as teamLabel } from '../lib/matchRivals';

interface Props {
  profileId?: string;
  isAdmin: boolean;
  onRejoinMatch?: (matchData: any) => void;
}

/** Admin list of results still waiting, and the notice for matches a rival sent back. Rivals answer in ResultConfirmationPrompt. */
export const PendingConfirmations: React.FC<Props> = ({ profileId, isAdmin, onRejoinMatch }) => {
  const [pending, setPending] = useState<any[]>([]);
  const [reopened, setReopened] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profileId) return;
    // These columns don't exist until the migration runs: an error just means nothing to show
    const [waiting, disputed] = await Promise.all([
      supabase.from('matches').select(CONFIRMATION_COLUMNS).eq('status', 'pending_confirmation').order('closed_at', { ascending: false }).limit(30),
      supabase.from('matches').select(CONFIRMATION_COLUMNS).eq('status', 'active').not('disputed_at', 'is', null).limit(30),
    ]);
    setPending(isAdmin ? (waiting.data || []).filter((m: any) => !isMatchRival(m, profileId)) : []);
    setReopened((disputed.data || []).filter((m: any) => isInMatch(m, profileId) || m.created_by === profileId));
  }, [profileId, isAdmin]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`pending-confirmations-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload: any) => {
        const row = payload.new || {};
        if (row.status === 'pending_confirmation' || row.confirmed_at || row.disputed_at) load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [load]);

  const confirm = async (m: any) => {
    setBusyId(m.id);
    const res = await confirmMatchResult(m.id);
    setBusyId(null);
    if (res.ok) Alert.alert('✅ Resultado confirmado', 'La partida quedó terminada y se pagó lo que correspondía.');
    else Alert.alert('No se pudo confirmar', res.error || 'Inténtalo de nuevo.');
    load();
  };

  const dispute = (m: any) => {
    Alert.alert(
      '¿No estás de acuerdo?',
      'Se quitará la última mano y la partida volverá a estar activa para corregirla.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reabrir',
          style: 'destructive',
          onPress: async () => {
            setBusyId(m.id);
            const res = await disputeMatchResult(m.id);
            setBusyId(null);
            if (!res.ok) Alert.alert('No se pudo reabrir', res.error || 'Inténtalo de nuevo.');
            load();
          },
        },
      ]
    );
  };

  if (!profileId || (pending.length === 0 && reopened.length === 0)) return null;

  return (
    <View>
      {pending.map((m) => {
        const winner = m.winner_team === 1 || m.winner_team === 2 ? teamLabel(m, m.winner_team) : null;
        return (
          <View key={m.id} style={styles.card}>
            <Text style={styles.title}>⏳ RESULTADO POR CONFIRMAR</Text>
            <Text style={styles.score}>
              {teamLabel(m, 1)}  {m.team1_total} – {m.team2_total}  {teamLabel(m, 2)}
            </Text>
            <Text style={styles.detail}>{winner ? `Ganador: ${winner}` : 'Partida anulada'}</Text>
            {busyId === m.id ? (
              <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
            ) : (
              <View style={styles.row}>
                <TouchableOpacity style={[styles.button, styles.confirm]} onPress={() => confirm(m)} accessibilityRole="button">
                  <Text style={styles.buttonText}>✅ Confirmar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.reject]} onPress={() => dispute(m)} accessibilityRole="button">
                  <Text style={styles.buttonText}>✋ No estoy de acuerdo</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })}

      {reopened.map((m) => (
        <TouchableOpacity key={m.id} style={styles.card} onPress={() => onRejoinMatch?.(m)} activeOpacity={0.8} accessibilityRole="button">
          <Text style={styles.title}>🔁 PARTIDA REABIERTA</Text>
          <Text style={styles.detail}>
            Un rival no estuvo de acuerdo
            {m.disputed_round?.points !== undefined ? ` y se quitó la última mano (${m.disputed_round.points} puntos)` : ''}.
            Toca para corregir y volver a terminar.
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderColor: theme.colors.accent,
    borderWidth: 1,
    borderRadius: theme.borderRadius.m,
    padding: theme.spacing.m,
    marginBottom: theme.spacing.m,
  },
  title: { color: theme.colors.accent, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  score: { color: theme.colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: theme.spacing.s },
  detail: { color: theme.colors.textDim, fontSize: 14, textAlign: 'center', marginTop: theme.spacing.xs },
  spinner: { marginTop: theme.spacing.m },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.s, marginTop: theme.spacing.m },
  button: {
    flexGrow: 1,
    flexBasis: 130,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.s,
    paddingHorizontal: theme.spacing.s,
  },
  confirm: { backgroundColor: theme.colors.success },
  reject: { backgroundColor: theme.colors.danger },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 14, textAlign: 'center' },
});

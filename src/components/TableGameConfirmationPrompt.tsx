import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { formatClock, secondsUntil } from '../lib/matchRivals';
import { sounds } from '../lib/sounds';
import { mustAnswerGame, playerNames, TableGame, tableGameLabel, winnerName } from '../lib/tableGames';
import { answerTableGame, fetchTableGames, finishExpiredTableGame } from '../lib/tableGameService';
import { confirmationStyles as styles } from './ResultConfirmationPrompt';

const RELOAD_MS = 20000;
const FINISH_RETRY_MS = 3000;

/** The same full-screen question domino rivals get, for the other players of a table game. */
export const TableGameConfirmationPrompt: React.FC<{ currentUserProfileId: string | null }> = ({ currentUserProfileId }) => {
  const [queue, setQueue] = useState<TableGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const announced = useRef<Set<string>>(new Set());

  const game = queue[0];
  const secondsLeft = game?.auto_confirm_at ? secondsUntil(game.auto_confirm_at) : null;

  const load = useCallback(async () => {
    if (!currentUserProfileId) return;
    const pending = await fetchTableGames('pending_confirmation');
    setQueue(pending.filter((g) => mustAnswerGame(g, currentUserProfileId)));
  }, [currentUserProfileId]);

  useEffect(() => {
    load();
    const channel = supabase
      .channel(`table-game-confirmation-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'table_games' }, load)
      .subscribe();
    // Realtime can drop on a phone that went to sleep
    const reload = setInterval(load, RELOAD_MS);
    return () => {
      clearInterval(reload);
      supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    if (!game) return;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [game?.id]);

  // A phone clock ahead of the server just gets false and tries again
  const countdownEnded = secondsLeft === 0;
  useEffect(() => {
    if (!countdownEnded || !game) return;
    let active = true;
    const finish = async () => {
      if ((await finishExpiredTableGame(game.id)) && active) {
        setQueue((q) => q.filter((g) => g.id !== game.id));
      }
    };
    finish();
    const retry = setInterval(finish, FINISH_RETRY_MS);
    return () => {
      active = false;
      clearInterval(retry);
    };
  }, [countdownEnded, game?.id]);

  useEffect(() => {
    if (!game || announced.current.has(game.id)) return;
    announced.current.add(game.id);
    sounds.playSound('slap');
  }, [game?.id]);

  if (!game) return null;

  const respond = async (agree: boolean) => {
    setBusy(true);
    const res = await answerTableGame(game.id, agree);
    setBusy(false);
    setQueue((q) => q.filter((g) => g.id !== game.id));
    if (!res.ok) Alert.alert('No se pudo responder', res.error || 'Inténtalo de nuevo.');
    else if (agree) sounds.playSound('chaching');
    load();
  };

  const dispute = () => {
    Alert.alert('¿El resultado está mal?', 'La partida volverá a estar activa para marcar el ganador correcto.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Reabrir', style: 'destructive', onPress: () => respond(false) },
    ]);
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.emoji}>🃏</Text>
          <Text style={styles.title}>¿Este resultado es correcto?</Text>
          <Text style={styles.winnerLabel}>Ganó en {tableGameLabel(game.game)}</Text>
          <Text style={styles.winner}>{winnerName(game)}</Text>
          <Text style={styles.score}>{playerNames(game)}</Text>

          {secondsLeft !== null && (
            <Text style={[styles.clock, secondsLeft <= 30 && { color: theme.colors.danger }]}>
              {secondsLeft > 0 ? `Se confirma sola en ${formatClock(secondsLeft)}` : 'Confirmando…'}
            </Text>
          )}

          {busy ? (
            <ActivityIndicator color={theme.colors.accent} size="large" style={styles.spinner} />
          ) : (
            <>
              <TouchableOpacity style={[styles.button, styles.confirm]} onPress={() => respond(true)} accessibilityRole="button">
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

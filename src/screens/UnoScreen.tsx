import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../theme';
import { Profile } from '../types';
import { supabase } from '../lib/supabase';
import { offlineSync } from '../lib/offlineSync';
import { sounds } from '../lib/sounds';
import { formatClock, secondsUntil } from '../lib/matchRivals';
import {
  canAnswerGame, canManageGame, canStartRoster, MAX_PLAYERS, playerNames, RosterEntry, TABLE_GAMES,
  TableGame, TableGameKind, tableGameLabel, winnerName,
} from '../lib/tableGames';
import {
  answerTableGame, cancelTableGame, fetchTableGame, fetchTableGames, finishExpiredTableGame,
  finishTableGame, startTableGame,
} from '../lib/tableGameService';

interface Props {
  currentUserProfileId: string | null;
  isAdmin: boolean;
  initialGameId: string | null;
  onBack: () => void;
}

const REFRESH_MS = 5000;
const MAX_SUGGESTIONS = 8;
// A game started without internet exists only on this phone until the outbox sends it
const LOCAL_GAME_KEY = '@domino_uno_game_v1';

const saveLocalGame = (game: TableGame | null) =>
  (game ? AsyncStorage.setItem(LOCAL_GAME_KEY, JSON.stringify(game)) : AsyncStorage.removeItem(LOCAL_GAME_KEY)).catch(() => {});

const readLocalGame = async (): Promise<TableGame | null> => {
  try {
    const saved = await AsyncStorage.getItem(LOCAL_GAME_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

export const UnoScreen: React.FC<Props> = ({ currentUserProfileId, isAdmin, initialGameId, onBack }) => {
  const [game, setGame] = useState<TableGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const [kind, setKind] = useState<TableGameKind>('uno');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>(() => offlineSync.getCachedProfilesSync());
  const [search, setSearch] = useState('');
  const [guestName, setGuestName] = useState('');
  const [recent, setRecent] = useState<TableGame[]>([]);
  const [winnerSeat, setWinnerSeat] = useState<number | null>(null);

  const gameId = game?.id ?? null;
  const status = game?.status ?? null;

  useEffect(() => {
    let active = true;
    const open = async () => {
      if (initialGameId) {
        const found = await fetchTableGame(initialGameId);
        if (active) setGame(found);
      } else {
        const local = await readLocalGame();
        const fromServer = local ? await fetchTableGame(local.id) : null;
        const resumable = fromServer ?? local;
        if (resumable && resumable.status !== 'completed' && resumable.status !== 'cancelled') {
          if (active) setGame(resumable);
        } else {
          saveLocalGame(null);
          // Coming back to a game this person left open
          const [playing, waiting] = await Promise.all([fetchTableGames('active'), fetchTableGames('pending_confirmation')]);
          const mine = [...playing, ...waiting].find((g) => canManageGame(g, currentUserProfileId, false));
          if (active && mine) setGame(mine);
        }
      }
      if (active) setLoading(false);
    };
    open();
    return () => {
      active = false;
    };
  }, [initialGameId, currentUserProfileId]);

  useEffect(() => {
    if (gameId) return;
    fetchTableGames('completed', 15).then(setRecent);
    offlineSync.getProfiles(offlineSync.getIsOnline()).then((list) => setProfiles(list || []));
  }, [gameId]);

  useEffect(() => {
    const me = profiles.find((p) => p.id === currentUserProfileId);
    if (me) setRoster((r) => (r.length === 0 ? [{ user_id: me.id, name: me.display_name }] : r));
  }, [profiles, currentUserProfileId]);

  const reload = useCallback(async () => {
    if (!gameId || !offlineSync.getIsOnline()) return;
    const fresh = await fetchTableGame(gameId);
    if (fresh) setGame(fresh);
  }, [gameId]);

  useEffect(() => {
    if (!gameId) return;
    setWinnerSeat(null);
    const channel = supabase
      .channel(`table-game-${gameId}-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'table_games', filter: `id=eq.${gameId}` }, reload)
      .subscribe();
    // Realtime can drop on a phone that went to sleep
    const refresh = setInterval(reload, REFRESH_MS);
    return () => {
      clearInterval(refresh);
      supabase.removeChannel(channel);
    };
  }, [gameId, reload]);

  useEffect(() => {
    if (status !== 'active' && status !== 'pending_confirmation') return;
    const tick = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [status]);

  const secondsLeft = game?.status === 'pending_confirmation' && game.auto_confirm_at ? secondsUntil(game.auto_confirm_at) : null;

  // At zero any phone watching closes it; the server's minute job is only the backup
  const countdownEnded = secondsLeft === 0;
  useEffect(() => {
    if (countdownEnded && gameId) finishExpiredTableGame(gameId).then(reload);
  }, [countdownEnded, gameId, reload]);

  useEffect(() => {
    if (status === 'completed' || status === 'cancelled') saveLocalGame(null);
  }, [status]);

  const suggestions = useMemo(() => {
    const text = search.trim().toLowerCase();
    return profiles
      .filter((p) => !roster.some((r) => r.user_id === p.id))
      .filter((p) => !text || p.display_name?.toLowerCase().includes(text))
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
      .slice(0, MAX_SUGGESTIONS);
  }, [profiles, roster, search]);

  const addToRoster = (entry: RosterEntry) => {
    if (roster.length >= MAX_PLAYERS) {
      Alert.alert('Mesa llena', `Una partida admite hasta ${MAX_PLAYERS} jugadores.`);
      return;
    }
    setRoster((r) => [...r, entry]);
    setSearch('');
  };

  const addGuest = () => {
    const name = guestName.trim();
    if (!name) return;
    addToRoster({ name });
    setGuestName('');
  };

  const begin = async (gameKind: TableGameKind, players: RosterEntry[]) => {
    if (!currentUserProfileId) return;
    setBusy(true);
    const res = await startTableGame(gameKind, players, currentUserProfileId);
    setBusy(false);
    if (!res.ok || !res.game) {
      Alert.alert('No se pudo empezar', res.error || 'Inténtalo de nuevo.');
      return;
    }
    sounds.playSound('pop');
    if (res.queued) saveLocalGame(res.game);
    setGame(res.game);
  };

  const backToSetup = () => {
    setGame(null);
    saveLocalGame(null);
  };

  const finish = () => {
    if (!game || winnerSeat === null) return;
    const name = game.players.find((p) => p.seat === winnerSeat)?.name;
    Alert.alert('¿Terminar la partida?', `Ganó ${name}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Terminar',
        onPress: async () => {
          setBusy(true);
          const res = await finishTableGame(game.id, winnerSeat);
          setBusy(false);
          if (!res.ok) {
            Alert.alert('No se pudo terminar', res.error || 'Inténtalo de nuevo.');
            return;
          }
          sounds.playSound('slap');
          if (res.queued) {
            Alert.alert('📡 Sin internet', 'El resultado se enviará solo cuando vuelva la conexión.');
            backToSetup();
            return;
          }
          reload();
        },
      },
    ]);
  };

  const cancel = () => {
    if (!game) return;
    Alert.alert('¿Anular la partida?', 'No contará para nadie.', [
      { text: 'Seguir jugando', style: 'cancel' },
      {
        text: 'Anular',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          const res = await cancelTableGame(game.id);
          setBusy(false);
          if (res.ok) backToSetup();
          else Alert.alert('No se pudo anular', res.error || 'Necesitas internet para anular.');
        },
      },
    ]);
  };

  const answer = async (agree: boolean) => {
    if (!game) return;
    setBusy(true);
    const res = await answerTableGame(game.id, agree);
    setBusy(false);
    if (!res.ok) Alert.alert('No se pudo responder', res.error || 'Inténtalo de nuevo.');
    reload();
  };

  const rematch = (finished: TableGame) => {
    begin(finished.game, finished.players.map((p) => ({ user_id: p.user_id ?? undefined, name: p.name })));
  };

  const renderSetup = () => (
    <>
      <Text style={styles.sectionTitle}>¿Qué van a jugar?</Text>
      <View style={styles.chips}>
        {TABLE_GAMES.map((g) => (
          <TouchableOpacity
            key={g.key}
            style={[styles.chip, kind === g.key && styles.chipActive]}
            onPress={() => setKind(g.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: kind === g.key }}
          >
            <Text style={[styles.chipText, kind === g.key && styles.chipTextActive]}>{g.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Jugadores ({roster.length}/{MAX_PLAYERS})</Text>
      {roster.map((p, i) => (
        <View key={`${p.user_id ?? p.name}-${i}`} style={styles.rosterRow}>
          <Text style={styles.rosterName}>{p.name}{p.user_id ? '' : ' (sin cuenta)'}</Text>
          <TouchableOpacity
            onPress={() => setRoster((r) => r.filter((_, index) => index !== i))}
            style={styles.removeBtn}
            accessibilityRole="button"
            accessibilityLabel={`Quitar a ${p.name}`}
          >
            <Text style={styles.removeText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Buscar jugador…"
        placeholderTextColor={theme.colors.textDim}
        accessibilityLabel="Buscar jugador"
      />
      <View style={styles.chips}>
        {suggestions.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={styles.chip}
            onPress={() => addToRoster({ user_id: p.id, name: p.display_name })}
            accessibilityRole="button"
          >
            <Text style={styles.chipText}>+ {p.display_name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.guestRow}>
        <TextInput
          style={[styles.input, styles.guestInput]}
          value={guestName}
          onChangeText={setGuestName}
          onSubmitEditing={addGuest}
          maxLength={30}
          placeholder="Jugador sin cuenta"
          placeholderTextColor={theme.colors.textDim}
          accessibilityLabel="Nombre de quien no tiene cuenta"
        />
        <TouchableOpacity style={styles.guestBtn} onPress={addGuest} accessibilityRole="button">
          <Text style={styles.guestBtnText}>Agregar</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>Quien juega sin cuenta no entra en el ranking ni recibe premio.</Text>

      <TouchableOpacity
        style={[styles.primaryBtn, !canStartRoster(roster) && styles.disabled]}
        disabled={!canStartRoster(roster) || busy}
        onPress={() => begin(kind, roster)}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>🃏 Empezar {tableGameLabel(kind)}</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Últimas partidas</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>Todavía no hay partidas terminadas.</Text>
      ) : (
        recent.map((g) => (
          <View key={g.id} style={styles.historyRow}>
            <Text style={styles.historyTitle}>🏆 {winnerName(g) ?? 'Sin ganador'} · {tableGameLabel(g.game)}</Text>
            <Text style={styles.historyDetail}>
              {playerNames(g)} · {new Date(g.closed_at ?? g.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}
            </Text>
          </View>
        ))
      )}
    </>
  );

  const renderActive = (current: TableGame) => {
    const manages = canManageGame(current, currentUserProfileId, isAdmin);
    const minutes = Math.floor((Date.now() - new Date(current.created_at).getTime()) / 60000);
    return (
      <>
        <Text style={styles.gameTitle}>🃏 {tableGameLabel(current.game)}</Text>
        <Text style={styles.gameMeta}>En juego · {minutes < 1 ? 'acaban de empezar' : `${minutes} min`}</Text>
        {current.disputed_at && (
          <Text style={styles.notice}>✋ Un jugador no estuvo de acuerdo. Marquen el ganador correcto.</Text>
        )}
        <Text style={styles.sectionTitle}>{manages ? '¿Quién ganó?' : 'Jugadores'}</Text>
        {current.players.map((p) => (
          <TouchableOpacity
            key={p.seat}
            style={[styles.playerRow, winnerSeat === p.seat && styles.playerRowActive]}
            disabled={!manages}
            onPress={() => setWinnerSeat(p.seat)}
            accessibilityRole="button"
            accessibilityState={{ selected: winnerSeat === p.seat }}
          >
            <Text style={styles.playerName}>{winnerSeat === p.seat ? '🏆 ' : ''}{p.name}</Text>
          </TouchableOpacity>
        ))}
        {manages && (
          <>
            <TouchableOpacity
              style={[styles.primaryBtn, winnerSeat === null && styles.disabled]}
              disabled={winnerSeat === null || busy}
              onPress={finish}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>🏁 Terminar partida</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkBtn} onPress={cancel} disabled={busy} accessibilityRole="button">
              <Text style={styles.linkDanger}>Anular partida</Text>
            </TouchableOpacity>
          </>
        )}
      </>
    );
  };

  const renderPending = (current: TableGame) => (
    <>
      <Text style={styles.gameTitle}>🏁 {tableGameLabel(current.game)}</Text>
      <Text style={styles.winnerLabel}>Ganó</Text>
      <Text style={styles.winner}>{winnerName(current)}</Text>
      <Text style={styles.gameMeta}>
        {secondsLeft ? `Esperando confirmación · se confirma sola en ${formatClock(secondsLeft)}` : 'Confirmando…'}
      </Text>
      {canAnswerGame(current, currentUserProfileId, isAdmin) && (
        <>
          <TouchableOpacity style={[styles.primaryBtn, styles.confirm]} onPress={() => answer(true)} disabled={busy} accessibilityRole="button">
            <Text style={styles.primaryText}>✅ Sí, es correcto</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, styles.reject]} onPress={() => answer(false)} disabled={busy} accessibilityRole="button">
            <Text style={styles.primaryText}>✋ No, hay un error</Text>
          </TouchableOpacity>
        </>
      )}
    </>
  );

  const renderClosed = (current: TableGame) => (
    <>
      <Text style={styles.gameTitle}>{current.status === 'completed' ? '🏆' : '🚫'} {tableGameLabel(current.game)}</Text>
      {current.status === 'completed' ? (
        <>
          <Text style={styles.winnerLabel}>Ganó</Text>
          <Text style={styles.winner}>{winnerName(current)}</Text>
        </>
      ) : (
        <Text style={styles.gameMeta}>Partida anulada</Text>
      )}
      <Text style={styles.gameMeta}>{playerNames(current)}</Text>
      {canManageGame(current, currentUserProfileId, false) && (
        <TouchableOpacity style={styles.primaryBtn} onPress={() => rematch(current)} disabled={busy} accessibilityRole="button">
          <Text style={styles.primaryText}>🔁 Otra con los mismos</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.linkBtn} onPress={backToSetup} accessibilityRole="button">
        <Text style={styles.linkText}>Nueva partida</Text>
      </TouchableOpacity>
    </>
  );

  const renderBody = () => {
    if (loading) return <ActivityIndicator color={theme.colors.accent} size="large" style={styles.spinner} />;
    if (!game) return renderSetup();
    if (game.status === 'active') return renderActive(game);
    if (game.status === 'pending_confirmation') return renderPending(game);
    return renderClosed(game);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityRole="button">
          <Text style={styles.backText}>Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>UNO</Text>
        <View style={styles.headerSpace} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>{renderBody()}</View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: theme.spacing.m },
  backBtn: { padding: theme.spacing.s, minHeight: 44, justifyContent: 'center' },
  backText: { color: theme.colors.primary, fontSize: 16 },
  headerTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  headerSpace: { width: 64 },
  content: { padding: theme.spacing.m, paddingBottom: theme.spacing.xxl, alignItems: 'center' },
  column: { width: '100%', maxWidth: 520 },
  spinner: { marginTop: theme.spacing.xl },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800', marginTop: theme.spacing.l, marginBottom: theme.spacing.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.s, marginBottom: theme.spacing.s },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.m,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: '#60a5fa' },
  chipText: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  chipTextActive: { color: '#fff' },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.s,
    paddingLeft: theme.spacing.m,
    marginBottom: theme.spacing.xs,
  },
  rosterName: { color: theme.colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  removeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: theme.colors.danger, fontSize: 16, fontWeight: 'bold' },
  input: {
    minHeight: 44,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.m,
    fontSize: 16,
    marginTop: theme.spacing.s,
    marginBottom: theme.spacing.s,
  },
  guestRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.s },
  guestInput: { flex: 1, minWidth: 0 },
  guestBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.m,
    borderRadius: theme.borderRadius.s,
    backgroundColor: theme.colors.secondary,
  },
  guestBtnText: { color: '#fff', fontWeight: 'bold' },
  hint: { color: theme.colors.textDim, fontSize: 13 },
  primaryBtn: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.m,
    backgroundColor: theme.colors.primary,
    marginTop: theme.spacing.l,
  },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  confirm: { backgroundColor: theme.colors.success },
  reject: { backgroundColor: theme.colors.danger, marginTop: theme.spacing.s },
  linkBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.s },
  linkText: { color: theme.colors.primary, fontSize: 15, fontWeight: '600' },
  linkDanger: { color: theme.colors.danger, fontSize: 15, fontWeight: '600' },
  empty: { color: theme.colors.textDim, fontStyle: 'italic', paddingVertical: theme.spacing.s },
  historyRow: { paddingVertical: theme.spacing.s, borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder },
  historyTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  historyDetail: { color: theme.colors.textDim, fontSize: 13, marginTop: 2 },
  gameTitle: { color: theme.colors.text, fontSize: 26, fontWeight: '900', textAlign: 'center', marginTop: theme.spacing.m },
  gameMeta: { color: theme.colors.textDim, fontSize: 15, textAlign: 'center', marginTop: theme.spacing.s },
  notice: {
    color: theme.colors.accent,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderRadius: theme.borderRadius.s,
    padding: theme.spacing.m,
    marginTop: theme.spacing.m,
  },
  playerRow: {
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.m,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s,
    marginBottom: theme.spacing.s,
  },
  playerRowActive: { borderColor: theme.colors.accent, backgroundColor: 'rgba(245,158,11,0.12)' },
  playerName: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  winnerLabel: { color: theme.colors.textDim, fontSize: 15, textAlign: 'center', marginTop: theme.spacing.l },
  winner: { color: theme.colors.accent, fontSize: 30, fontWeight: '900', textAlign: 'center' },
});

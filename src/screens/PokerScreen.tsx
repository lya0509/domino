import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../theme';
import { VipCelebration, VipEntrance } from '../components/VipEffects';
import { Profile } from '../types';
import { supabase } from '../lib/supabase';
import { offlineSync } from '../lib/offlineSync';
import { hasQueuedGame } from '../lib/outbox';
import { sounds } from '../lib/sounds';
import { formatClock, secondsUntil } from '../lib/matchRivals';
import {
  canScoreHand, chipLeaders, chipsAfterHands, copySeat, DEFAULT_ENTRY, DEFAULT_START_CHIPS, handLabel, handPot,
  openHand, PokerHand, smallBlind,
} from '../lib/poker';
import {
  activeSeats, canAnswerGame, canManageGame, canStartRoster, missingCheckIn, playerNames, playerSeats, RosterEntry, TableGame, winnerName,
} from '../lib/tableGames';
import {
  addTableGameDealer, answerTableGame, cancelPokerHand, cancelTableGame, checkInTableGame, fetchPokerHands, fetchTableGame,
  fetchTableGames, finishExpiredTableGame, finishTableGame, leaveTableGame, makeTableGameGuest, mesaReady, savePokerHand,
  setPokerSeat, startPokerGame,
} from '../lib/tableGameService';
import { TableCheckIn } from '../components/TableCheckIn';
import { PokerHandPanel } from '../components/PokerHandPanel';
import { PokerHelpModal } from '../components/PokerHelpModal';
import { POKER_GOLD, PokerNewHand } from '../components/PokerNewHand';
import { RosterPicker } from '../components/RosterPicker';

interface Props {
  currentUserProfileId: string | null;
  isAdmin: boolean;
  initialGameId: string | null;
  onBack: () => void;
}

// Everyone bets from their own phone, so the table has to feel live
const REFRESH_MS = 3000;
// A game played without internet exists only on this phone until the outbox sends it
const LOCAL_GAME_KEY = '@domino_poker_game_v1';
// A table this person walked away from must not swallow "Nueva Partida" until it ends
const LEFT_GAME_KEY = '@domino_poker_left_game_v1';

const saveLocalGame = (saved: { game: TableGame; hands: PokerHand[] } | null) =>
  (saved ? AsyncStorage.setItem(LOCAL_GAME_KEY, JSON.stringify(saved)) : AsyncStorage.removeItem(LOCAL_GAME_KEY)).catch(() => {});

const readLocalGame = async (): Promise<{ game: TableGame; hands: PokerHand[] } | null> => {
  try {
    const saved = await AsyncStorage.getItem(LOCAL_GAME_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

const toWhole = (text: string) => parseInt(text.replace(/\D/g, ''), 10) || 0;

export const PokerScreen: React.FC<Props> = ({ currentUserProfileId, isAdmin, initialGameId, onBack }) => {
  const [game, setGame] = useState<TableGame | null>(null);
  const [hands, setHands] = useState<PokerHand[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [tieChoice, setTieChoice] = useState(false);
  // "Otra con los mismos" shows a moment after the result, never under the finger that confirmed it
  const [rematchReady, setRematchReady] = useState(false);
  const [, setTick] = useState(0);

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>(() => offlineSync.getCachedProfilesSync());
  const [startChips, setStartChips] = useState(String(DEFAULT_START_CHIPS));
  const [entry, setEntry] = useState(String(DEFAULT_ENTRY));
  const [recent, setRecent] = useState<TableGame[]>([]);

  // While a hand is being saved a slower read would bring back the previous state
  const saving = useRef(0);
  // Each save carries the whole hand: two quick taps must reach the server in order
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  const gameId = game?.id ?? null;
  const status = game?.status ?? null;

  const open = useCallback(async (found: TableGame) => {
    setGame(found);
    const list = await fetchPokerHands(found.id);
    if (list) setHands(list);
  }, []);

  useEffect(() => {
    let active = true;
    const start = async () => {
      if (initialGameId) {
        const found = await fetchTableGame(initialGameId);
        if (active && found) await open(found);
      } else {
        const local = await readLocalGame();
        const fromServer = local ? await fetchTableGame(local.game.id) : null;
        // Online with nothing left to send, a game the server doesn't have no longer exists
        const gone = !!local && !fromServer && offlineSync.getIsOnline() && !hasQueuedGame(offlineSync.getQueue(), local.game.id);
        if (local && !fromServer && !gone) {
          if (active) {
            setGame(local.game);
            setHands(local.hands);
          }
        } else if (fromServer && fromServer.status !== 'completed' && fromServer.status !== 'cancelled') {
          if (active) {
            await open(fromServer);
            if (local && hasQueuedGame(offlineSync.getQueue(), local.game.id)) setHands(local.hands);
          }
        } else {
          saveLocalGame(null);
          // Coming back to a game this person left open
          const [playing, waiting] = await Promise.all([
            fetchTableGames('active', 30, 'poker'),
            fetchTableGames('pending_confirmation', 30, 'poker'),
          ]);
          const left = await AsyncStorage.getItem(LEFT_GAME_KEY).catch(() => null);
          const mine = [...playing, ...waiting].find((g) => g.id !== left && canManageGame(g, currentUserProfileId, false));
          if (active && mine) await open(mine);
        }
      }
      if (active) setLoading(false);
    };
    start();
    return () => {
      active = false;
    };
  }, [initialGameId, currentUserProfileId, open]);

  useEffect(() => {
    if (gameId) return;
    fetchTableGames('completed', 15, 'poker').then(setRecent);
    offlineSync.getProfiles(offlineSync.getIsOnline()).then((list) => setProfiles(list || []));
  }, [gameId]);

  useEffect(() => {
    const me = profiles.find((p) => p.id === currentUserProfileId);
    if (me) setRoster((r) => (r.length === 0 ? [{ user_id: me.id, name: me.display_name }] : r));
  }, [profiles, currentUserProfileId]);

  const reload = useCallback(async () => {
    // What is still queued is newer than what the server has
    if (!gameId || saving.current > 0 || !offlineSync.getIsOnline() || hasQueuedGame(offlineSync.getQueue(), gameId)) return;
    const [fresh, list] = await Promise.all([fetchTableGame(gameId), fetchPokerHands(gameId)]);
    if (saving.current > 0) return;
    if (fresh) setGame(fresh);
    if (fresh && list) setHands(list);
  }, [gameId]);

  const finished = status === 'completed' || status === 'cancelled';

  useEffect(() => {
    if (!gameId || finished) return;
    const channel = supabase
      .channel(`poker-game-${gameId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poker_hands', filter: `game_id=eq.${gameId}` }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'table_games', filter: `id=eq.${gameId}` }, reload)
      .subscribe();
    // Realtime can drop on a phone that went to sleep
    const refresh = setInterval(reload, REFRESH_MS);
    return () => {
      clearInterval(refresh);
      supabase.removeChannel(channel);
    };
  }, [gameId, finished, reload]);

  useEffect(() => {
    if (status !== 'pending_confirmation') return;
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
    else if (game && !offlineSync.getIsOnline() && canManageGame(game, currentUserProfileId, false)) {
      saveLocalGame({ game, hands });
    }
  }, [status, game, hands, currentUserProfileId]);

  // Whoever only deals has no chips; whoever left keeps theirs on the board
  const seats = useMemo(() => (game ? playerSeats(game) : []), [game]);
  const stillIn = useMemo(() => (game ? activeSeats(game) : []), [game]);
  const chips = useMemo(
    () => chipsAfterHands(seats, game?.start_chips ?? DEFAULT_START_CHIPS, hands),
    [seats, game?.start_chips, hands]
  );
  const openedHand = hands.find((h) => h.status === 'open') ?? null;
  const lastHand = hands.length > 0 ? hands[hands.length - 1] : null;
  const leaders = useMemo(
    () => (stillIn.length > 0 ? chipLeaders(Object.fromEntries(stillIn.map((s) => [s, chips[s] ?? 0]))) : []),
    [chips, stillIn]
  );

  const nameOf = (seat: number) => game?.players.find((p) => p.seat === seat)?.name ?? '';

  const applyHand = async (next: PokerHand) => {
    if (!game) return;
    setHands((list) =>
      list.some((h) => h.number === next.number) ? list.map((h) => (h.number === next.number ? next : h)) : [...list, next]
    );
    saving.current += 1;
    const sent = saveChain.current.then(() => savePokerHand(game.id, next));
    saveChain.current = sent.catch(() => {});
    const res = await sent;
    saving.current -= 1;
    if (!res.ok) Alert.alert('No se pudo guardar', res.error || 'Inténtalo de nuevo.');
    reload();
  };

  const applySeat = async (next: PokerHand, seat: number) => {
    if (!game) return;
    setHands((list) => list.map((h) => (h.number === next.number ? copySeat(h, next, seat) : h)));
    saving.current += 1;
    const sent = saveChain.current.then(() =>
      setPokerSeat(game.id, next.number, seat, next.contributions[seat], next.folded.includes(seat))
    );
    saveChain.current = sent.catch(() => {});
    const res = await sent;
    saving.current -= 1;
    if (!res.ok) Alert.alert('No se pudo guardar', res.error || 'Inténtalo de nuevo.');
    reload();
  };

  const begin = async (players: RosterEntry[], start: number, amount: number, rematchOf?: string) => {
    if (!currentUserProfileId || busy) return;
    setBusy(true);
    const res = await startPokerGame(players, start, amount, currentUserProfileId, rematchOf);
    setBusy(false);
    if (!res.ok || !res.game) {
      Alert.alert('No se pudo empezar', res.error || 'Inténtalo de nuevo.');
      // Someone is already at another open table: take this phone there
      if (/ya está en otra partida/.test(res.error || '')) {
        const playing = await fetchTableGames('active', 30, 'poker');
        const mine = playing.find((g) => canManageGame(g, currentUserProfileId, false));
        if (mine) await open(mine);
      }
      return;
    }
    if (rematchOf && !res.queued) {
      // The server says which game it is: a new one, or the rematch someone else started a moment ago
      sounds.playSound('pop');
      await open((await fetchTableGame(res.game.id)) ?? res.game);
      return;
    }
    sounds.playSound('pop');
    setHands([]);
    if (res.queued) saveLocalGame({ game: res.game, hands: [] });
    setGame(res.game);
  };

  const dealHand = (dealerSeat: number, entrants: number[]) => {
    if (!game) return;
    sounds.playSound('pop');
    applyHand(
      openHand({
        number: (lastHand?.number ?? 0) + 1,
        dealerSeat,
        dealerPlays: entrants.includes(dealerSeat),
        entrants,
        entry: game.entry_amount ?? DEFAULT_ENTRY,
        chips,
      })
    );
  };

  const removeHand = (hand: PokerHand) => {
    if (!game) return;
    Alert.alert('¿Quitar esta mano?', 'Las apuestas de esta mano se borran y nadie gana ni pierde fichas.', [
      { text: 'Seguir', style: 'cancel' },
      {
        text: 'Quitar',
        style: 'destructive',
        onPress: async () => {
          const res = await cancelPokerHand(game.id, hand.number);
          if (res.ok) setHands((list) => list.filter((h) => h.number !== hand.number));
          else Alert.alert('No se pudo quitar', res.error || 'Necesitas internet para quitar una mano.');
        },
      },
    ]);
  };

  const checkIn = async () => {
    if (!game) return;
    setBusy(true);
    const res = await checkInTableGame(game.id);
    setBusy(false);
    if (!res.ok) Alert.alert('No se pudo confirmar', res.error || 'Necesitas internet para confirmar.');
    else sounds.playSound('pop');
    reload();
  };

  const makeGuest = async (seat: number) => {
    if (!game) return;
    const res = await makeTableGameGuest(game.id, seat);
    if (!res.ok) Alert.alert('No se pudo', res.error || 'Inténtalo de nuevo.');
    reload();
  };

  const addDealer = async (userId: string | null, name: string): Promise<number | null> => {
    if (!game) return null;
    const res = await addTableGameDealer(game.id, userId, name);
    if (!res.ok || res.seat === undefined) {
      Alert.alert('No se pudo', res.error || 'Necesitas internet para agregar a quien reparte.');
      return null;
    }
    await reload();
    return res.seat;
  };

  const leaveGame = (seat: number) => {
    if (!game) return;
    const mine = game.players.find((p) => p.seat === seat)?.user_id === currentUserProfileId;
    const name = nameOf(seat);
    Alert.alert(
      mine ? '¿Retirarte de la partida?' : `¿Retirar a ${name}?`,
      `${mine ? 'Tus fichas quedan' : 'Sus fichas quedan'} anotadas como están, pero ya no ${mine ? 'entras' : 'entra'} en más manos ni ${mine ? 'puedes' : 'puede'} ganar la partida.`,
      [
        { text: 'Seguir jugando', style: 'cancel' },
        {
          text: 'Retirarse',
          style: 'destructive',
          onPress: async () => {
            const res = await leaveTableGame(game.id, seat);
            if (!res.ok) Alert.alert('No se pudo', res.error || 'Inténtalo de nuevo.');
            reload();
          },
        },
      ]
    );
  };

  const correctLast = () => {
    if (!lastHand) return;
    applyHand({ ...lastHand, status: 'open', endType: null, winners: [], bestHand: null, reopen: true });
  };

  const finishWith = (seat: number) => {
    if (!game) return;
    Alert.alert('¿Terminar la partida?', `Ganó ${nameOf(seat)} con ${chips[seat]} fichas.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Terminar',
        onPress: async () => {
          setBusy(true);
          const res = await finishTableGame(game.id, seat);
          setBusy(false);
          setTieChoice(false);
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

  const requestFinish = () => {
    if (leaders.length === 1) finishWith(leaders[0]);
    else setTieChoice(true);
  };

  const cancelGame = () => {
    if (!game) return;
    Alert.alert('¿Anular la partida?', 'No contará para nadie.', [
      { text: 'Seguir jugando', style: 'cancel' },
      {
        text: 'Anular',
        style: 'destructive',
        onPress: async () => {
          const res = await cancelTableGame(game.id);
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

  const backToSetup = () => {
    setGame(null);
    setHands([]);
    saveLocalGame(null);
  };

  const leaveTable = () => {
    if (!game) return;
    Alert.alert('¿Salir de esta mesa?', 'La partida sigue para los demás. Puedes volver desde Jugando ahora.', [
      { text: 'Seguir aquí', style: 'cancel' },
      {
        text: 'Salir',
        onPress: () => {
          AsyncStorage.setItem(LEFT_GAME_KEY, game.id).catch(() => {});
          backToSetup();
        },
      },
    ]);
  };

  const rematch = (finished: TableGame) => {
    Alert.alert('¿Otra partida con los mismos?', 'Si alguien de la mesa ya la empezó, entras a esa.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Empezar',
        onPress: () =>
          begin(
            finished.players.filter((p) => p.role !== 'dealer').map((p) => ({ user_id: p.user_id ?? undefined, name: p.name })),
            finished.start_chips ?? DEFAULT_START_CHIPS,
            finished.entry_amount ?? DEFAULT_ENTRY,
            finished.id
          ),
      },
    ]);
  };

  useEffect(() => {
    setRematchReady(false);
    if (status !== 'completed' && status !== 'cancelled') return;
    const t = setTimeout(() => setRematchReady(true), 2000);
    return () => clearTimeout(t);
  }, [status, gameId]);

  const setupStart = toWhole(startChips);
  const setupEntry = toWhole(entry);
  const canStart = canStartRoster(roster) && setupStart > 0 && setupEntry > 0 && setupEntry <= setupStart;

  const renderSetup = () => (
    <>
      <View style={styles.settings}>
        <View style={styles.setting}>
          <Text style={styles.settingLabel}>Fichas iniciales</Text>
          <TextInput
            style={styles.settingInput}
            value={startChips}
            onChangeText={setStartChips}
            keyboardType="number-pad"
            accessibilityLabel="Fichas iniciales"
          />
        </View>
        <View style={styles.setting}>
          <Text style={styles.settingLabel}>Salida alta</Text>
          <TextInput
            style={styles.settingInput}
            value={entry}
            onChangeText={setEntry}
            keyboardType="number-pad"
            accessibilityLabel="Salida alta"
          />
        </View>
      </View>
      <Text style={styles.hint}>
        {setupEntry > 0 ? `La salida baja es de ${smallBlind(setupEntry)}. ` : ''}Las fichas valen solo en esta partida y no tocan tus puntos.
      </Text>

      <RosterPicker roster={roster} onChange={setRoster} profiles={profiles} ordered />

      <TouchableOpacity
        style={[styles.primaryBtn, !canStart && styles.disabled]}
        disabled={!canStart || busy}
        onPress={() => begin(roster, setupStart, setupEntry)}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>Empezar partida</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Últimas partidas</Text>
      {recent.length === 0 ? (
        <Text style={styles.empty}>Todavía no hay partidas terminadas.</Text>
      ) : (
        recent.map((g) => (
          <View key={g.id} style={styles.historyRow}>
            <Text style={styles.historyTitle}>{winnerName(g) ?? 'Sin ganador'}</Text>
            <Text style={styles.historyDetail}>
              {playerNames(g)}, {new Date(g.closed_at ?? g.created_at).toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}
            </Text>
          </View>
        ))
      )}
    </>
  );

  const renderStacks = (current: TableGame, canLeave = false) => (
    <View style={styles.stacks}>
      {[...current.players]
        .filter((p) => p.role !== 'dealer')
        .sort((a, b) => (chips[b.seat] ?? 0) - (chips[a.seat] ?? 0))
        .map((p) => {
          const mayRetire = canLeave && !p.left_at && (p.user_id === currentUserProfileId || current.created_by === currentUserProfileId || isAdmin);
          return (
            <View key={p.seat} style={[styles.stackRow, !!p.left_at && styles.stackLeft]}>
              <Text style={styles.stackName} numberOfLines={1}>{p.name}{p.left_at ? ' (se retiró)' : ''}</Text>
              {mayRetire && (
                <TouchableOpacity onPress={() => leaveGame(p.seat)} style={styles.retireBtn} accessibilityRole="button" accessibilityLabel={`Retirar a ${p.name}`}>
                  <Text style={styles.retireText}>{p.user_id === currentUserProfileId ? 'Retirarme' : 'Retirar'}</Text>
                </TouchableOpacity>
              )}
              <Text style={styles.stackChips}>{chips[p.seat] ?? 0}</Text>
            </View>
          );
        })}
    </View>
  );

  const renderHistory = (current: TableGame) => {
    const closed = hands.filter((h) => h.status === 'closed').reverse();
    if (closed.length === 0) return null;
    return (
      <>
        <Text style={styles.sectionTitle}>Manos</Text>
        {closed.map((h) => (
          <View key={h.number} style={styles.historyRow}>
            <Text style={styles.historyTitle}>
              Mano {h.number}: {h.winners.map((w) => nameOf(w.seat)).join(' y ')}
            </Text>
            <Text style={styles.historyDetail}>
              {h.bestHand ? handLabel(h.bestHand) : 'Ganó sin mostrar'}, pozo {handPot(h)}, anotó {
                current.players.find((p) => p.user_id === h.scoredBy)?.name ?? nameOf(h.dealerSeat)
              }
            </Text>
          </View>
        ))}
      </>
    );
  };

  const renderActive = (current: TableGame) => {
    const manages = canManageGame(current, currentUserProfileId, isAdmin);
    const canScoreOpen = !!openedHand && canScoreHand(current, openedHand.dealerSeat, currentUserProfileId, isAdmin);
    const canCloseGame = !openedHand && !!lastHand && canScoreHand(current, lastHand.dealerSeat, currentUserProfileId, isAdmin);
    return (
      <>
        {current.disputed_at && (
          <Text style={styles.notice}>✋ Un jugador no estuvo de acuerdo con el ganador. Revisen las fichas y vuelvan a terminar.</Text>
        )}
        {mesaReady() && (
          <TableCheckIn
            game={current}
            userId={currentUserProfileId}
            isAdmin={isAdmin}
            busy={busy}
            waitsFor={hands.length === 0 ? 'repartir la primera mano' : 'terminar la partida'}
            accent={POKER_GOLD}
            onCheckIn={checkIn}
            onMakeGuest={makeGuest}
          />
        )}
        {openedHand ? (
          <PokerHandPanel
            key={`${openedHand.number}-${openedHand.status}`}
            game={current}
            hand={openedHand}
            chips={chips}
            mySeat={current.players.find((p) => p.user_id === currentUserProfileId)?.seat ?? null}
            canScore={canScoreOpen}
            busy={busy}
            onSeat={applySeat}
            onChange={applyHand}
            onCancel={() => removeHand(openedHand)}
          />
        ) : (
          <>
            <Text style={styles.sectionTitle}>Fichas</Text>
            {renderStacks(current, mesaReady())}
            {manages ? (
              <PokerNewHand
                game={current}
                chips={chips}
                number={(lastHand?.number ?? 0) + 1}
                lastDealer={lastHand?.dealerSeat ?? null}
                disabled={busy || missingCheckIn(current).length > 0}
                onStart={dealHand}
                onAddDealer={mesaReady() ? addDealer : undefined}
                profiles={profiles}
              />
            ) : (
              <Text style={styles.empty}>Esperando la próxima mano.</Text>
            )}
            {canCloseGame && (
              <>
                {tieChoice ? (
                  <>
                    <Text style={styles.sectionTitle}>Empate. ¿Quién gana la partida?</Text>
                    {leaders.map((seat) => (
                      <TouchableOpacity key={seat} style={styles.tieRow} onPress={() => finishWith(seat)} accessibilityRole="button">
                        <Text style={styles.tieText}>{nameOf(seat)}, {chips[seat]} fichas</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                ) : (
                  <TouchableOpacity style={styles.finishBtn} onPress={requestFinish} disabled={busy} accessibilityRole="button">
                    <Text style={styles.finishText}>Terminar partida</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.linkBtn} onPress={correctLast} disabled={busy} accessibilityRole="button">
                  <Text style={styles.linkText}>Corregir la última mano</Text>
                </TouchableOpacity>
              </>
            )}
            {manages && hands.length === 0 && (
              <TouchableOpacity style={styles.linkBtn} onPress={cancelGame} disabled={busy} accessibilityRole="button">
                <Text style={styles.linkDanger}>Anular partida</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {renderHistory(current)}
        {manages && (
          <TouchableOpacity style={styles.linkBtn} onPress={leaveTable} accessibilityRole="button">
            <Text style={styles.linkText}>Dejar de ver esta mesa (sigue abierta)</Text>
          </TouchableOpacity>
        )}
      </>
    );
  };

  const renderPending = (current: TableGame) => (
    <>
      <Text style={styles.winnerLabel}>Ganó</Text>
      <Text style={styles.winner}>{winnerName(current)}</Text>
      <Text style={styles.gameMeta}>
        {secondsLeft ? `Esperando confirmación, se confirma sola en ${formatClock(secondsLeft)}` : 'Confirmando…'}
      </Text>
      {canAnswerGame(current, currentUserProfileId, isAdmin) && (
        <>
          <TouchableOpacity style={[styles.primaryBtn, styles.confirm]} onPress={() => answer(true)} disabled={busy} accessibilityRole="button">
            <Text style={styles.answerText}>✅ Sí, es correcto</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.primaryBtn, styles.reject]} onPress={() => answer(false)} disabled={busy} accessibilityRole="button">
            <Text style={styles.answerText}>✋ No, hay un error</Text>
          </TouchableOpacity>
        </>
      )}
      {renderStacks(current)}
      {renderHistory(current)}
    </>
  );

  const renderClosed = (current: TableGame) => (
    <>
      {current.status === 'completed' ? (
        <>
          <Text style={styles.winnerLabel}>Ganó</Text>
          <Text style={styles.winner}>{winnerName(current)}</Text>
        </>
      ) : (
        <Text style={styles.gameMeta}>Partida anulada</Text>
      )}
      {renderStacks(current)}
      <TouchableOpacity style={styles.linkBtn} onPress={backToSetup} accessibilityRole="button">
        <Text style={styles.linkText}>Nueva partida</Text>
      </TouchableOpacity>
      {renderHistory(current)}
      {canManageGame(current, currentUserProfileId, false) && rematchReady && (
        <TouchableOpacity style={styles.primaryBtn} onPress={() => rematch(current)} disabled={busy} accessibilityRole="button">
          <Text style={styles.primaryText}>Otra con los mismos</Text>
        </TouchableOpacity>
      )}
    </>
  );

  const renderBody = () => {
    if (loading) return <ActivityIndicator color={POKER_GOLD} size="large" style={styles.spinner} />;
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
        <Text style={styles.headerTitle}>Póker</Text>
        <TouchableOpacity style={styles.guideBtn} onPress={() => setShowHelp(true)} accessibilityRole="button">
          <Text style={styles.guideText}>Guía de jugadas</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>{renderBody()}</View>
      </ScrollView>
      <PokerHelpModal visible={showHelp} onClose={() => setShowHelp(false)} />
      {game && (
        <>
          <VipEntrance players={game.players.map((p) => ({ id: p.user_id, name: p.name }))} gameKey={`tg-${game.id}`} />
          <VipCelebration
            winners={game.players.filter((p) => p.seat === game.winner_seat).map((p) => ({ id: p.user_id, name: p.name }))}
            celebrationKey={`tg-win-${game.id}`}
            active={game.winner_seat !== null && (game.status === 'pending_confirmation' || game.status === 'completed')}
          />
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: theme.spacing.m },
  backBtn: { padding: theme.spacing.s, minHeight: 44, justifyContent: 'center' },
  backText: { color: theme.colors.primary, fontSize: 16 },
  headerTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  guideBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.m,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: POKER_GOLD,
  },
  guideText: { color: POKER_GOLD, fontSize: 14, fontWeight: '800' },
  content: { padding: theme.spacing.m, paddingBottom: theme.spacing.xxl, alignItems: 'center' },
  column: { width: '100%', maxWidth: 520 },
  spinner: { marginTop: theme.spacing.xl },
  sectionTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800', marginTop: theme.spacing.l, marginBottom: theme.spacing.s },
  settings: { flexDirection: 'row', gap: theme.spacing.s },
  setting: { flex: 1, minWidth: 0 },
  settingLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '700', marginBottom: theme.spacing.xs },
  settingInput: {
    minHeight: 48,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s,
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  hint: { color: theme.colors.textDim, fontSize: 13, marginTop: theme.spacing.s },
  primaryBtn: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.m,
    backgroundColor: POKER_GOLD,
    marginTop: theme.spacing.l,
  },
  primaryText: { color: '#1a1405', fontSize: 17, fontWeight: '800' },
  answerText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  confirm: { backgroundColor: theme.colors.success },
  reject: { backgroundColor: theme.colors.danger, marginTop: theme.spacing.s },
  finishBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.m,
    borderWidth: 1,
    borderColor: POKER_GOLD,
    marginTop: theme.spacing.l,
  },
  finishText: { color: POKER_GOLD, fontSize: 15, fontWeight: '700' },
  tieRow: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.m,
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.s,
    marginBottom: theme.spacing.xs,
  },
  tieText: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  linkBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.s },
  linkText: { color: theme.colors.primary, fontSize: 15, fontWeight: '600' },
  linkDanger: { color: theme.colors.danger, fontSize: 15, fontWeight: '600' },
  empty: { color: theme.colors.textDim, fontStyle: 'italic', paddingVertical: theme.spacing.s },
  stacks: { marginTop: theme.spacing.xs },
  stackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: theme.spacing.m,
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.s,
    marginBottom: theme.spacing.xs,
  },
  stackName: { color: theme.colors.text, fontSize: 15, fontWeight: '700', flex: 1, minWidth: 0 },
  stackLeft: { opacity: 0.55 },
  retireBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.s },
  retireText: { color: theme.colors.danger, fontSize: 13, fontWeight: '700' },
  stackChips: { color: POKER_GOLD, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  historyRow: { paddingVertical: theme.spacing.s, borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder },
  historyTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  historyDetail: { color: theme.colors.textDim, fontSize: 13, marginTop: 2 },
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
  winnerLabel: { color: theme.colors.textDim, fontSize: 15, textAlign: 'center', marginTop: theme.spacing.l },
  winner: { color: POKER_GOLD, fontSize: 30, fontWeight: '900', textAlign: 'center', marginBottom: theme.spacing.s },
});

import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import {
  callBet, closeByFold, closeShowdown, currentBet, DEFAULT_ENTRY, foldPlayer, handPot, isShortAllIn, loneSurvivor,
  newBettingRound, owedBy, POKER_HANDS, PokerHand, raiseBet, splitPot, stackLeft, unfoldPlayer, Winner,
} from '../lib/poker';
import { TableGame } from '../lib/tableGames';
import { POKER_GOLD } from './PokerNewHand';
import { PokerTable } from './PokerTable';
import { PokerTray } from './PokerTray';

interface Props {
  game: TableGame;
  hand: PokerHand;
  chips: Record<string, number>;
  mySeat: number | null;
  canScore: boolean;
  busy: boolean;
  /** One seat changed: a bet or a fold. */
  onSeat: (next: PokerHand, seat: number) => void;
  /** The hand itself changed: a new betting round, or it closed. */
  onChange: (hand: PokerHand) => void;
  onCancel: () => void;
}

const toWhole = (text: string) => parseInt(text.replace(/\D/g, ''), 10) || 0;

export const PokerHandPanel: React.FC<Props> = ({ game, hand, chips, mySeat, canScore, busy, onSeat, onChange, onCancel }) => {
  const [raising, setRaising] = useState<number | null>(null);
  const [raiseText, setRaiseText] = useState('');
  const [showdown, setShowdown] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [bestHand, setBestHand] = useState<string | null>(null);
  const [oddSeat, setOddSeat] = useState<number | null>(null);
  const [shares, setShares] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<{ hand: PokerHand; seat: number | null }[]>([]);

  const nameOf = (seat: number) => game.players.find((p) => p.seat === seat)?.name ?? '';

  // A wrong tap at the table must not cost the whole hand
  const act = (next: PokerHand, seat: number) => {
    setHistory((list) => [...list, { hand, seat }]);
    onSeat(next, seat);
  };

  const nextRound = () => {
    setHistory((list) => [...list, { hand, seat: null }]);
    onChange(newBettingRound(hand));
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (last.seat === null) onChange(last.hand);
    else onSeat(last.hand, last.seat);
    setHistory((list) => list.slice(0, -1));
  };
  const pot = handPot(hand);
  const alive = hand.entrants.filter((s) => !hand.folded.includes(s));
  const survivor = loneSurvivor(hand);
  const otherSeats = hand.entrants.filter((s) => s !== mySeat || hand.folded.includes(s));
  const someoneOwes = alive.some((s) => owedBy(hand, s, chips) > 0);
  const manualSplit = isShortAllIn(hand, chips);
  const needsOddChip = !manualSplit && picked.length > 1 && pot % picked.length !== 0;

  const raiseAmount = toWhole(raiseText);
  const raiseTotal = raising === null ? 0 : Math.min(currentBet(hand) + raiseAmount, chips[raising] ?? 0);

  const confirmRaise = () => {
    if (raising === null || raiseAmount < 1) return;
    act(raiseBet(hand, raising, raiseAmount, chips), raising);
    setRaising(null);
    setRaiseText('');
  };

  const togglePick = (seat: number) =>
    setPicked((list) => (list.includes(seat) ? list.filter((s) => s !== seat) : [...list, seat]));

  const paidOut = picked.reduce((sum, s) => sum + toWhole(shares[s] ?? ''), 0);

  const ready =
    picked.length > 0 &&
    !!bestHand &&
    (manualSplit ? paidOut === pot : !needsOddChip || oddSeat !== null);

  const closeWithCards = () => {
    if (!bestHand) return;
    const winners: Winner[] = manualSplit
      ? picked.map((seat) => ({ seat, amount: toWhole(shares[seat] ?? '') }))
      : splitPot(pot, picked, oddSeat);
    try {
      onChange(closeShowdown(hand, winners, bestHand));
    } catch (e: any) {
      Alert.alert('No se pudo cerrar la mano', e.message);
    }
  };

  const renderSeat = (seat: number) => {
    const folded = hand.folded.includes(seat);
    const left = stackLeft(hand, seat, chips);
    const owed = owedBy(hand, seat, chips);
    return (
      <View key={seat} style={[styles.seat, folded && styles.seatFolded]}>
        <View style={styles.seatInfo}>
          <Text style={styles.seatName} numberOfLines={1}>{nameOf(seat)}{seat === hand.dealerSeat ? ' (reparte)' : ''}</Text>
          <Text style={styles.seatDetail}>
            {folded ? `Se retiró, puso ${hand.contributions[seat]}` : `Puso ${hand.contributions[seat]}, le quedan ${left}${left === 0 ? ' (todo adentro)' : ''}`}
          </Text>
        </View>
        {canScore && folded && (
          <TouchableOpacity style={[styles.action, styles.actionBack]} onPress={() => act(unfoldPlayer(hand, seat), seat)} disabled={busy} accessibilityRole="button">
            <Text style={styles.actionText}>Vuelve a la mano</Text>
          </TouchableOpacity>
        )}
        {canScore && !folded && survivor === null && (
          <View style={styles.seatActions}>
            {owed > 0 && (
              <TouchableOpacity style={styles.action} onPress={() => act(callBet(hand, seat, chips), seat)} disabled={busy} accessibilityRole="button">
                <Text style={styles.actionText}>Iguala {owed}</Text>
              </TouchableOpacity>
            )}
            {left > 0 && (
              <TouchableOpacity style={styles.action} onPress={() => { setRaising(seat); setRaiseText(''); }} disabled={busy} accessibilityRole="button">
                <Text style={styles.actionText}>Sube</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.action, styles.actionOut]} onPress={() => act(foldPlayer(hand, seat), seat)} disabled={busy} accessibilityRole="button">
              <Text style={styles.actionText}>Se retira</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (showdown) {
    return (
      <View>
        <Text style={styles.potLabel}>Pozo</Text>
        <Text style={styles.pot}>{pot}</Text>
        <Text style={styles.label}>¿Quién ganó? Si hay empate, marca a todos.</Text>
        {alive.map((seat) => (
          <TouchableOpacity
            key={seat}
            style={[styles.pick, picked.includes(seat) && styles.pickActive]}
            onPress={() => togglePick(seat)}
            accessibilityRole="button"
            accessibilityState={{ selected: picked.includes(seat) }}
          >
            <Text style={styles.pickText}>{nameOf(seat)}</Text>
            {manualSplit && picked.includes(seat) && (
              <TextInput
                style={styles.shareInput}
                value={shares[seat] ?? ''}
                onChangeText={(text) => setShares((s) => ({ ...s, [seat]: text }))}
                keyboardType="number-pad"
                placeholder="Se lleva"
                placeholderTextColor={theme.colors.textDim}
                accessibilityLabel={`Fichas que se lleva ${nameOf(seat)}`}
              />
            )}
          </TouchableOpacity>
        ))}
        {manualSplit && (
          <Text style={styles.hint}>
            Alguien fue todo adentro: solo gana hasta lo que alcanzó a igualar. Anota cuánto se lleva cada uno. Falta repartir {pot - paidOut}.
          </Text>
        )}
        {needsOddChip && (
          <>
            <Text style={styles.label}>¿Quién recibe la ficha que sobra?</Text>
            <View style={styles.chips}>
              {picked.map((seat) => (
                <TouchableOpacity
                  key={seat}
                  style={[styles.chip, oddSeat === seat && styles.chipActive]}
                  onPress={() => setOddSeat(seat)}
                  accessibilityRole="button"
                >
                  <Text style={[styles.chipText, oddSeat === seat && styles.chipTextActive]}>{nameOf(seat)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
        <Text style={styles.label}>¿Con qué jugada?</Text>
        <View style={styles.chips}>
          {POKER_HANDS.map((h) => (
            <TouchableOpacity
              key={h.key}
              style={[styles.chip, bestHand === h.key && styles.chipActive]}
              onPress={() => setBestHand(h.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: bestHand === h.key }}
            >
              <Text style={[styles.chipText, bestHand === h.key && styles.chipTextActive]}>{h.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={[styles.primary, !ready && styles.disabled]} disabled={!ready || busy} onPress={closeWithCards} accessibilityRole="button">
          <Text style={styles.primaryText}>Cerrar mano</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => setShowdown(false)} accessibilityRole="button">
          <Text style={styles.linkText}>Volver a las apuestas</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <PokerTable game={game} hand={hand} chips={chips} />

      {mySeat !== null && alive.includes(mySeat) && survivor === null && (
        <PokerTray
          hand={hand}
          seat={mySeat}
          chips={chips}
          entry={game.entry_amount ?? DEFAULT_ENTRY}
          busy={busy}
          onAct={(next) => act(next, mySeat)}
        />
      )}
      {mySeat !== null && hand.folded.includes(mySeat) && (
        <Text style={styles.hintCenter}>Te retiraste de esta mano. Lo que pusiste queda en el pozo.</Text>
      )}

      {canScore && otherSeats.length > 0 && (
        <>
          <Text style={styles.label}>Anotar por los demás</Text>
          <Text style={styles.hint}>Solo hace falta para quien no tiene teléfono a mano.</Text>
          {otherSeats.map(renderSeat)}
        </>
      )}

      {canScore && history.length > 0 && raising === null && (
        <TouchableOpacity style={styles.link} onPress={undo} disabled={busy} accessibilityRole="button">
          <Text style={styles.linkText}>Deshacer lo último</Text>
        </TouchableOpacity>
      )}

      {raising !== null && (
        <View style={styles.raise}>
          <Text style={styles.label}>¿Cuánto agrega {nameOf(raising)}?</Text>
          <TextInput
            style={styles.raiseInput}
            value={raiseText}
            onChangeText={setRaiseText}
            keyboardType="number-pad"
            autoFocus
            placeholder="Fichas que agrega"
            placeholderTextColor={theme.colors.textDim}
            accessibilityLabel="Fichas que agrega"
          />
          <Text style={styles.hint}>
            {raiseAmount > 0 ? `Su total queda en ${raiseTotal}; los demás deben llegar a eso.` : 'Se suma encima de la apuesta más alta.'}
          </Text>
          <TouchableOpacity style={[styles.primary, raiseAmount < 1 && styles.disabled]} disabled={raiseAmount < 1 || busy} onPress={confirmRaise} accessibilityRole="button">
            <Text style={styles.primaryText}>Subir {raiseAmount || ''}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.link} onPress={() => setRaising(null)} accessibilityRole="button">
            <Text style={styles.linkText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      )}

      {canScore && raising === null && (
        survivor !== null ? (
          <TouchableOpacity style={styles.primary} onPress={() => onChange(closeByFold(hand))} disabled={busy} accessibilityRole="button">
            <Text style={styles.primaryText}>{nameOf(survivor)} gana sin mostrar. Cerrar mano</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.primary, someoneOwes && styles.disabled]}
              disabled={someoneOwes || busy}
              onPress={() => setShowdown(true)}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>Mostrar cartas</Text>
            </TouchableOpacity>
            {someoneOwes && <Text style={styles.hintCenter}>Antes, cada quien debe igualar o retirarse.</Text>}
            <TouchableOpacity
              style={[styles.secondary, someoneOwes && styles.disabled]}
              disabled={someoneOwes || busy}
              onPress={nextRound}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Nueva ronda de apuestas</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.link} onPress={onCancel} disabled={busy} accessibilityRole="button">
              <Text style={styles.linkDanger}>Quitar esta mano</Text>
            </TouchableOpacity>
          </>
        )
      )}

      {!canScore && <Text style={styles.hintCenter}>Cierra la mano quien reparte: {nameOf(hand.dealerSeat)}.</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  potLabel: { color: theme.colors.textDim, fontSize: 14, textAlign: 'center', marginTop: theme.spacing.s },
  pot: { color: POKER_GOLD, fontSize: 44, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'] },
  seat: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.s,
    padding: theme.spacing.s,
    paddingHorizontal: theme.spacing.m,
    marginTop: theme.spacing.s,
  },
  seatFolded: { opacity: 0.7 },
  seatInfo: { minWidth: 0 },
  seatName: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  seatDetail: { color: theme.colors.textDim, fontSize: 14, marginTop: 2, fontVariant: ['tabular-nums'] },
  seatActions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, marginTop: theme.spacing.s },
  action: {
    flexGrow: 1,
    minHeight: 44,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.s,
    backgroundColor: 'rgba(212,168,67,0.18)',
  },
  actionOut: { backgroundColor: 'rgba(239,68,68,0.16)' },
  actionBack: { flexGrow: 0, marginTop: theme.spacing.s },
  actionText: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  raise: { marginTop: theme.spacing.s },
  raiseInput: {
    minHeight: 54,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: POKER_GOLD,
    borderRadius: theme.borderRadius.s,
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  shareInput: {
    width: 110,
    minHeight: 40,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: theme.borderRadius.s,
    color: theme.colors.text,
    fontSize: 16,
    textAlign: 'center',
  },
  label: { color: theme.colors.text, fontSize: 15, fontWeight: '700', marginTop: theme.spacing.m, marginBottom: theme.spacing.s },
  hint: { color: theme.colors.textDim, fontSize: 13, marginTop: theme.spacing.xs },
  hintCenter: { color: theme.colors.textDim, fontSize: 14, textAlign: 'center', marginTop: theme.spacing.s },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: theme.spacing.m,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s,
    marginBottom: theme.spacing.xs,
  },
  pickActive: { borderColor: POKER_GOLD, backgroundColor: 'rgba(212,168,67,0.14)' },
  pickText: { color: theme.colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.s },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.m,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  chipActive: { backgroundColor: POKER_GOLD, borderColor: POKER_GOLD },
  chipText: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  chipTextActive: { color: '#1a1405' },
  primary: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.m,
    borderRadius: theme.borderRadius.m,
    backgroundColor: POKER_GOLD,
    marginTop: theme.spacing.m,
  },
  primaryText: { color: '#1a1405', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  secondary: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.m,
    borderWidth: 1,
    borderColor: POKER_GOLD,
    marginTop: theme.spacing.s,
  },
  secondaryText: { color: POKER_GOLD, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.s },
  linkText: { color: theme.colors.primary, fontSize: 15, fontWeight: '600' },
  linkDanger: { color: theme.colors.danger, fontSize: 15, fontWeight: '600' },
});

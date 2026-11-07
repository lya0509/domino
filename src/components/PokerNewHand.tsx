import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { blindSeats, DEFAULT_ENTRY, nextDealerSeat, smallBlind } from '../lib/poker';
import { activeSeats, isDealerOnly, TableGame } from '../lib/tableGames';
import { Profile } from '../types';
import { GuestNameInput } from './GuestNameInput';

export const POKER_GOLD = '#d4a843';

interface Props {
  game: TableGame;
  chips: Record<string, number>;
  number: number;
  lastDealer: number | null;
  disabled: boolean;
  onStart: (dealerSeat: number, entrants: number[]) => void;
  /** With SQL 22: someone who is not playing can deal. Answers their seat, or null if it failed. */
  onAddDealer?: (userId: string | null, name: string) => Promise<number | null>;
  profiles?: Profile[];
}

/** Before each hand: who deals, and who is in. */
export const PokerNewHand: React.FC<Props> = ({ game, chips, number, lastDealer, disabled, onStart, onAddDealer, profiles = [] }) => {
  // Only who is still in the game plays; whoever only deals or left is not offered a seat in the hand
  const playing = activeSeats(game);
  const withChips = playing.filter((s) => (chips[s] ?? 0) > 0);
  const firstDealer = () => nextDealerSeat(playing, lastDealer !== null && playing.includes(lastDealer) ? lastDealer : null);
  const [dealer, setDealer] = useState(firstDealer);
  const [entrants, setEntrants] = useState<number[]>(withChips);
  const [outside, setOutside] = useState(false);

  useEffect(() => {
    setDealer(firstDealer());
    setEntrants(withChips);
    setOutside(false);
    // A new hand starts from a clean slate; chips only change between hands
  }, [number, lastDealer]);

  const toggle = (seat: number) =>
    setEntrants((list) => (list.includes(seat) ? list.filter((s) => s !== seat) : [...list, seat].sort((a, b) => a - b)));

  const dealerName = game.players.find((p) => p.seat === dealer)?.name;
  const entry = game.entry_amount ?? DEFAULT_ENTRY;
  const blinds = entrants.length >= 2 ? blindSeats(entrants, dealer) : null;
  const blindText = (seat: number) => {
    if (seat === blinds?.small) return `Salida baja: ${smallBlind(entry)}`;
    return seat === blinds?.big ? `Salida alta: ${entry}` : 'Entra';
  };
  const dealerIn = entrants.includes(dealer);
  // Players still in, plus anyone who already dealt from outside this game
  const dealerOptions = game.players.filter((p) => !p.left_at && (playing.includes(p.seat) || isDealerOnly(p)));

  const addOutsideDealer = async (name: string) => {
    if (!onAddDealer) return;
    const account = profiles.find((p) => (p.display_name || '').trim().toLowerCase() === name.trim().toLowerCase());
    const seat = await onAddDealer(account?.id ?? null, name);
    if (seat !== null) {
      setDealer(seat);
      setEntrants((list) => list.filter((s) => s !== seat));
      setOutside(false);
    }
  };

  return (
    <View>
      <Text style={styles.title}>Mano {number}</Text>
      <Text style={styles.label}>¿Quién reparte?</Text>
      <View style={styles.chips}>
        {dealerOptions.map((p) => (
          <TouchableOpacity
            key={p.seat}
            style={[styles.chip, dealer === p.seat && styles.chipActive]}
            onPress={() => setDealer(p.seat)}
            accessibilityRole="button"
            accessibilityState={{ selected: dealer === p.seat }}
          >
            <Text style={[styles.chipText, dealer === p.seat && styles.chipTextActive]}>
              {p.name}{isDealerOnly(p) ? ' (solo reparte)' : ''}
            </Text>
          </TouchableOpacity>
        ))}
        {onAddDealer && !outside && (
          <TouchableOpacity style={styles.chip} onPress={() => setOutside(true)} accessibilityRole="button">
            <Text style={styles.chipText}>+ Otra persona</Text>
          </TouchableOpacity>
        )}
      </View>
      {outside && (
        <View style={styles.outside}>
          <Text style={styles.hint}>Alguien que no juega: no recibe fichas, no entra en la mano y no puede ganar.</Text>
          <GuestNameInput
            onAdd={addOutsideDealer}
            chosen={game.players.map((p) => p.name)}
            placeholder="¿Quién reparte?"
            buttonText="Reparte"
            accentColor="#8a6a1f"
          />
        </View>
      )}

      <Text style={styles.label}>¿Quién entra?</Text>
      {game.players.filter((p) => playing.includes(p.seat)).map((p) => {
        const noChips = (chips[p.seat] ?? 0) <= 0;
        const inHand = entrants.includes(p.seat);
        return (
          <TouchableOpacity
            key={p.seat}
            style={[styles.row, inHand && styles.rowIn, noChips && styles.rowOff]}
            disabled={noChips}
            onPress={() => toggle(p.seat)}
            accessibilityRole="button"
            accessibilityState={{ selected: inHand }}
          >
            <Text style={styles.rowName} numberOfLines={1}>{p.name}</Text>
            <Text style={[styles.rowState, inHand && (p.seat === blinds?.small || p.seat === blinds?.big) && styles.rowBlind]}>
              {noChips ? 'Sin fichas' : inHand ? blindText(p.seat) : p.seat === dealer ? 'Solo reparte' : 'No entra'}
            </Text>
          </TouchableOpacity>
        );
      })}
      <Text style={styles.hint}>
        Para que quien reparte no juegue esta mano, tócalo en la lista y queda "Solo reparte".
      </Text>

      <Text style={styles.summary}>{dealerName} reparte y {dealerIn ? 'juega' : 'no juega'}.</Text>
      <TouchableOpacity
        style={[styles.deal, entrants.length < 2 && styles.disabled]}
        disabled={entrants.length < 2 || disabled}
        onPress={() => onStart(dealer, entrants)}
        accessibilityRole="button"
      >
        <Text style={styles.dealText}>Empezar mano {number}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '900', marginTop: theme.spacing.l },
  label: { color: theme.colors.text, fontSize: 15, fontWeight: '700', marginTop: theme.spacing.m, marginBottom: theme.spacing.s },
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: theme.spacing.m,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s,
    marginBottom: theme.spacing.xs,
  },
  rowIn: { borderColor: POKER_GOLD },
  rowOff: { opacity: 0.45 },
  rowName: { color: theme.colors.text, fontSize: 15, fontWeight: '700', flex: 1, minWidth: 0 },
  rowState: { color: theme.colors.textDim, fontSize: 14 },
  rowBlind: { color: POKER_GOLD, fontWeight: '800' },
  hint: { color: theme.colors.textDim, fontSize: 13, marginTop: theme.spacing.xs },
  outside: { marginTop: theme.spacing.s },
  summary: { color: theme.colors.textDim, fontSize: 14, textAlign: 'center', marginTop: theme.spacing.s },
  deal: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.borderRadius.m,
    backgroundColor: POKER_GOLD,
    marginTop: theme.spacing.s,
  },
  dealText: { color: '#1a1405', fontSize: 17, fontWeight: '800' },
  disabled: { opacity: 0.4 },
});

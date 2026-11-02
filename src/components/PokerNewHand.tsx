import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { nextDealerSeat } from '../lib/poker';
import { TableGame } from '../lib/tableGames';

export const POKER_GOLD = '#d4a843';

interface Props {
  game: TableGame;
  chips: Record<string, number>;
  number: number;
  lastDealer: number | null;
  disabled: boolean;
  onStart: (dealerSeat: number, entrants: number[]) => void;
}

/** Before each hand: who deals, and who is in. */
export const PokerNewHand: React.FC<Props> = ({ game, chips, number, lastDealer, disabled, onStart }) => {
  const seats = game.players.map((p) => p.seat);
  const withChips = seats.filter((s) => (chips[s] ?? 0) > 0);
  const [dealer, setDealer] = useState(() => nextDealerSeat(seats, lastDealer));
  const [entrants, setEntrants] = useState<number[]>(withChips);

  useEffect(() => {
    setDealer(nextDealerSeat(seats, lastDealer));
    setEntrants(withChips);
    // A new hand starts from a clean slate; chips only change between hands
  }, [number, lastDealer]);

  const toggle = (seat: number) =>
    setEntrants((list) => (list.includes(seat) ? list.filter((s) => s !== seat) : [...list, seat].sort((a, b) => a - b)));

  const dealerName = game.players.find((p) => p.seat === dealer)?.name;
  const dealerIn = entrants.includes(dealer);

  return (
    <View>
      <Text style={styles.title}>Mano {number}</Text>
      <Text style={styles.label}>¿Quién reparte?</Text>
      <View style={styles.chips}>
        {game.players.map((p) => (
          <TouchableOpacity
            key={p.seat}
            style={[styles.chip, dealer === p.seat && styles.chipActive]}
            onPress={() => setDealer(p.seat)}
            accessibilityRole="button"
            accessibilityState={{ selected: dealer === p.seat }}
          >
            <Text style={[styles.chipText, dealer === p.seat && styles.chipTextActive]}>{p.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>¿Quién entra? La entrada es de {game.entry_amount} fichas.</Text>
      {game.players.map((p) => {
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
            <Text style={styles.rowState}>
              {noChips ? 'Sin fichas' : inHand ? 'Entra' : p.seat === dealer ? 'Solo reparte' : 'No entra'}
            </Text>
          </TouchableOpacity>
        );
      })}

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

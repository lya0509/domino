import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { blindSeats, DEFAULT_ENTRY, firstToSpeak, handPot, PokerHand, seatStatus, stackLeft } from '../lib/poker';
import { TableGame } from '../lib/tableGames';
import { PokerPot } from './PokerPot';

export const POKER_FELT = '#0f4a37';
export const POKER_WOOD = '#2c1d12';

interface Props {
  game: TableGame;
  hand: PokerHand;
  chips: Record<string, number>;
}

const statusText = (status: ReturnType<typeof seatStatus>) => {
  if (status.state === 'folded') return 'Se retiró';
  if (status.state === 'allIn') return 'Todo adentro';
  return status.state === 'owes' ? `Le faltan ${status.owed}` : 'Igualado';
};

/** What everyone at the table sees: the pot and how each seat stands. */
export const PokerTable: React.FC<Props> = ({ game, hand, chips }) => {
  const nameOf = (seat: number) => game.players.find((p) => p.seat === seat)?.name ?? '';
  const { small, big } = blindSeats(hand.entrants, hand.dealerSeat);
  const speaker = firstToSpeak(hand, chips);

  const rolesOf = (seat: number) =>
    [seat === hand.dealerSeat && 'Reparte', seat === small && 'Salida baja', seat === big && 'Salida alta']
      .filter(Boolean)
      .join(', ');

  return (
    <View style={styles.table}>
      <Text style={styles.meta}>
        Mano {hand.number}, ronda {hand.bettingRound}. Reparte {nameOf(hand.dealerSeat)}
      </Text>
      <PokerPot amount={handPot(hand)} entry={game.entry_amount ?? DEFAULT_ENTRY} />
      {speaker !== null && <Text style={styles.speaker}>Habla primero: {nameOf(speaker)}</Text>}
      <View style={styles.seats}>
        {hand.entrants.map((seat) => {
          const status = seatStatus(hand, seat, chips);
          const roles = rolesOf(seat);
          return (
            <View key={seat} style={[styles.seat, status.state === 'folded' && styles.seatOut]}>
              <Text style={styles.name} numberOfLines={1}>{nameOf(seat)}</Text>
              <Text style={styles.detail}>Puso {hand.contributions[seat]}, le quedan {stackLeft(hand, seat, chips)}</Text>
              <Text style={[styles.state, styles[status.state]]}>{statusText(status)}</Text>
              {!!roles && <Text style={styles.role}>{roles}</Text>}
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  table: {
    backgroundColor: POKER_FELT,
    borderWidth: 8,
    borderColor: POKER_WOOD,
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.s,
    marginTop: theme.spacing.s,
  },
  meta: { color: theme.colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: theme.spacing.xs },
  speaker: { color: theme.colors.text, fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: theme.spacing.s },
  seats: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, marginTop: theme.spacing.s },
  seat: {
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 0,
    backgroundColor: 'rgba(8,6,4,0.72)',
    borderRadius: theme.borderRadius.s,
    paddingVertical: 6,
    paddingHorizontal: theme.spacing.s,
  },
  seatOut: { opacity: 0.6 },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  detail: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontVariant: ['tabular-nums'] },
  state: { fontSize: 12, fontWeight: '700' },
  role: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
  folded: { color: '#f09a95' },
  allIn: { color: '#e6c878' },
  owes: { color: '#e6c878' },
  matched: { color: '#7fdcae' },
});

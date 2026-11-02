// Rules of a poker table. The chips here are table chips: they live only inside a game
// and never touch the points balance. The server checks every closed hand again.

export const DEFAULT_START_CHIPS = 200;
export const DEFAULT_ENTRY = 10;

export const POKER_HANDS = [
  { key: 'royal_flush', label: 'Escalera real', detail: '10, J, Q, K y A del mismo palo', cards: ['10♠', 'J♠', 'Q♠', 'K♠', 'A♠'] },
  { key: 'straight_flush', label: 'Escalera de color', detail: '5 cartas seguidas del mismo palo', cards: ['5♥', '6♥', '7♥', '8♥', '9♥'] },
  { key: 'four_of_a_kind', label: 'Póker', detail: '4 cartas del mismo valor', cards: ['K♠', 'K♥', 'K♦', 'K♣', '4♦'] },
  { key: 'full_house', label: 'Full', detail: 'Un trío y un par', cards: ['J♠', 'J♥', 'J♦', '8♣', '8♠'] },
  { key: 'flush', label: 'Color', detail: '5 cartas del mismo palo', cards: ['2♦', '6♦', '9♦', 'J♦', 'K♦'] },
  { key: 'straight', label: 'Escalera', detail: '5 cartas seguidas de distintos palos', cards: ['4♣', '5♦', '6♠', '7♥', '8♣'] },
  { key: 'three_of_a_kind', label: 'Trío', detail: '3 cartas del mismo valor', cards: ['9♠', '9♥', '9♦', 'K♣', '3♠'] },
  { key: 'two_pair', label: 'Doble par', detail: 'Dos pares distintos', cards: ['A♠', 'A♦', '7♣', '7♥', '2♦'] },
  { key: 'pair', label: 'Un par', detail: '2 cartas del mismo valor', cards: ['Q♥', 'Q♣', '9♠', '5♦', '2♣'] },
  { key: 'high_card', label: 'Carta alta', detail: 'Ninguna de las anteriores', cards: ['A♦', 'J♠', '8♣', '5♥', '3♦'] },
];

export interface Winner {
  seat: number;
  amount: number;
}

export interface PokerHand {
  number: number;
  dealerSeat: number;
  dealerPlays: boolean;
  entrants: number[];
  contributions: Record<string, number>;
  folded: number[];
  bettingRound: number;
  status: 'open' | 'closed';
  endType: 'fold' | 'showdown' | null;
  winners: Winner[];
  bestHand: string | null;
  scoredBy?: string | null;
}

type Chips = Record<string, number>;

const stillIn = (hand: PokerHand) => hand.entrants.filter((s) => !hand.folded.includes(s));

const addTo = (hand: PokerHand, seat: number, total: number): PokerHand => ({
  ...hand,
  contributions: { ...hand.contributions, [seat]: total },
});

export const handLabel = (key: string | null): string | null =>
  POKER_HANDS.find((h) => h.key === key)?.label ?? null;

export const handPot = (hand: PokerHand): number =>
  Object.values(hand.contributions).reduce((sum, amount) => sum + amount, 0);

export const currentBet = (hand: PokerHand): number =>
  Math.max(0, ...stillIn(hand).map((s) => hand.contributions[s] ?? 0));

export const stackLeft = (hand: PokerHand, seat: number, chips: Chips): number =>
  (chips[seat] ?? 0) - (hand.contributions[seat] ?? 0);

export const owedBy = (hand: PokerHand, seat: number, chips: Chips): number =>
  Math.min(currentBet(hand) - (hand.contributions[seat] ?? 0), stackLeft(hand, seat, chips));

export const openHand = (input: {
  number: number;
  dealerSeat: number;
  dealerPlays: boolean;
  entrants: number[];
  entry: number;
  chips: Chips;
}): PokerHand => ({
  number: input.number,
  dealerSeat: input.dealerSeat,
  dealerPlays: input.dealerPlays,
  entrants: input.entrants,
  contributions: Object.fromEntries(input.entrants.map((s) => [s, Math.min(input.entry, input.chips[s] ?? 0)])),
  folded: [],
  bettingRound: 1,
  status: 'open',
  endType: null,
  winners: [],
  bestHand: null,
});

export const callBet = (hand: PokerHand, seat: number, chips: Chips): PokerHand =>
  addTo(hand, seat, (hand.contributions[seat] ?? 0) + Math.max(0, owedBy(hand, seat, chips)));

/** "Sube" is how much is added on top of the highest bet, not the total to reach. */
export const raiseBet = (hand: PokerHand, seat: number, amount: number, chips: Chips): PokerHand =>
  addTo(hand, seat, Math.min(currentBet(hand) + amount, chips[seat] ?? 0));

export const foldPlayer = (hand: PokerHand, seat: number): PokerHand => ({
  ...hand,
  folded: [...hand.folded, seat],
});

export const unfoldPlayer = (hand: PokerHand, seat: number): PokerHand => ({
  ...hand,
  folded: hand.folded.filter((s) => s !== seat),
});

/** A bet from the tray: chips added to what the player already put in. */
export const betChips = (hand: PokerHand, seat: number, amount: number, chips: Chips): PokerHand =>
  addTo(hand, seat, Math.min((hand.contributions[seat] ?? 0) + amount, chips[seat] ?? 0));

/** Each player writes only their own seat, so a local change must not undo what others did. */
export const copySeat = (hand: PokerHand, from: PokerHand, seat: number): PokerHand => ({
  ...hand,
  contributions: { ...hand.contributions, [seat]: from.contributions[seat] },
  folded: from.folded.includes(seat) ? [...new Set([...hand.folded, seat])] : hand.folded.filter((s) => s !== seat),
});

export const newBettingRound = (hand: PokerHand): PokerHand => ({ ...hand, bettingRound: hand.bettingRound + 1 });

export const loneSurvivor = (hand: PokerHand): number | null => {
  const left = stillIn(hand);
  return left.length === 1 ? left[0] : null;
};

export const closeByFold = (hand: PokerHand): PokerHand => ({
  ...hand,
  status: 'closed',
  endType: 'fold',
  bestHand: null,
  winners: [{ seat: loneSurvivor(hand) as number, amount: handPot(hand) }],
});

/** Someone all-in who couldn't match can only win part of the pot: the dealer writes each share. */
export const isShortAllIn = (hand: PokerHand, chips: Chips): boolean =>
  stillIn(hand).some((s) => (hand.contributions[s] ?? 0) < currentBet(hand) && stackLeft(hand, s, chips) === 0);

export const splitPot = (pot: number, seats: number[], oddChipSeat: number | null): Winner[] => {
  const share = Math.floor(pot / seats.length);
  const left = pot - share * seats.length;
  return seats.map((seat) => ({ seat, amount: share + (seat === oddChipSeat ? left : 0) }));
};

export const closeShowdown = (hand: PokerHand, winners: Winner[], bestHand: string): PokerHand => {
  if (winners.reduce((sum, w) => sum + w.amount, 0) !== handPot(hand)) {
    throw new Error('Las fichas repartidas deben sumar el pozo');
  }
  if (!handLabel(bestHand)) throw new Error('Esa jugada no existe');
  return { ...hand, status: 'closed', endType: 'showdown', winners, bestHand };
};

export const chipsAfterHands = (seats: number[], startChips: number, hands: PokerHand[]): Chips => {
  const chips: Chips = Object.fromEntries(seats.map((s) => [s, startChips]));
  hands
    .filter((h) => h.status === 'closed')
    .forEach((h) => {
      Object.entries(h.contributions).forEach(([seat, amount]) => {
        chips[seat] -= amount;
      });
      h.winners.forEach((w) => {
        chips[w.seat] += w.amount;
      });
    });
  return chips;
};

export const nextDealerSeat = (seats: number[], lastDealer: number | null): number => {
  if (lastDealer === null) return seats[0];
  return seats[(seats.indexOf(lastDealer) + 1) % seats.length];
};

export const chipLeaders = (chips: Chips): number[] => {
  const most = Math.max(...Object.values(chips));
  return Object.keys(chips).map(Number).filter((seat) => chips[seat] === most);
};

/** Only who deals writes. The creator covers a dealer with no account or no phone at hand. */
export const canScoreHand = (
  game: { created_by: string | null; players: { seat: number; user_id: string | null }[] },
  dealerSeat: number,
  userId: string | null,
  isAdmin: boolean
): boolean => {
  if (!userId) return false;
  if (isAdmin || game.created_by === userId) return true;
  return game.players.find((p) => p.seat === dealerSeat)?.user_id === userId;
};

export type SeatState = 'folded' | 'allIn' | 'owes' | 'matched';

export const seatStatus = (hand: PokerHand, seat: number, chips: Chips): { state: SeatState; owed: number } => {
  if (hand.folded.includes(seat)) return { state: 'folded', owed: 0 };
  if (stackLeft(hand, seat, chips) === 0) return { state: 'allIn', owed: 0 };
  const owed = Math.max(0, owedBy(hand, seat, chips));
  return { state: owed > 0 ? 'owes' : 'matched', owed };
};

/** What the tray's main button does with the chips the player has tapped. */
export const trayAction = (
  hand: PokerHand,
  seat: number,
  chips: Chips,
  bet: number
): { label: string; amount: number; enabled: boolean } => {
  const owed = Math.max(0, owedBy(hand, seat, chips));
  const put = hand.contributions[seat] ?? 0;
  if (bet === 0) {
    return owed > 0
      ? { label: `Igualar ${owed}`, amount: owed, enabled: true }
      : { label: 'Nada que igualar', amount: 0, enabled: false };
  }
  if (bet === stackLeft(hand, seat, chips)) return { label: `Todo adentro ${bet}`, amount: bet, enabled: true };
  if (bet < owed) return { label: `Faltan ${owed - bet}`, amount: bet, enabled: false };
  if (bet === owed) return { label: `Igualar ${owed}`, amount: bet, enabled: true };
  return { label: `Subir ${bet - owed}, total ${put + bet}`, amount: bet, enabled: true };
};

/** The chip faces on the tray scale with the entry: half, the entry itself, and bigger steps. */
export const chipValues = (entry: number): number[] => [
  ...new Set([0.5, 1, 2.5, 5, 10].map((step) => Math.max(1, Math.round(entry * step)))),
];

/** Chips are only a number here: the rack keeps small ones in view, like a real tray. */
export const rackOf = (amount: number, values: number[]): Record<number, number> => {
  const rack: Record<number, number> = Object.fromEntries(values.map((v) => [v, 0]));
  let left = amount;
  values.slice(0, 3).forEach((value) => {
    const take = Math.min(4, Math.floor(left / value));
    rack[value] = take;
    left -= take * value;
  });
  [...values].reverse().forEach((value) => {
    const take = Math.floor(left / value);
    rack[value] += take;
    left -= take * value;
  });
  return rack;
};

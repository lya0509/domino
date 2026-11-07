import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { buildMonthRecap, clubMonth, monthLabel, monthRange, previousMonth, RecapMatch, RecapTableGame } from '../lib/monthRecap';
import { shareMonthRecap } from '../lib/shareMonthRecap';

interface Props {
  userId: string;
  name: string;
  /** Every completed dominó match of this player (the profile already has them). */
  matches: RecapMatch[];
  names: Record<string, string>;
  accent?: string;
}

const GOLD = '#fbbf24';

// UNO and poker of the two months shown, with how many guests each table had
const fetchTables = async (userId: string, from: string): Promise<RecapTableGame[]> => {
  const query = (withRole: boolean) =>
    supabase
      .from('table_game_players')
      .select(`seat${withRole ? ', role' : ''}, table_games!inner(game, status, winner_seat, closed_at, players:table_game_players(user_id${withRole ? ', role' : ''}))`)
      .eq('user_id', userId)
      .eq('table_games.status', 'completed')
      .gte('table_games.closed_at', from);
  let res: any = await query(true);
  if (res.error) res = await query(false);
  if (res.error) return [];
  return (res.data || [])
    .filter((r: any) => r.role !== 'dealer')
    .map((r: any) => {
      const g = Array.isArray(r.table_games) ? r.table_games[0] : r.table_games;
      const players = g?.players || [];
      return {
        game: g?.game,
        closed_at: g?.closed_at ?? null,
        winner_seat: g?.winner_seat ?? null,
        seat: r.seat,
        guests: players.filter((p: any) => !p.user_id && p.role !== 'dealer').length,
      };
    });
};

/** A VIP perk: the month in numbers, ready to share on WhatsApp. */
export const MonthRecapCard: React.FC<Props> = ({ userId, name, matches, names, accent = GOLD }) => {
  const thisMonth = clubMonth(Date.now());
  const lastMonth = previousMonth(thisMonth);
  // The first week of a month, last month's summary is the news
  const [month, setMonth] = useState(() => (new Date(Date.now() - 4 * 3600_000).getUTCDate() <= 7 ? lastMonth : thisMonth));
  const [tables, setTables] = useState<RecapTableGame[] | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchTables(userId, monthRange(lastMonth).from).then((t) => alive && setTables(t));
    return () => {
      alive = false;
    };
  }, [userId, lastMonth]);

  const recap = useMemo(() => buildMonthRecap(userId, month, matches, tables || [], names), [userId, month, matches, tables, names]);

  // An empty default month is no news: show the other one if it has games (only until the person picks)
  const [picked, setPicked] = useState(false);
  useEffect(() => {
    if (picked || tables === null || recap.played > 0) return;
    const other = month === thisMonth ? lastMonth : thisMonth;
    if (buildMonthRecap(userId, other, matches, tables, names).played > 0) setMonth(other);
  }, [picked, tables, recap.played, month, thisMonth, lastMonth, userId, matches, names]);

  const share = async () => {
    setSharing(true);
    try {
      await shareMonthRecap(recap, name, accent);
    } catch (e: any) {
      Alert.alert('No se pudo compartir', e?.message || 'Inténtalo de nuevo.');
    } finally {
      setSharing(false);
    }
  };

  const line = (left: string, right: string) => (
    <View style={styles.line} key={left}>
      <Text style={styles.lineLeft}>{left}</Text>
      <Text style={styles.lineRight} numberOfLines={1}>{right}</Text>
    </View>
  );

  return (
    <View style={[styles.card, { borderColor: accent }]}>
      <Text style={[styles.kicker, { color: accent }]}>📊 MI MES EN EL CAFETÍN</Text>
      <View style={styles.tabs}>
        {[lastMonth, thisMonth].map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.tab, month === m && { backgroundColor: accent, borderColor: accent }]}
            onPress={() => { setPicked(true); setMonth(m); }}
            accessibilityRole="button"
            accessibilityState={{ selected: month === m }}
          >
            <Text style={[styles.tabText, month === m && styles.tabTextOn]}>{m === thisMonth ? `${monthLabel(m)} (va)` : monthLabel(m)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tables === null ? (
        <ActivityIndicator color={accent} style={{ marginVertical: 16 }} />
      ) : recap.played === 0 ? (
        <Text style={styles.empty}>No jugaste en {monthLabel(month).toLowerCase()}. ¡A la mesa!</Text>
      ) : (
        <>
          <View style={styles.tiles}>
            {[
              [String(recap.played), 'partidas'],
              [String(recap.wins), 'victorias'],
              [`${recap.domino.winRate}%`, 'en dominó'],
            ].map(([value, label]) => (
              <View key={label} style={styles.tile}>
                <Text style={[styles.tileValue, { color: accent }]}>{value}</Text>
                <Text style={styles.tileLabel}>{label}</Text>
              </View>
            ))}
          </View>
          {line('🁫 Dominó', `${recap.domino.wins} de ${recap.domino.played}`)}
          {line('🃏 UNO', `${recap.uno.wins} de ${recap.uno.played}`)}
          {line('♠ Póker', `${recap.poker.wins} de ${recap.poker.played}`)}
          {line('👟 Zapatos dados', String(recap.domino.zapatos))}
          {line('🔥 Mejor racha', recap.bestStreak ? `${recap.bestStreak} seguidas` : '—')}
          {line('🤝 Mejor pareja', recap.bestPartner ? `${recap.bestPartner.name} (${recap.bestPartner.count})` : '—')}
          {line('😤 Rival más duro', recap.toughestRival ? `${recap.toughestRival.name} (${recap.toughestRival.count})` : '—')}
          {line('🎯 Tu víctima favorita', recap.favoriteVictim ? `${recap.favoriteVictim.name} (${recap.favoriteVictim.count})` : '—')}
          <TouchableOpacity style={[styles.share, { backgroundColor: accent }]} onPress={share} disabled={sharing} accessibilityRole="button">
            {sharing ? <ActivityIndicator color="#1a1405" /> : <Text style={styles.shareText}>📤 Compartir mi mes</Text>}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: theme.borderRadius.l, padding: theme.spacing.m, marginTop: theme.spacing.m, backgroundColor: 'rgba(251,191,36,0.05)' },
  kicker: { fontSize: 13, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: theme.spacing.s, justifyContent: 'center', marginTop: theme.spacing.s, flexWrap: 'wrap' },
  tab: { minHeight: 40, justifyContent: 'center', paddingHorizontal: theme.spacing.m, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.cardBorder },
  tabText: { color: theme.colors.text, fontWeight: '700', fontSize: 14 },
  tabTextOn: { color: '#1a1405' },
  empty: { color: theme.colors.textDim, textAlign: 'center', marginVertical: theme.spacing.l, fontSize: 15 },
  tiles: { flexDirection: 'row', gap: theme.spacing.s, marginTop: theme.spacing.m },
  tile: { flex: 1, minWidth: 0, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: theme.borderRadius.m, paddingVertical: theme.spacing.s, alignItems: 'center' },
  tileValue: { fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'] },
  tileLabel: { color: theme.colors.textDim, fontSize: 12, fontWeight: '700' },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)', gap: theme.spacing.s },
  lineLeft: { color: theme.colors.textDim, fontSize: 14, fontWeight: '600' },
  lineRight: { color: theme.colors.text, fontSize: 14, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  share: { minHeight: 48, borderRadius: theme.borderRadius.m, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.m },
  shareText: { color: '#1a1405', fontSize: 16, fontWeight: '900' },
});

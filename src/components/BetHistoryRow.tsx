import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { matchTeamLabel } from '../lib/matchRivals';
import { betOutcome, BetOutcomeKind, HistoryBet, HistoryMatch } from '../lib/playerHistory';
import { MatchGraph } from './MatchGraph';

interface Props {
  bet: HistoryBet & { bet_on_team: number; created_at: string };
  match?: HistoryMatch;
  own: boolean;
  expanded: boolean;
  onToggle: () => void;
}

const OUTCOME_STYLE: Record<BetOutcomeKind, { color: string; emoji: string }> = {
  won: { color: theme.colors.success, emoji: ' 🤑' },
  lost: { color: theme.colors.danger, emoji: ' 💸' },
  refunded: { color: '#60a5fa', emoji: '' },
  pending: { color: theme.colors.textDim, emoji: ' ⏳' },
};

const scoreText = (match: HistoryMatch, team: number) => {
  const [mine, other] = team === 1
    ? [match.team1_total, match.team2_total]
    : [match.team2_total, match.team1_total];
  if (match.winner_team) return `${mine} a ${other}`;
  return `${mine} a ${other} (${match.status === 'active' ? 'en juego' : 'anulada'})`;
};

/** One bet. Tapping it shows the match it was placed on and how it ended. */
export const BetHistoryRow: React.FC<Props> = ({ bet, match, own, expanded, onToggle }) => {
  const outcome = betOutcome(bet);
  const { color, emoji } = OUTCOME_STYLE[outcome.kind];
  const multiplier = `x${Number(outcome.multiplier.toFixed(2))}`;
  const team = bet.bet_on_team;
  const teamName = matchTeamLabel(match ?? {}, team);
  const date = new Date(match?.created_at ?? bet.created_at).toLocaleDateString();

  const facts = [
    { label: 'Partida del', value: date },
    { label: own ? 'Apostaste por' : 'Apostó por', value: teamName },
    ...(match
      ? [
          { label: 'Contra', value: matchTeamLabel(match, team === 1 ? 2 : 1) },
          { label: 'Marcador', value: scoreText(match, team) },
        ]
      : []),
    { label: 'Puntos apostados', value: `${bet.amount_wagered} pts` },
    { label: 'Multiplicador', value: multiplier },
  ];

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={styles.dice}>🎲</Text>
        <View style={styles.info}>
          <Text style={styles.amount}>Apuesta: {bet.amount_wagered} pts ({multiplier})</Text>
          <Text style={styles.team} numberOfLines={1}>Por {teamName}</Text>
        </View>
        <View style={[styles.badge, { borderColor: color }]}>
          <Text style={[styles.badgeText, { color }]}>{outcome.text}{emoji}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.details}>
          {facts.map((fact) => (
            <View key={fact.label} style={styles.fact}>
              <Text style={styles.factLabel}>{fact.label}</Text>
              <Text style={styles.factValue}>{fact.value}</Text>
            </View>
          ))}
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Resultado</Text>
            <Text style={[styles.factValue, { color }]}>{outcome.text}</Text>
          </View>
          {!match && <Text style={styles.missing}>No se pudo cargar esta partida.</Text>}
          {!!match?.rounds?.length && (
            <MatchGraph
              rounds={match.rounds}
              limitScore={match.limit_score || 0}
              team1Name={matchTeamLabel(match, 1)}
              team2Name={matchTeamLabel(match, 2)}
            />
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.m, paddingVertical: theme.spacing.m },
  dice: { fontSize: 13, width: 24, textAlign: 'center' },
  info: { flex: 1, minWidth: 0 },
  amount: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  team: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  badge: { borderWidth: 1, borderRadius: theme.borderRadius.full, paddingHorizontal: theme.spacing.m, paddingVertical: 4, flexShrink: 1 },
  badgeText: { fontSize: 13, fontWeight: '900', textAlign: 'center' },
  details: { paddingBottom: theme.spacing.m },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.m, paddingVertical: 6 },
  factLabel: { color: theme.colors.textDim, fontSize: 13 },
  factValue: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 13, fontWeight: '700', textAlign: 'right' },
  missing: { color: theme.colors.textDim, fontSize: 13, marginTop: theme.spacing.xs },
});

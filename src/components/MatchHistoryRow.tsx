import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { matchTeamLabel } from '../lib/matchRivals';
import { HistoryMatch, partnerNames, sidesOf, wonMatch } from '../lib/playerHistory';
import { MatchGraph } from './MatchGraph';

interface Props {
  match: HistoryMatch;
  playerId: string;
  expanded: boolean;
  onToggle: () => void;
}

/** One domino match seen from a player. Tapping it opens the round-by-round graph. */
export const MatchHistoryRow: React.FC<Props> = ({ match, playerId, expanded, onToggle }) => {
  const { rivalTeam, myScore, rivalScore } = sidesOf(match, playerId);
  const voided = !match.winner_team;
  const won = wonMatch(match, playerId);
  const color = voided ? theme.colors.textDim : won ? theme.colors.success : theme.colors.danger;
  const partner = partnerNames(match, playerId);
  const details = [
    new Date(match.created_at).toLocaleDateString(),
    partner && `con ${partner}`,
    match.is_zapato && '👟',
    voided && '(Anulada)',
  ].filter(Boolean).join(' · ');

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={[styles.badge, { backgroundColor: color }]}>
          <Text style={styles.badgeText}>{voided ? '-' : won ? 'W' : 'L'}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.rivals}>vs {matchTeamLabel(match, rivalTeam)}</Text>
          <Text style={styles.details}>{details}</Text>
        </View>
        <Text style={[styles.score, { color }]}>{myScore} - {rivalScore}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.graph}>
          <Text style={styles.graphTitle}>El VAR del Dominó (Puntos por Ronda)</Text>
          <MatchGraph
            rounds={match.rounds || []}
            limitScore={match.limit_score || 0}
            team1Name={matchTeamLabel(match, 1)}
            team2Name={matchTeamLabel(match, 2)}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.m, paddingVertical: theme.spacing.m },
  badge: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  info: { flex: 1, minWidth: 0 },
  rivals: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  details: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  score: { fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  graph: { paddingBottom: theme.spacing.m },
  graphTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '800', marginTop: theme.spacing.s, marginBottom: theme.spacing.xs },
});

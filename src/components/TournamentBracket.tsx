import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import {
  BracketMatchInfo,
  BracketRow,
  BracketState,
  bracketScore,
  bracketState,
  canDecide,
  champions,
  roundLabel,
  STATE_TEXT,
  teamLabel,
} from '../lib/tournamentBracket';

const STATE_COLOR: Record<BracketState, string> = {
  bye: theme.colors.textDim,
  waiting: theme.colors.textDim,
  not_started: theme.colors.textDim,
  playing: theme.colors.primary,
  to_confirm: theme.colors.warning,
  done: theme.colors.success,
  stuck: theme.colors.danger,
};

interface Props {
  rows: BracketRow[];
  matches: Record<string, BracketMatchInfo>;
  isAdmin?: boolean;
  onPress?: (row: BracketRow) => void;
  onDecide?: (row: BracketRow, team: 1 | 2) => void;
}

/** The bracket of a tournament: rounds side by side, names, scores and where each match stands. */
export const TournamentBracket: React.FC<Props> = ({ rows, matches, isAdmin, onPress, onDecide }) => {
  if (!rows.length) {
    return <Text style={styles.empty}>Las llaves aparecen cuando el torneo empieza.</Text>;
  }
  const rounds = [...new Set(rows.map((r) => r.round_number))].sort((a, b) => a - b);
  const lastRound = rounds[rounds.length - 1];
  const champs = champions(rows);

  return (
    <View>
      {champs && (
        <View style={styles.champs} accessibilityRole="header">
          <Text style={styles.champsCup}>🏆</Text>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.champsLabel}>Campeones</Text>
            <Text style={styles.champsNames}>{champs}</Text>
          </View>
        </View>
      )}
      {rounds.length > 1 && <Text style={styles.hint}>Desliza de lado para ver todas las rondas →</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.roundsRow}>
        {rounds.map((round) => {
          const inRound = rows.filter((r) => r.round_number === round).sort((a, b) => a.match_number - b.match_number);
          return (
            <View key={round} style={styles.roundCol}>
              <Text style={styles.roundTitle}>{roundLabel(round, inRound.length, round === lastRound)}</Text>
              <View style={styles.roundCards}>
                {inRound.map((row) => {
                  const m = row.live_match_id ? matches[row.live_match_id] : undefined;
                  const state = bracketState(row, m);
                  const score = bracketScore(m);
                  const isFinal = round === lastRound && inRound.length === 1;
                  return (
                    <View key={row.id} style={[styles.card, state === 'done' && styles.cardDone, state === 'stuck' && styles.cardStuck]}>
                      <TouchableOpacity onPress={() => onPress?.(row)} disabled={!onPress || state === 'bye'} accessibilityRole="button" accessibilityLabel={`${teamLabel(row, 1) || ''} contra ${teamLabel(row, 2) || 'pase directo'}`}>
                        <Text style={[styles.state, { color: STATE_COLOR[state] }]}>{STATE_TEXT[state]}</Text>
                        {([1, 2] as const).map((team) => {
                          const label = teamLabel(row, team);
                          const won = row.winner_team === team;
                          return (
                            <View key={team} style={[styles.teamRow, team === 1 && styles.teamRowTop]}>
                              <Text numberOfLines={1} style={[styles.teamName, won && styles.teamWon, !label && styles.teamEmpty]}>
                                {won && isFinal ? '🏆 ' : ''}
                                {label || (state === 'bye' ? '—' : 'Por definir')}
                              </Text>
                              {score && label ? (
                                <Text style={[styles.score, won && styles.teamWon]}>{score[team - 1]}</Text>
                              ) : null}
                            </View>
                          );
                        })}
                        {(state === 'playing' || state === 'not_started') && row.live_match_id ? (
                          <Text style={styles.watch}>Toca para ver en vivo</Text>
                        ) : null}
                      </TouchableOpacity>
                      {isAdmin && onDecide && canDecide(row, m) && (
                        <View style={styles.decide}>
                          <Text style={styles.decideLabel}>Admin: ¿quién ganó?</Text>
                          <View style={styles.decideRow}>
                            {([1, 2] as const).map((team) => (
                              <TouchableOpacity key={team} style={styles.decideBtn} onPress={() => onDecide(row, team)} accessibilityRole="button" accessibilityLabel={`Dar la victoria a ${teamLabel(row, team)}`}>
                                <Text numberOfLines={1} style={styles.decideBtnText}>{teamLabel(row, team)}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  empty: { color: theme.colors.textDim, textAlign: 'center', paddingVertical: 16 },
  champs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: theme.colors.warning,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
  },
  champsCup: { fontSize: 28 },
  champsLabel: { color: theme.colors.warning, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  champsNames: { color: theme.colors.text, fontSize: 17, fontWeight: '900' },
  hint: { color: theme.colors.textDim, fontSize: 11, textAlign: 'center', marginBottom: 4 },
  roundsRow: { paddingVertical: 8, paddingHorizontal: 4, gap: 14 },
  roundCol: { width: 184 },
  roundTitle: { color: theme.colors.primary, textAlign: 'center', fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  roundCards: { flex: 1, justifyContent: 'space-around', gap: 12 },
  card: {
    backgroundColor: theme.colors.sheet,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: 10,
  },
  cardDone: { borderColor: 'rgba(16, 185, 129, 0.5)' },
  cardStuck: { borderColor: 'rgba(239, 68, 68, 0.6)' },
  state: { fontSize: 11, fontWeight: '800', marginBottom: 6 },
  teamRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5, gap: 8 },
  teamRowTop: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  teamName: { color: theme.colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  teamWon: { color: theme.colors.success, fontWeight: '900' },
  teamEmpty: { color: theme.colors.textDim, fontStyle: 'italic' },
  score: { color: theme.colors.text, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  watch: { color: theme.colors.primary, fontSize: 11, marginTop: 4 },
  decide: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(245, 158, 11, 0.3)' },
  decideLabel: { color: theme.colors.warning, fontSize: 11, fontWeight: '800', marginBottom: 6 },
  decideRow: { flexDirection: 'row', gap: 6 },
  decideBtn: { flex: 1, backgroundColor: 'rgba(245, 158, 11, 0.15)', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center' },
  decideBtnText: { color: theme.colors.warning, fontSize: 11, fontWeight: '800' },
});

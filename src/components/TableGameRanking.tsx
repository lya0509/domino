import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { TableGameKind } from '../lib/tableGames';
import { fetchTableGameRanking, RankingRow } from '../lib/tableGameService';

interface Props {
  game: TableGameKind;
  from: string | null;
  currentUserProfileId: string | null;
  medal: (index: number) => string;
  onOpenProfile: (profileId: string) => void;
}

/** One ranking per variant, counted by the server from confirmed games. */
export const TableGameRanking: React.FC<Props> = ({ game, from, currentUserProfileId, medal, onOpenProfile }) => {
  const [rows, setRows] = useState<RankingRow[] | null>(null);

  useEffect(() => {
    let active = true;
    setRows(null);
    fetchTableGameRanking(game, from).then((data) => {
      if (active) setRows(data);
    });
    return () => {
      active = false;
    };
  }, [game, from]);

  if (rows === null) return <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />;
  if (rows.length === 0) return <Text style={styles.empty}>No hay partidas en este período.</Text>;

  return (
    <>
      {rows.map((row, i) => (
        <TouchableOpacity
          key={row.user_id}
          style={[styles.row, row.user_id === currentUserProfileId && styles.rowMe]}
          onPress={() => onOpenProfile(row.user_id)}
          accessibilityRole="button"
        >
          <Text style={styles.medal}>{medal(i)}</Text>
          <View style={styles.info}>
            <Text style={styles.name}>{row.display_name}</Text>
            <Text style={styles.detail}>{row.wins} {row.wins === 1 ? 'victoria' : 'victorias'} de {row.played}</Text>
          </View>
          <Text style={styles.wins}>{row.wins}</Text>
        </TouchableOpacity>
      ))}
    </>
  );
};

const styles = StyleSheet.create({
  spinner: { marginVertical: theme.spacing.m },
  empty: { color: theme.colors.textDim, textAlign: 'center', paddingVertical: theme.spacing.m },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: theme.spacing.s,
    paddingHorizontal: theme.spacing.s,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.cardBorder,
  },
  rowMe: { backgroundColor: 'rgba(59,130,246,0.12)', borderRadius: theme.borderRadius.s },
  medal: { fontSize: 18, width: 36, textAlign: 'center', color: theme.colors.text },
  info: { flex: 1, minWidth: 0 },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  detail: { color: theme.colors.textDim, fontSize: 13 },
  wins: { color: theme.colors.accent, fontSize: 18, fontWeight: '900' },
});

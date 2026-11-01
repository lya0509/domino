import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { playerNames, TableGame, tableGameLabel } from '../lib/tableGames';
import { fetchTableGames } from '../lib/tableGameService';

const REFRESH_MS = 15000;

interface Props {
  currentUserProfileId: string | null;
  onOpen: (gameId: string) => void;
}

/** Home's list of table games being played right now. Shows nothing when there are none. */
export const LiveTableGames: React.FC<Props> = ({ currentUserProfileId, onOpen }) => {
  const [games, setGames] = useState<TableGame[]>([]);

  const load = useCallback(async () => {
    setGames(await fetchTableGames('active'));
  }, []);

  useEffect(() => {
    if (!currentUserProfileId) return;
    load();
    const channel = supabase
      .channel(`live-table-games-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_games' }, load)
      .subscribe();
    // Realtime can drop on a phone that went to sleep
    const refresh = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(refresh);
      supabase.removeChannel(channel);
    };
  }, [currentUserProfileId, load]);

  if (games.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🃏 Jugando ahora</Text>
      {games.map((g) => (
        <TouchableOpacity key={g.id} style={styles.card} onPress={() => onOpen(g.id)} accessibilityRole="button">
          <Text style={styles.game}>{tableGameLabel(g.game)}</Text>
          <Text style={styles.players} numberOfLines={2}>{playerNames(g)}</Text>
          <Text style={styles.watch}>Ver en vivo →</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(139,92,246,0.1)',
    borderColor: theme.colors.secondary,
    borderWidth: 1,
    borderRadius: theme.borderRadius.m,
    padding: theme.spacing.m,
    marginBottom: theme.spacing.m,
  },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: '800', marginBottom: theme.spacing.s },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.s,
    padding: theme.spacing.m,
    marginTop: theme.spacing.xs,
  },
  game: { color: '#c4b5fd', fontSize: 15, fontWeight: '800' },
  players: { color: theme.colors.text, fontSize: 14, marginTop: 2 },
  watch: { color: theme.colors.textDim, fontSize: 13, marginTop: theme.spacing.xs, textAlign: 'right' },
});

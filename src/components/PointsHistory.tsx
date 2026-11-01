import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';

interface Movement {
  id: string;
  delta: number;
  balance: number;
  reason: string;
  created_at: string;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The last point movements of the signed-in user. Only they and admins can read them. */
export const PointsHistory: React.FC<{ profileId: string }> = ({ profileId }) => {
  const [movements, setMovements] = useState<Movement[]>([]);

  useEffect(() => {
    let active = true;
    supabase
      .from('points_ledger')
      .select('id, delta, balance, reason, created_at')
      .eq('user_id', profileId)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (active) setMovements((data || []) as Movement[]);
      });
    return () => {
      active = false;
    };
  }, [profileId]);

  // The table doesn't exist until the migration runs: nothing to show yet
  if (movements.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>🧾 Historial de Puntos</Text>
      {movements.map((m) => {
        const delta = Number(m.delta);
        return (
          <View key={m.id} style={styles.row}>
            <View style={styles.info}>
              <Text style={styles.reason}>{m.reason}</Text>
              <Text style={styles.date}>{formatDate(m.created_at)}</Text>
            </View>
            <View style={styles.amounts}>
              <Text style={[styles.delta, { color: delta < 0 ? theme.colors.danger : theme.colors.success }]}>
                {delta > 0 ? '+' : ''}{delta.toLocaleString('es-VE')}
              </Text>
              <Text style={styles.balance}>Saldo {Number(m.balance).toLocaleString('es-VE')}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.cardBorder,
    borderWidth: 1,
    borderRadius: theme.borderRadius.m,
    padding: theme.spacing.m,
    marginBottom: theme.spacing.m,
  },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: theme.spacing.s },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.s,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
  },
  info: { flex: 1, paddingRight: theme.spacing.s },
  reason: { color: theme.colors.text, fontSize: 14 },
  date: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  amounts: { alignItems: 'flex-end' },
  delta: { fontSize: 15, fontWeight: 'bold' },
  balance: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
});

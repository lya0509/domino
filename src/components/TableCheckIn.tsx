import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { missingCheckIn, TableGame } from '../lib/tableGames';

interface Props {
  game: TableGame;
  userId: string | null;
  isAdmin: boolean;
  busy: boolean;
  /** What waits for everyone: the first hand in poker, the result in UNO. */
  waitsFor: string;
  accent: string;
  onCheckIn: () => void;
  onMakeGuest: (seat: number, name: string) => void;
}

/**
 * Everyone with an account confirms from their own phone that they are at the table.
 * Nobody can fill a table with absent friends to win their points.
 */
export const TableCheckIn: React.FC<Props> = ({ game, userId, isAdmin, busy, waitsFor, accent, onCheckIn, onMakeGuest }) => {
  const missing = missingCheckIn(game);
  if (missing.length === 0) return null;
  const mine = missing.some((p) => p.user_id === userId);
  const canTurnIntoGuest = !!userId && (game.created_by === userId || isAdmin);

  const askGuest = (seat: number, name: string) =>
    Alert.alert(
      `¿Pasar a ${name} a invitado?`,
      `Sigue en la partida con su nombre, pero sin su cuenta: no suma ranking ni premio. Úsalo si no tiene el teléfono a mano.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Pasar a invitado', onPress: () => onMakeGuest(seat, name) },
      ]
    );

  return (
    <View style={[styles.box, { borderColor: accent }]}>
      <Text style={styles.title}>¿Están todos en la mesa?</Text>
      <Text style={styles.detail}>
        Cada jugador con cuenta lo confirma en su teléfono. Hasta entonces no se puede {waitsFor}.
      </Text>
      {mine && (
        <TouchableOpacity style={[styles.primary, { backgroundColor: accent }]} onPress={onCheckIn} disabled={busy} accessibilityRole="button">
          <Text style={styles.primaryText}>✋ Estoy en la mesa</Text>
        </TouchableOpacity>
      )}
      {missing.map((p) => (
        <View key={p.seat} style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
          {p.user_id === userId ? (
            <Text style={styles.waiting}>Falta tu confirmación</Text>
          ) : canTurnIntoGuest ? (
            <TouchableOpacity onPress={() => askGuest(p.seat, p.name)} disabled={busy} style={styles.guestBtn} accessibilityRole="button">
              <Text style={styles.guestText}>Pasar a invitado</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.waiting}>Esperando…</Text>
          )}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    borderWidth: 2,
    borderRadius: theme.borderRadius.m,
    padding: theme.spacing.m,
    marginTop: theme.spacing.m,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  detail: { color: theme.colors.textDim, fontSize: 14, textAlign: 'center', marginTop: theme.spacing.xs },
  primary: { minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: theme.borderRadius.m, marginTop: theme.spacing.m },
  primaryText: { color: '#1a1405', fontSize: 19, fontWeight: '900' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
    marginTop: theme.spacing.s,
  },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '700', flex: 1, minWidth: 0 },
  waiting: { color: theme.colors.textDim, fontSize: 14, fontStyle: 'italic' },
  guestBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.s },
  guestText: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
});

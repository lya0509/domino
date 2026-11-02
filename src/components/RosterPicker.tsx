import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { Profile } from '../types';
import { MAX_PLAYERS, RosterEntry } from '../lib/tableGames';
import { PlayerAvatar, PlayerChip } from './PlayerChip';

interface Props {
  roster: RosterEntry[];
  onChange: (roster: RosterEntry[]) => void;
  profiles: Profile[];
  /** The order matters: poker seats follow it around the table. */
  ordered?: boolean;
}

/** Choose who plays, with or without an account. */
export const RosterPicker: React.FC<Props> = ({ roster, onChange, profiles, ordered = false }) => {
  const [search, setSearch] = useState('');
  const [guestName, setGuestName] = useState('');

  const registered = useMemo(() => {
    const text = search.trim().toLowerCase();
    return profiles
      .filter((p) => !text || p.display_name?.toLowerCase().includes(text))
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
  }, [profiles, search]);

  const add = (entry: RosterEntry) => {
    if (roster.length >= MAX_PLAYERS) {
      Alert.alert('Mesa llena', `Una partida admite hasta ${MAX_PLAYERS} jugadores.`);
      return;
    }
    onChange([...roster, entry]);
    setSearch('');
  };

  const toggle = (profile: Profile) => {
    const index = roster.findIndex((r) => r.user_id === profile.id);
    if (index >= 0) onChange(roster.filter((_, i) => i !== index));
    else add({ user_id: profile.id, name: profile.display_name });
  };

  const addGuest = () => {
    const name = guestName.trim();
    if (!name) return;
    add({ name });
    setGuestName('');
  };

  const move = (index: number, step: number) => {
    const next = [...roster];
    const [player] = next.splice(index, 1);
    next.splice(index + step, 0, player);
    onChange(next);
  };

  return (
    <>
      <Text style={styles.title}>Jugadores ({roster.length}/{MAX_PLAYERS})</Text>
      {ordered && (
        <Text style={styles.hint}>Ponlos en el orden en que están sentados: el juego sigue esta lista, de arriba hacia abajo.</Text>
      )}
      {roster.map((p, i) => (
        <View key={`${p.user_id ?? p.name}-${i}`} style={styles.row}>
          <PlayerAvatar person={profiles.find((x) => x.id === p.user_id) ?? { initials: p.name.slice(0, 2).toUpperCase() }} selected />
          <Text style={styles.name} numberOfLines={1}>{p.name}{p.user_id ? '' : ' (sin cuenta)'}</Text>
          {ordered && (
            <>
              <TouchableOpacity
                onPress={() => move(i, -1)}
                disabled={i === 0}
                style={[styles.iconBtn, i === 0 && styles.disabled]}
                accessibilityRole="button"
                accessibilityLabel={`Subir a ${p.name}`}
              >
                <Text style={styles.moveText}>↑</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => move(i, 1)}
                disabled={i === roster.length - 1}
                style={[styles.iconBtn, i === roster.length - 1 && styles.disabled]}
                accessibilityRole="button"
                accessibilityLabel={`Bajar a ${p.name}`}
              >
                <Text style={styles.moveText}>↓</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity
            onPress={() => onChange(roster.filter((_, index) => index !== i))}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel={`Quitar a ${p.name}`}
          >
            <Text style={styles.removeText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Buscar jugador…"
        placeholderTextColor={theme.colors.textDim}
        accessibilityLabel="Buscar jugador"
      />
      <Text style={styles.registeredTitle}>Jugadores Registrados</Text>
      <View style={styles.chips}>
        {registered.map((p) => (
          <PlayerChip key={p.id} person={p} selected={roster.some((r) => r.user_id === p.id)} onPress={() => toggle(p)} />
        ))}
        {registered.length === 0 && <Text style={styles.hint}>Nadie con ese nombre.</Text>}
      </View>

      <View style={styles.guestRow}>
        <TextInput
          style={[styles.input, styles.guestInput]}
          value={guestName}
          onChangeText={setGuestName}
          onSubmitEditing={addGuest}
          maxLength={30}
          placeholder="Jugador sin cuenta"
          placeholderTextColor={theme.colors.textDim}
          accessibilityLabel="Nombre de quien no tiene cuenta"
        />
        <TouchableOpacity style={styles.guestBtn} onPress={addGuest} accessibilityRole="button">
          <Text style={styles.guestBtnText}>Agregar</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>Quien juega sin cuenta no entra en el ranking ni recibe premio.</Text>
    </>
  );
};

const styles = StyleSheet.create({
  title: { color: theme.colors.text, fontSize: 17, fontWeight: '800', marginTop: theme.spacing.l, marginBottom: theme.spacing.s },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.s,
    paddingLeft: theme.spacing.s,
    gap: theme.spacing.s,
    marginBottom: theme.spacing.xs,
  },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '600', flex: 1, minWidth: 0 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.25 },
  moveText: { color: theme.colors.text, fontSize: 18, fontWeight: 'bold' },
  removeText: { color: theme.colors.danger, fontSize: 16, fontWeight: 'bold' },
  input: {
    minHeight: 44,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s,
    color: theme.colors.text,
    paddingHorizontal: theme.spacing.m,
    fontSize: 16,
    marginTop: theme.spacing.s,
    marginBottom: theme.spacing.s,
  },
  registeredTitle: { color: theme.colors.textDim, fontSize: 13, fontWeight: '700', marginTop: theme.spacing.xs, marginBottom: theme.spacing.s },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.s, marginBottom: theme.spacing.m },
  guestRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.s },
  guestInput: { flex: 1, minWidth: 0 },
  guestBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.m,
    borderRadius: theme.borderRadius.s,
    backgroundColor: theme.colors.secondary,
  },
  guestBtnText: { color: '#fff', fontWeight: 'bold' },
  hint: { color: theme.colors.textDim, fontSize: 13, marginBottom: theme.spacing.xs },
});

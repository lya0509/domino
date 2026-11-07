import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { normalizeGuestName, suggestGuests } from '../lib/guests';
import { fetchClubGuests } from '../lib/tableGameService';

// One read per app session is enough: the list only grows when a game starts
let cached: string[] | null = null;
let loading: Promise<string[]> | null = null;
export const loadClubGuests = (fresh = false): Promise<string[]> => {
  if (cached && !fresh) return Promise.resolve(cached);
  if (!loading || fresh) {
    loading = fetchClubGuests().then((names) => {
      cached = names;
      loading = null;
      return names;
    });
  }
  return loading;
};

interface Props {
  /** Called with the cleaned name when the person taps Agregar or a suggestion. */
  onAdd: (name: string) => void;
  /** Names already at the table: never suggested again. */
  chosen?: string[];
  placeholder?: string;
  buttonText?: string;
  accentColor?: string;
}

/** Write a guest's name; the club's guest list suggests the ones already used. */
export const GuestNameInput: React.FC<Props> = ({ onAdd, chosen = [], placeholder = 'Nombre del invitado', buttonText = 'Agregar', accentColor = theme.colors.primary }) => {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [all, setAll] = useState<string[]>(cached ?? []);

  useEffect(() => {
    let alive = true;
    loadClubGuests().then((names) => alive && setAll(names));
    return () => {
      alive = false;
    };
  }, []);

  const suggestions = useMemo(
    () => (focused || text ? suggestGuests(all, text, chosen, 5) : []),
    [all, text, chosen, focused]
  );

  const add = (name: string) => {
    const clean = normalizeGuestName(name);
    if (!clean) return;
    onAdd(clean.slice(0, 30));
    setText('');
    if (!all.some((n) => n.toLowerCase() === clean.toLowerCase())) setAll([clean, ...all]);
  };

  return (
    <View>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          onSubmitEditing={() => add(text)}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textDim}
          maxLength={30}
          accessibilityLabel={placeholder}
        />
        <TouchableOpacity style={[styles.btn, { backgroundColor: accentColor }]} onPress={() => add(text)} accessibilityRole="button">
          <Text style={styles.btnText}>{buttonText}</Text>
        </TouchableOpacity>
      </View>
      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((name) => (
            <TouchableOpacity key={name} style={styles.suggestion} onPress={() => add(name)} accessibilityRole="button" accessibilityLabel={`Agregar a ${name}`}>
              <Text style={styles.suggestionText}>+ {name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.s },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s,
    color: theme.colors.text,
    fontSize: 16,
    paddingHorizontal: theme.spacing.m,
  },
  btn: { minHeight: 48, justifyContent: 'center', paddingHorizontal: theme.spacing.m, borderRadius: theme.borderRadius.s },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, marginTop: theme.spacing.xs },
  suggestion: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.m,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  suggestionText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
});

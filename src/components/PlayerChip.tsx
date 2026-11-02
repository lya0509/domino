import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';

interface Person {
  avatar_url?: string | null;
  initials?: string | null;
  display_name?: string | null;
}

export const PlayerAvatar: React.FC<{ person: Person; selected?: boolean }> = ({ person, selected = false }) => (
  <View style={[styles.avatar, selected && styles.avatarSelected]}>
    {person.avatar_url ? (
      <Image source={{ uri: person.avatar_url }} style={styles.avatarImage} />
    ) : (
      <Text style={styles.avatarText}>{person.initials}</Text>
    )}
  </View>
);

/** A registered player, the same way in every game: photo and name. */
export const PlayerChip: React.FC<{ person: Person; selected: boolean; onPress: () => void }> = ({ person, selected, onPress }) => (
  <TouchableOpacity
    style={[styles.chip, selected && styles.chipSelected]}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected }}
  >
    <PlayerAvatar person={person} selected={selected} />
    <Text style={[styles.name, selected && styles.nameSelected]} numberOfLines={1}>
      {person.display_name}
    </Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: theme.borderRadius.full,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    gap: 8,
  },
  chipSelected: { backgroundColor: 'rgba(59,130,246,0.2)', borderColor: theme.colors.primary },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarSelected: { backgroundColor: theme.colors.primary },
  avatarImage: { width: '100%', height: '100%', borderRadius: 14 },
  avatarText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  name: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600', maxWidth: 100 },
  nameSelected: { color: theme.colors.text },
});

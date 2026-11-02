import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { HistoryMatch, matchRecord } from '../lib/playerHistory';
import { MatchHistoryRow } from './MatchHistoryRow';

interface Props {
  title: string;
  matches: HistoryMatch[];
  playerId: string;
  onClose: () => void;
}

/** Every match against a rival or next to a duo partner, with the record on top. */
export const PlayerMatchesSheet: React.FC<Props> = ({ title, matches, playerId, onClose }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { won, lost } = matchRecord(matches, playerId);

  const cells = [
    { label: 'Ganadas', value: won, color: theme.colors.success },
    { label: 'Perdidas', value: lost, color: theme.colors.danger },
    { label: 'Partidas', value: matches.length, color: theme.colors.text },
  ];

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar">
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.record}>
            {cells.map((cell) => (
              <View key={cell.label} style={styles.cell}>
                <Text style={[styles.cellValue, { color: cell.color }]}>{cell.value}</Text>
                <Text style={styles.cellLabel}>{cell.label}</Text>
              </View>
            ))}
          </View>

          <ScrollView style={styles.list}>
            {matches.length === 0 && <Text style={styles.empty}>Todavía no hay partidas.</Text>}
            {matches.map((m) => (
              <MatchHistoryRow
                key={m.id}
                match={m}
                playerId={playerId}
                expanded={expanded === m.id}
                onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.sheet,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '85%',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.s },
  title: { flex: 1, minWidth: 0, color: theme.colors.text, fontSize: 18, fontWeight: '800' },
  closeBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  close: { color: theme.colors.textDim, fontSize: 22 },
  record: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 8 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  cellValue: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  cellLabel: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600' },
  list: { flexGrow: 0 },
  empty: { color: theme.colors.textDim, textAlign: 'center', paddingVertical: theme.spacing.l },
});

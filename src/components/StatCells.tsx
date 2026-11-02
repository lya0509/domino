import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import { StatCell, StatTone } from '../lib/gameStatsCore';

const TONE: Record<StatTone, string> = {
  win: theme.colors.success,
  loss: theme.colors.danger,
  accent: theme.colors.accent,
  plain: theme.colors.text,
};

/** Four numbers in a row, the same in the home card and the profile. */
export const StatCells: React.FC<{ cells: StatCell[]; colored?: boolean }> = ({ cells, colored = true }) => (
  <View style={styles.grid}>
    {cells.map((c) => (
      <View key={c.label} style={styles.cell}>
        <Text
          style={[styles.value, { color: colored ? TONE[c.tone] : theme.colors.text }, c.value.length > 6 && styles.valueSmall]}
          numberOfLines={2}
        >
          {c.value}
        </Text>
        <Text style={styles.label} numberOfLines={1}>{c.label}</Text>
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', justifyContent: 'space-around', width: '100%' },
  cell: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  value: { fontSize: 24, fontWeight: '900', textAlign: 'center' },
  valueSmall: { fontSize: 14, lineHeight: 18 },
  label: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
});

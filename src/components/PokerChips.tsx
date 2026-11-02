import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const CHIP_COLORS = ['#2467b8', '#c8372d', '#d9822b', '#24242a', '#6b3fa0'];
const MAX_DISCS = 9;

export const chipColor = (index: number) => CHIP_COLORS[index % CHIP_COLORS.length];

export const PokerChip: React.FC<{ value: number; color: string }> = ({ value, color }) => (
  <View style={[styles.chip, { backgroundColor: color }]}>
    <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
  </View>
);

export const ChipTower: React.FC<{ count: number; color: string }> = ({ count, color }) => (
  <View style={styles.tower}>
    {Array.from({ length: Math.min(count, MAX_DISCS) }, (_, i) => (
      <View key={i} style={[styles.disc, { backgroundColor: color }]} />
    ))}
  </View>
);

const styles = StyleSheet.create({
  chip: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 4,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { color: '#fff', fontSize: 17, fontWeight: '900' },
  tower: { flexDirection: 'column-reverse', alignItems: 'center', minHeight: 12 },
  disc: {
    width: 44,
    height: 12,
    borderRadius: 22,
    marginTop: -7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
});

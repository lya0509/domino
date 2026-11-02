import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { sounds } from '../lib/sounds';
import { betChips, chipValues, foldPlayer, PokerHand, rackOf, stackLeft, trayAction } from '../lib/poker';
import { ChipTower, chipColor, PokerChip } from './PokerChips';
import { POKER_WOOD } from './PokerTable';

interface Props {
  hand: PokerHand;
  seat: number;
  chips: Record<string, number>;
  entry: number;
  busy: boolean;
  onAct: (next: PokerHand) => void;
}

/** The player's own chips: tap them to bet, the way you would push them across the table. */
export const PokerTray: React.FC<Props> = ({ hand, seat, chips, entry, busy, onAct }) => {
  const [bet, setBet] = useState(0);

  const stack = stackLeft(hand, seat, chips);

  useEffect(() => {
    // Someone may have corrected this seat from another phone
    setBet((current) => Math.min(current, stack));
  }, [stack]);

  const values = chipValues(entry);
  const left = stack - bet;
  const rack = rackOf(left, values);
  const action = trayAction(hand, seat, chips, bet);

  const addChip = (value: number) => {
    sounds.playSound('pop');
    setBet((current) => current + value);
  };

  const confirm = () => {
    sounds.playSound('chaching');
    onAct(betChips(hand, seat, action.amount, chips));
    setBet(0);
  };

  const fold = () => {
    Alert.alert('¿Retirarte de esta mano?', 'Lo que ya pusiste queda en el pozo.', [
      { text: 'Seguir', style: 'cancel' },
      { text: 'Retirarme', style: 'destructive', onPress: () => onAct(foldPlayer(hand, seat)) },
    ]);
  };

  return (
    <View style={styles.tray}>
      <View style={styles.head}>
        <Text style={styles.headLabel}>Tus fichas</Text>
        <Text style={styles.headValue}>{left}</Text>
      </View>

      <View style={styles.towers}>
        {values.map((value, index) => (
          <TouchableOpacity
            key={value}
            style={[styles.towerBtn, value > left && styles.off]}
            disabled={value > left || busy}
            onPress={() => addChip(value)}
            accessibilityRole="button"
            accessibilityLabel={`Agregar ficha de ${value}`}
          >
            <ChipTower count={rack[value]} color={chipColor(index)} />
            <PokerChip value={value} color={chipColor(index)} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.betRow}>
        <View>
          <Text style={styles.betLabel}>Vas a poner</Text>
          <Text style={styles.betValue}>{bet}</Text>
        </View>
        {bet > 0 ? (
          <TouchableOpacity style={styles.link} onPress={() => setBet(0)} accessibilityRole="button">
            <Text style={styles.linkText}>Devolver fichas</Text>
          </TouchableOpacity>
        ) : (
          stack > 0 && (
            <TouchableOpacity style={styles.link} onPress={() => setBet(stack)} accessibilityRole="button">
              <Text style={styles.linkText}>Todo adentro</Text>
            </TouchableOpacity>
          )
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.btn, styles.foldBtn]} onPress={fold} disabled={busy} accessibilityRole="button">
          <Text style={styles.foldText}>Retirarme</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.mainBtn, !action.enabled && styles.off]}
          disabled={!action.enabled || busy}
          onPress={confirm}
          accessibilityRole="button"
        >
          <Text style={styles.mainText}>{action.label}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  tray: {
    backgroundColor: POKER_WOOD,
    borderRadius: theme.borderRadius.m,
    padding: theme.spacing.s,
    marginTop: theme.spacing.s,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: theme.spacing.xs },
  headLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '600' },
  headValue: { color: theme.colors.text, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  towers: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', minHeight: 130, marginTop: theme.spacing.s },
  towerBtn: { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  off: { opacity: 0.35 },
  betRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48, paddingHorizontal: theme.spacing.xs, marginTop: theme.spacing.s },
  betLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  betValue: { color: theme.colors.text, fontSize: 24, fontWeight: '900', fontVariant: ['tabular-nums'] },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.spacing.s },
  linkText: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', gap: theme.spacing.s, marginTop: theme.spacing.xs },
  btn: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: theme.borderRadius.s, paddingHorizontal: theme.spacing.s },
  foldBtn: { flex: 1, backgroundColor: 'rgba(224,101,95,0.16)' },
  foldText: { color: '#f09a95', fontSize: 16, fontWeight: '800' },
  mainBtn: { flex: 1.7, backgroundColor: '#d4a843' },
  mainText: { color: '#1a1405', fontSize: 17, fontWeight: '800', textAlign: 'center' },
});

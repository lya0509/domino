import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { POKER_HANDS } from '../lib/poker';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const RED_SUITS = /[♥♦]/;

const Card: React.FC<{ card: string }> = ({ card }) => {
  const color = RED_SUITS.test(card) ? styles.red : styles.black;
  return (
    <View style={styles.card}>
      <Text style={[styles.rank, color]}>{card.slice(0, -1)}</Text>
      <Text style={[styles.suit, color]}>{card.slice(-1)}</Text>
    </View>
  );
};

export const PokerHelpModal: React.FC<Props> = ({ visible, onClose }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <View style={styles.sheet}>
        <Text style={styles.title}>Guía de jugadas</Text>
        <ScrollView style={styles.list}>
          <Text style={styles.section}>Cómo arranca cada mano</Text>
          <Text style={styles.rule}>
            Quien reparte cambia en cada mano, siguiendo el orden de la mesa. El siguiente pone la salida baja y el que sigue,
            la salida alta. Los demás igualan la alta, suben o se retiran.
          </Text>
          <Text style={styles.rule}>
            La primera ronda la abre quien está después de la salida alta. Las siguientes, quien está después de quien reparte.
          </Text>
          <Text style={styles.section}>Jugadas, de la más alta a la más baja</Text>
          {POKER_HANDS.map((hand) => (
            <View key={hand.key} style={styles.row} accessibilityLabel={`${hand.label}: ${hand.detail}`}>
              <Text style={styles.name}>{hand.label}</Text>
              <Text style={styles.detail}>{hand.detail}</Text>
              <View style={styles.cards}>
                {hand.cards.map((card) => (
                  <Card key={card} card={card} />
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button">
          <Text style={styles.closeText}>Cerrar</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.m,
  },
  sheet: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '94%',
    backgroundColor: '#14161c',
    borderRadius: theme.borderRadius.m,
    padding: theme.spacing.m,
  },
  title: { color: theme.colors.text, fontSize: 21, fontWeight: '900' },
  section: { color: theme.colors.text, fontSize: 16, fontWeight: '800', marginTop: theme.spacing.m },
  rule: { color: theme.colors.textDim, fontSize: 14, lineHeight: 20, marginTop: theme.spacing.xs },
  list: { flexGrow: 0 },
  row: { paddingVertical: theme.spacing.s },
  name: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  detail: { color: theme.colors.textDim, fontSize: 14, marginTop: 2 },
  cards: { flexDirection: 'row', gap: 6, marginTop: theme.spacing.s },
  card: {
    flex: 1,
    aspectRatio: 0.72,
    maxWidth: 62,
    backgroundColor: '#f7f3e8',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rank: { fontSize: 18, fontWeight: '900', lineHeight: 21 },
  suit: { fontSize: 18, lineHeight: 21 },
  red: { color: '#c0282d' },
  black: { color: '#17181c' },
  close: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: theme.spacing.xs },
  closeText: { color: theme.colors.primary, fontSize: 16, fontWeight: '700' },
});

import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Ellipse, G, RadialGradient, Stop } from 'react-native-svg';
import { chipValues, rackOf } from '../lib/poker';
import { chipColor } from './PokerChips';

const WIDTH = 340;
const HEIGHT = 158;
const CENTER = WIDTH / 2;
const FLOOR = 112;
const CHIP_X = 38;
const CHIP_Y = 15;
const CHIP_STEP = 9;
const MAX_CHIPS = 8;

// Where the stacks stand, by how many there are. Back ones first, so the front ones cover them.
const SPOTS: { x: number; y: number }[][] = [
  [],
  [{ x: 0, y: 0 }],
  [{ x: -42, y: 0 }, { x: 42, y: 0 }],
  [{ x: 0, y: -8 }, { x: -82, y: 6 }, { x: 82, y: 6 }],
  [{ x: -44, y: -6 }, { x: 44, y: -6 }, { x: -116, y: 8 }, { x: 116, y: 8 }],
  [{ x: 0, y: -12 }, { x: -84, y: -8 }, { x: 84, y: -8 }, { x: -42, y: 12 }, { x: 42, y: 12 }],
];

const Stack: React.FC<{ x: number; y: number; count: number; color: string }> = ({ x, y, count, color }) => (
  <G>
    {Array.from({ length: Math.min(count, MAX_CHIPS) }, (_, i) => {
      const top = y - i * CHIP_STEP;
      return (
        <G key={i}>
          <Ellipse cx={x} cy={top + 3} rx={CHIP_X} ry={CHIP_Y} fill={color} />
          <Ellipse cx={x} cy={top + 3} rx={CHIP_X} ry={CHIP_Y} fill="#000" fillOpacity={0.38} />
          <Ellipse cx={x} cy={top} rx={CHIP_X} ry={CHIP_Y} fill={color} />
          <Ellipse
            cx={x}
            cy={top}
            rx={CHIP_X - 1.5}
            ry={CHIP_Y - 1}
            fill="none"
            stroke="#fff"
            strokeOpacity={0.9}
            strokeWidth={3.5}
            strokeDasharray="10 12"
          />
        </G>
      );
    })}
    <Ellipse
      cx={x}
      cy={y - (Math.min(count, MAX_CHIPS) - 1) * CHIP_STEP}
      rx={CHIP_X * 0.58}
      ry={CHIP_Y * 0.58}
      fill="none"
      stroke="#fff"
      strokeOpacity={0.55}
      strokeWidth={1.5}
    />
  </G>
);

/** The middle of the table: the pot as a real pile, in the same chips the players hold. */
export const PokerPot: React.FC<{ amount: number; entry: number }> = ({ amount, entry }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const previous = useRef(amount);

  useEffect(() => {
    const grew = amount > previous.current;
    previous.current = amount;
    if (!grew) return;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) return;
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.14, duration: 130, useNativeDriver: false }),
        Animated.timing(scale, { toValue: 1, duration: 200, useNativeDriver: false }),
      ]).start();
    });
  }, [amount, scale]);

  const values = chipValues(entry);
  const rack = rackOf(amount, values);
  const stacks = values
    .map((value, index) => ({ count: rack[value], color: chipColor(index) }))
    .filter((stack) => stack.count > 0);
  const spots = SPOTS[stacks.length];
  const drawn = stacks
    .map((stack, index) => ({ ...stack, ...spots[index] }))
    .sort((a, b) => a.y - b.y);

  return (
    <View accessible accessibilityLabel={`${amount} fichas en el pozo`}>
      <View style={styles.pile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width="100%" height="100%" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          <Defs>
            <RadialGradient id="potLight" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0" stopColor="#2c9271" stopOpacity={0.75} />
              <Stop offset="1" stopColor="#0f4a37" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={CENTER} cy={HEIGHT / 2} rx={WIDTH / 2} ry={HEIGHT / 2} fill="url(#potLight)" />
          <Ellipse
            cx={CENTER}
            cy={HEIGHT / 2}
            rx={WIDTH / 2 - 8}
            ry={HEIGHT / 2 - 5}
            fill="none"
            stroke="#e6c878"
            strokeOpacity={0.4}
            strokeWidth={1.5}
          />
          {drawn.map((stack) => (
            <Stack key={`${stack.x}-${stack.y}`} x={CENTER + stack.x} y={FLOOR + stack.y} count={stack.count} color={stack.color} />
          ))}
        </Svg>
      </View>
      <Animated.Text style={[styles.amount, amount >= 100000 && styles.amountLong, { transform: [{ scale }] }]}>
        {amount}
      </Animated.Text>
      <Text style={styles.label}>fichas en el pozo</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pile: { width: '100%', aspectRatio: WIDTH / HEIGHT, marginTop: 4 },
  amount: {
    color: '#f4dc92',
    fontSize: 66,
    lineHeight: 72,
    fontWeight: '900',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
    marginTop: -6,
  },
  amountLong: { fontSize: 50 },
  label: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: -2 },
});

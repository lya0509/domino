import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { theme } from '../theme';
import { GAME_TABS, GameTab, tabIndex } from '../lib/gameTabs';

interface Props {
  active: GameTab;
  onSelect: (tab: GameTab) => void;
}

const ICON_SIZE = 28;
const DOCK_BACKGROUND = '#14161c';

const DominoIcon = ({ color }: { color: string }) => (
  <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 28 28">
    <G rotation={18} origin="14, 14">
      <Rect x={8} y={2} width={12} height={24} rx={2.5} fill={color} />
      <Line x1={9.5} y1={14} x2={18.5} y2={14} stroke={DOCK_BACKGROUND} strokeWidth={1.4} />
      <Circle cx={11.5} cy={5.8} r={1.3} fill={DOCK_BACKGROUND} />
      <Circle cx={16.5} cy={10.2} r={1.3} fill={DOCK_BACKGROUND} />
      <Circle cx={14} cy={20} r={1.3} fill={DOCK_BACKGROUND} />
    </G>
  </Svg>
);

const UnoIcon = ({ color }: { color: string }) => (
  <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 28 28">
    <G rotation={-10} origin="14, 14">
      <Rect x={6} y={2} width={16} height={24} rx={3} fill={color} />
      <Ellipse cx={14} cy={14} rx={5.2} ry={8.6} fill={DOCK_BACKGROUND} rotation={24} origin="14, 14" />
    </G>
  </Svg>
);

const PokerIcon = ({ color }: { color: string }) => (
  <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24">
    <Path
      d="M12 2C9 6 4 9 4 14a4.5 4.5 0 0 0 7 3.7c-.2 1.6-.9 3-2 4.3h6c-1.1-1.3-1.8-2.7-2-4.3A4.5 4.5 0 0 0 20 14c0-5-5-8-8-12z"
      fill={color}
    />
  </Svg>
);

const ICONS: Record<GameTab, React.FC<{ color: string }>> = { domino: DominoIcon, uno: UnoIcon, poker: PokerIcon };

/** Home's bottom bar. The lit tile slides to the chosen game and takes that game's colour. */
export const GameDock: React.FC<Props> = ({ active, onSelect }) => {
  const [slotWidth, setSlotWidth] = useState(0);
  const position = useRef(new Animated.Value(tabIndex(active))).current;
  const activeColor = GAME_TABS[tabIndex(active)].color;

  useEffect(() => {
    Animated.spring(position, {
      toValue: tabIndex(active),
      useNativeDriver: Platform.OS !== 'web',
      speed: 22,
      bounciness: 4,
    }).start();
  }, [active, position]);

  return (
    <View style={styles.dock}>
      <View
        style={styles.row}
        accessibilityRole="tablist"
        onLayout={(e) => setSlotWidth(e.nativeEvent.layout.width / GAME_TABS.length)}
      >
        {slotWidth > 0 && (
          <Animated.View
            style={[
              styles.tile,
              {
                width: slotWidth,
                borderTopColor: activeColor,
                backgroundColor: `${activeColor}24`,
                transform: [{ translateX: Animated.multiply(position, slotWidth) }],
              },
            ]}
          />
        )}
        {GAME_TABS.map(({ key, label, color, note }) => {
          const selected = active === key;
          const Icon = ICONS[key];
          return (
            <TouchableOpacity
              key={key}
              style={styles.tab}
              onPress={() => onSelect(key)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              aria-selected={selected}
            >
              <Icon color={selected ? color : theme.colors.textDim} />
              <Text style={[styles.label, selected && styles.labelActive]}>{label}</Text>
              {note && <Text style={styles.note}>{note}</Text>}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  dock: {
    backgroundColor: DOCK_BACKGROUND,
    borderTopWidth: 1,
    borderTopColor: theme.colors.cardBorder,
    paddingHorizontal: theme.spacing.s,
    paddingBottom: Platform.OS === 'web' ? ('max(6px, env(safe-area-inset-bottom))' as any) : 6,
  },
  row: { flexDirection: 'row', width: '100%', maxWidth: 520, alignSelf: 'center' },
  tile: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderTopWidth: 3,
    borderBottomLeftRadius: theme.borderRadius.s,
    borderBottomRightRadius: theme.borderRadius.s,
  },
  tab: { flex: 1, height: 68, alignItems: 'center', justifyContent: 'center' },
  label: { color: theme.colors.textDim, fontSize: 13, fontWeight: '700', marginTop: 2 },
  labelActive: { color: theme.colors.text },
  note: { color: '#d4a843', fontSize: 10, fontWeight: '700' },
});

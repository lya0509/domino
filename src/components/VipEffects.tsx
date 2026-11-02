import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Platform, StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';
import { VIP_GOLD } from './VipRing';
import { useVip, useVipList } from '../lib/vipService';
import { sounds } from '../lib/sounds';

const useNative = Platform.OS !== 'web';

// ---------------------------------------------------------------------------
// Golden name: a VIP's name in gold with a soft glow and the crown
// ---------------------------------------------------------------------------
export const VipName: React.FC<{ userId?: string | null; style?: StyleProp<TextStyle>; children: React.ReactNode; numberOfLines?: number }> = ({
  userId,
  style,
  children,
  numberOfLines,
}) => {
  const vip = useVip(userId);
  return (
    <Text style={[style, vip && styles.goldName]} numberOfLines={numberOfLines}>
      {children}
      {vip ? <Text style={styles.crown}> ♛</Text> : null}
    </Text>
  );
};

// ---------------------------------------------------------------------------
// Golden celebration: confetti and a banner when a VIP wins
// ---------------------------------------------------------------------------
const PIECES = 36;
const COLORS = [VIP_GOLD, '#fde68a', '#f59e0b', '#ffffff', '#facc15'];

const Confetti: React.FC<{ run: number }> = ({ run }) => {
  const { width, height } = Dimensions.get('window');
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        x: Math.random() * width,
        drift: (Math.random() - 0.5) * 120,
        size: 6 + Math.random() * 8,
        delay: Math.random() * 600,
        duration: 2200 + Math.random() * 1400,
        color: COLORS[i % COLORS.length],
        v: new Animated.Value(0),
      })),
    [run, width],
  );

  useEffect(() => {
    const anims = pieces.map((p) =>
      Animated.timing(p.v, { toValue: 1, duration: p.duration, delay: p.delay, easing: Easing.in(Easing.quad), useNativeDriver: useNative }),
    );
    Animated.parallel(anims).start();
    return () => anims.forEach((a) => a.stop());
  }, [pieces]);

  return (
    <>
      {pieces.map((p, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: p.x,
            top: -20,
            width: p.size,
            height: p.size * 0.6,
            borderRadius: 2,
            backgroundColor: p.color,
            opacity: p.v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, height + 40] }) },
              { translateX: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${i % 2 ? 540 : -540}deg`] }) },
            ],
          }}
        />
      ))}
    </>
  );
};

/**
 * Shown over a win when a winner is VIP. Plays once per `celebrationKey`
 * (a match or game id), so reopening the screen does not repeat it.
 */
const played = new Set<string>();

export const VipCelebration: React.FC<{ winners: { id?: string | null; name: string }[]; celebrationKey: string; active: boolean }> = ({
  winners,
  celebrationKey,
  active,
}) => {
  const vips = useVipList(winners.map((w) => w.id));
  const names = winners.filter((w) => vips.some((v) => v.user_id === w.id)).map((w) => w.name);
  const [run, setRun] = useState(0);
  const [visible, setVisible] = useState(false);
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || names.length === 0 || played.has(celebrationKey)) return;
    played.add(celebrationKey);
    setRun((r) => r + 1);
    setVisible(true);
    sounds.playSound('chaching');
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 60, useNativeDriver: useNative }).start();
    const t = setTimeout(() => setVisible(false), 4200);
    return () => clearTimeout(t);
  }, [active, names.length, celebrationKey]);

  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Confetti run={run} />
      <View style={styles.celebrateCenter}>
        <Animated.View style={[styles.celebrateBadge, { transform: [{ scale: pop }] }]}>
          <Text style={styles.celebrateCrown}>♛</Text>
          <Text style={styles.celebrateTitle}>¡VICTORIA VIP!</Text>
          <Text style={styles.celebrateNames} numberOfLines={2}>{names.join(' y ')}</Text>
        </Animated.View>
      </View>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Entrance: a golden banner for each VIP sitting at the table, once per game
// ---------------------------------------------------------------------------
const entered = new Set<string>();

export const VipEntrance: React.FC<{ players: { id?: string | null; name: string }[]; gameKey: string }> = ({ players, gameKey }) => {
  const vips = useVipList(players.map((p) => p.id));
  const [queue, setQueue] = useState<string[]>([]);
  const slide = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const fresh = players
      .filter((p) => p.id && vips.some((v) => v.user_id === p.id) && !entered.has(`${gameKey}:${p.id}`))
      .map((p) => {
        entered.add(`${gameKey}:${p.id}`);
        return p.name;
      });
    if (fresh.length) setQueue((q) => [...q, ...fresh]);
  }, [vips.length, gameKey, players.length]);

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    slide.setValue(0);
    shine.setValue(0);
    Animated.sequence([
      Animated.spring(slide, { toValue: 1, friction: 7, tension: 50, useNativeDriver: useNative }),
      Animated.timing(shine, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: useNative }),
      Animated.delay(1500),
      Animated.timing(slide, { toValue: 0, duration: 350, useNativeDriver: useNative }),
    ]).start(() => setQueue((q) => q.slice(1)));
  }, [current]);

  if (!current) return null;
  return (
    <View style={styles.entranceWrap} pointerEvents="none">
      <Animated.View
        style={[
          styles.entrance,
          {
            opacity: slide,
            transform: [
              { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) },
              { scale: slide.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
            ],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.entranceShine,
            { transform: [{ translateX: shine.interpolate({ inputRange: [0, 1], outputRange: [-160, 420] }) }, { rotate: '20deg' }] },
          ]}
        />
        <Text style={styles.entranceText} numberOfLines={1}>♛ {current} está en la mesa</Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  goldName: {
    color: VIP_GOLD,
    textShadowColor: 'rgba(251,191,36,0.55)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 0 },
  },
  crown: { color: VIP_GOLD, fontWeight: '900' },
  celebrateCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  celebrateBadge: {
    backgroundColor: 'rgba(23,18,10,0.92)',
    borderWidth: 2,
    borderColor: VIP_GOLD,
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 28,
    alignItems: 'center',
    shadowColor: VIP_GOLD,
    shadowOpacity: 0.7,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    maxWidth: '86%',
  },
  celebrateCrown: { color: VIP_GOLD, fontSize: 44, lineHeight: 50 },
  celebrateTitle: { color: VIP_GOLD, fontSize: 24, fontWeight: '900', letterSpacing: 1.5 },
  celebrateNames: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 4, textAlign: 'center' },
  entranceWrap: { position: 'absolute', top: 72, left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  entrance: {
    backgroundColor: '#17120a',
    borderWidth: 1.5,
    borderColor: VIP_GOLD,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 20,
    overflow: 'hidden',
    maxWidth: '92%',
    shadowColor: VIP_GOLD,
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  entranceShine: { position: 'absolute', top: -20, bottom: -20, width: 40, backgroundColor: 'rgba(255,255,255,0.35)' },
  entranceText: { color: VIP_GOLD, fontWeight: '900', fontSize: 15 },
});

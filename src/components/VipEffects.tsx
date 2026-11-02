import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Modal, Platform, StyleProp, StyleSheet, Text, TextStyle, TouchableOpacity, View } from 'react-native';
import { VIP_GOLD } from './VipRing';
import { useVip, useVipList } from '../lib/vipService';
import { sounds } from '../lib/sounds';
import { WIN_STYLES, WinStyle, winStyleOf } from '../lib/vip';

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
// Win animations: what everyone sees when a VIP wins (the VIP picks one)
// ---------------------------------------------------------------------------
const COLORS = [VIP_GOLD, '#fde68a', '#f59e0b', '#ffffff', '#facc15'];
const BURST_COLORS = ['#fbbf24', '#f87171', '#60a5fa', '#34d399', '#e879f9', '#ffffff'];

/** A small domino tile drawn with views, so it shows on every phone. */
export const DominoTile: React.FC<{ size: number }> = ({ size }) => {
  const w = size;
  const h = size * 1.9;
  const pip = Math.max(3, size * 0.2);
  const dot = (top: number, left: number) => (
    <View style={{ position: 'absolute', top, left, width: pip, height: pip, borderRadius: pip / 2, backgroundColor: '#111' }} />
  );
  return (
    <View style={{ width: w, height: h, borderRadius: size * 0.2, backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#d4d4d8' }}>
      <View style={{ position: 'absolute', top: h / 2 - 0.5, left: 2, right: 2, height: 1, backgroundColor: '#71717a' }} />
      {dot(h * 0.25 - pip / 2, w / 2 - pip / 2)}
      {dot(h * 0.62 - pip / 2, w * 0.28 - pip / 2)}
      {dot(h * 0.82 - pip / 2, w * 0.72 - pip / 2)}
    </View>
  );
};

const Falling: React.FC<{ run: number; kind: 'confeti' | 'domino' | 'coronas' }> = ({ run, kind }) => {
  const { width, height } = Dimensions.get('window');
  const count = kind === 'confeti' ? 36 : 22;
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: Math.random() * width,
        drift: (Math.random() - 0.5) * 120,
        size: kind === 'confeti' ? 6 + Math.random() * 8 : kind === 'domino' ? 12 + Math.random() * 8 : 20 + Math.random() * 18,
        delay: Math.random() * 700,
        duration: 2300 + Math.random() * 1400,
        color: COLORS[i % COLORS.length],
        v: new Animated.Value(0),
      })),
    [run, width, kind],
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
      {pieces.map((p, i) => {
        const motion = {
          position: 'absolute' as const,
          left: p.x,
          top: -50,
          opacity: p.v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
          transform: [
            { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, height + 80] }) },
            { translateX: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
            { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${i % 2 ? 540 : -540}deg`] }) },
          ],
        };
        if (kind === 'domino') {
          return (
            <Animated.View key={i} style={motion}>
              <DominoTile size={p.size} />
            </Animated.View>
          );
        }
        if (kind === 'coronas') {
          return (
            <Animated.Text key={i} style={[motion, { fontSize: p.size, color: p.color, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 }]}>
              ♛
            </Animated.Text>
          );
        }
        return (
          <Animated.View key={i} style={[motion, { width: p.size, height: p.size * 0.6, borderRadius: 2, backgroundColor: p.color }]} />
        );
      })}
    </>
  );
};

const Fireworks: React.FC<{ run: number }> = ({ run }) => {
  const { width, height } = Dimensions.get('window');
  const bursts = useMemo(
    () =>
      Array.from({ length: 6 }, (_, b) => ({
        x: width * (0.15 + Math.random() * 0.7),
        y: height * (0.12 + Math.random() * 0.45),
        delay: b * 380,
        color: BURST_COLORS[b % BURST_COLORS.length],
        radius: 70 + Math.random() * 50,
        v: new Animated.Value(0),
      })),
    [run, width, height],
  );

  useEffect(() => {
    const anims = bursts.map((b) =>
      Animated.timing(b.v, { toValue: 1, duration: 1300, delay: b.delay, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }),
    );
    Animated.parallel(anims).start();
    return () => anims.forEach((a) => a.stop());
  }, [bursts]);

  const SPARKS = 16;
  return (
    <>
      {bursts.map((b, bi) => (
        <View key={bi} style={{ position: 'absolute', left: b.x, top: b.y }}>
          {Array.from({ length: SPARKS }, (_, i) => {
            const a = (i / SPARKS) * Math.PI * 2;
            return (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute',
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: i % 3 === 0 ? '#ffffff' : b.color,
                  opacity: b.v.interpolate({ inputRange: [0, 0.05, 0.75, 1], outputRange: [0, 1, 1, 0] }),
                  transform: [
                    { translateX: b.v.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * b.radius] }) },
                    // A little gravity: the sparks sag as they fade
                    { translateY: b.v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, Math.sin(a) * b.radius * 0.8, Math.sin(a) * b.radius + 30] }) },
                  ],
                }}
              />
            );
          })}
        </View>
      ))}
    </>
  );
};

/** One of the four win animations, played once per `run`. */
export const WinAnimation: React.FC<{ style: WinStyle; run: number }> = ({ style, run }) =>
  style === 'fuegos' ? <Fireworks run={run} /> : <Falling run={run} kind={style} />;

/**
 * Shown over a win when a winner is VIP, with the animation that VIP picked.
 * Plays once per `celebrationKey` (a match or game id), so reopening the
 * screen does not repeat it.
 */
const played = new Set<string>();

export const VipCelebration: React.FC<{ winners: { id?: string | null; name: string }[]; celebrationKey: string; active: boolean }> = ({
  winners,
  celebrationKey,
  active,
}) => {
  const vips = useVipList(winners.map((w) => w.id));
  const names = winners.filter((w) => vips.some((v) => v.user_id === w.id)).map((w) => w.name);
  const style = winStyleOf(vips[0]?.win_style);
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
      <WinAnimation style={style} run={run} />
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

/** Full-screen preview of a win animation, for the VIP's picker. */
export const WinPreview: React.FC<{ style: WinStyle | null; onDone: () => void }> = ({ style, onDone }) => {
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!style) return;
    setRun((r) => r + 1);
    const t = setTimeout(onDone, 3800);
    return () => clearTimeout(t);
  }, [style]);
  if (!style) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDone}>
      <TouchableOpacity style={styles.previewBg} activeOpacity={1} onPress={onDone}>
        <WinAnimation style={style} run={run} />
        <View style={styles.celebrateBadge}>
          <Text style={styles.celebrateCrown}>♛</Text>
          <Text style={styles.celebrateTitle}>¡VICTORIA VIP!</Text>
          <Text style={styles.celebrateNames}>{WIN_STYLES[style].label}</Text>
        </View>
      </TouchableOpacity>
    </Modal>
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
  previewBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
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

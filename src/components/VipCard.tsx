import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, PanResponder, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { VIP_GOLD } from './VipRing';

const useNative = Platform.OS !== 'web';

export interface VipBack {
  name: string;
  initials?: string | null;
  avatarUrl?: string | null;
  tagline?: string | null;
}

/** Stand-in for a member's GIF in the sample card: glows and pieces drifting. */
const SampleBackdrop: React.FC = () => {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 6000, easing: Easing.linear, useNativeDriver: useNative }));
    loop.start();
    return () => loop.stop();
  }, [t]);

  const glow = (from: number, to: number) => t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [from, to, from] });
  const pieces = [
    { glyph: '🁫', left: '8%', top: '12%', size: 34, rise: -26 },
    { glyph: '♛', left: '32%', top: '58%', size: 28, rise: 22 },
    { glyph: '🃏', left: '58%', top: '16%', size: 30, rise: 30 },
    { glyph: '✦', left: '80%', top: '62%', size: 22, rise: -24 },
    { glyph: '🂡', left: '86%', top: '8%', size: 30, rise: 18 },
    { glyph: '✦', left: '16%', top: '74%', size: 18, rise: -20 },
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#2a1650' }]} />
      <Animated.View style={[styles.blob, { backgroundColor: '#f59e0b', top: '-20%', left: '-15%', opacity: glow(0.35, 0.6), transform: [{ scale: glow(1, 1.25) }] }]} />
      <Animated.View style={[styles.blob, { backgroundColor: '#db2777', bottom: '-25%', right: '-20%', opacity: glow(0.5, 0.3), transform: [{ scale: glow(1.2, 0.9) }] }]} />
      <Animated.View style={[styles.blob, { backgroundColor: '#2563eb', top: '35%', left: '40%', width: 160, height: 160, opacity: glow(0.25, 0.45) }]} />
      {pieces.map((p, i) => {
        const y = t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, p.rise, 0] });
        const turn = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', i % 2 ? '-360deg' : '360deg'] });
        return (
          <Animated.Text
            key={i}
            style={{
              position: 'absolute',
              left: p.left as any,
              top: p.top as any,
              fontSize: p.size,
              color: VIP_GOLD,
              opacity: 0.85,
              transform: [{ translateY: y }, { rotate: turn }],
            }}
          >
            {p.glyph}
          </Animated.Text>
        );
      })}
    </View>
  );
};

/** The member's GIF or photo across the whole card, or the sample, with a veil so text stays readable. */
const Backdrop: React.FC<{ mediaUrl?: string | null; sample?: boolean }> = ({ mediaUrl, sample }) => {
  if (!mediaUrl && !sample) return null;
  return (
    <>
      {mediaUrl ? <Image source={{ uri: mediaUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <SampleBackdrop />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.42)' }]} pointerEvents="none" />
    </>
  );
};

/**
 * The VIP card: it floats and flips with a sideways swipe or a tap on ↻.
 * The member's GIF or photo fills the whole card on both sides. The front is
 * whatever the screen passes; the back shows the profile photo (or initials),
 * the name and the phrase.
 */
export const VipCard: React.FC<{
  front: React.ReactNode;
  back: VipBack;
  mediaUrl?: string | null;
  sample?: boolean;
  autoFlip?: boolean;
  showHint?: boolean;
}> = ({ front, back, mediaUrl, sample = false, autoFlip = false, showHint = true }) => {
  const flip = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const flipped = useRef(false);
  const [, setSide] = useState(0);

  const turn = (to?: boolean) => {
    flipped.current = to ?? !flipped.current;
    setSide((s) => s + 1);
    Animated.spring(flip, { toValue: flipped.current ? 1 : 0, friction: 7, tension: 18, useNativeDriver: useNative }).start();
  };

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: useNative }),
        Animated.timing(float, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: useNative }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  useEffect(() => {
    if (!autoFlip) return;
    const id = setInterval(() => turn(), 3200);
    return () => clearInterval(id);
  }, [autoFlip]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > 40) turn();
      },
    }),
  ).current;

  const frontRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  const lift = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  return (
    <View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateY: lift }] }}>
        <Animated.View style={[styles.face, styles.frame, { transform: [{ perspective: 1200 }, { rotateY: frontRotate }] }]}>
          <Backdrop mediaUrl={mediaUrl} sample={sample} />
          {front}
        </Animated.View>
        <Animated.View
          style={[styles.face, styles.frame, styles.back, { transform: [{ perspective: 1200 }, { rotateY: backRotate }] }]}
          pointerEvents={flipped.current ? 'auto' : 'none'}
        >
          <Backdrop mediaUrl={mediaUrl} sample={sample} />
          <View style={styles.backInner}>
            <Text style={styles.backTag}>♛ SOCIO VIP</Text>
            <View style={styles.photo}>
              {back.avatarUrl ? (
                <Image source={{ uri: back.avatarUrl }} style={styles.photoImg} resizeMode="cover" />
              ) : (
                <Text style={styles.initials}>{back.initials || back.name.slice(0, 2).toUpperCase()}</Text>
              )}
            </View>
            <Text style={styles.backName} numberOfLines={1}>{back.name}</Text>
            {!!back.tagline && <Text style={styles.backPhrase} numberOfLines={2}>“{back.tagline}”</Text>}
          </View>
        </Animated.View>
      </Animated.View>
      {showHint && (
        <TouchableOpacity onPress={() => turn()} style={styles.hint} accessibilityRole="button" accessibilityLabel="Voltear tarjeta">
          <Text style={styles.hintText}>↻ Desliza o toca para voltear</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  face: { backfaceVisibility: 'hidden' },
  frame: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: VIP_GOLD,
    backgroundColor: '#11141b',
    overflow: 'hidden',
  },
  back: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#17120a' },
  backInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  backTag: {
    color: VIP_GOLD,
    fontWeight: '900',
    letterSpacing: 2,
    fontSize: 12,
    marginBottom: 10,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 4,
  },
  photo: {
    width: 104,
    height: 104,
    borderRadius: 52,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: VIP_GOLD,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImg: { width: '100%', height: '100%' },
  initials: { color: '#fff', fontSize: 36, fontWeight: '900' },
  backName: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    marginTop: 10,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 6,
  },
  backPhrase: {
    color: '#fde68a',
    fontSize: 14,
    fontStyle: 'italic',
    marginTop: 4,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 6,
  },
  blob: { position: 'absolute', width: 220, height: 220, borderRadius: 110 },
  hint: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  hintText: { color: VIP_GOLD, fontSize: 12, fontWeight: '700' },
});

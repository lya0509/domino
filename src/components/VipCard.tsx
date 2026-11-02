import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, PanResponder, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { VIP_GOLD } from './VipRing';

const useNative = Platform.OS !== 'web';

export interface VipBack {
  name: string;
  initials?: string | null;
  avatarUrl?: string | null;
  mediaUrl?: string | null;
  tagline?: string | null;
}

/**
 * The VIP card: it floats, and flips with a sideways swipe or a tap on ↻.
 * The front is whatever the screen passes; the back shows the photo or GIF,
 * the name and the phrase.
 */
export const VipCard: React.FC<{
  front: React.ReactNode;
  back: VipBack;
  autoFlip?: boolean;
  showHint?: boolean;
}> = ({ front, back, autoFlip = false, showHint = true }) => {
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
    const id = setInterval(() => turn(), 2800);
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
  const media = back.mediaUrl || back.avatarUrl;

  return (
    <View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateY: lift }] }}>
        <Animated.View style={[styles.face, { transform: [{ perspective: 1200 }, { rotateY: frontRotate }] }]}>
          {front}
        </Animated.View>
        <Animated.View
          style={[styles.face, styles.back, { transform: [{ perspective: 1200 }, { rotateY: backRotate }] }]}
          pointerEvents={flipped.current ? 'auto' : 'none'}
        >
          <View style={styles.backInner}>
            <Text style={styles.backTag}>♛ SOCIO VIP</Text>
            <View style={styles.mediaFrame}>
              {media ? (
                <Image source={{ uri: media }} style={styles.media} resizeMode="cover" />
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
  back: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  backInner: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: VIP_GOLD,
    backgroundColor: '#17120a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    shadowColor: VIP_GOLD,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  backTag: { color: VIP_GOLD, fontWeight: '900', letterSpacing: 2, fontSize: 12, marginBottom: 8 },
  mediaFrame: {
    width: 112,
    height: 112,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: VIP_GOLD,
    backgroundColor: 'rgba(251,191,36,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  media: { width: '100%', height: '100%' },
  initials: { color: VIP_GOLD, fontSize: 40, fontWeight: '900' },
  backName: { color: '#fff', fontSize: 19, fontWeight: '900', marginTop: 10 },
  backPhrase: { color: '#fde68a', fontSize: 13, fontStyle: 'italic', marginTop: 4, textAlign: 'center' },
  hint: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  hintText: { color: VIP_GOLD, fontSize: 12, fontWeight: '700' },
});

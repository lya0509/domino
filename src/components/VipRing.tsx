import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { useVip } from '../lib/vipService';

export const VIP_GOLD = '#fbbf24';
const useNative = Platform.OS !== 'web';

/** A golden ring that turns around an avatar, with a small crown. Only for VIPs. */
export const VipRing: React.FC<{ active: boolean; size: number; children: React.ReactNode; crown?: boolean }> = ({
  active,
  size,
  children,
  crown = true,
}) => {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: useNative }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, spin]);

  if (!active) return <>{children}</>;

  const ring = size + 8;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const badge = Math.max(14, Math.round(size * 0.36));

  return (
    <View style={{ width: ring, height: ring, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[styles.base, { width: ring, height: ring, borderRadius: ring / 2 }]} />
      <Animated.View
        pointerEvents="none"
        style={[styles.arc, { width: ring, height: ring, borderRadius: ring / 2, transform: [{ rotate }] }]}
      />
      {children}
      {crown && (
        <View
          pointerEvents="none"
          style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2, top: -2, right: -2 }]}
          accessibilityLabel="VIP"
        >
          <Text style={{ fontSize: badge * 0.62, color: '#1a1205', lineHeight: badge * 0.8 }}>♛</Text>
        </View>
      )}
    </View>
  );
};

/** VipRing that looks the player up by id. */
export const VipAvatarRing: React.FC<{ userId?: string | null; size: number; children: React.ReactNode; crown?: boolean }> = ({
  userId,
  ...rest
}) => {
  const vip = useVip(userId);
  return <VipRing active={!!vip} {...rest} />;
};

/** A small golden crown next to a name, only when the player is VIP. */
export const VipCrown: React.FC<{ userId?: string | null; size?: number }> = ({ userId, size = 12 }) => {
  const vip = useVip(userId);
  if (!vip) return null;
  return (
    <Text style={{ color: VIP_GOLD, fontSize: size, fontWeight: '900' }} accessibilityLabel="VIP">
      {' '}♛
    </Text>
  );
};

const styles = StyleSheet.create({
  base: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(251,191,36,0.35)' },
  arc: {
    position: 'absolute',
    borderWidth: 2.5,
    borderTopColor: VIP_GOLD,
    borderRightColor: '#fde68a',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
  },
  badge: {
    position: 'absolute',
    backgroundColor: VIP_GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#0f172a',
  },
});

import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Dimensions, PanResponder, Platform } from 'react-native';
import { dragOffset, GameTab, isHorizontalSwipe, tabAfterSwipe, tabIndex } from './gameTabs';

const ENTRY_DISTANCE = 36;

/** Moves between games with the finger; the content follows it and settles in from the side it came from. */
export const useGameSwipe = (active: GameTab, onChange: (tab: GameTab) => void) => {
  const offset = useRef(new Animated.Value(0)).current;
  const activeRef = useRef(active);
  const onChangeRef = useRef(onChange);
  const reduceMotion = useRef(false);

  activeRef.current = active;
  onChangeRef.current = onChange;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotion.current = enabled;
    }).catch(() => {});
  }, []);

  const settle = () =>
    Animated.spring(offset, {
      toValue: 0,
      useNativeDriver: Platform.OS !== 'web',
      speed: 24,
      bounciness: 3,
    }).start();

  const goTo = (next: GameTab) => {
    const current = activeRef.current;
    if (next !== current) {
      onChangeRef.current(next);
      offset.setValue(reduceMotion.current ? 0 : ENTRY_DISTANCE * Math.sign(tabIndex(next) - tabIndex(current)));
    }
    settle();
  };

  const panHandlers = useMemo(
    () =>
      PanResponder.create({
        // x0 is only filled in once the gesture is granted, so the start comes from the current position
        onMoveShouldSetPanResponderCapture: (_, g) =>
          isHorizontalSwipe(g.dx, g.dy, g.moveX - g.dx, Dimensions.get('window').width),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => {
          if (!reduceMotion.current) offset.setValue(dragOffset(activeRef.current, g.dx));
        },
        onPanResponderRelease: (_, g) => goTo(tabAfterSwipe(activeRef.current, g.dx, g.vx)),
        onPanResponderTerminate: settle,
      }).panHandlers,
    []
  );

  const opacity = offset.interpolate({
    inputRange: [-90, 0, 90],
    outputRange: [0.45, 1, 0.45],
    extrapolate: 'clamp',
  });

  return { panHandlers, goTo, contentStyle: { opacity, transform: [{ translateX: offset }] } };
};

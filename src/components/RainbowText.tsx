import React, { useEffect, useRef } from 'react';
import { Text, Animated, TextProps } from 'react-native';

interface RainbowTextProps extends TextProps {
  children: React.ReactNode;
}

export const RainbowText: React.FC<RainbowTextProps> = ({ children, style, ...props }) => {
  const animation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(animation, {
        toValue: 1,
        duration: 3000,
        useNativeDriver: false, // Color interpolation requires useNativeDriver: false
      })
    ).start();
  }, [animation]);

  const color = animation.interpolate({
    inputRange: [0, 0.16, 0.33, 0.5, 0.66, 0.83, 1],
    outputRange: [
      '#FF0000', // Red
      '#FF7F00', // Orange
      '#FFFF00', // Yellow
      '#00FF00', // Green
      '#0000FF', // Blue
      '#4B0082', // Indigo
      '#FF0000', // Red
    ],
  });

  return (
    <Animated.Text style={[style, { color }]} {...props}>
      {children}
    </Animated.Text>
  );
};

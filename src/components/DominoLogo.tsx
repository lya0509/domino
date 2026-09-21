import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Svg, {
  Rect,
  Circle,
  Line,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  G,
  Filter,
  FeDropShadow,
} from 'react-native-svg';

interface DominoLogoProps {
  size?: number;
  glow?: boolean;
}

export const DominoLogo: React.FC<DominoLogoProps> = ({ size = 80, glow = true }) => {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Defs>
          {/* Radial Gradient for Outer Neon Glow */}
          <RadialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
            <Stop offset="65%" stopColor="#1d4ed8" stopOpacity="0.15" />
            <Stop offset="100%" stopColor="#0b1329" stopOpacity="0" />
          </RadialGradient>

          {/* Badge Background Gradient */}
          <LinearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#1e293b" />
            <Stop offset="50%" stopColor="#0f172a" />
            <Stop offset="100%" stopColor="#050811" />
          </LinearGradient>

          {/* Golden/Blue Border Gradient */}
          <LinearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#60a5fa" />
            <Stop offset="50%" stopColor="#3b82f6" />
            <Stop offset="100%" stopColor="#1d4ed8" />
          </LinearGradient>

          {/* Domino Body Gradient (Cream White Ivory) */}
          <LinearGradient id="dominoBody" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#ffffff" />
            <Stop offset="80%" stopColor="#f1f5f9" />
            <Stop offset="100%" stopColor="#cbd5e1" />
          </LinearGradient>

          {/* Pip (Dot) Gradient */}
          <RadialGradient id="pipGrad" cx="35%" cy="35%" r="65%">
            <Stop offset="0%" stopColor="#0f172a" />
            <Stop offset="80%" stopColor="#020617" />
            <Stop offset="100%" stopColor="#000000" />
          </RadialGradient>

          {/* Center Brass Spinner Rivet */}
          <RadialGradient id="rivetGrad" cx="35%" cy="35%" r="65%">
            <Stop offset="0%" stopColor="#fef08a" />
            <Stop offset="60%" stopColor="#eab308" />
            <Stop offset="100%" stopColor="#a16207" />
          </RadialGradient>
        </Defs>

        {/* Ambient Glow */}
        {glow && <Circle cx="60" cy="60" r="58" fill="url(#bgGlow)" />}

        {/* Outer Circular Shield */}
        <Circle
          cx="60"
          cy="60"
          r="54"
          fill="url(#badgeGrad)"
          stroke="url(#borderGrad)"
          strokeWidth="2.5"
        />

        {/* Inner subtle rim */}
        <Circle
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth="1"
        />

        {/* Centered Domino Tile Group (rotated slightly for modern 3D dynamics) */}
        <G transform="translate(60, 60) rotate(-6) translate(-60, -60)">
          {/* Domino Drop Shadow */}
          <Rect
            x="41"
            y="23"
            width="42"
            height="78"
            rx="6"
            fill="rgba(0,0,0,0.6)"
          />

          {/* Domino Ivory Tile Body */}
          <Rect
            x="39"
            y="21"
            width="42"
            height="78"
            rx="6"
            fill="url(#dominoBody)"
            stroke="#94a3b8"
            strokeWidth="0.8"
          />

          {/* Center Divider Groove */}
          <Line
            x1="43"
            y1="60"
            x2="77"
            y2="60"
            stroke="#64748b"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Central Golden Spinner Rivet */}
          <Circle cx="60" cy="60" r="2.8" fill="url(#rivetGrad)" stroke="#713f12" strokeWidth="0.5" />

          {/* Top Half Pips: 6 dots (Two columns of 3) */}
          {/* Left column top */}
          <Circle cx="48" cy="30" r="3.2" fill="url(#pipGrad)" />
          <Circle cx="48" cy="40" r="3.2" fill="url(#pipGrad)" />
          <Circle cx="48" cy="50" r="3.2" fill="url(#pipGrad)" />
          {/* Right column top */}
          <Circle cx="72" cy="30" r="3.2" fill="url(#pipGrad)" />
          <Circle cx="72" cy="40" r="3.2" fill="url(#pipGrad)" />
          <Circle cx="72" cy="50" r="3.2" fill="url(#pipGrad)" />

          {/* Bottom Half Pips: 6 dots (Double Six - La Cochina / Máxima pieza) */}
          {/* Left column bottom */}
          <Circle cx="48" cy="70" r="3.2" fill="url(#pipGrad)" />
          <Circle cx="48" cy="80" r="3.2" fill="url(#pipGrad)" />
          <Circle cx="48" cy="90" r="3.2" fill="url(#pipGrad)" />
          {/* Right column bottom */}
          <Circle cx="72" cy="70" r="3.2" fill="url(#pipGrad)" />
          <Circle cx="72" cy="80" r="3.2" fill="url(#pipGrad)" />
          <Circle cx="72" cy="90" r="3.2" fill="url(#pipGrad)" />

          {/* Gloss highlight on the tile */}
          <Rect
            x="41"
            y="23"
            width="38"
            height="10"
            rx="3"
            fill="rgba(255, 255, 255, 0.45)"
          />
        </G>
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

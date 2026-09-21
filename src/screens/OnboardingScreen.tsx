import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Dimensions, Platform } from 'react-native';
import { theme } from '../theme';
import { sounds } from '../lib/sounds';
import * as Haptics from 'expo-haptics';

interface Props {
  onComplete: () => void;
}

const SLIDES = [
  {
    id: 'welcome',
    badge: 'BIENVENIDO',
    icon: '🁣',
    title: 'Domino del Cafetín',
    highlight: 'PeSiMiSta EDITION',
    description: 'El sistema definitivo para partidas y torneos de dominó. Diseñado para llevar el registro sin trampas, con estadísticas y prestigio.',
    bullets: ['Partidas en tiempo real', 'Tablas de clasificación', 'Economía de puntos'],
  },
  {
    id: 'var',
    badge: 'TECNOLOGÍA EN MESA',
    icon: '📊',
    title: 'Anotador & El VAR',
    highlight: 'HISTORIAL POR RONDA',
    description: 'Olvídate de la libreta de papel. Gráficas interactivas de anotaciones por mano, conteo de rondas y detector oficial de Zapatos 👟.',
    bullets: ['Detección de Zapatos automáticos', 'Sustitución de jugadores en vivo', 'Efectos de sonido y vibración háptica'],
  },
  {
    id: 'tournaments',
    badge: 'COMPETICIÓN DE ÉLITE',
    icon: '🏆',
    title: 'Torneos VIP & Brackets',
    highlight: 'PREMIOS Y LLAVES',
    description: 'Cuadro de enfrentamientos eliminatorios generados al instante. Registro por parejas o lista de espera y sistema de cobros por Pago Móvil.',
    bullets: ['Árbol de eliminatorias visual', 'Aprobación de pagos en panel Admin', 'Modo espectador en vivo con chat'],
  },
  {
    id: 'store_medals',
    badge: 'GAMIFICACIÓN TOTAL',
    icon: '🎖️',
    title: 'Medallas & Tapetes VIP',
    highlight: 'PERSONALIZACIÓN MÁXIMA',
    description: 'Demuestra tu rango con la vitrina de medallas. Compra en la tienda manteles de mesa (Verde Casino, Rojo, Negro VIP), nombres arcoíris y marcos de diamante.',
    bullets: ['Bono diario de 10 puntos a las 7:00 AM', '8 Medallas desbloqueables por hazañas', 'Notificaciones Web Push en vivo'],
  },
];

export const OnboardingScreen: React.FC<Props> = ({ onComplete }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const handleNext = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    sounds.playSound('pop');

    if (currentIndex < SLIDES.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      handleFinish();
    }
  };

  const handleSkip = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    sounds.playSound('pop');
    onComplete();
  };

  const handleFinish = () => {
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    sounds.playSound('clap');
    onComplete();
  };

  const currentSlide = SLIDES[currentIndex];

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Header with Skip Button */}
      <View style={styles.topBar}>
        <View style={styles.badgeContainer}>
          <Text style={styles.badgeText}>{currentSlide.badge}</Text>
        </View>
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
          <Text style={styles.skipText}>Saltar ⏩</Text>
        </TouchableOpacity>
      </View>

      {/* Main Slide Card */}
      <View style={styles.contentContainer}>
        <View style={styles.iconCircle}>
          <Text style={styles.mainIcon}>{currentSlide.icon}</Text>
        </View>

        <Text style={styles.title}>{currentSlide.title}</Text>
        <Text style={styles.highlightText}>{currentSlide.highlight}</Text>
        <Text style={styles.description}>{currentSlide.description}</Text>

        {/* Feature Highlights */}
        <View style={styles.bulletBox}>
          {currentSlide.bullets.map((bullet, idx) => (
            <View key={idx} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>⚡</Text>
              <Text style={styles.bulletText}>{bullet}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Bottom Controls */}
      <View style={styles.bottomBar}>
        {/* Pagination Dots */}
        <View style={styles.dotsRow}>
          {SLIDES.map((_, idx) => (
            <View
              key={idx}
              style={[
                styles.dot,
                idx === currentIndex ? styles.activeDot : styles.inactiveDot
              ]}
            />
          ))}
        </View>

        {/* Next / Start Button */}
        <TouchableOpacity
          style={[styles.nextBtn, currentIndex === SLIDES.length - 1 && styles.finishBtn]}
          onPress={handleNext}
          activeOpacity={0.8}
        >
          <Text style={styles.nextBtnText}>
            {currentIndex === SLIDES.length - 1 ? '¡Comenzar a Jugar! 🚀' : 'Siguiente ➜'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07080a',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  badgeContainer: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  badgeText: {
    color: '#60a5fa',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  skipText: {
    color: theme.colors.textDim,
    fontSize: 14,
    fontWeight: '700',
  },
  skipBtn: {
    padding: 8,
  },
  contentContainer: {
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 2,
    borderColor: theme.colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },
  mainIcon: {
    fontSize: 48,
  },
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  highlightText: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  description: {
    color: theme.colors.textDim,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  bulletBox: {
    width: '100%',
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.m,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  bulletDot: {
    fontSize: 12,
    marginRight: 8,
  },
  bulletText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
  },
  bottomBar: {
    paddingBottom: 20,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  activeDot: {
    width: 24,
    backgroundColor: theme.colors.primary,
  },
  inactiveDot: {
    width: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  nextBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    borderRadius: theme.borderRadius.m,
    alignItems: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  finishBtn: {
    backgroundColor: '#10b981',
    shadowColor: '#10b981',
  },
  nextBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

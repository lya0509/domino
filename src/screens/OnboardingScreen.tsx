import React, { useState } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Dimensions, Platform, Image, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
    title: 'PeSiMistas',
    highlight: 'DOMINO DEL CAFETÍN',
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
    bullets: ['Bono diario de 10 puntos a las 7:00 AM', '8 Medallas desbloqueables por hazañas', 'Economía y recompensas exclusivas'],
  },
  {
    id: 'install_notifications',
    badge: 'PASO OBLIGATORIO',
    icon: '🔔',
    title: 'Notificaciones & App',
    highlight: 'ALERTAS Y ACCESO RÁPIDO',
    description: 'Activa sí o sí las notificaciones para enterarte cuando te toque jugar o si ganaste una apuesta, e instala la aplicación en tu teléfono.',
    bullets: ['Avisos inmediatos de llamada a mesa', 'Instalación sin pasar por App Store', 'Acceso a pantalla completa como app nativa'],
  },
];

export const OnboardingScreen: React.FC<Props> = ({ onComplete }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission === 'granted'
      : false
  );

  const handleRequestNotifications = async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          setNotificationsEnabled(true);
          sounds.playSound('chaching');
          Alert.alert('✅ ¡Notificaciones Activadas!', 'Recibirás avisos en tiempo real cuando tu dúo sea llamado a la mesa o haya novedades en torneos.');
        } else if (perm === 'denied') {
          Alert.alert('⚠️ Notificaciones Bloqueadas', 'Habilita los permisos de notificaciones desde la configuración de tu navegador.');
        }
      } catch (e) {
        console.error(e);
      }
    } else {
      Alert.alert('Notificaciones', 'Las notificaciones automáticas están habilitadas en navegadores compatibles.');
    }
  };

  const handleShowIosInstructions = () => {
    Alert.alert(
      '🍏 Cómo Instalar en iPhone (Safari)',
      '1. Toca el botón Compartir ⎋ (en la barra inferior de Safari).\n\n2. Baja en las opciones y presiona "Agregar a pantalla de inicio ➕".\n\n3. Pulsa "Agregar" arriba a la derecha y ¡listo! Se abrirá como app independiente a pantalla completa.'
    );
  };

  const handleShowAndroidInstructions = () => {
    Alert.alert(
      '🤖 Cómo Instalar en Android (Chrome)',
      '1. Toca los tres puntos (⋮) en la esquina superior derecha de Chrome.\n\n2. Presiona "Instalar aplicación" o "Agregar a pantalla principal".\n\n3. Confirma y ¡listo! Tendrás el ícono de la app en tu teléfono.'
    );
  };

  const saveSeen = async () => {
    try {
      await AsyncStorage.setItem('@domino_onboarding_seen', '1');
      await AsyncStorage.setItem('domino_onboarding_seen', '1');
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.localStorage.setItem('@domino_onboarding_seen', '1');
        window.localStorage.setItem('domino_onboarding_seen', '1');
      }
    } catch {}
  };

  const handleFinish = () => {
    saveSeen();
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    sounds.playSound('clap');
    onComplete();
  };

  const handleNext = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    sounds.playSound('pop');

    setCurrentIndex((prev) => {
      if (prev < SLIDES.length - 1) {
        return prev + 1;
      } else {
        handleFinish();
        return prev;
      }
    });
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => {
      if (prev > 0) {
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        sounds.playSound('pop');
        return prev - 1;
      }
      return prev;
    });
  };

  const handleSkip = () => {
    saveSeen();
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    sounds.playSound('pop');
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
        <View style={[styles.iconCircle, currentSlide.id === 'welcome' && styles.welcomeCircle]}>
          {currentSlide.id === 'welcome' ? (
            <Image
              source={require('../../assets/icon.png')}
              style={[
                styles.welcomeImage,
                Platform.OS === 'web' ? ({ imageRendering: '-webkit-optimize-contrast' } as any) : {}
              ]}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.mainIcon}>{currentSlide.icon}</Text>
          )}
        </View>

        <Text style={styles.title}>{currentSlide.title}</Text>
        <Text style={styles.highlightText}>{currentSlide.highlight}</Text>
        <Text style={styles.description}>{currentSlide.description}</Text>

        {/* Feature Highlights or Interactive Buttons */}
        {currentSlide.id === 'install_notifications' ? (
          <View style={styles.actionButtonsContainer}>
            {/* Botón 1: Activar Notificaciones */}
            <TouchableOpacity
              style={[styles.notifBtn, notificationsEnabled && styles.notifBtnActive]}
              onPress={handleRequestNotifications}
              activeOpacity={0.8}
            >
              <Text style={styles.notifBtnText}>
                {notificationsEnabled ? '✅ Notificaciones Activadas' : '🔔 Activar Notificaciones Sí o Sí'}
              </Text>
            </TouchableOpacity>

            {/* Fila de Botones: iPhone y Android */}
            <View style={styles.installRow}>
              <TouchableOpacity
                style={styles.installBtn}
                onPress={handleShowIosInstructions}
                activeOpacity={0.8}
              >
                <Text style={styles.installBtnText}>🍏 Cómo Instalar en iPhone</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.installBtn}
                onPress={handleShowAndroidInstructions}
                activeOpacity={0.8}
              >
                <Text style={styles.installBtnText}>🤖 Cómo Instalar en Android</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.bulletBox}>
            {currentSlide.bullets.map((bullet, idx) => (
              <View key={idx} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>⚡</Text>
                <Text style={styles.bulletText}>{bullet}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Bottom Controls (Sin Gestos Ocultos) */}
      <View style={styles.bottomBar}>
        {/* Pagination Dots (Táctiles) */}
        <View style={styles.dotsRow}>
          {SLIDES.map((_, idx) => (
            <TouchableOpacity
              key={idx}
              onPress={() => {
                if (Platform.OS !== 'web') {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                sounds.playSound('pop');
                setCurrentIndex(idx);
              }}
              activeOpacity={0.7}
              style={[
                styles.dot,
                idx === currentIndex ? styles.activeDot : styles.inactiveDot
              ]}
            />
          ))}
        </View>

        {/* Action Buttons Row */}
        <View style={styles.navButtonsRow}>
          {currentIndex > 0 && (
            <TouchableOpacity
              style={styles.prevBtn}
              onPress={handlePrev}
              activeOpacity={0.8}
            >
              <Text style={styles.prevBtnText}>◀ Anterior</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[
              styles.nextBtn,
              currentIndex === 0 && { flex: 1 },
              currentIndex === SLIDES.length - 1 && styles.finishBtn
            ]}
            onPress={handleNext}
            activeOpacity={0.8}
          >
            <Text style={styles.nextBtnText}>
              {currentIndex === SLIDES.length - 1 ? '¡Comenzar a Jugar! 🚀' : 'Siguiente ➜'}
            </Text>
          </TouchableOpacity>
        </View>
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
  welcomeCircle: {
    width: 120,
    height: 120,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 2.5,
    borderColor: '#3b82f6',
    backgroundColor: '#000',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 8,
  },
  welcomeImage: {
    width: '100%',
    height: '100%',
  },
  actionButtonsContainer: {
    width: '100%',
    marginTop: 4,
    gap: 10,
  },
  notifBtn: {
    backgroundColor: '#3b82f6',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  notifBtnActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1.5,
    borderColor: '#10b981',
    shadowColor: '#10b981',
  },
  notifBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  installRow: {
    flexDirection: 'row',
    gap: 10,
  },
  installBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  installBtnText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
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
  navButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  prevBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: theme.borderRadius.m,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prevBtnText: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: '700',
  },
  nextBtn: {
    flex: 1,
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

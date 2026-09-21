import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  SafeAreaView,
  Dimensions,
  Linking,
  ActivityIndicator,
  Platform,
  StatusBar,
  Animated,
} from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { sounds } from '../lib/sounds';
import * as Haptics from 'expo-haptics';

interface Props {
  onComplete: () => void;
}

interface AdItem {
  id: string;
  image_url: string;
  link_url?: string | null;
}

const FALLBACK_ADS: AdItem[] = [
  {
    id: 'ad-1',
    image_url: 'https://jnejvuprgreghfucnswv.supabase.co/storage/v1/object/public/ads/WhatsApp%20Image%202026-06-12%20at%204.11.47%20PM.jpeg',
    link_url: null,
  },
  {
    id: 'ad-2',
    image_url: 'https://jnejvuprgreghfucnswv.supabase.co/storage/v1/object/public/ads/WhatsApp%20Image%202026-06-12%20at%205.05.25%20PM(1).jpeg',
    link_url: null,
  },
  {
    id: 'ad-3',
    image_url: 'https://jnejvuprgreghfucnswv.supabase.co/storage/v1/object/public/ads/WhatsApp%20Image%202026-06-18%20at%203.30.54%20PM.jpeg',
    link_url: null,
  },
];

export const SplashAdScreen: React.FC<Props> = ({ onComplete }) => {
  const [timeLeft, setTimeLeft] = useState(5);
  const [canClose, setCanClose] = useState(false);
  const [adImageUrl, setAdImageUrl] = useState<string | null>(null);
  const [adLinkUrl, setAdLinkUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const closeBtnScale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    fetchRandomAd();
  }, []);

  const fetchRandomAd = async () => {
    try {
      const { data, error } = await supabase
        .from('ads')
        .select('*')
        .eq('is_active', true);

      const adsList: AdItem[] = (data && data.length > 0 && !error) ? data : FALLBACK_ADS;
      const randomIndex = Math.floor(Math.random() * adsList.length);
      const selected = adsList[randomIndex];

      setAdImageUrl(selected.image_url);
      if (selected.link_url) {
        setAdLinkUrl(selected.link_url);
      }
    } catch (e) {
      console.warn('Error fetching ad from Supabase, using fallback:', e);
      const randomIndex = Math.floor(Math.random() * FALLBACK_ADS.length);
      setAdImageUrl(FALLBACK_ADS[randomIndex].image_url);
    } finally {
      setIsLoading(false);
    }
  };

  // Temporizador de 5 segundos
  useEffect(() => {
    if (!isLoading) {
      if (timeLeft > 0) {
        const timer = setTimeout(() => {
          setTimeLeft((prev) => prev - 1);
        }, 1000);
        return () => clearTimeout(timer);
      } else {
        setCanClose(true);
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        sounds.playSound('pop');
        Animated.spring(closeBtnScale, {
          toValue: 1,
          friction: 4,
          tension: 80,
          useNativeDriver: true,
        }).start();
      }
    }
  }, [timeLeft, isLoading]);

  const handleClose = () => {
    if (!canClose) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    sounds.playSound('pop');
    onComplete();
  };

  const handlePressAd = () => {
    if (adLinkUrl) {
      Linking.openURL(adLinkUrl).catch((err) =>
        console.error('No se pudo abrir el enlace de la publicidad', err)
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Barra Superior con Badge y Botón de Cierre / Contador */}
      <View style={styles.topBar}>
        <View style={styles.sponsoredBadge}>
          <Text style={styles.sponsoredText}>📢 Publicidad</Text>
        </View>

        {canClose ? (
          <Animated.View style={{ transform: [{ scale: closeBtnScale }] }}>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.closeText}>✕ Quitar Publicidad</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <View style={styles.timerBadge}>
            <Text style={styles.timerText}>Cerrar en {timeLeft}s</Text>
          </View>
        )}
      </View>

      {/* Contenido del Anuncio */}
      <View style={styles.adContainer}>
        {isLoading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.loaderText}>Cargando anuncio...</Text>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={adLinkUrl ? 0.9 : 1}
            onPress={handlePressAd}
            style={styles.imageWrapper}
          >
            <Image
              source={
                imageError || !adImageUrl
                  ? require('../../assets/fake_ad.jpg')
                  : { uri: adImageUrl }
              }
              style={styles.image}
              resizeMode="contain"
              onError={() => setImageError(true)}
            />

            {adLinkUrl && (
              <View style={styles.linkPrompt}>
                <Text style={styles.linkPromptText}>🔗 Toca aquí para ver más detalles ➜</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Barra Inferior Informativa */}
      <View style={styles.footerBar}>
        <Text style={styles.footerText}>Domino del Cafetín • PeSiMistas</Text>
      </View>
    </SafeAreaView>
  );
};

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07080a',
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 36 : 14,
    paddingBottom: 12,
    zIndex: 10,
  },
  sponsoredBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  sponsoredText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  timerBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  timerText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '800',
  },
  closeBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#60a5fa',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 5,
  },
  closeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  adContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    maxWidth: 550,
  },
  linkPrompt: {
    position: 'absolute',
    bottom: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  linkPromptText: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: 'bold',
  },
  footerBar: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  footerText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, SafeAreaView, Dimensions, Linking } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';

interface Props {
  onComplete: () => void;
}

export const SplashAdScreen: React.FC<Props> = ({ onComplete }) => {
  const [timeLeft, setTimeLeft] = useState(5);
  const [canClose, setCanClose] = useState(false);
  const [adImageUrl, setAdImageUrl] = useState<string | null>(null);
  const [adLinkUrl, setAdLinkUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAd();
  }, []);

  const fetchAd = async () => {
    try {
      const { data, error } = await supabase
        .from('ads')
        .select('*')
        .eq('is_active', true);
      
      if (data && data.length > 0 && !error) {
        const randomIndex = Math.floor(Math.random() * data.length);
        const randomAd = data[randomIndex];

        setAdImageUrl(randomAd.image_url);
        if (randomAd.link_url) {
          setAdLinkUrl(randomAd.link_url);
        }
      }
    } catch (e) {
      console.log('Error fetching ad:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Solo empezamos a descontar el tiempo si ya terminó de cargar
    if (!isLoading) {
      if (timeLeft > 0) {
        const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
        return () => clearTimeout(timer);
      } else {
        setCanClose(true);
      }
    }
  }, [timeLeft, isLoading]);

  const handlePressAd = () => {
    if (adLinkUrl) {
      Linking.openURL(adLinkUrl).catch(err => console.error("No se pudo abrir la URL", err));
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.adContainer, { justifyContent: 'center', alignItems: 'center' }]}>
          <Text style={{ color: theme.colors.textDim }}>Cargando anuncio...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const adContent = (
    <Image 
      source={adImageUrl ? { uri: adImageUrl } : require('../../assets/fake_ad.jpg')} 
      style={styles.image}
      resizeMode="contain"
    />
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.adContainer}>
        {adLinkUrl ? (
          <TouchableOpacity activeOpacity={0.9} onPress={handlePressAd} style={styles.imageWrapper}>
            {adContent}
          </TouchableOpacity>
        ) : (
          <View style={styles.imageWrapper}>
            {adContent}
          </View>
        )}

        <View style={styles.timerBadge}>
          {canClose ? (
            <TouchableOpacity onPress={onComplete} style={styles.closeBtn}>
              <Text style={styles.closeText}>X Cerrar Anuncio</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.timerText}>Anuncio: {timeLeft}s</Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  adContainer: {
    flex: 1,
    position: 'relative',
  },
  imageWrapper: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  timerBadge: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: theme.spacing.m,
    paddingVertical: theme.spacing.s,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  timerText: {
    color: theme.colors.textDim,
    fontSize: 14,
    fontWeight: 'bold',
  },
  closeBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.m,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.borderRadius.full,
  },
  closeText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  }
});

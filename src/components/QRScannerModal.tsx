import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Platform, Alert, ActivityIndicator } from 'react-native';
import jsQR from 'jsqr';
import { theme } from '../theme';
import { sounds } from '../lib/sounds';
import * as ImagePicker from 'expo-image-picker';

interface Props {
  visible: boolean;
  onClose: () => void;
  onScanSuccess: (code: string) => void;
}

export const QRScannerModal: React.FC<Props> = ({ visible, onClose, onScanSuccess }) => {
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    let isCancelled = false;

    if (visible && Platform.OS === 'web') {
      startWebScanner(() => isCancelled);
    } else {
      stopWebScanner();
    }

    return () => {
      isCancelled = true;
      stopWebScanner();
    };
  }, [visible]);

  const extractCode = (rawData: string): string => {
    if (!rawData) return '';
    try {
      let toParse = rawData.trim();
      if (!toParse.startsWith('http://') && !toParse.startsWith('https://') && toParse.includes('/?')) {
        toParse = 'https://' + toParse;
      }
      if (toParse.includes('?') || toParse.startsWith('http')) {
        const url = new URL(toParse);
        const code = url.searchParams.get('invite') || url.searchParams.get('code') || url.searchParams.get('ref');
        if (code) return code.trim().toUpperCase();
      }
    } catch {
      // Ignorar error de URL inválida
    }

    // Extracción directa por expresión regular en caso de URLs complejas
    const match = rawData.match(/(?:invite|code|ref)=([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      return match[1].trim().toUpperCase();
    }

    return rawData.trim().toUpperCase();
  };

  const attachStreamToVideo = async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream) {
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      video.setAttribute('playsinline', 'true');
      try {
        await video.play();
      } catch (e) {
        console.warn('Video play caught:', e);
      }
      if (!animFrameRef.current) {
        scanFrame();
      }
    }
  };

  const startWebScanner = async (checkCancelled?: () => boolean) => {
    setScanning(true);
    setHasCameraPermission(null);
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setHasCameraPermission(false);
        setScanning(false);
        return;
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }
        });
      } catch (err1) {
        try {
          // Fallback a cualquier cámara disponible si environment falla
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (err2) {
          console.warn('Camera access denied or failed:', err2);
          setHasCameraPermission(false);
          setScanning(false);
          return;
        }
      }

      if (checkCancelled && checkCancelled()) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      setHasCameraPermission(true);

      await attachStreamToVideo();

      // Sondeo de respaldo por si el elemento <video> aún está completando el ciclo de renderizado
      setTimeout(() => {
        if (streamRef.current && videoRef.current) {
          attachStreamToVideo();
        }
      }, 120);
    } catch (err) {
      console.warn('Camera access error:', err);
      setHasCameraPermission(false);
      setScanning(false);
    }
  };

  const stopWebScanner = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const scanFrame = () => {
    const video = videoRef.current;
    let canvas = canvasRef.current;

    if (!canvas && typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvasRef.current = canvas;
    }

    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (code && code.data) {
      const extracted = extractCode(code.data);
      sounds.playSound('pop');
      stopWebScanner();
      onScanSuccess(extracted);
      return;
    }

    animFrameRef.current = requestAnimationFrame(scanFrame);
  };

  const handlePickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      if (result.canceled || !result.assets || !result.assets[0]) return;

      const imageUri = result.assets[0].uri;

      if (Platform.OS === 'web') {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imgData.data, imgData.width, imgData.height);
          if (code && code.data) {
            sounds.playSound('pop');
            stopWebScanner();
            onScanSuccess(extractCode(code.data));
          } else {
            Alert.alert('Código No Encontrado', 'No pudimos detectar un código QR en esa imagen. Intenta con una foto más clara.');
          }
        };
        img.src = imageUri;
      } else {
        Alert.alert('Lector de Fotos', 'Selecciona o toma una foto del código QR.');
      }
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo leer la imagen.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>📷 Escáner de Código QR</Text>
              <Text style={styles.subtitle}>Apunta tu cámara al QR de invitación</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Camera Viewport */}
          <View style={styles.cameraBox}>
            {Platform.OS === 'web' ? (
              <>
                <video
                  ref={(el: any) => {
                    videoRef.current = el;
                    if (el && streamRef.current) {
                      attachStreamToVideo();
                    }
                  }}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: 16,
                  }}
                  autoPlay
                  muted
                  playsInline
                />
                <canvas ref={canvasRef as any} style={{ display: 'none' }} />
                
                {/* Visual Target Frame */}
                <View style={styles.targetFrame}>
                  <View style={[styles.corner, styles.topLeft]} />
                  <View style={[styles.corner, styles.topRight]} />
                  <View style={[styles.corner, styles.bottomLeft]} />
                  <View style={[styles.corner, styles.bottomRight]} />
                  <View style={styles.laserLine} />
                </View>
              </>
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: '#fff', textAlign: 'center' }}>
                  Abre la galería o toma una foto del código QR.
                </Text>
              </View>
            )}

            {hasCameraPermission === false && (
              <View style={styles.noPermissionOverlay}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>📷⚠️</Text>
                <Text style={{ color: '#ef4444', fontWeight: 'bold', textAlign: 'center', marginBottom: 6 }}>
                  Permiso de Cámara Denegado o No Disponible
                </Text>
                <Text style={{ color: theme.colors.textDim, fontSize: 12, textAlign: 'center', paddingHorizontal: 16 }}>
                  Puedes subir una foto del código QR desde tu galería usando el botón abajo.
                </Text>
              </View>
            )}
          </View>

          {/* Actions */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.galleryBtn}
              onPress={handlePickImage}
              activeOpacity={0.8}
            >
              <Text style={styles.galleryBtnText}>🖼️ Seleccionar Foto de QR</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Text style={styles.cancelBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#111318',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(59, 130, 246, 0.4)',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    color: theme.colors.textDim,
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cameraBox: {
    width: '100%',
    height: 280,
    borderRadius: 16,
    backgroundColor: '#000',
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  targetFrame: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
    borderRadius: 16,
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: '#3b82f6',
  },
  topLeft: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 8,
  },
  topRight: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 8,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 8,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 8,
  },
  laserLine: {
    position: 'absolute',
    top: '50%',
    left: 10,
    right: 10,
    height: 2,
    backgroundColor: '#3b82f6',
    shadowColor: '#60a5fa',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  noPermissionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#111318',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  actionsRow: {
    gap: 10,
  },
  galleryBtn: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1.5,
    borderColor: '#3b82f6',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  galleryBtnText: {
    color: '#60a5fa',
    fontWeight: '800',
    fontSize: 14,
  },
  cancelBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: theme.colors.textDim,
    fontWeight: '700',
    fontSize: 14,
  },
});

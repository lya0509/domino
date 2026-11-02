import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { theme } from '../theme';
import { VipCard } from './VipCard';
import { VIP_GOLD, VipRing } from './VipRing';
import { fetchVipConfig, MyVip, pickImage, PickedImage, requestVip, VipConfig } from '../lib/vipService';

interface Props {
  visible: boolean;
  onClose: () => void;
  userId: string;
  name: string;
  initials?: string | null;
  avatarUrl?: string | null;
  myVip: MyVip | null;
  onSubmitted: () => void;
}

const PERKS = [
  'Borde dorado animado y corona ♛ en tu foto, en las mesas de dominó, UNO y póker y en los rankings.',
  'Tu tarjeta VIP que flota y se voltea, con tu foto o GIF y tu frase.',
  'Tu corona en el chat y en la partida en vivo: todos saben que eres VIP.',
  'Solo estilo: no da puntos ni ventajas en el juego.',
];

/** What VIP includes, a sample card, and the form to send the payment receipt. */
export const VipOfferModal: React.FC<Props> = ({ visible, onClose, userId, name, initials, avatarUrl, myVip, onSubmitted }) => {
  const [config, setConfig] = useState<VipConfig | null>(null);
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState<PickedImage | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (visible) fetchVipConfig().then(setConfig);
  }, [visible]);

  const pending = myVip?.request?.status === 'pending';
  const rejected = myVip?.request?.status === 'rejected' ? myVip.request : null;
  const renewing = !!myVip?.active;

  const pick = async () => {
    try {
      const img = await pickImage();
      if (img) setReceipt(img);
    } catch (e: any) {
      Alert.alert('No se pudo abrir la galería', e?.message || 'Intenta de nuevo.');
    }
  };

  const send = async () => {
    if (reference.trim().length < 4) return Alert.alert('Falta la referencia', 'Escribe la referencia del pago (al menos 4 caracteres).');
    if (!receipt) return Alert.alert('Falta el comprobante', 'Sube la foto del comprobante de pago.');
    setSending(true);
    try {
      await requestVip(userId, reference.trim(), receipt);
      setReference('');
      setReceipt(null);
      onSubmitted();
      Alert.alert('¡Solicitud enviada!', 'Un administrador revisará tu pago. Te llegará un aviso cuando esté listo.');
    } catch (e: any) {
      Alert.alert('No se pudo enviar', e?.message || 'Intenta de nuevo.');
    } finally {
      setSending(false);
    }
  };

  const sampleFront = (
    <View style={styles.sampleFront}>
      <Text style={styles.sampleClub}>DOMINO DEL CAFETÍN</Text>
      <VipRing active size={64}>
        <View style={styles.sampleAvatar}>
          {avatarUrl ? <Image source={{ uri: avatarUrl }} style={styles.sampleAvatarImg} /> : <Text style={styles.sampleInitials}>{initials}</Text>}
        </View>
      </VipRing>
      <Text style={styles.sampleName} numberOfLines={1}>{name}</Text>
      <Text style={styles.sampleState}>♛ VIP ACTIVO</Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{renewing ? '♛ Renueva tu VIP' : '♛ Hazte VIP'}</Text>
            <Text style={styles.price}>{config?.priceText ?? '5 USD al mes, al cambio BCV del día'}</Text>

            <View style={{ marginVertical: 14 }}>
              <VipCard front={sampleFront} back={{ name, initials, avatarUrl, tagline: 'Así se ve tu tarjeta por detrás' }} autoFlip={visible} showHint={false} />
            </View>

            {PERKS.map((p) => (
              <Text key={p} style={styles.perk}>✦ {p}</Text>
            ))}

            {pending ? (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle}>⏳ Tu solicitud está en revisión</Text>
                <Text style={styles.noticeText}>
                  La enviaste el {new Date(myVip!.request!.created_at).toLocaleDateString()}. Te llegará un aviso cuando un administrador la revise.
                </Text>
              </View>
            ) : (
              <>
                {rejected && (
                  <View style={[styles.notice, { borderColor: 'rgba(239,68,68,0.5)' }]}>
                    <Text style={[styles.noticeTitle, { color: '#f87171' }]}>Tu última solicitud fue rechazada</Text>
                    <Text style={styles.noticeText}>{rejected.reason || 'No se pudo confirmar el pago'}. Puedes enviarla de nuevo.</Text>
                  </View>
                )}

                <Text style={styles.section}>1. Paga al asesor</Text>
                <Text style={styles.payInfo}>{config?.paymentInfo || 'Pídele los datos de pago al asesor del café.'}</Text>

                <Text style={styles.section}>2. Escribe la referencia</Text>
                <TextInput
                  style={styles.input}
                  value={reference}
                  onChangeText={setReference}
                  placeholder="Ej: 0102-12345678"
                  placeholderTextColor="#666"
                  maxLength={40}
                />

                <Text style={styles.section}>3. Sube el comprobante</Text>
                <TouchableOpacity style={styles.pickBtn} onPress={pick} accessibilityRole="button">
                  {receipt ? (
                    <Image source={{ uri: receipt.previewUri }} style={styles.receiptPreview} resizeMode="contain" />
                  ) : (
                    <Text style={styles.pickText}>📷 Elegir foto del comprobante</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.6 }]} onPress={send} disabled={sending} accessibilityRole="button">
                  {sending ? <ActivityIndicator color="#1a1205" /> : <Text style={styles.sendText}>Enviar solicitud</Text>}
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button">
              <Text style={styles.closeText}>Cerrar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.sheet,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    borderTopWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  title: { color: VIP_GOLD, fontSize: 24, fontWeight: '900', textAlign: 'center' },
  price: { color: theme.colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  sampleFront: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: VIP_GOLD,
    backgroundColor: '#1a1d24',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 16,
    minHeight: 260,
    justifyContent: 'center',
  },
  sampleClub: { color: VIP_GOLD, fontWeight: '900', letterSpacing: 1.5, fontSize: 12, marginBottom: 12 },
  sampleAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sampleAvatarImg: { width: '100%', height: '100%' },
  sampleInitials: { color: '#fff', fontSize: 22, fontWeight: '900' },
  sampleName: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 10 },
  sampleState: { color: VIP_GOLD, fontSize: 12, fontWeight: '900', marginTop: 4, letterSpacing: 1 },
  perk: { color: theme.colors.text, fontSize: 14, lineHeight: 20, marginBottom: 6 },
  section: { color: VIP_GOLD, fontWeight: '900', fontSize: 14, marginTop: 16, marginBottom: 6 },
  payInfo: {
    color: theme.colors.text,
    fontSize: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 12,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    fontSize: 15,
  },
  pickBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(251,191,36,0.6)',
    borderRadius: 12,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  pickText: { color: VIP_GOLD, fontWeight: '700' },
  receiptPreview: { width: '100%', height: 180 },
  sendBtn: { backgroundColor: VIP_GOLD, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  sendText: { color: '#1a1205', fontWeight: '900', fontSize: 16 },
  notice: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.5)',
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(251,191,36,0.06)',
  },
  noticeTitle: { color: VIP_GOLD, fontWeight: '900', marginBottom: 4 },
  noticeText: { color: theme.colors.text, fontSize: 13, lineHeight: 18 },
  closeBtn: { alignSelf: 'center', padding: 14, marginTop: 4 },
  closeText: { color: theme.colors.textDim, fontWeight: '700' },
});

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { theme } from '../theme';
import { VIP_GOLD } from './VipRing';
import { MyVip, pickImage, setVipTagline, submitVipMedia, vipDaysLeft, vipMediaUrl } from '../lib/vipService';

/** The VIP's own corner: days left, renew, photo or GIF for the card, and the phrase. */
export const VipStudio: React.FC<{ userId: string; myVip: MyVip; onChanged: () => void; onRenew: () => void }> = ({
  userId,
  myVip,
  onChanged,
  onRenew,
}) => {
  const [tagline, setTagline] = useState(myVip.tagline ?? '');
  const [busy, setBusy] = useState<'media' | 'tagline' | null>(null);

  useEffect(() => setTagline(myVip.tagline ?? ''), [myVip.tagline]);

  const days = vipDaysLeft(myVip.vip_until);
  const until = myVip.vip_until ? new Date(myVip.vip_until).toLocaleDateString() : '';
  const pendingUrl = vipMediaUrl(myVip.pending_media_path);
  const renewPending = myVip.request?.status === 'pending';

  const changeMedia = async () => {
    try {
      const img = await pickImage({ keepAnimation: true });
      if (!img) return;
      setBusy('media');
      await submitVipMedia(userId, img, [myVip.media_path]);
      onChanged();
      Alert.alert('¡Listo!', 'Tu foto quedó por aprobar. Te llegará un aviso cuando la aprueben.');
    } catch (e: any) {
      Alert.alert('No se pudo subir', e?.message || 'Intenta de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  const saveTagline = async () => {
    setBusy('tagline');
    try {
      await setVipTagline(tagline);
      onChanged();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intenta de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>♛ Tu VIP</Text>
      <Text style={[styles.until, days <= 3 && { color: '#f87171' }]}>
        Activo hasta el {until} ({days} {days === 1 ? 'día' : 'días'})
      </Text>
      {renewPending ? (
        <Text style={styles.muted}>⏳ Tu renovación está en revisión.</Text>
      ) : (
        <TouchableOpacity style={styles.renew} onPress={onRenew} accessibilityRole="button">
          <Text style={styles.renewText}>Renovar VIP</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.section}>Foto o GIF de tu tarjeta</Text>
      {pendingUrl ? (
        <View style={styles.pendingRow}>
          <Image source={{ uri: pendingUrl }} style={styles.thumb} />
          <Text style={[styles.muted, { flex: 1 }]}>⏳ Esperando aprobación. Mientras tanto se ve tu foto de perfil.</Text>
        </View>
      ) : null}
      <TouchableOpacity style={styles.mediaBtn} onPress={changeMedia} disabled={busy === 'media'} accessibilityRole="button">
        {busy === 'media' ? <ActivityIndicator color={VIP_GOLD} /> : <Text style={styles.mediaText}>🖼️ {myVip.media_path ? 'Cambiar foto o GIF' : 'Subir foto o GIF'}</Text>}
      </TouchableOpacity>
      <Text style={styles.muted}>Hasta 4 MB. Un administrador la aprueba antes de que se vea.</Text>

      <Text style={styles.section}>Tu frase (detrás de la tarjeta)</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={tagline}
          onChangeText={setTagline}
          maxLength={60}
          placeholder="Ej: El rey del capicúa"
          placeholderTextColor="#666"
        />
        <TouchableOpacity style={styles.save} onPress={saveTagline} disabled={busy === 'tagline'} accessibilityRole="button">
          {busy === 'tagline' ? <ActivityIndicator color="#1a1205" /> : <Text style={styles.saveText}>Guardar</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(251,191,36,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  title: { color: VIP_GOLD, fontSize: 18, fontWeight: '900' },
  until: { color: theme.colors.text, marginTop: 4, fontWeight: '700' },
  renew: { alignSelf: 'flex-start', backgroundColor: VIP_GOLD, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, marginTop: 10 },
  renewText: { color: '#1a1205', fontWeight: '900' },
  section: { color: VIP_GOLD, fontWeight: '800', marginTop: 16, marginBottom: 6 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  thumb: { width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderColor: VIP_GOLD },
  mediaBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(251,191,36,0.6)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 4,
  },
  mediaText: { color: VIP_GOLD, fontWeight: '700' },
  muted: { color: theme.colors.textDim, fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 10,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  save: { backgroundColor: VIP_GOLD, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  saveText: { color: '#1a1205', fontWeight: '900' },
});

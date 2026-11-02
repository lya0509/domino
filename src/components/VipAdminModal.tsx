import React, { useCallback, useEffect, useState } from 'react';
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
import { VIP_GOLD } from './VipRing';
import {
  fetchVipConfig,
  listVipMediaPending,
  listVipRequests,
  receiptUrl,
  reviewVipMedia,
  reviewVipRequest,
  saveVipSettings,
  vipMediaUrl,
  VipMediaRow,
  VipRequestRow,
} from '../lib/vipService';

type Tab = 'requests' | 'media' | 'settings';

const STATUS_LABEL: Record<VipRequestRow['status'], string> = {
  pending: '⏳ En revisión',
  approved: '✅ Aprobada',
  rejected: '❌ Rechazada',
};

const RequestCard: React.FC<{ row: VipRequestRow; onDone: () => void; onZoom: (uri: string) => void }> = ({ row, onDone, onZoom }) => {
  const [receipt, setReceipt] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    receiptUrl(row.receipt_path).then(setReceipt);
  }, [row.receipt_path]);

  const act = async (approve: boolean) => {
    setBusy(true);
    try {
      await reviewVipRequest(row.id, approve, approve ? undefined : reason.trim() || undefined);
      onDone();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    Alert.alert('Aprobar VIP', `¿Confirmaste en tu banco el pago de ${row.display_name} con referencia ${row.reference}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Aprobar', onPress: () => act(true) },
    ]);

  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <View style={styles.avatar}>
          {row.avatar_url ? <Image source={{ uri: row.avatar_url }} style={styles.avatarImg} /> : <Text style={styles.avatarTxt}>{(row.display_name || '?').slice(0, 2).toUpperCase()}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{row.display_name}</Text>
          <Text style={styles.meta}>Ref: <Text style={{ color: theme.colors.text, fontWeight: '800' }}>{row.reference}</Text></Text>
          <Text style={styles.meta}>{new Date(row.created_at).toLocaleString()}</Text>
          {row.vip_until && new Date(row.vip_until) > new Date() && (
            <Text style={styles.meta}>Ya es VIP hasta el {new Date(row.vip_until).toLocaleDateString()} (se le suman los días)</Text>
          )}
        </View>
        <Text style={styles.status}>{STATUS_LABEL[row.status]}</Text>
      </View>

      <TouchableOpacity onPress={() => receipt && onZoom(receipt)} disabled={!receipt} style={styles.receiptBox} accessibilityLabel="Ver comprobante">
        {receipt ? <Image source={{ uri: receipt }} style={styles.receipt} resizeMode="contain" /> : <ActivityIndicator color={VIP_GOLD} />}
      </TouchableOpacity>

      {row.status === 'rejected' && !!row.reason && <Text style={styles.meta}>Motivo: {row.reason}</Text>}

      {row.status === 'pending' && (
        rejecting ? (
          <View>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="Motivo (ej: la referencia no aparece)"
              placeholderTextColor="#666"
              maxLength={120}
            />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setRejecting(false)}>
                <Text style={styles.btnGhostText}>Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnNo]} onPress={() => act(false)} disabled={busy}>
                <Text style={styles.btnText}>Rechazar</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.btnNo]} onPress={() => setRejecting(true)} disabled={busy}>
              <Text style={styles.btnText}>Rechazar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnYes]} onPress={approve} disabled={busy}>
              {busy ? <ActivityIndicator color="#1a1205" /> : <Text style={[styles.btnText, { color: '#1a1205' }]}>Aprobar</Text>}
            </TouchableOpacity>
          </View>
        )
      )}
    </View>
  );
};

/** Admin panel: payment requests, card photos waiting for approval, price and payment details. */
export const VipAdminModal: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
  const [tab, setTab] = useState<Tab>('requests');
  const [showAll, setShowAll] = useState(false);
  const [requests, setRequests] = useState<VipRequestRow[]>([]);
  const [media, setMedia] = useState<VipMediaRow[]>([]);
  const [price, setPrice] = useState('');
  const [payInfo, setPayInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, m, c] = await Promise.all([listVipRequests(showAll ? null : 'pending'), listVipMediaPending(), fetchVipConfig()]);
      setRequests(r);
      setMedia(m);
      if (c) {
        setPrice(c.priceText);
        setPayInfo(c.paymentInfo);
      }
    } catch (e: any) {
      Alert.alert('No se pudo cargar', e?.message || 'Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const reviewMedia = async (userId: string, approve: boolean) => {
    try {
      await reviewVipMedia(userId, approve);
      load();
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intenta de nuevo.');
    }
  };

  const saveSettings = async () => {
    try {
      await saveVipSettings(price, payInfo);
      Alert.alert('Guardado', 'Los socios ya ven el precio y los datos de pago nuevos.');
    } catch (e: any) {
      Alert.alert('No se pudo guardar', e?.message || 'Intenta de nuevo.');
    }
  };

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>♛ Panel VIP</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Cerrar">
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.tabs}>
            {([
              ['requests', `Solicitudes${pendingCount ? ` (${pendingCount})` : ''}`],
              ['media', `Fotos${media.length ? ` (${media.length})` : ''}`],
              ['settings', 'Ajustes'],
            ] as [Tab, string][]).map(([id, label]) => (
              <TouchableOpacity key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabOn]}>
                <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            {loading && <ActivityIndicator color={VIP_GOLD} style={{ marginVertical: 12 }} />}

            {tab === 'requests' && (
              <>
                <TouchableOpacity onPress={() => setShowAll((v) => !v)} style={{ alignSelf: 'flex-end', marginBottom: 8 }}>
                  <Text style={{ color: VIP_GOLD, fontWeight: '700' }}>{showAll ? 'Ver solo pendientes' : 'Ver historial'}</Text>
                </TouchableOpacity>
                {!loading && requests.length === 0 && <Text style={styles.empty}>No hay solicitudes {showAll ? '' : 'pendientes'}.</Text>}
                {requests.map((r) => (
                  <RequestCard key={r.id} row={r} onDone={load} onZoom={setZoom} />
                ))}
              </>
            )}

            {tab === 'media' && (
              <>
                {!loading && media.length === 0 && <Text style={styles.empty}>No hay fotos por aprobar.</Text>}
                {media.map((m) => {
                  const uri = vipMediaUrl(m.pending_media_path);
                  return (
                    <View key={m.user_id} style={styles.card}>
                      <Text style={styles.name}>{m.display_name}</Text>
                      <TouchableOpacity onPress={() => uri && setZoom(uri)} style={styles.receiptBox}>
                        {uri && <Image source={{ uri }} style={styles.receipt} resizeMode="contain" />}
                      </TouchableOpacity>
                      <View style={styles.actions}>
                        <TouchableOpacity style={[styles.btn, styles.btnNo]} onPress={() => reviewMedia(m.user_id, false)}>
                          <Text style={styles.btnText}>Rechazar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.btn, styles.btnYes]} onPress={() => reviewMedia(m.user_id, true)}>
                          <Text style={[styles.btnText, { color: '#1a1205' }]}>Aprobar</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </>
            )}

            {tab === 'settings' && (
              <View>
                <Text style={styles.label}>Precio que ven los socios</Text>
                <TextInput style={styles.input} value={price} onChangeText={setPrice} maxLength={120} placeholderTextColor="#666" />
                <Text style={styles.label}>Datos de pago (pago móvil del asesor, etc.)</Text>
                <TextInput
                  style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
                  value={payInfo}
                  onChangeText={setPayInfo}
                  maxLength={500}
                  multiline
                  placeholder="Banco, teléfono y cédula del asesor"
                  placeholderTextColor="#666"
                />
                <TouchableOpacity style={[styles.btn, styles.btnYes, { marginTop: 14 }]} onPress={saveSettings}>
                  <Text style={[styles.btnText, { color: '#1a1205' }]}>Guardar</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <TouchableOpacity style={styles.zoomBg} activeOpacity={1} onPress={() => setZoom(null)}>
          {zoom && <Image source={{ uri: zoom }} style={styles.zoomImg} resizeMode="contain" />}
          <Text style={styles.zoomHint}>Toca para cerrar</Text>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.colors.sheet,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '92%',
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    borderTopWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 8 },
  title: { color: VIP_GOLD, fontSize: 20, fontWeight: '900' },
  close: { color: theme.colors.textDim, fontSize: 22, padding: 4 },
  tabs: { flexDirection: 'row', paddingHorizontal: 12, gap: 6 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
  tabOn: { backgroundColor: 'rgba(251,191,36,0.18)' },
  tabText: { color: theme.colors.textDim, fontWeight: '700', fontSize: 13 },
  tabTextOn: { color: VIP_GOLD },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  rowTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarTxt: { color: '#fff', fontWeight: '900' },
  name: { color: theme.colors.text, fontWeight: '900', fontSize: 15 },
  meta: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  status: { color: theme.colors.textDim, fontSize: 12, fontWeight: '700' },
  receiptBox: {
    marginTop: 10,
    height: 200,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  receipt: { width: '100%', height: '100%' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnYes: { backgroundColor: VIP_GOLD },
  btnNo: { backgroundColor: 'rgba(239,68,68,0.85)' },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.08)' },
  btnText: { color: '#fff', fontWeight: '900' },
  btnGhostText: { color: theme.colors.text, fontWeight: '700' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 10,
    color: theme.colors.text,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    marginTop: 8,
  },
  label: { color: VIP_GOLD, fontWeight: '800', marginTop: 12 },
  empty: { color: theme.colors.textDim, textAlign: 'center', marginTop: 24 },
  zoomBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  zoomImg: { width: '100%', height: '85%' },
  zoomHint: { color: '#aaa', marginTop: 10 },
});

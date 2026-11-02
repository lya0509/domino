import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, TextInput, Platform, StatusBar, Image } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { offlineSync } from '../lib/offlineSync';
import { Profile } from '../types';
import { RainbowText } from '../components/RainbowText';
import { useVip } from '../lib/vipService';
import {
  CATEGORIES,
  CUSTOM_MAX,
  customTitle,
  Equipped,
  EXCLUSIVE_NOTE,
  isEquipped,
  splitByOwnership,
  STORE_ITEMS,
  StoreItem,
  toggleEquip,
} from '../lib/storeCatalog';

import * as Haptics from 'expo-haptics';
import { sounds } from '../lib/sounds';

interface Props {
  onBack: () => void;
  currentUserProfileId: string;
}

const MAX_CUSTOM = CUSTOM_MAX;

export const StoreScreen: React.FC<Props> = ({ onBack, currentUserProfileId }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const vip = useVip(currentUserProfileId);

  // Custom title: buying it (250.000) or, once owned, changing the text for free
  const [customMode, setCustomMode] = useState<'buy' | 'edit' | null>(null);
  const [customText, setCustomText] = useState('');

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', currentUserProfileId).single();
      if (data) setProfile(data as Profile);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const applyProfile = (data: Profile) => {
    setProfile(data);
    offlineSync.updateCachedProfile(data);
  };

  const celebrate = () => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    sounds.playSound('chaching');
  };

  const handleBuy = (item: StoreItem) => {
    if (!profile) return;
    if ((profile.betting_points || 0) < item.price) {
      Alert.alert('Saldo insuficiente', `Te faltan ${(item.price - (profile.betting_points || 0)).toLocaleString('es-VE')} pts para ${item.name}.`);
      return;
    }
    if (item.isCustom) {
      setCustomText('');
      setCustomMode('buy');
      return;
    }
    Alert.alert('Confirmar compra', `¿Comprar ${item.name} por ${item.price.toLocaleString('es-VE')} pts? Te lo pones de una vez.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Comprar',
        onPress: async () => {
          setBusyId(item.id);
          try {
            // The server charges the catalog price, adds it to the inventory and puts it on
            const { data, error } = await supabase.rpc('buy_store_item', { p_item_id: item.id });
            if (error) throw error;
            celebrate();
            applyProfile(data as Profile);
            Alert.alert('¡Listo!', `Compraste y te pusiste ${item.name}. Lo encuentras en "Lo que tienes".`);
          } catch (err: any) {
            Alert.alert('Error', err?.message || 'No se pudo completar la compra.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  // Wearing or taking off something already owned (the server checks it is really yours)
  const saveEquipped = async (item: StoreItem, custom?: string) => {
    if (!profile) return;
    setBusyId(item.id);
    try {
      const next = toggleEquip(item, profile.equipped_items as Equipped, custom);
      const { data, error } = await supabase
        .from('profiles')
        .update({ equipped_items: next })
        .eq('id', profile.id)
        .select()
        .single();
      if (error) throw error;
      if (data) applyProfile(data as Profile);
    } catch {
      Alert.alert('Error', 'No se pudo cambiar lo que llevas puesto.');
    } finally {
      setBusyId(null);
    }
  };

  const submitCustom = async () => {
    const text = customText.trim();
    if (!profile || !text) return;
    const item = STORE_ITEMS.find((i) => i.isCustom)!;
    const mode = customMode;
    setCustomMode(null);
    if (mode === 'edit') {
      await saveEquipped(item, text);
      return;
    }
    setBusyId(item.id);
    try {
      const { data, error } = await supabase.rpc('buy_store_item', { p_item_id: item.id, p_custom_title: text });
      if (error) throw error;
      celebrate();
      applyProfile(data as Profile);
      Alert.alert('¡Listo!', `Ya llevas tu etiqueta: "${text}". Puedes cambiar el texto gratis cuando quieras.`);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo completar la compra.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 100 }} />
      </SafeAreaView>
    );
  }

  const equipped = (profile?.equipped_items || {}) as Equipped;
  const { owned, toBuy } = splitByOwnership(profile?.inventory as string[]);
  const tableItem = STORE_ITEMS.find((i) => i.type === 'table_color' && i.value === equipped.table_color);
  const points = profile?.betting_points || 0;

  const preview = (item: StoreItem, size = 44) => {
    if (item.type === 'title') return <Text style={{ fontSize: size * 0.5 }}>{item.isCustom ? '✏️' : item.name.split(' ')[0]}</Text>;
    if (item.type === 'color') {
      return item.value === 'rainbow'
        ? <RainbowText style={{ fontSize: size * 0.42, fontWeight: '900' }}>Aa</RainbowText>
        : <Text style={{ fontSize: size * 0.42, fontWeight: '900', color: item.value }}>Aa</Text>;
    }
    if (item.type === 'border') return <View style={{ width: size * 0.7, height: size * 0.7, borderRadius: size, borderWidth: 3, borderColor: item.value }} />;
    return <View style={{ width: size * 0.75, height: size * 0.5, borderRadius: 6, backgroundColor: item.value, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }} />;
  };

  const whereOf = (item: StoreItem) => CATEGORIES.find((c) => c.type === item.type)?.where || '';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tienda</Text>
        <View style={styles.pointsBadge}>
          <Text style={styles.pointsText}>🪙 {points.toLocaleString('es-VE')}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* How others see you right now */}
        <View style={styles.previewCard}>
          <Text style={styles.kicker}>Así te ven los demás</Text>
          <View style={styles.previewRow}>
            <View style={[styles.previewAvatar, equipped.border ? { borderColor: equipped.border, borderWidth: 3 } : null]}>
              {profile?.avatar_url
                ? <Image source={{ uri: profile.avatar_url }} style={styles.previewImg} />
                : <Text style={styles.previewInitials}>{profile?.initials || '?'}</Text>}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {equipped.color === 'rainbow' ? (
                <RainbowText style={styles.previewName} numberOfLines={1}>{profile?.display_name}</RainbowText>
              ) : (
                <Text style={[styles.previewName, equipped.color ? { color: equipped.color } : null]} numberOfLines={1}>{profile?.display_name}</Text>
              )}
              <Text style={styles.previewTitle} numberOfLines={1}>{equipped.title ? `⭐ ${equipped.title}` : 'Sin título puesto'}</Text>
              <Text style={styles.previewTable}>Tapete: {tableItem ? tableItem.name.replace('Tapete ', '') : 'el normal'}</Text>
            </View>
          </View>
          {vip ? (
            <Text style={styles.vipNote}>♛ Eres VIP: tu borde que gira, tu animación de victoria y tu tarjeta se eligen en Perfil → Tu VIP.</Text>
          ) : null}
        </View>

        {/* What you own */}
        <Text style={styles.sectionTitle}>🎒 Lo que tienes ({owned.length})</Text>
        <Text style={styles.sectionSub}>Toca "Ponérmelo" para usarlo. Solo llevas uno de cada tipo a la vez.</Text>
        {owned.length === 0 ? (
          <Text style={styles.empty}>Todavía no tienes cosméticos. Cómpralos abajo con tus puntos.</Text>
        ) : (
          owned.map((item) => {
            const on = isEquipped(item, equipped);
            const custom = item.isCustom ? customTitle(equipped) : null;
            return (
              <View key={item.id} style={[styles.ownedRow, on && styles.ownedRowOn]}>
                <View style={styles.ownedIcon}>{preview(item)}</View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.ownedName}>{item.isCustom ? (custom ? `"${custom}"` : 'Etiqueta personalizada') : item.name}</Text>
                  <Text style={styles.ownedWhere}>{item.isExclusive ? EXCLUSIVE_NOTE : whereOf(item)}</Text>
                  {on ? <Text style={styles.onBadge}>✓ Lo llevas puesto</Text> : null}
                </View>
                <View style={{ gap: 6 }}>
                  {item.isCustom && (
                    <TouchableOpacity style={styles.smallBtn} onPress={() => { setCustomText(custom || ''); setCustomMode('edit'); }} accessibilityRole="button">
                      <Text style={styles.smallBtnText}>{custom ? 'Cambiar' : 'Escribir'}</Text>
                    </TouchableOpacity>
                  )}
                  {(!item.isCustom || custom) && (
                    <TouchableOpacity
                      style={[styles.wearBtn, on && styles.wearBtnOn]}
                      onPress={() => saveEquipped(item)}
                      disabled={busyId === item.id}
                      accessibilityRole="button"
                      accessibilityLabel={on ? `Quitarme ${item.name}` : `Ponerme ${item.name}`}
                    >
                      {busyId === item.id
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <Text style={[styles.wearBtnText, on && styles.wearBtnTextOn]}>{on ? 'Quitar' : 'Ponérmelo'}</Text>}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}

        {/* What is left to buy, by kind */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>🛒 Por comprar</Text>
        <Text style={styles.sectionSub}>Se paga con tus puntos y te lo pones de una vez.</Text>
        {CATEGORIES.map((cat) => {
          const items = toBuy.filter((i) => i.type === cat.type);
          if (!items.length) return null;
          return (
            <View key={cat.type} style={{ marginBottom: 18 }}>
              <Text style={styles.catTitle}>{cat.label}</Text>
              <Text style={styles.catWhere}>{cat.where}</Text>
              <View style={styles.grid}>
                {items.map((item) => {
                  const short = !item.isExclusive && points < item.price;
                  return (
                    <View key={item.id} style={styles.itemCard}>
                      <View style={styles.itemIconContainer}>{preview(item, 56)}</View>
                      <Text style={styles.itemName}>{item.name}</Text>
                      {item.isExclusive ? (
                        <>
                          <View style={[styles.buyBtn, styles.buyBtnLocked]}>
                            <Text style={styles.buyBtnText}>🔒 Veteranos</Text>
                          </View>
                          <Text style={styles.lockNote}>{EXCLUSIVE_NOTE}</Text>
                        </>
                      ) : (
                        <TouchableOpacity
                          style={[styles.buyBtn, short && styles.buyBtnShort]}
                          onPress={() => handleBuy(item)}
                          disabled={busyId === item.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Comprar ${item.name} por ${item.price} puntos`}
                        >
                          {busyId === item.id
                            ? <ActivityIndicator size="small" color="#fff" />
                            : <Text style={styles.buyBtnText}>🪙 {item.price.toLocaleString('es-VE')}</Text>}
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
        {toBuy.filter((i) => !i.isExclusive).length === 0 && (
          <Text style={styles.empty}>¡Ya tienes todo lo de la tienda!</Text>
        )}
      </ScrollView>

      {/* Custom title */}
      <Modal visible={customMode !== null} transparent animationType="slide" onRequestClose={() => setCustomMode(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Etiqueta personalizada</Text>
            <Text style={styles.modalSub}>
              {customMode === 'edit'
                ? 'Escribe el nuevo texto. Cambiarlo es gratis.'
                : `Escribe la etiqueta que vas a lucir (máx. ${MAX_CUSTOM} letras). Después puedes cambiarla gratis.`}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Ej: El Rey del Dominó"
              placeholderTextColor={theme.colors.textDim}
              value={customText}
              onChangeText={setCustomText}
              maxLength={MAX_CUSTOM}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setCustomMode(null)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBuy, !customText.trim() && { opacity: 0.5 }]} onPress={submitCustom} disabled={!customText.trim()}>
                <Text style={styles.modalBuyText}>{customMode === 'edit' ? 'Guardar' : 'Comprar (250.000 pts)'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.l, paddingVertical: theme.spacing.m,
    borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder,
  },
  headerTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '800' },
  backBtn: { paddingVertical: 6 },
  backBtnText: { color: theme.colors.primary, fontSize: 15, fontWeight: '600' },
  pointsBadge: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    paddingHorizontal: 12, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  pointsText: { color: theme.colors.text, fontWeight: '800', fontSize: 14 },
  scroll: { padding: theme.spacing.l, paddingBottom: 48 },
  kicker: { color: theme.colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 },
  previewCard: { backgroundColor: theme.colors.sheet, borderRadius: theme.borderRadius.l, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: theme.spacing.m, marginBottom: 24 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  previewAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  previewImg: { width: '100%', height: '100%' },
  previewInitials: { color: '#fff', fontSize: 22, fontWeight: '900' },
  previewName: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  previewTitle: { color: theme.colors.accent, fontSize: 14, fontWeight: '700', marginTop: 2 },
  previewTable: { color: theme.colors.textDim, fontSize: 12, marginTop: 4 },
  vipNote: { color: '#fbbf24', fontSize: 12, marginTop: 12, lineHeight: 17 },
  sectionTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  sectionSub: { color: theme.colors.textDim, fontSize: 13, marginBottom: theme.spacing.m, marginTop: 4 },
  empty: { color: theme.colors.textDim, fontStyle: 'italic', paddingVertical: 12, textAlign: 'center' },
  ownedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.m, borderWidth: 1, borderColor: theme.colors.cardBorder, padding: 12, marginBottom: 10 },
  ownedRowOn: { borderColor: theme.colors.success, backgroundColor: 'rgba(16,185,129,0.06)' },
  ownedIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  ownedName: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  ownedWhere: { color: theme.colors.textDim, fontSize: 12, marginTop: 2, lineHeight: 16 },
  onBadge: { color: theme.colors.success, fontSize: 12, fontWeight: '800', marginTop: 4 },
  wearBtn: { backgroundColor: theme.colors.primary, borderRadius: theme.borderRadius.m, paddingVertical: 8, paddingHorizontal: 12, minWidth: 96, alignItems: 'center' },
  wearBtnOn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.textDim },
  wearBtnText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  wearBtnTextOn: { color: theme.colors.textDim },
  smallBtn: { borderRadius: theme.borderRadius.m, paddingVertical: 6, paddingHorizontal: 12, minWidth: 96, alignItems: 'center', backgroundColor: 'rgba(245,158,11,0.15)' },
  smallBtnText: { color: theme.colors.accent, fontWeight: '800', fontSize: 12 },
  catTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  catWhere: { color: theme.colors.textDim, fontSize: 12, marginTop: 2, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  itemCard: {
    width: '48%', backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.l,
    padding: theme.spacing.m, marginBottom: theme.spacing.m,
    borderWidth: 1, borderColor: theme.colors.cardBorder,
    alignItems: 'center',
  },
  itemIconContainer: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.s,
  },
  itemName: { color: theme.colors.text, fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: theme.spacing.s, minHeight: 36 },
  buyBtn: {
    backgroundColor: theme.colors.primary, width: '100%', paddingVertical: 8,
    borderRadius: theme.borderRadius.m, alignItems: 'center',
  },
  buyBtnShort: { opacity: 0.55 },
  buyBtnLocked: { backgroundColor: '#475569' },
  buyBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  lockNote: { color: theme.colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', backgroundColor: theme.colors.sheet, borderRadius: theme.borderRadius.l, padding: 24, borderWidth: 1, borderColor: theme.colors.cardBorder },
  modalTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  modalSub: { color: theme.colors.textDim, fontSize: 14, textAlign: 'center', marginBottom: 20 },
  modalInput: { backgroundColor: theme.colors.background, color: theme.colors.text, padding: 16, borderRadius: theme.borderRadius.m, fontSize: 16, borderWidth: 1, borderColor: theme.colors.primary, marginBottom: 24, textAlign: 'center', fontWeight: 'bold' },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between' },
  modalCancel: { flex: 1, padding: 16, alignItems: 'center', marginRight: 8 },
  modalCancelText: { color: theme.colors.textDim, fontWeight: 'bold', fontSize: 15 },
  modalBuy: { flex: 1.5, backgroundColor: theme.colors.primary, padding: 16, borderRadius: theme.borderRadius.m, alignItems: 'center' },
  modalBuyText: { color: theme.colors.background, fontWeight: 'bold', fontSize: 15 },
});

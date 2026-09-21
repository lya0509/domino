import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, TextInput, Platform, StatusBar } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';

import * as Haptics from 'expo-haptics';

interface Props {
  onBack: () => void;
  currentUserProfileId: string;
}

const STORE_ITEMS = [
  { id: 'title_rey', type: 'title', name: '👑 Rey del Zapato', price: 50000 },
  { id: 'title_custom', type: 'title', name: '✏️ Etiqueta Personalizada', price: 250000, isCustom: true },
  { id: 'title_veteran', type: 'title', name: '🏅 Superviviente', price: 0, isExclusive: true },
  { id: 'title_mala_suerte', type: 'title', name: '⛈️ Mala Suerte', price: 10000 },
  { id: 'title_millonario', type: 'title', name: '💰 Millonario', price: 100000 },
  { id: 'color_gold', type: 'color', name: 'Nombre Dorado', price: 80000, value: '#F59E0B' },
  { id: 'color_fire', type: 'color', name: 'Nombre Fuego', price: 60000, value: '#EF4444' },
  { id: 'color_rainbow', type: 'color', name: 'Nombre Arcoíris', price: 500000, value: 'rainbow' },
  { id: 'border_diamond', type: 'border', name: 'Marco Diamante', price: 150000, value: '#3B82F6' },
  { id: 'border_gold', type: 'border', name: 'Marco Oro', price: 100000, value: '#F59E0B' },
  { id: 'border_veteran', type: 'border', name: 'Marco Titanio', price: 0, value: '#94A3B8', isExclusive: true },
  { id: 'table_green', type: 'table_color', name: 'Tapete Verde Casino', price: 50000, value: '#064e3b' },
  { id: 'table_red', type: 'table_color', name: 'Tapete Rojo Imperial', price: 100000, value: '#7f1d1d' },
  { id: 'table_black', type: 'table_color', name: 'Tapete Negro VIP', price: 250000, value: '#0f172a' },
];

export const StoreScreen: React.FC<Props> = ({ onBack, currentUserProfileId }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  
  // Custom title modal
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customItemPending, setCustomItemPending] = useState<any>(null);

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

  const handleBuy = async (item: any) => {
    if (!profile) return;
    if ((profile.betting_points || 0) < item.price) {
      Alert.alert('Saldo Insuficiente', 'No tienes suficientes puntos de apuesta para comprar esto.');
      return;
    }

    if (item.isCustom) {
      setCustomItemPending(item);
      setCustomText('');
      setShowCustomModal(true);
      return;
    }

    Alert.alert(
      'Confirmar Compra',
      `¿Deseas comprar ${item.name} por ${item.price} pts?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Comprar',
          onPress: async () => {
            setBuyingId(item.id);
            try {
              const inventory = profile.inventory || [];
              if (inventory.includes(item.id)) {
                Alert.alert('Ya lo tienes', 'Ya has comprado este artículo.');
                setBuyingId(null);
                return;
              }

              const newPoints = (profile.betting_points || 0) - item.price;
              const newInventory = [...inventory, item.id];
              const equipped = { ...(profile.equipped_items || {}) };
              
              // Auto-equip
              if (item.type === 'title') equipped.title = item.name;
              if (item.type === 'color') equipped.color = item.value;
              if (item.type === 'border') equipped.border = item.value;
              if (item.type === 'table_color') equipped.table_color = item.value;

              const { data, error } = await supabase
                .from('profiles')
                .update({ 
                  betting_points: newPoints, 
                  inventory: newInventory,
                  equipped_items: equipped
                })
                .eq('id', profile.id)
                .select()
                .single();

              if (error) throw error;
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              setProfile(data as Profile);
              Alert.alert('¡Compra Exitosa!', `Has adquirido y equipado: ${item.name}`);
            } catch (err) {
              Alert.alert('Error', 'Hubo un problema al procesar la compra.');
            } finally {
              setBuyingId(null);
            }
          }
        }
      ]
    );
  };

  const handleBuyCustom = async () => {
    if (!profile || !customItemPending || !customText.trim()) return;
    
    if (customText.trim().length > 20) {
      Alert.alert('Muy largo', 'La etiqueta no puede tener más de 20 caracteres.');
      return;
    }

    setBuyingId(customItemPending.id);
    setShowCustomModal(false);
    
    try {
      const inventory = profile.inventory || [];
      const newPoints = (profile.betting_points || 0) - customItemPending.price;
      
      // Allow buying multiple custom titles, so we don't check inventory.includes()
      // But we still add it so it registers
      const newInventory = [...inventory, customItemPending.id];
      const equipped = { ...(profile.equipped_items || {}) };
      
      equipped.title = customText.trim();

      const { data, error } = await supabase
        .from('profiles')
        .update({ 
          betting_points: newPoints, 
          inventory: newInventory,
          equipped_items: equipped
        })
        .eq('id', profile.id)
        .select()
        .single();

      if (error) throw error;
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setProfile(data as Profile);
      Alert.alert('¡Compra Exitosa!', `Has adquirido tu etiqueta personalizada: "${customText.trim()}"`);
    } catch (err) {
      Alert.alert('Error', 'Hubo un problema al procesar la compra.');
    } finally {
      setBuyingId(null);
      setCustomItemPending(null);
      setCustomText('');
    }
  };

  const handleEquip = async (item: any) => {
    if (!profile) return;
    try {
      const equipped = { ...(profile.equipped_items || {}) };
      if (item.type === 'title') equipped.title = equipped.title === item.name ? null : item.name;
      if (item.type === 'color') equipped.color = equipped.color === item.value ? null : item.value;
      if (item.type === 'border') equipped.border = equipped.border === item.value ? null : item.value;

      const { data } = await supabase
        .from('profiles')
        .update({ equipped_items: equipped })
        .eq('id', profile.id)
        .select()
        .single();
      
      if (data) setProfile(data as Profile);
    } catch (err) {
      Alert.alert('Error', 'No se pudo equipar el artículo.');
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 100 }} />
      </SafeAreaView>
    );
  }

  const inventory = profile?.inventory || [];
  const equipped = profile?.equipped_items || {};

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tienda</Text>
        <View style={styles.pointsBadge}>
          <Text style={styles.pointsText}>🪙 {profile?.betting_points || 0}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>🛒 Cosméticos Disponibles</Text>
        <Text style={styles.sectionSub}>Gasta tus puntos de apuesta en lucir increíble.</Text>

        <View style={styles.grid}>
          {STORE_ITEMS.map(item => {
            const owned = inventory.includes(item.id);
            let isEquipped = false;
            if (item.type === 'title' && equipped.title === item.name) isEquipped = true;
            if (item.type === 'color' && equipped.color === item.value) isEquipped = true;
            if (item.type === 'border' && equipped.border === item.value) isEquipped = true;

            return (
              <View key={item.id} style={[styles.itemCard, owned && styles.itemCardOwned, isEquipped && styles.itemCardEquipped]}>
                <View style={styles.itemIconContainer}>
                  {item.type === 'title' && <Text style={styles.itemIcon}>🏷️</Text>}
                  {item.type === 'color' && <View style={[styles.colorCircle, { backgroundColor: item.value }]} />}
                  {item.type === 'border' && <View style={[styles.borderCircle, { borderColor: item.value }]} />}
                </View>
                <Text style={styles.itemName}>{item.name}</Text>
                
                {owned ? (
                  <TouchableOpacity 
                    style={[styles.buyBtn, isEquipped ? styles.buyBtnEquipped : styles.buyBtnOwned]}
                    onPress={() => handleEquip(item)}
                  >
                    <Text style={styles.buyBtnText}>{isEquipped ? 'Quitar' : 'Equipar'}</Text>
                  </TouchableOpacity>
                ) : item.isExclusive ? (
                  <View style={[styles.buyBtn, { backgroundColor: '#475569' }]}>
                    <Text style={styles.buyBtnText}>No Disponible</Text>
                  </View>
                ) : (
                  <TouchableOpacity 
                    style={styles.buyBtn}
                    onPress={() => handleBuy(item)}
                    disabled={buyingId === item.id}
                  >
                    {buyingId === item.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.buyBtnText}>🪙 {item.price}</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Custom Title Modal */}
      <Modal visible={showCustomModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Etiqueta Personalizada</Text>
            <Text style={styles.modalSub}>Escribe la etiqueta que deseas lucir (máx 20 caracteres).</Text>
            <TextInput 
              style={styles.modalInput}
              placeholder="Ej: El Rey del Dominó"
              placeholderTextColor={theme.colors.textDim}
              value={customText}
              onChangeText={setCustomText}
              maxLength={20}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowCustomModal(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalBuy} onPress={handleBuyCustom}>
                <Text style={styles.modalBuyText}>Comprar (250,000 pts)</Text>
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
  scroll: { padding: theme.spacing.l, paddingBottom: 40 },
  sectionTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  sectionSub: { color: theme.colors.textDim, fontSize: 14, marginBottom: theme.spacing.l, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  itemCard: {
    width: '48%', backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.l,
    padding: theme.spacing.m, marginBottom: theme.spacing.m,
    borderWidth: 1, borderColor: theme.colors.cardBorder,
    alignItems: 'center',
  },
  itemCardOwned: { borderColor: 'rgba(255,255,255,0.2)' },
  itemCardEquipped: { borderColor: theme.colors.primary, backgroundColor: 'rgba(59,130,246,0.05)' },
  itemIconContainer: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center', marginBottom: theme.spacing.m,
  },
  itemIcon: { fontSize: 28 },
  colorCircle: { width: 30, height: 30, borderRadius: 15 },
  borderCircle: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, backgroundColor: 'transparent' },
  itemName: { color: theme.colors.text, fontSize: 14, fontWeight: '700', textAlign: 'center', marginBottom: theme.spacing.m, height: 40 },
  buyBtn: {
    backgroundColor: theme.colors.primary, width: '100%', paddingVertical: 8,
    borderRadius: theme.borderRadius.m, alignItems: 'center',
  },
  buyBtnOwned: { backgroundColor: theme.colors.cardBorder },
  buyBtnEquipped: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.primary },
  buyBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '85%', backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.l, padding: 24, borderWidth: 1, borderColor: theme.colors.cardBorder },
  modalTitle: { color: theme.colors.text, fontSize: 20, fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  modalSub: { color: theme.colors.textDim, fontSize: 14, textAlign: 'center', marginBottom: 20 },
  modalInput: { backgroundColor: theme.colors.background, color: theme.colors.text, padding: 16, borderRadius: theme.borderRadius.m, fontSize: 16, borderWidth: 1, borderColor: theme.colors.primary, marginBottom: 24, textAlign: 'center', fontWeight: 'bold' },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between' },
  modalCancel: { flex: 1, padding: 16, alignItems: 'center', marginRight: 8 },
  modalCancelText: { color: theme.colors.textDim, fontWeight: 'bold', fontSize: 15 },
  modalBuy: { flex: 1.5, backgroundColor: theme.colors.primary, padding: 16, borderRadius: theme.borderRadius.m, alignItems: 'center' },
  modalBuyText: { color: theme.colors.background, fontWeight: 'bold', fontSize: 15 },
});

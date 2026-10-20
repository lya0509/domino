import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { offlineSync } from '../lib/offlineSync';

// VIP wager consent: the server activates the wager only when all 4 players accept
// (propose_wager / respond_wager in fix_wager_consent.sql)

interface Consent {
  match_id: string;
  user_id: string;
  amount: number;
  proposed_by: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  expires_at: string;
}

const secondsLeft = (expiresAt: string) =>
  Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));

const nameOf = (id?: string | null) =>
  (id && offlineSync.getCachedProfileMapSync()[id]?.display_name) || 'Un jugador';

// Ticks once per second while `active`, so countdowns re-render
const useTick = (active: boolean) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
};

/** Global prompt: asks the current user to accept or decline a proposed wager. */
export const WagerConsentPrompt: React.FC<{ currentUserProfileId: string | null }> = ({ currentUserProfileId }) => {
  const [consent, setConsent] = useState<Consent | null>(null);
  const [sending, setSending] = useState(false);
  useTick(!!consent);

  useEffect(() => {
    if (!currentUserProfileId) return;

    const loadPending = async () => {
      const { data } = await supabase
        .from('wager_consents')
        .select('*')
        .eq('user_id', currentUserProfileId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
      setConsent((data && data[0]) || null);
    };
    loadPending();

    const channel = supabase.channel(`wager_consent_me_${Date.now()}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'wager_consents', filter: `user_id=eq.${currentUserProfileId}` },
        payload => {
          const row = payload.new as Consent;
          if (row && row.status === 'pending' && secondsLeft(row.expires_at) > 0) {
            setConsent(row);
          } else {
            setConsent(prev => (prev && row && prev.match_id === row.match_id ? null : prev));
          }
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUserProfileId]);

  const remaining = consent ? secondsLeft(consent.expires_at) : 0;
  useEffect(() => {
    if (consent && remaining === 0) setConsent(null);
  }, [consent, remaining]);

  const respond = useCallback(async (accept: boolean) => {
    if (!consent) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc('respond_wager', { p_match_id: consent.match_id, p_accept: accept });
      if (error) throw error;
      setConsent(null);
      if (data?.status === 'active') {
        Alert.alert('💰 Apuesta Activa', `Los 4 aceptaron. Se juega por ${data.amount} pts cada uno.`);
      } else if (data?.status === 'expired') {
        Alert.alert('⏱️ Muy tarde', 'La propuesta venció o la partida ya empezó. Se juega sin apuesta.');
      } else if (data?.status === 'insufficient') {
        Alert.alert('Sin apuesta', `No alcanzan los puntos de: ${data.players}. Se juega sin apuesta.`);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo enviar tu respuesta.');
    } finally {
      setSending(false);
    }
  }, [consent]);

  if (!consent || remaining === 0) return null;

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.icon}>💰</Text>
        <Text style={styles.title}>Duelo VIP</Text>
        <Text style={styles.subtitle}>{nameOf(consent.proposed_by)} propone jugar con apuesta</Text>

        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Apuesta por jugador</Text>
          <Text style={styles.amount}>🪙 {consent.amount}</Text>
          <Text style={styles.amountHint}>El equipo ganador se lleva lo que pierden los otros dos.</Text>
        </View>

        <Text style={[styles.timer, remaining <= 10 && { color: theme.colors.danger }]}>{remaining}s</Text>

        {sending ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : (
          <View style={styles.row}>
            <TouchableOpacity style={[styles.btn, styles.btnDecline]} onPress={() => respond(false)}>
              <Text style={styles.btnText}>Rechazar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnAccept]} onPress={() => respond(true)}>
              <Text style={[styles.btnText, { color: '#000' }]}>Aceptar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
};

/** Match screen banner: shows who accepted and whether the wager is active. */
export const WagerStatusBanner: React.FC<{ matchId: string }> = ({ matchId }) => {
  const [consents, setConsents] = useState<Consent[]>([]);
  const [activeAmount, setActiveAmount] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      const [{ data: rows }, { data: m }] = await Promise.all([
        supabase.from('wager_consents').select('*').eq('match_id', matchId),
        supabase.from('matches').select('is_wager_match, wager_amount').eq('id', matchId).maybeSingle(),
      ]);
      setConsents((rows as Consent[]) || []);
      setActiveAmount(m?.is_wager_match ? m.wager_amount : null);
    };
    load();

    const channel = supabase.channel(`wager_status_${matchId}_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wager_consents', filter: `match_id=eq.${matchId}` }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` }, payload => {
        const row = payload.new as any;
        if (row?.is_wager_match) setActiveAmount(row.wager_amount);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [matchId]);

  const pending = consents.some(c => c.status === 'pending');
  useTick(pending && activeAmount === null);

  if (activeAmount !== null) {
    return (
      <View style={[styles.banner, { borderColor: theme.colors.success }]}>
        <Text style={[styles.bannerText, { color: theme.colors.success }]}>✅ Apuesta VIP activa: 🪙 {activeAmount} por jugador</Text>
      </View>
    );
  }
  if (consents.length === 0) return null;

  const amount = consents[0].amount;
  const accepted = consents.filter(c => c.status === 'accepted').length;
  const decliner = consents.find(c => c.status === 'declined');
  const remaining = secondsLeft(consents[0].expires_at);

  if (decliner || !pending || remaining === 0) {
    const reason = decliner
      ? `${nameOf(decliner.user_id)} rechazó`
      : 'no todos aceptaron antes de los 60 s o de la primera mano';
    return (
      <View style={[styles.banner, { borderColor: theme.colors.cardBorder }]}>
        <Text style={[styles.bannerText, { color: theme.colors.textDim }]}>Sin apuesta VIP: {reason}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.banner, { borderColor: theme.colors.accent }]}>
      <Text style={[styles.bannerText, { color: theme.colors.accent }]}>
        💰 Apuesta VIP 🪙 {amount}: {accepted}/4 aceptaron · {remaining}s
      </Text>
      <Text style={styles.bannerHint}>Si alguien no acepta antes de la primera mano, se juega sin apuesta.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    zIndex: 99998,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#111318',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    alignItems: 'center',
  },
  icon: { fontSize: 48, marginBottom: 8 },
  title: { color: theme.colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 4 },
  subtitle: { color: theme.colors.accent, fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  amountBox: {
    backgroundColor: theme.colors.card,
    padding: 12,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  amountLabel: { color: theme.colors.textDim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  amount: { color: theme.colors.text, fontSize: 28, fontWeight: '900', marginTop: 4 },
  amountHint: { color: theme.colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 6 },
  timer: { color: theme.colors.accent, fontSize: 28, fontWeight: '900', marginBottom: 16 },
  row: { flexDirection: 'row', gap: 12, width: '100%' },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  btnDecline: { backgroundColor: theme.colors.cardBorder },
  btnAccept: { backgroundColor: theme.colors.accent },
  btnText: { color: theme.colors.text, fontWeight: '800', fontSize: 16 },
  banner: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    backgroundColor: theme.colors.card,
  },
  bannerText: { fontWeight: '800', fontSize: 13, textAlign: 'center' },
  bannerHint: { color: theme.colors.textDim, fontSize: 11, textAlign: 'center', marginTop: 2 },
});

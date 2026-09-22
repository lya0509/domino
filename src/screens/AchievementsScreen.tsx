import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform, StatusBar } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';

interface Props {
  onBack: () => void;
  currentUserProfileId: string;
}

interface Achievement {
  id: string;
  title: string;
  description: string;
  points: number;
  icon: string;
  // condition evaluates the user stats and returns true if achieved
  condition: (stats: any) => boolean;
}

// 50 Logros (Achievements)
const ACHIEVEMENTS: Achievement[] = [
  { id: 'play_1', title: 'Primera Sangre', description: 'Juega 1 partida.', points: 50, icon: '🎲', condition: (s) => s.total_matches >= 1 },
  { id: 'play_10', title: 'Aficionado', description: 'Juega 10 partidas.', points: 100, icon: '🥉', condition: (s) => s.total_matches >= 10 },
  { id: 'play_50', title: 'Experimentado', description: 'Juega 50 partidas.', points: 300, icon: '🥈', condition: (s) => s.total_matches >= 50 },
  { id: 'play_100', title: 'Veterano', description: 'Juega 100 partidas.', points: 1000, icon: '🥇', condition: (s) => s.total_matches >= 100 },
  { id: 'win_1', title: 'Primera Victoria', description: 'Gana 1 partida.', points: 50, icon: '🏆', condition: (s) => s.wins >= 1 },
  { id: 'win_10', title: 'Ganador', description: 'Gana 10 partidas.', points: 200, icon: '😎', condition: (s) => s.wins >= 10 },
  { id: 'win_50', title: 'Dominador', description: 'Gana 50 partidas.', points: 500, icon: '👑', condition: (s) => s.wins >= 50 },
  { id: 'win_100', title: 'Dios del Dominó', description: 'Gana 100 partidas.', points: 2000, icon: '🌟', condition: (s) => s.wins >= 100 },
  { id: 'zapato_1', title: 'Primer Zapato', description: 'Da 1 zapato.', points: 100, icon: '🥾', condition: (s) => s.zapatos_given >= 1 },
  { id: 'zapato_5', title: 'Zapatero', description: 'Da 5 zapatos.', points: 300, icon: '👢', condition: (s) => s.zapatos_given >= 5 },
  { id: 'zapato_15', title: 'Fábrica de Zapatos', description: 'Da 15 zapatos.', points: 1000, icon: '👟', condition: (s) => s.zapatos_given >= 15 },
  { id: 'zapato_50', title: 'El Señor del Zapato', description: 'Da 50 zapatos.', points: 5000, icon: '🦶', condition: (s) => s.zapatos_given >= 50 },
  { id: 'lose_1', title: 'Un Tropezón', description: 'Pierde 1 partida.', points: 10, icon: '🤕', condition: (s) => s.losses >= 1 },
  { id: 'lose_10', title: 'No es tu día', description: 'Pierde 10 partidas.', points: 50, icon: '☔', condition: (s) => s.losses >= 10 },
  { id: 'lose_50', title: 'Masoquista', description: 'Pierde 50 partidas.', points: 200, icon: '🤡', condition: (s) => s.losses >= 50 },
  { id: 'zapatorecv_1', title: 'Descalzo', description: 'Recibe 1 zapato.', points: 20, icon: '👣', condition: (s) => s.zapatos_received >= 1 },
  { id: 'zapatorecv_5', title: 'Humillado', description: 'Recibe 5 zapatos.', points: 100, icon: '📉', condition: (s) => s.zapatos_received >= 5 },
  { id: 'zapatorecv_15', title: 'El Cliente', description: 'Recibe 15 zapatos.', points: 500, icon: '💔', condition: (s) => s.zapatos_received >= 15 },
  { id: 'bet_win_1', title: 'Apostador Novato', description: 'Gana 1 apuesta.', points: 50, icon: '🪙', condition: (s) => s.bets_won >= 1 },
  { id: 'bet_win_10', title: 'Apostador Frecuente', description: 'Gana 10 apuestas.', points: 200, icon: '💰', condition: (s) => s.bets_won >= 10 },
  { id: 'bet_win_50', title: 'El Lobo de Wall Street', description: 'Gana 50 apuestas.', points: 1000, icon: '💸', condition: (s) => s.bets_won >= 50 },
  { id: 'bet_lose_1', title: 'Mala Inversión', description: 'Pierde 1 apuesta.', points: 10, icon: '📉', condition: (s) => s.bets_lost >= 1 },
  { id: 'bet_lose_10', title: 'Bancarrota', description: 'Pierde 10 apuestas.', points: 50, icon: '🗑️', condition: (s) => s.bets_lost >= 10 },
  { id: 'win_streak_3', title: 'En Racha', description: 'Gana 3 partidas seguidas.', points: 200, icon: '🔥', condition: (s) => s.max_win_streak >= 3 },
  { id: 'win_streak_5', title: 'Imparable', description: 'Gana 5 partidas seguidas.', points: 500, icon: '☄️', condition: (s) => s.max_win_streak >= 5 },
  { id: 'win_streak_10', title: 'Legendario', description: 'Gana 10 partidas seguidas.', points: 2000, icon: '🌋', condition: (s) => s.max_win_streak >= 10 },
  { id: 'rich_1000', title: 'Ahorrador', description: 'Acumula 1,000 puntos.', points: 100, icon: '🏦', condition: (s) => s.max_points >= 1000 },
  { id: 'rich_5000', title: 'Magnate', description: 'Acumula 5,000 puntos.', points: 500, icon: '💎', condition: (s) => s.max_points >= 5000 },
  { id: 'rich_10000', title: 'Bill Gates', description: 'Acumula 10,000 puntos.', points: 2000, icon: '🤑', condition: (s) => s.max_points >= 10000 },
  { id: 'night_owl', title: 'Noctámbulo', description: 'Juega de madrugada (después de las 12 AM).', points: 100, icon: '🦉', condition: (s) => s.played_late >= 1 },
  { id: 'early_bird', title: 'Madrugador', description: 'Juega antes de las 8 AM.', points: 100, icon: '🌅', condition: (s) => s.played_early >= 1 },
  { id: 'loyal_3', title: 'Fiel (3 Días)', description: 'Juega en 3 días distintos.', points: 150, icon: '📅', condition: (s) => s.unique_days >= 3 },
  { id: 'loyal_7', title: 'Semana Completa', description: 'Juega en 7 días distintos.', points: 400, icon: '🗓️', condition: (s) => s.unique_days >= 7 },
  { id: 'loyal_30', title: 'Un Mes Jugando', description: 'Juega en 30 días distintos.', points: 2000, icon: '🎉', condition: (s) => s.unique_days >= 30 },
  { id: 'play_vs_3', title: 'Sociable', description: 'Juega contra 3 personas distintas.', points: 100, icon: '👥', condition: (s) => s.unique_opponents >= 3 },
  { id: 'play_vs_10', title: 'Popular', description: 'Juega contra 10 personas distintas.', points: 300, icon: '🌍', condition: (s) => s.unique_opponents >= 10 },
  { id: 'partner_3', title: 'Buen Compañero', description: 'Juega con 3 compañeros distintos.', points: 100, icon: '🤝', condition: (s) => s.unique_partners >= 3 },
  { id: 'partner_10', title: 'Comodín', description: 'Juega con 10 compañeros distintos.', points: 300, icon: '🃏', condition: (s) => s.unique_partners >= 10 },
  { id: 'close_win_1', title: 'Por los Pelos', description: 'Gana una partida por diferencia de 5 puntos o menos.', points: 100, icon: '🤏', condition: (s) => s.close_wins >= 1 },
  { id: 'close_win_5', title: 'Corazón de Acero', description: 'Gana 5 partidas ajustadas.', points: 400, icon: '❤️‍🔥', condition: (s) => s.close_wins >= 5 },
  { id: 'comeback_1', title: 'Remontada Épica', description: 'Gana una partida tras estar perdiendo por 50 puntos o más.', points: 300, icon: '🔄', condition: (s) => s.comebacks >= 1 },
  { id: 'fast_match_1', title: 'Velocista', description: 'Gana una partida en menos de 5 manos.', points: 200, icon: '⚡', condition: (s) => s.fast_wins >= 1 },
  { id: 'long_match_1', title: 'Maratón', description: 'Gana una partida de más de 20 manos.', points: 200, icon: '🐌', condition: (s) => s.long_wins >= 1 },
  { id: 'bet_100', title: 'Apostador Arriesgado', description: 'Apuesta 100 o más puntos en una sola partida.', points: 200, icon: '🎯', condition: (s) => s.max_bet >= 100 },
  { id: 'bet_1000', title: 'High Roller', description: 'Apuesta 1000 o más puntos en una sola partida.', points: 1000, icon: '🎰', condition: (s) => s.max_bet >= 1000 },
  { id: 'chat_10', title: 'Hablador', description: 'Envía 10 mensajes en el chat.', points: 50, icon: '💬', condition: (s) => s.chat_messages >= 10 },
  { id: 'chat_100', title: 'Locutor', description: 'Envía 100 mensajes en el chat.', points: 300, icon: '🎙️', condition: (s) => s.chat_messages >= 100 },
  { id: 'store_1', title: 'Comprador Compulsivo', description: 'Compra 1 artículo en la tienda.', points: 50, icon: '🛍️', condition: (s) => s.store_items >= 1 },
  { id: 'store_5', title: 'V.I.P.', description: 'Compra 5 artículos en la tienda.', points: 300, icon: '💳', condition: (s) => s.store_items >= 5 },
  { id: 'billetera_gorda', title: 'Billetera Gorda', description: 'Gana un total de 500 puntos en apuestas acumuladas.', points: 100, icon: '💼', condition: (s) => s.max_points >= 500 }, // Legado
];

export const AchievementsScreen: React.FC<Props> = ({ onBack, currentUserProfileId }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [userStats, setUserStats] = useState<any>({
    total_matches: 0, wins: 0, losses: 0, zapatos_given: 0, zapatos_received: 0,
    bets_won: 0, bets_lost: 0, max_win_streak: 0, max_points: 0,
    played_late: 0, played_early: 0, unique_days: 0, unique_opponents: 0, unique_partners: 0,
    close_wins: 0, comebacks: 0, fast_wins: 0, long_wins: 0, max_bet: 0,
    chat_messages: 0, store_items: 0
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch Profile
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', currentUserProfileId).single();
      if (profileData) setProfile(profileData as Profile);

      // 2. Fetch Matches
      const { data: matches } = await supabase.from('matches').select('*').eq('status', 'completed');
      
      // 3. Fetch Bets
      const { data: bets } = await supabase.from('bets').select('*').eq('user_id', currentUserProfileId);
      
      // 4. Fetch Chat
      const { data: chats } = await supabase.from('live_chat').select('id', { count: 'exact' }).eq('user_id', currentUserProfileId);
      
      // Calculate stats
      const stats = { ...userStats };
      
      if (profileData) {
        stats.max_points = profileData.betting_points || 0; // Aproximación
        stats.store_items = (profileData.inventory || []).length;
      }

      if (chats) {
        stats.chat_messages = chats.length || 0;
      }

      if (bets) {
        stats.bets_won = bets.filter((b: any) => b.status === 'won').length;
        stats.bets_lost = bets.filter((b: any) => b.status === 'lost').length;
        bets.forEach((b: any) => {
          if (b.amount_wagered > stats.max_bet) stats.max_bet = b.amount_wagered;
        });
      }

      if (matches) {
        let currentWinStreak = 0;
        const days = new Set<string>();
        const opponents = new Set<string>();
        const partners = new Set<string>();

        // Sort matches by date to calculate streaks
        const sortedMatches = matches.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        sortedMatches.forEach((m: any) => {
          const team1 = [m.team1_player1, m.team1_player2].filter(Boolean);
          const team2 = [m.team2_player1, m.team2_player2].filter(Boolean);
          const inTeam1 = team1.includes(currentUserProfileId);
          const inTeam2 = team2.includes(currentUserProfileId);
          
          if (!inTeam1 && !inTeam2) return;

          stats.total_matches++;
          
          const matchDate = new Date(m.created_at);
          days.add(matchDate.toDateString());
          
          const hour = matchDate.getHours();
          if (hour >= 0 && hour <= 4) stats.played_late++;
          if (hour >= 5 && hour <= 8) stats.played_early++;

          const partner = inTeam1 ? team1.find((id: string) => id !== currentUserProfileId) : team2.find((id: string) => id !== currentUserProfileId);
          if (partner) partners.add(partner);

          const opps = inTeam1 ? team2 : team1;
          opps.forEach((id: string) => opponents.add(id));

          const won = (inTeam1 && m.winner_team === 1) || (inTeam2 && m.winner_team === 2);
          
          if (won) {
            stats.wins++;
            currentWinStreak++;
            if (currentWinStreak > stats.max_win_streak) stats.max_win_streak = currentWinStreak;
            if (m.is_zapato) stats.zapatos_given++;

            const myScore = inTeam1 ? m.team1_total : m.team2_total;
            const theirScore = inTeam1 ? m.team2_total : m.team1_total;
            
            if (myScore - theirScore <= 5) stats.close_wins++;
            
            const roundsCount = m.rounds?.length || 0;
            if (roundsCount > 0 && roundsCount <= 5) stats.fast_wins++;
            if (roundsCount > 20) stats.long_wins++;
            
            // Aproximación de remontada: si ellos tenían > 50 y nosotros ganamos.
            if (theirScore >= 50) stats.comebacks++;
            
          } else {
            stats.losses++;
            currentWinStreak = 0;
            if (m.is_zapato) stats.zapatos_received++;
          }
        });

        stats.unique_days = days.size;
        stats.unique_opponents = opponents.size;
        stats.unique_partners = partners.size;
      }

      setUserStats(stats);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [currentUserProfileId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleClaim = async (achievement: Achievement) => {
    if (!profile) return;
    setClaimingId(achievement.id);

    try {
      const currentClaimed = profile.achievements || [];
      if (currentClaimed.includes(achievement.id)) return; // Ya reclamado

      const newClaimed = [...currentClaimed, achievement.id];
      const newPoints = (profile.betting_points || 0) + achievement.points;

      const { data, error } = await supabase
        .from('profiles')
        .update({ achievements: newClaimed, betting_points: newPoints })
        .eq('id', profile.id)
        .select()
        .single();

      if (error) throw error;
      setProfile(data as Profile);
      Alert.alert('¡Logro Reclamado!', `Has recibido ${achievement.points} puntos de apuesta.`);
    } catch (err) {
      Alert.alert('Error', 'No se pudo reclamar la recompensa.');
    } finally {
      setClaimingId(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 100 }} />
      </SafeAreaView>
    );
  }

  const claimedIds = profile?.achievements || [];
  
  // Separar y ordenar la lista
  const achievementsStatus = ACHIEVEMENTS.map(ach => ({
    ...ach,
    isCompleted: ach.condition(userStats),
    isClaimed: claimedIds.includes(ach.id),
  }));

  const claimable = achievementsStatus.filter(a => a.isCompleted && !a.isClaimed);
  const uncompleted = achievementsStatus.filter(a => !a.isCompleted);
  const claimed = achievementsStatus.filter(a => a.isClaimed);

  const displayList = [...claimable, ...uncompleted, ...claimed];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🏆 Logros</Text>
        <View style={styles.pointsBadge}>
          <Text style={styles.pointsText}>🪙 {profile?.betting_points || 0}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>Tus Misiones</Text>
        <Text style={styles.sectionSub}>Completa misiones para ganar puntos de apuesta.</Text>

        {claimable.length > 0 && (
          <View style={styles.claimableSection}>
            <Text style={styles.claimableTitle}>¡Listos para reclamar!</Text>
          </View>
        )}

        {displayList.map(ach => {
          return (
            <View key={ach.id} style={[styles.card, ach.isClaimed && styles.cardClaimed]}>
              <View style={styles.iconContainer}>
                <Text style={styles.icon}>{ach.icon}</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.title}>{ach.title}</Text>
                <Text style={styles.desc}>{ach.description}</Text>
              </View>
              
              <View style={styles.action}>
                {ach.isClaimed ? (
                  <Text style={styles.claimedText}>✓ Reclamado</Text>
                ) : ach.isCompleted ? (
                  <TouchableOpacity 
                    style={styles.claimBtn}
                    onPress={() => handleClaim(ach)}
                    disabled={claimingId === ach.id}
                  >
                    {claimingId === ach.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.claimBtnText}>Reclamar (+{ach.points})</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.lockedText}>🪙 {ach.points}</Text>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
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
  claimableSection: { backgroundColor: 'rgba(34, 197, 94, 0.1)', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(34, 197, 94, 0.3)' },
  claimableTitle: { color: theme.colors.success, fontWeight: 'bold', textAlign: 'center' },
  
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.l,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  cardClaimed: {
    opacity: 0.6,
    borderColor: 'transparent',
  },
  iconContainer: {
    width: 48, height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.background,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  icon: { fontSize: 24 },
  info: { flex: 1, marginRight: 8 },
  title: { color: theme.colors.text, fontSize: 16, fontWeight: 'bold' },
  desc: { color: theme.colors.textDim, fontSize: 13, marginTop: 4 },
  action: { alignItems: 'flex-end', justifyContent: 'center' },
  claimBtn: {
    backgroundColor: theme.colors.success,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8,
  },
  claimBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  claimedText: { color: theme.colors.textDim, fontWeight: 'bold', fontSize: 12 },
  lockedText: { color: theme.colors.primary, fontWeight: '800', fontSize: 14 },
});

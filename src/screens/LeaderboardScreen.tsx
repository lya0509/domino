import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ActivityIndicator, Image, ScrollView, Platform, StatusBar } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { offlineSync } from '../lib/offlineSync';

interface LeaderboardScreenProps {
  onBack: () => void;
  currentUserProfileId: string;
  onOpenProfile: (profileId: string) => void;
}

type TabType = 'rich' | 'wins' | 'zapatos';

export const LeaderboardScreen: React.FC<LeaderboardScreenProps> = ({ onBack, currentUserProfileId, onOpenProfile }) => {
  const [activeTab, setActiveTab] = useState<TabType>('rich');
  const [loading, setLoading] = useState(true);
  const [richList, setRichList] = useState<Profile[]>([]);
  const [winsList, setWinsList] = useState<any[]>([]);
  const [zapatosList, setZapatosList] = useState<any[]>([]);

  useEffect(() => {
    fetchLeaderboards();
  }, []);

  const fetchLeaderboards = async () => {
    setLoading(true);
    try {
      const [allProfiles, matches] = await Promise.all([
        offlineSync.getProfiles(offlineSync.getIsOnline()),
        (async () => {
          if (!offlineSync.getIsOnline()) {
            const cached = await offlineSync.getCachedMatches();
            return cached.filter((m: any) => m.status === 'completed');
          }
          const { data } = await supabase
            .from('matches')
            .select('winner_team, is_zapato, team1_player1, team1_player2, team2_player1, team2_player2, team1_total, team2_total, limit_score')
            .eq('status', 'completed');
          return data || [];
        })(),
      ]);

      const sortedRich = [...(allProfiles || [])]
        .sort((a, b) => (b.betting_points || 0) - (a.betting_points || 0))
        .slice(0, 100);
      setRichList(sortedRich);

      const stats: Record<string, { id: string; wins: number; zapatos: number; total: number; profile: any }> = {};
      const profileMap: Record<string, any> = {};
      allProfiles?.forEach(p => { profileMap[p.id] = p; });

      matches?.forEach((m: any) => {
        if (!m.winner_team) return;

        const p1 = m.team1_player1;
        const p2 = m.team1_player2;
        const p3 = m.team2_player1;
        const p4 = m.team2_player2;

        const updateStat = (pid: string, isWin: boolean, isZapato: boolean) => {
          if (!pid) return;
          if (!stats[pid]) stats[pid] = { id: pid, wins: 0, zapatos: 0, total: 0, profile: profileMap[pid] };
          stats[pid].total++;
          if (isWin) stats[pid].wins++;
          if (isWin && isZapato) stats[pid].zapatos++;
        };

        const t1Zapato = m.is_zapato && m.winner_team === 1 ? true : (m.team1_total >= (m.limit_score || 100) && m.team2_total === 0);
        const t2Zapato = m.is_zapato && m.winner_team === 2 ? true : (m.team2_total >= (m.limit_score || 100) && m.team1_total === 0);

        updateStat(p1, m.winner_team === 1, t1Zapato);
        updateStat(p2, m.winner_team === 1, t1Zapato);
        updateStat(p3, m.winner_team === 2, t2Zapato);
        updateStat(p4, m.winner_team === 2, t2Zapato);
      });

      const statsArray = Object.values(stats);
      
      const sortedWins = [...statsArray].sort((a, b) => b.wins - a.wins).slice(0, 100);
      const sortedZapatos = [...statsArray].sort((a, b) => b.zapatos - a.zapatos).slice(0, 100);

      setWinsList(sortedWins);
      setZapatosList(sortedZapatos);

    } catch (err) {
      console.log('Error fetching leaderboards:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderRichList = () => {
    return richList.map((p, index) => (
      <TouchableOpacity key={p.id} style={styles.listItem} onPress={() => onOpenProfile(p.id)}>
        <Text style={styles.rank}>#{index + 1}</Text>
        <View style={styles.avatar}>
          {p.avatar_url ? <Image source={{uri: p.avatar_url}} style={styles.avatarImg} /> : <Text style={styles.avatarInitials}>{p.initials}</Text>}
        </View>
        <Text style={styles.name}>{p.display_name}</Text>
        <Text style={styles.score}>{p.betting_points || 0} pts</Text>
      </TouchableOpacity>
    ));
  };

  const renderWinsList = () => {
    return winsList.map((p, index) => (
      <TouchableOpacity key={p.id} style={styles.listItem} onPress={() => onOpenProfile(p.id)}>
        <Text style={styles.rank}>#{index + 1}</Text>
        <View style={styles.avatar}>
          {p.profile?.avatar_url ? <Image source={{uri: p.profile.avatar_url}} style={styles.avatarImg} /> : <Text style={styles.avatarInitials}>{p.profile?.initials}</Text>}
        </View>
        <Text style={styles.name}>{p.profile?.display_name || 'Desconocido'}</Text>
        <Text style={[styles.score, { color: theme.colors.primary }]}>{p.wins} W</Text>
      </TouchableOpacity>
    ));
  };

  const renderZapatosList = () => {
    return zapatosList.map((p, index) => (
      <TouchableOpacity key={p.id} style={styles.listItem} onPress={() => onOpenProfile(p.id)}>
        <Text style={styles.rank}>#{index + 1}</Text>
        <View style={styles.avatar}>
          {p.profile?.avatar_url ? <Image source={{uri: p.profile.avatar_url}} style={styles.avatarImg} /> : <Text style={styles.avatarInitials}>{p.profile?.initials}</Text>}
        </View>
        <Text style={styles.name}>{p.profile?.display_name || 'Desconocido'}</Text>
        <Text style={[styles.score, { color: theme.colors.danger }]}>{p.zapatos} 🥾</Text>
      </TouchableOpacity>
    ));
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Salón de la Fama 🌍</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, activeTab === 'rich' && styles.activeTab]} onPress={() => setActiveTab('rich')}>
          <Text style={[styles.tabText, activeTab === 'rich' && styles.activeTabText]}>💰 Ricos</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'wins' && styles.activeTab]} onPress={() => setActiveTab('wins')}>
          <Text style={[styles.tabText, activeTab === 'wins' && styles.activeTabText]}>🥇 Ganadores</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'zapatos' && styles.activeTab]} onPress={() => setActiveTab('zapatos')}>
          <Text style={[styles.tabText, activeTab === 'zapatos' && styles.activeTabText]}>🥾 Zapateros</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 50 }} />
      ) : (
        <ScrollView style={styles.list}>
          {activeTab === 'rich' && renderRichList()}
          {activeTab === 'wins' && renderWinsList()}
          {activeTab === 'zapatos' && renderZapatosList()}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  backBtn: { padding: 8 },
  backBtnText: { color: theme.colors.primary, fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: theme.colors.text, flexShrink: 1, textAlign: 'center' },
  tabs: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
  activeTab: { borderColor: theme.colors.primary },
  tabText: { color: theme.colors.textDim, fontSize: 14, fontWeight: 'bold' },
  activeTabText: { color: theme.colors.primary },
  list: { paddingHorizontal: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  rank: { width: 40, fontSize: 18, fontWeight: 'bold', color: theme.colors.textDim },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarImg: { width: 40, height: 40, borderRadius: 20 },
  avatarInitials: { color: '#fff', fontWeight: 'bold' },
  name: { flex: 1, fontSize: 16, color: theme.colors.text, fontWeight: 'bold' },
  score: { fontSize: 16, fontWeight: 'bold', color: theme.colors.primary },
});

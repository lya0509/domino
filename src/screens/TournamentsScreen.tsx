import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, Alert, TextInput, Platform, StatusBar, Image, Modal } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { offlineSync } from '../lib/offlineSync';
import { Match, Profile, Tournament, TournamentParticipant, TournamentBracket, BracketMatch } from '../types';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';

interface Props {
  profileId: string | null;
  isAdmin: boolean;
  onBack: () => void;
  onRejoinMatch?: (match: any) => void;
  onWatchLiveMatch?: (matchId: string) => void;
}

export const TournamentsScreen: React.FC<Props> = ({ profileId, isAdmin, onBack, onRejoinMatch, onWatchLiveMatch }) => {
  const [localIsAdmin, setLocalIsAdmin] = useState(isAdmin);
  const [activeTab, setActiveTab] = useState<'lobby' | 'live' | 'my_tourneys' | 'admin'>('lobby');

  useEffect(() => {
    setLocalIsAdmin(isAdmin);
  }, [isAdmin]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [participants, setParticipants] = useState<TournamentParticipant[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showJoinModal, setShowJoinModal] = useState<Tournament | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBracketModal, setShowBracketModal] = useState<Tournament | null>(null);
  const [bracketsData, setBracketsData] = useState<any[]>([]); // For modal backwards compatibility if needed
  const [allBrackets, setAllBrackets] = useState<Record<string, any[]>>({});
  const [liveMatches, setLiveMatches] = useState<Record<string, any[]>>({});
  const [showPartnerModal, setShowPartnerModal] = useState<Tournament | null>(null);
  const [availablePartners, setAvailablePartners] = useState<any[]>([]);

  // Form states
  const [paymentRef, setPaymentRef] = useState('');
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [receiptExt, setReceiptExt] = useState('jpeg');
  
  // Create Tournament form
  const [tName, setTName] = useState('');
  const [tType, setTType] = useState<'vip_cash' | 'brackets' | 'leaderboard'>('brackets');
  const [tEntryFee, setTEntryFee] = useState('');
  const [tEntryPoints, setTEntryPoints] = useState('');
  const [tMaxPlayers, setTMaxPlayers] = useState('');
  
  // Payout form
  const [showPayoutModal, setShowPayoutModal] = useState<Tournament | null>(null);
  const [payoutBank, setPayoutBank] = useState('');
  const [payoutId, setPayoutId] = useState('');
  const [payoutPhone, setPayoutPhone] = useState('');

  useEffect(() => {
    fetchData();

    // Realtime: invitations, sign-ups, bracket results and tournament start show up without leaving the screen
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => fetchData(true), 400);
    };
    const channel = supabase.channel(`tournaments_live_${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_participants' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_brackets' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [activeTab]);

  useEffect(() => {
    // Inicio Automático de Torneos de Llaves
    tournaments.forEach(t => {
      if (t.status === 'registration' && t.tournament_type === 'brackets') {
        const tParts = participants.filter(p => p.tournament_id === t.id && p.payment_status === 'approved');
        if (tParts.length > 0 && tParts.length >= t.max_participants) {
          // Only confirmed duos: a pending invitation must not trigger the start (it would pair at random)
          const allHavePartner = tParts.every(p => p.partner_id != null && p.partner_status === 'confirmed');
          if (allHavePartner) {
            // Permitimos que el creador o un admin ejecute la auto-generación para evitar duplicados masivos
            if (t.created_by === profileId || localIsAdmin) {
              handleGenerateBrackets(t);
            }
          }
        }
      }
    });
  }, [participants]);

  useEffect(() => {
    if (showBracketModal) {
      loadBrackets(showBracketModal.id);
    }
  }, [showBracketModal]);

  const loadBrackets = async (tId: string) => {
    try {
      const { data, error } = await supabase
        .from('tournament_brackets')
        .select(`
          *,
          t1p1:profiles!tournament_brackets_team1_player1_fkey(id, initials),
          t1p2:profiles!tournament_brackets_team1_player2_fkey(id, initials),
          t2p1:profiles!tournament_brackets_team2_player1_fkey(id, initials),
          t2p2:profiles!tournament_brackets_team2_player2_fkey(id, initials)
        `)
        .eq('tournament_id', tId)
        .order('round_number', { ascending: true })
        .order('match_number', { ascending: true });
        
      if (error) throw error;
      setBracketsData(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (profileId) {
        const { data: prof } = await supabase.from('profiles').select('is_admin').eq('id', profileId).single();
        if (prof) {
          setLocalIsAdmin(isAdmin || prof.is_admin);
        } else {
          setLocalIsAdmin(isAdmin);
        }
      } else {
        setLocalIsAdmin(isAdmin);
      }

      // RPC para limpiar torneos viejos (15 días)
      // Lo ejecutamos de forma silenciosa para que no interrumpa si falla (por permisos).
      try {
        await supabase.rpc('clean_old_tournaments');
      } catch (rpcErr) {
        console.error(rpcErr);
      }

      if (activeTab === 'lobby' || activeTab === 'my_tourneys' || activeTab === 'live') {
        const { data: tData, error: tErr } = await supabase
          .from('tournaments')
          .select('*')
          .order('created_at', { ascending: false });
        if (tErr) throw tErr;
        const fetchedTournaments = tData as Tournament[];
        setTournaments(fetchedTournaments);

        // Cargamos llaves y partidas para torneos activos o completados en mis torneos
        if (activeTab === 'live' || activeTab === 'my_tourneys') {
          const liveT = fetchedTournaments.filter(t => t.status === 'in_progress' || (activeTab === 'my_tourneys' && t.status === 'completed'));
          const newAllBrackets: Record<string, any[]> = {};
          const newLiveMatches: Record<string, any[]> = {};
          
          for (const lt of liveT) {
            const { data: bData } = await supabase
              .from('tournament_brackets')
              .select(`
                *,
                t1p1:profiles!tournament_brackets_team1_player1_fkey(id, initials),
                t1p2:profiles!tournament_brackets_team1_player2_fkey(id, initials),
                t2p1:profiles!tournament_brackets_team2_player1_fkey(id, initials),
                t2p2:profiles!tournament_brackets_team2_player2_fkey(id, initials)
              `)
              .eq('tournament_id', lt.id)
              .order('round_number', { ascending: true })
              .order('match_number', { ascending: true });
            
            if (bData) newAllBrackets[lt.id] = bData;

            const { data: mData } = await supabase
              .from('matches')
              .select('id, team1_total, team2_total, players_json')
              .eq('tournament_id', lt.id)
              .eq('status', 'active');
            
            if (mData) newLiveMatches[lt.id] = mData;
          }
          setAllBrackets(newAllBrackets);
          setLiveMatches(newLiveMatches);
        }

        if (profileId) {
          const { data: pData, error: pErr } = await supabase
            .from('tournament_participants')
            .select('*, profiles!tournament_participants_user_id_fkey(display_name, initials)')
            .or(`user_id.eq.${profileId},payment_status.eq.approved`);
          if (pErr) throw pErr;
          setParticipants(pData as TournamentParticipant[]);
        }
      } else if (activeTab === 'admin' && localIsAdmin) {
        // Fetch all tournaments for admin
        const { data: tData, error: tErr } = await supabase
          .from('tournaments')
          .select('*')
          .order('created_at', { ascending: false });
        if (tErr) throw tErr;
        setTournaments(tData as Tournament[]);

        // Fetch all pending participants AND participants with payout details
        const { data: pData, error: pErr } = await supabase
          .from('tournament_participants')
          .select('*, profiles!tournament_participants_user_id_fkey(display_name, initials)')
          .or('payment_status.eq.pending,payout_details.not.is.null');
        if (pErr) throw pErr;
        setParticipants(pData as any[]);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handlePickReceipt = async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permiso denegado', 'Necesitamos acceso a tu galería para subir el comprobante.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.5,
        base64: Platform.OS !== 'web', // Request base64 only on mobile
      });

      if (!result.canceled && result.assets[0]) {
        // On web we save the URI, on mobile we save the base64
        const dataToSave = Platform.OS === 'web' ? result.assets[0].uri : result.assets[0].base64;
        if (dataToSave) {
          setReceiptBase64(dataToSave);
          
          // Get extension from uri
          let ext = result.assets[0].uri.split('.').pop()?.toLowerCase() || 'jpg';
          if (ext.length > 5 || ext.includes('/')) ext = 'jpg'; // fallback for web blob uris
          setReceiptExt(ext);
        }
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo seleccionar la imagen');
    }
  };

  const handleJoinTournament = async () => {
    if (!showJoinModal || !profileId) return;
    
    setLoading(true);
    try {
      if (showJoinModal.tournament_type === 'vip_cash') {
        if (!paymentRef.trim() || !receiptBase64) {
          Alert.alert('Incompleto', 'Debes ingresar la referencia y subir el capture.');
          setLoading(false);
          return;
        }

        const fileName = `tournaments/${showJoinModal.id}/${profileId}-${Date.now()}.${receiptExt}`;
        
        let uploadData: any;
        if (Platform.OS === 'web') {
          // On web, fetch the blob from the blob URI
          const res = await fetch(receiptBase64);
          uploadData = await res.blob();
        } else {
          // On mobile, decode the base64 string
          let cleanBase64 = receiptBase64;
          if (cleanBase64.includes(',')) cleanBase64 = cleanBase64.split(',')[1];
          uploadData = decode(cleanBase64);
        }

        const { error: uploadError } = await supabase.storage
          .from('receipts')
          .upload(fileName, uploadData, {
            contentType: `image/${receiptExt}`,
            upsert: true,
          });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from('receipts').getPublicUrl(fileName);

        const { error: insertError } = await supabase
          .from('tournament_participants')
          .insert({
            tournament_id: showJoinModal.id,
            user_id: profileId,
            payment_reference: paymentRef,
            payment_receipt_url: publicUrlData.publicUrl,
            payment_status: 'pending'
          });

        if (insertError) {
          if (insertError.code === '23505') {
            Alert.alert('Error', 'Ya estás registrado en este torneo.');
          } else throw insertError;
        } else {
          Alert.alert('¡Inscripción Recibida!', 'El administrador verificará tu pago móvil pronto.');
          setShowJoinModal(null);
          setPaymentRef('');
          setReceiptBase64(null);
          fetchData();
        }
      } else {
        // Brackets / Leaderboard: the server charges the entry points, registers
        // the user as approved and grows the prize pool in one transaction
        const { error: joinError } = await supabase.rpc('join_tournament_with_points', {
          p_tournament_id: showJoinModal.id,
        });

        if (joinError) {
          Alert.alert('No se pudo inscribir', joinError.message || 'No se pudo procesar la inscripción.');
        } else {
          Alert.alert('¡Estás dentro!', 'Te has inscrito exitosamente en el torneo.');
          const { data: freshProf } = await supabase.from('profiles').select('*').eq('id', profileId).single();
          if (freshProf) offlineSync.updateCachedProfile(freshProf);
          setShowJoinModal(null);
          fetchData();
        }
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo procesar la inscripción.');
    } finally {
      setLoading(false);
    }
  };
  const handleSubmitPayout = async () => {
    if (!payoutBank || !payoutId || !payoutPhone || !showPayoutModal || !profileId) {
      Alert.alert('Incompleto', 'Por favor llena todos los datos del Pago Móvil.');
      return;
    }
    
    setLoading(true);
    try {
      const payout_details = {
        bank: payoutBank,
        id: payoutId,
        phone: payoutPhone
      };
      
      const { error } = await supabase
        .from('tournament_participants')
        .update({ payout_details })
        .eq('tournament_id', showPayoutModal.id)
        .eq('user_id', profileId);
        
      if (error) throw error;
      
      Alert.alert('¡Éxito!', 'Tus datos de pago han sido enviados. Recibirás tu premio pronto.');
      setShowPayoutModal(null);
      fetchData();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo enviar la información de pago.');
    } finally {
      setLoading(false);
    }
  };
  const [fakeTournamentError, setFakeTournamentError] = useState<string | null>(null);

  const handleGenerateFakeTournament = async () => {
    setLoading(true);
    setFakeTournamentError(null);
    try {
      const { data: tData, error: tErr } = await supabase.from('tournaments').insert({
        name: 'Torneo Falso de Prueba',
        entry_points: 1000,
        entry_fee: 0,
        prize_pool: 8000,
        max_participants: 8,
        status: 'registration',
        tournament_type: 'brackets',
        created_by: profileId
      }).select().single();
      
      if (tErr) throw new Error('Error al crear torneo: ' + tErr.message);
      if (!tData) throw new Error('Error al crear torneo: Sin datos');

      // 2. Fetch 7 users that are explicitly our Guests (Invitados)
      const { data: otherUsers, error: uErr } = await supabase.from('profiles').select('id').ilike('display_name', 'Invitado %').limit(7);
      if (uErr) throw new Error('Error al buscar usuarios: ' + uErr.message);
      if (!otherUsers || otherUsers.length < 7) {
        throw new Error(`Solo tienes ${otherUsers?.length || 0} usuarios extra en tu base de datos. ¡Necesitas crear al menos 7 cuentas más para generar este torneo de prueba!`);
      }

      const users = [{ id: profileId }, ...otherUsers];

      // 3. Insert participants
      const participantsToInsert = users.map(u => ({
        tournament_id: tData.id,
        user_id: u.id,
        payment_status: 'approved'
      }));
      const { error: pErr } = await supabase.from('tournament_participants').insert(participantsToInsert);
      if (pErr) throw new Error('Error al insertar participantes: ' + pErr.message);

      // 4. Pair them up (0-1, 2-3, 4-5, 6-7)
      for (let i = 0; i < 8; i += 2) {
        await supabase.from('tournament_participants').update({ partner_id: users[i+1].id }).eq('tournament_id', tData.id).eq('user_id', users[i].id);
        await supabase.from('tournament_participants').update({ partner_id: users[i].id }).eq('tournament_id', tData.id).eq('user_id', users[i+1].id);
      }

      setFakeTournamentError('✅ Éxito: Torneo falso creado con 8 jugadores emparejados. Por favor presiona "Generar Llaves al Azar" abajo.');
      fetchData();
    } catch (e: any) {
      console.error(e);
      setFakeTournamentError('❌ Fallo de Prueba: ' + (e.message || 'Error desconocido'));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTournament = async () => {
    if (!tName.trim()) {
      Alert.alert('Nombre Requerido', 'Por favor ingresa el nombre del torneo.');
      return;
    }
    if (!tMaxPlayers) {
      Alert.alert('Participantes Requeridos', 'Por favor selecciona la cantidad de jugadores.');
      return;
    }
    if (tType === 'vip_cash' && !tEntryFee.trim()) {
      Alert.alert('Precio Requerido', 'Por favor ingresa el precio de entrada en Bs.');
      return;
    }
    
    const maxP = parseInt(tMaxPlayers);
    if (tType === 'brackets' && maxP < 4) {
      Alert.alert('Error', 'Los torneos de llaves (dominó) requieren un mínimo de 4 jugadores (2 parejas).');
      return;
    }
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('tournaments')
        .insert({
          name: tName.trim(),
          entry_fee: tType === 'vip_cash' ? parseFloat(tEntryFee) : 0,
          entry_points: tType !== 'vip_cash' ? (tEntryPoints ? parseFloat(tEntryPoints) : 0) : 0,
          max_participants: parseInt(tMaxPlayers),
          tournament_type: tType,
          created_by: profileId
        });
      if (error) throw error;
      Alert.alert('¡Éxito!', 'Torneo creado exitosamente.');
      setShowCreateModal(false);
      setTName('');
      setTEntryFee('');
      setTEntryPoints('');
      setTMaxPlayers('');
      fetchData();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudo crear el torneo');
    } finally {
      setLoading(false);
    }
  };

  const handleApprovePayment = async (participantId: string, tournamentId: string, amount: number) => {
    try {
      // Approve participant
      const { error: updErr } = await supabase
        .from('tournament_participants')
        .update({ payment_status: 'approved' })
        .eq('id', participantId);
      if (updErr) throw updErr;

      // Update prize pool (add entry fee)
      const { data: tData } = await supabase.from('tournaments').select('prize_pool').eq('id', tournamentId).single();
      const newPool = (tData?.prize_pool || 0) + amount;
      await supabase.from('tournaments').update({ prize_pool: newPool }).eq('id', tournamentId);

      Alert.alert('Aprobado', 'El pago fue aprobado y el pozo actualizado.');
      fetchData();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo aprobar.');
    }
  };

  const openPartnerSelection = async (t: Tournament) => {
    setShowPartnerModal(t);
    try {
      // Buscar participantes del torneo que estén aprobados y que no tengan compañero confirmado
      const { data, error } = await supabase
        .from('tournament_participants')
        .select('user_id, profiles!tournament_participants_user_id_fkey(display_name, initials)')
        .eq('tournament_id', t.id)
        .eq('payment_status', 'approved')
        .neq('user_id', profileId)
        .or('partner_status.is.null,partner_id.is.null');
        
      if (error) throw error;
      setAvailablePartners(data || []);
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'No se pudieron cargar los jugadores.');
    }
  };

  const handleSelectPartner = async (partnerId: string) => {
    if (!showPartnerModal || !profileId) return;
    try {
      setLoading(true);
      // The server updates both entries (the app may only edit its own row)
      const { data: result, error } = await supabase.rpc('invite_tournament_partner', {
        p_tournament_id: showPartnerModal.id,
        p_partner_id: partnerId,
      });
      if (error) throw error;

      if (result === 'confirmed') {
        Alert.alert('¡Dúo Confirmado!', 'Ese jugador ya te había invitado. Ya están listos para jugar.');
      } else {
        Alert.alert('¡Invitación Enviada!', 'Espera a que el jugador acepte tu solicitud.');
      }
      setShowPartnerModal(null);
      fetchData();
    } catch (error: any) {
      console.error(error);
      Alert.alert('Error', error?.message || 'No se pudo formar el equipo.');
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptPartner = async (tournamentId: string) => {
    try {
      setLoading(true);
      const myJoin = participants.find(p => p.tournament_id === tournamentId && p.user_id === profileId);
      if (!myJoin || !myJoin.partner_id) return;

      const { error } = await supabase.rpc('respond_tournament_partner', { p_tournament_id: tournamentId, p_accept: true });
      if (error) throw error;

      Alert.alert('¡Dúo Confirmado!', 'Ya están listos para jugar.');
      fetchData();
    } catch (error: any) {
      console.error(error);
      Alert.alert('Error', error?.message || 'No se pudo confirmar el dúo.');
    } finally {
      setLoading(false);
    }
  };

  const handleRejectPartner = async (tournamentId: string) => {
    try {
      setLoading(true);
      const myJoin = participants.find(p => p.tournament_id === tournamentId && p.user_id === profileId);
      if (!myJoin || !myJoin.partner_id) return;
      
      const { error } = await supabase.rpc('respond_tournament_partner', { p_tournament_id: tournamentId, p_accept: false });
      if (error) throw error;

      Alert.alert('Rechazado', 'Has rechazado la solicitud de dúo.');
      fetchData();
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateBrackets = async (t: Tournament) => {
    try {
      setLoading(true);
      // The server builds teams (confirmed duos + random pairs), round 1 and the live matches
      const { data: res, error } = await supabase.rpc('start_tournament', { p_tournament_id: t.id });
      if (error) throw error;

      if (res?.started) {
        Alert.alert('Éxito', res.left_out
          ? 'Llaves generadas. Un jugador quedó sin pareja y se le devolvió su inscripción.'
          : 'Llaves generadas correctamente. El torneo ha comenzado.');
      } else if (res?.reason === 'not_enough_players') {
        Alert.alert('Faltan jugadores', 'Se necesitan al menos 4 jugadores aprobados para iniciar.');
      } else if (res?.reason === 'vip_needs_multiple_of_8') {
        Alert.alert('Error', 'El torneo VIP requiere un múltiplo de 8 jugadores para iniciar.');
      }
      fetchData();
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message || 'No se pudieron generar las llaves.');
    } finally {
      setLoading(false);
    }
  };

  const handleMatchClick = async (match: BracketMatch) => {
    let currentLiveMatchId = match.live_match_id;

    // Si la llave no tiene live_match_id pero tiene ambos equipos y no ha concluido, la creamos al vuelo
    if (!currentLiveMatchId && !match.winner_team && match.team1_player1 && match.team2_player1) {
      setLoading(true);
      try {
        const playerIds = [match.team1_player1, match.team1_player2, match.team2_player1, match.team2_player2].filter(Boolean);
        const { data: profs } = await supabase.from('profiles').select('id, display_name, initials').in('id', playerIds);
        const pMap = new Map((profs || []).map(p => [p.id, p]));

        const p1 = pMap.get(match.team1_player1);
        const p2 = pMap.get(match.team1_player2);
        const p3 = pMap.get(match.team2_player1);
        const p4 = pMap.get(match.team2_player2);

        const players_json = [
          { id: '1', profileId: match.team1_player1, name: p1?.display_name || 'J1', initials: p1?.initials || 'J1', teamNumber: 1, position: 'bottom' },
          { id: '2', profileId: match.team2_player1, name: p3?.display_name || 'J3', initials: p3?.initials || 'J3', teamNumber: 2, position: 'right' },
          { id: '3', profileId: match.team1_player2, name: p2?.display_name || 'J2', initials: p2?.initials || 'J2', teamNumber: 1, position: 'top' },
          { id: '4', profileId: match.team2_player2, name: p4?.display_name || 'J4', initials: p4?.initials || 'J4', teamNumber: 2, position: 'left' },
        ];

        const { data: liveData } = await supabase.from('matches').insert({
          tournament_id: match.tournament_id,
          status: 'active',
          game_mode: 'teams',
          limit_score: 100,
          team1_total: 0,
          team2_total: 0,
          team1_player1: match.team1_player1,
          team1_player2: match.team1_player2,
          team2_player1: match.team2_player1,
          team2_player2: match.team2_player2,
          rounds: [],
          players_json
        }).select('id').single();

        if (liveData) {
          currentLiveMatchId = liveData.id;
          match.live_match_id = liveData.id;
          await supabase.from('tournament_brackets').update({ live_match_id: liveData.id }).eq('id', match.id);
        }
      } catch (err) {
        console.error('Error auto-creating live match:', err);
      } finally {
        setLoading(false);
      }
    }

    if (!currentLiveMatchId) {
      Alert.alert('Partida en Espera', 'Esta llave aún está esperando que se definan los contrincantes.');
      return;
    }

    // Si la partida ya terminó, todos (incluyendo participantes) la ven en modo espectador (Resultados)
    if (match.winner_team) {
      if (onWatchLiveMatch) {
        onWatchLiveMatch(currentLiveMatchId);
      }
      return;
    }

    const isParticipant = !!profileId && [match.team1_player1, match.team1_player2, match.team2_player1, match.team2_player2].includes(profileId);

    if (isParticipant || localIsAdmin) {
      if (onRejoinMatch) {
        setLoading(true);
        try {
          const { data, error } = await supabase.from('matches').select('*').eq('id', currentLiveMatchId).single();
          if (error) throw error;
          if (data) {
             onRejoinMatch(data);
          }
        } catch (e) {
          console.error('Error fetching live match:', e);
          Alert.alert('Error', 'No se pudo cargar la partida.');
        } finally {
          setLoading(false);
        }
      }
    } else {
      if (onWatchLiveMatch) {
        onWatchLiveMatch(currentLiveMatchId);
      }
    }
  };

  const processWinner = async (match: BracketMatch, winnerTeamNumber: number) => {
    try {
      setLoading(true);
      // Update match
      const { error: updErr } = await supabase
        .from('tournament_brackets')
        .update({ winner_team: winnerTeamNumber })
        .eq('id', match.id);
      if (updErr) throw updErr;

      // Check if all matches in this round are finished
      const { data: allMatches, error: selErr } = await supabase
        .from('tournament_brackets')
        .select('*')
        .eq('tournament_id', match.tournament_id)
        .eq('round_number', match.round_number);
        
      if (selErr) throw selErr;

      const updatedMatches = allMatches.map(m => m.id === match.id ? { ...m, winner_team: winnerTeamNumber } : m);
      const allFinished = updatedMatches.every(m => m.winner_team !== null);

      if (allFinished) {
        // Collect all winning teams
        const winners = updatedMatches.map(m => {
          return m.winner_team === 1 
            ? { p1: m.team1_player1, p2: m.team1_player2 } 
            : { p1: m.team2_player1, p2: m.team2_player2 };
        });

        if (winners.length === 1) {
          // Tournament is over!
          await supabase.from('tournaments').update({ status: 'completed' }).eq('id', match.tournament_id);

          // Si es un torneo de puntos, el servidor paga el pozo a los campeones de la final (una sola vez)
          let prizeMsg = 'El torneo ha concluido exitosamente.';
          try {
            const { data: prize, error: prizeErr } = await supabase.rpc('award_tournament_prize', { p_tournament_id: match.tournament_id });
            if (prizeErr) throw prizeErr;
            if (prize?.paid) prizeMsg += ` Cada campeón recibió ${prize.per_champion} pts.`;
          } catch (payoutErr) {
            console.error('Error awarding tournament prize points:', payoutErr);
          }

          Alert.alert('🏆 ¡Torneo Finalizado!', prizeMsg);
          fetchData();
        } else {
          // Generate next round with live matches
          const nextRoundMatches = [];
          let matchCount = 1;
          for (let i = 0; i < winners.length; i += 2) {
            if (i + 1 < winners.length) {
              const w1 = winners[i];
              const w2 = winners[i + 1];

              const playerIds = [w1.p1, w1.p2, w2.p1, w2.p2].filter(Boolean);
              const { data: profs } = await supabase.from('profiles').select('id, display_name, initials').in('id', playerIds);
              const pMap = new Map((profs || []).map(p => [p.id, p]));

              const players_json = [
                { id: '1', profileId: w1.p1, name: pMap.get(w1.p1)?.display_name || 'J1', initials: pMap.get(w1.p1)?.initials || 'J1', teamNumber: 1, position: 'bottom' },
                { id: '2', profileId: w2.p1, name: pMap.get(w2.p1)?.display_name || 'J3', initials: pMap.get(w2.p1)?.initials || 'J3', teamNumber: 2, position: 'right' },
                { id: '3', profileId: w1.p2, name: pMap.get(w1.p2)?.display_name || 'J2', initials: pMap.get(w1.p2)?.initials || 'J2', teamNumber: 1, position: 'top' },
                { id: '4', profileId: w2.p2, name: pMap.get(w2.p2)?.display_name || 'J4', initials: pMap.get(w2.p2)?.initials || 'J4', teamNumber: 2, position: 'left' },
              ];

              const { data: liveMatchData } = await supabase.from('matches').insert({
                tournament_id: match.tournament_id,
                status: 'active',
                game_mode: 'teams',
                limit_score: 100,
                team1_total: 0,
                team2_total: 0,
                team1_player1: w1.p1,
                team1_player2: w1.p2,
                team2_player1: w2.p1,
                team2_player2: w2.p2,
                rounds: [],
                players_json
              }).select('id').single();

              nextRoundMatches.push({
                tournament_id: match.tournament_id,
                round_number: match.round_number + 1,
                match_number: matchCount++,
                team1_player1: w1.p1,
                team1_player2: w1.p2,
                team2_player1: w2.p1,
                team2_player2: w2.p2,
                live_match_id: liveMatchData?.id || null
              });
            }
          }
          if (nextRoundMatches.length > 0) {
            await supabase.from('tournament_brackets').insert(nextRoundMatches);
            Alert.alert('¡Siguiente Ronda!', `La Ronda ${match.round_number + 1} ha sido generada automáticamente.`);
          }
        }
      }

      // Refresh brackets data
      loadBrackets(match.tournament_id);
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Hubo un error al procesar el ganador.');
    } finally {
      setLoading(false);
    }
  };

  const handleTournamentExpire = async (tId: string) => {
    try {
      // Server decides: 4+ players → start with random pairs; fewer → cancel and refund
      await supabase.rpc('expire_tournament_registration', { p_tournament_id: tId });
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const renderLobby = () => (
    <ScrollView contentContainerStyle={styles.scroll}>
      {activeTab === 'lobby' && (
        <>
          <View style={styles.casinoBanner}>
            <Text style={styles.casinoBannerTitle}>💎 ZONA VIP 💎</Text>
            <Text style={styles.casinoBannerSub}>Torneos con Pozo en Bs.</Text>
          </View>

          <TouchableOpacity 
            style={[styles.joinBtn, { marginBottom: 24, backgroundColor: theme.colors.cardBorder }]} 
            onPress={() => {
              setTType(localIsAdmin ? 'vip_cash' : 'brackets');
              setShowCreateModal(true);
            }}
          >
            <Text style={[styles.joinBtnText, { color: theme.colors.text }]}>+ Crear Nuevo Torneo</Text>
          </TouchableOpacity>
        </>
      )}

      {tournaments.filter(t => {
        if (activeTab === 'lobby') return t.status === 'registration';
        if (activeTab === 'live') return t.status === 'in_progress';
        if (activeTab === 'my_tourneys') return (t.status === 'completed' || t.status === 'cancelled') && participants.some(p => p.tournament_id === t.id && p.user_id === profileId);
        return false;
      }).map(t => {
        // participants also holds other users' approved entries, so match on the current user
        const myJoin = participants.find(p => p.tournament_id === t.id && p.user_id === profileId);
        const isJoined = !!myJoin;

        const getStatusLabel = (status: string) => {
          if (status === 'registration') return 'Abierto';
          if (status === 'in_progress') return 'En Vivo';
          if (status === 'completed') return 'Finalizado';
          if (status === 'cancelled') return 'Cancelado';
          return status;
        };

        const tBrackets = allBrackets[t.id] || [];
        const tMatches = liveMatches[t.id] || [];

        // VIP Logic
        const vipApprovedPlayers = participants.filter(p => p.tournament_id === t.id && p.payment_status === 'approved');
        const vipTotalPlayers = vipApprovedPlayers.length;
        const vipMesas = Math.floor(vipTotalPlayers / 4);
        
        const groupedPlayers: any[] = [];
        const processedP = new Set<string>();
        vipApprovedPlayers.forEach(p => {
          if (processedP.has(p.user_id)) return;
          if (p.partner_id && p.partner_status === 'confirmed') {
            const partner = vipApprovedPlayers.find(pt => pt.user_id === p.partner_id);
            if (partner) {
              groupedPlayers.push({ isDuo: true, p1: p, p2: partner });
              processedP.add(p.user_id);
              processedP.add(partner.user_id);
              return;
            }
          }
          groupedPlayers.push({ isDuo: false, p1: p });
          processedP.add(p.user_id);
        });

        let vipCounterText = '';
        if (vipTotalPlayers < 8) {
          vipCounterText = `Faltan ${8 - vipTotalPlayers} para el mínimo de 2 mesas (8 jugadores)`;
        } else if (vipTotalPlayers % 8 === 0) {
          vipCounterText = `${vipMesas} mesas listas para iniciar = ${vipMesas - 1} rondas de juego`;
        } else {
          const nextMultiple = Math.ceil(vipTotalPlayers / 8) * 8;
          vipCounterText = `${Math.floor(vipTotalPlayers / 4)} mesas listas. Faltan ${nextMultiple - vipTotalPlayers} jugadores para abrir ${nextMultiple / 4} mesas.`;
        }

        return (
          <View key={t.id} style={styles.tournamentCard}>
            <Text style={styles.tName}>{t.name}</Text>
            {t.status === 'registration' && t.tournament_type !== 'vip_cash' && (
              <TournamentTimer t={t} onExpire={() => handleTournamentExpire(t.id)} />
            )}
            
            <View style={styles.tStats}>
              <View style={styles.tStatBox}>
                <Text style={styles.tStatLabel}>Inscripción</Text>
                <Text style={styles.tStatValue}>{t.tournament_type === 'vip_cash' ? `Bs ${t.entry_fee}` : (Number(t.entry_points) > 0 ? `🪙 ${t.entry_points}` : 'GRATIS 🆓')}</Text>
              </View>
              <View style={[styles.tStatBox, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: theme.colors.cardBorder }]}>
                <Text style={styles.tStatLabel}>{t.status === 'cancelled' ? 'Pozo' : 'Pozo Actual'}</Text>
                {t.status === 'cancelled' ? (
                  <Text style={[styles.tStatValue, { color: theme.colors.textDim }]}>Reembolsado</Text>
                ) : (
                  <Text style={[styles.tStatValue, { color: theme.colors.accent }]}>{t.tournament_type === 'vip_cash' ? `Bs ${t.prize_pool}` : `🪙 ${t.prize_pool}`}</Text>
                )}
              </View>
              <View style={styles.tStatBox}>
                <Text style={styles.tStatLabel}>Estado</Text>
                <Text style={styles.tStatValue}>{getStatusLabel(t.status)}</Text>
              </View>
            </View>

            {localIsAdmin && t.status === 'registration' && t.tournament_type === 'brackets' && (
              <TouchableOpacity style={[styles.bracketBtn, { backgroundColor: theme.colors.warning, marginBottom: 8 }]} onPress={() => handleGenerateBrackets(t)}>
                <Text style={[styles.bracketBtnText, { color: '#000' }]}>🔥 Forzar Inicio (Admin)</Text>
              </TouchableOpacity>
            )}

            {t.tournament_type === 'vip_cash' && t.status === 'registration' && (
              <View style={{ backgroundColor: theme.colors.cardBackground, padding: 12, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.cardBorder }}>
                <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' }}>
                  ⏳ Lista de Espera ({vipTotalPlayers} Jugadores)
                </Text>
                
                <View style={{ backgroundColor: theme.colors.background, padding: 12, borderRadius: 8, marginBottom: 12 }}>
                  <Text style={{ color: vipTotalPlayers >= 8 && vipTotalPlayers % 8 === 0 ? theme.colors.success : '#FFFFFF', textAlign: 'center', fontWeight: 'bold' }}>
                    {vipCounterText}
                  </Text>
                </View>

                {groupedPlayers.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    {groupedPlayers.map((group, idx) => (
                      <View key={idx} style={{ 
                        flexDirection: 'row', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        backgroundColor: group.isDuo ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.03)', 
                        padding: 12, 
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: group.isDuo ? theme.colors.primary : theme.colors.cardBorder
                      }}>
                        
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.secondary, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                            <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 12 }}>
                              {((group.p1 as any).profiles?.display_name || 'VIP').substring(0,2).toUpperCase()}
                            </Text>
                          </View>
                          <Text style={{ color: '#FFF', fontSize: 14, fontWeight: 'bold' }}>
                            {(group.p1 as any).profiles?.display_name || 'VIP'}
                          </Text>
                        </View>

                        {group.isDuo ? (
                          <>
                            <View style={{ paddingHorizontal: 12 }}>
                              <Text style={{ fontSize: 18 }}>🤝</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                              <Text style={{ color: '#FFF', fontSize: 14, fontWeight: 'bold', marginRight: 10 }}>
                                {(group.p2 as any).profiles?.display_name || 'VIP'}
                              </Text>
                              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center' }}>
                                <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 12 }}>
                                  {((group.p2 as any).profiles?.display_name || 'VIP').substring(0,2).toUpperCase()}
                                </Text>
                              </View>
                            </View>
                          </>
                        ) : (
                          <>
                            <View style={{ paddingHorizontal: 12 }}>
                              <Text style={{ fontSize: 14, color: theme.colors.textDim }}>〰️</Text>
                            </View>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'flex-end', opacity: 0.5 }}>
                              <Text style={{ color: theme.colors.textDim, fontSize: 14, fontStyle: 'italic', marginRight: 10 }}>
                                Sin compañero
                              </Text>
                              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.cardBorder, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.textDim, borderStyle: 'dashed' }}>
                                <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>?</Text>
                              </View>
                            </View>
                          </>
                        )}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={{ color: theme.colors.textDim, textAlign: 'center' }}>No hay jugadores aprobados aún.</Text>
                )}

                {localIsAdmin && vipTotalPlayers > 0 && vipTotalPlayers % 8 === 0 && (
                  <View style={{ marginTop: 16, padding: 12, backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.warning }}>
                    <Text style={{ color: '#FFF', textAlign: 'center', fontWeight: 'bold', marginBottom: 8 }}>👑 Panel de Administrador</Text>
                    <TouchableOpacity style={[styles.bracketBtn, { backgroundColor: theme.colors.warning }]} onPress={() => handleGenerateBrackets(t)}>
                      <Text style={[styles.bracketBtnText, { color: '#000' }]}>🔥 Forzar Inicio (Generar Llaves)</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {isJoined && t.status === 'registration' && (
              <View style={{ gap: 12, marginTop: 8 }}>
                
                {/* Badge de Aprobación */}
                {myJoin?.payment_status === 'approved' ? (
                  <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', borderWidth: 1, borderColor: theme.colors.success, paddingVertical: 10, borderRadius: 12, alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.success, fontWeight: 'bold', fontSize: 16 }}>✅ ¡Estás dentro! (Aprobado)</Text>
                  </View>
                ) : (
                  <View style={{ backgroundColor: 'rgba(156, 163, 175, 0.15)', borderWidth: 1, borderColor: theme.colors.textDim, paddingVertical: 10, borderRadius: 12, alignItems: 'center' }}>
                    <Text style={{ color: theme.colors.textDim, fontWeight: '600', fontSize: 14 }}>⏳ Esperando aprobación...</Text>
                  </View>
                )}

                {/* Botón de Seleccionar Compañero */}
                {(t.tournament_type === 'brackets' || t.tournament_type === 'vip_cash') && myJoin?.payment_status === 'approved' && !myJoin.partner_id && (
                  <TouchableOpacity 
                    style={[styles.bracketBtn, { backgroundColor: theme.colors.primary, shadowColor: theme.colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5 }]} 
                    onPress={() => openPartnerSelection(t)}
                  >
                    <Text style={[styles.bracketBtnText, { fontSize: 16 }]}>👥 Seleccionar Compañero</Text>
                  </TouchableOpacity>
                )}
                
                {(t.tournament_type === 'brackets' || t.tournament_type === 'vip_cash') && myJoin?.partner_id && myJoin?.partner_status === 'sent' && (
                  <View style={{ alignItems: 'center', marginTop: 8 }}>
                    <Text style={{ color: '#FFFFFF', fontWeight: 'bold' }}>⏳ Esperando confirmación de dúo...</Text>
                  </View>
                )}

                {(t.tournament_type === 'brackets' || t.tournament_type === 'vip_cash') && myJoin?.partner_id && myJoin?.partner_status === 'pending' && (
                  <View style={{ marginTop: 8, padding: 12, backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: 12, borderWidth: 1, borderColor: theme.colors.warning }}>
                    <Text style={{ color: theme.colors.warning, textAlign: 'center', fontWeight: 'bold', marginBottom: 12 }}>
                      🤔 Alguien quiere formar un dúo contigo
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={[styles.bracketBtn, { flex: 1, backgroundColor: theme.colors.cardBorder }]} onPress={() => handleRejectPartner(t.id)}>
                        <Text style={styles.bracketBtnText}>Rechazar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.bracketBtn, { flex: 1, backgroundColor: theme.colors.success }]} onPress={() => handleAcceptPartner(t.id)}>
                        <Text style={styles.bracketBtnText}>✅ Aceptar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {(t.tournament_type === 'brackets' || t.tournament_type === 'vip_cash') && myJoin?.partner_id && (myJoin?.partner_status === 'confirmed' || !myJoin.partner_status) && (
                  <View style={{ alignItems: 'center', marginTop: 8 }}>
                    <Text style={{ color: theme.colors.success, fontWeight: 'bold' }}>✅ Ya tienes compañero</Text>
                  </View>
                )}
              </View>
            )}
            
            {!isJoined && t.status === 'registration' && (
              <TouchableOpacity style={styles.joinBtn} onPress={() => setShowJoinModal(t)}>
                <Text style={styles.joinBtnText}>Inscribirse ({t.tournament_type === 'vip_cash' ? `Bs ${t.entry_fee}` : (Number(t.entry_points) > 0 ? `🪙 ${t.entry_points}` : 'GRATIS 🆓')})</Text>
              </TouchableOpacity>
            )}

            {activeTab === 'live' && t.status === 'in_progress' && (
              <View style={{ marginTop: 16 }}>
                <Text style={{ color: theme.colors.accent, fontSize: 18, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' }}>🏆 Cuadro de Enfrentamientos</Text>
                
                {Number(t.prize_pool) > 0 && (
                  <View style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)', alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: theme.colors.warning }}>
                    <Text style={{ color: theme.colors.warning, fontWeight: 'bold', fontSize: 14 }}>
                      💰 Gran Premio: {t.tournament_type === 'vip_cash' ? `Bs ${t.prize_pool}` : `🪙 ${t.prize_pool}`}
                    </Text>
                  </View>
                )}
                <ScrollView style={{ flex: 1, width: '100%', marginBottom: 16 }}>
                  <ScrollView horizontal style={{ flex: 1, width: '100%' }}>
                    <View style={{ flexDirection: 'row', paddingVertical: 10, paddingHorizontal: 20 }}>
                    {[...new Set(tBrackets.map(b => b.round_number))].sort().map(round => {
                      const isLast = round === Math.max(...tBrackets.map(b => b.round_number));
                      const isFirst = round === Math.min(...tBrackets.map(b => b.round_number));
                      
                      const itemHeight = 120 * Math.pow(2, round - 1);
                      
                      return (
                        <View key={`round-${round}`} style={{ width: 160, marginHorizontal: 15, justifyContent: 'flex-start', paddingTop: 40 }}>
                          <Text style={{ position: 'absolute', top: 0, left: 0, right: 0, color: theme.colors.primary, textAlign: 'center', fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 }}>Ronda {round}</Text>
                          {tBrackets.filter(b => b.round_number === round).map(match => (
                            <View key={match.id} style={{ height: itemHeight, justifyContent: 'center', position: 'relative' }}>
                              {/* Línea vertical de conexión (en el centro del espacio entre columnas) */}
                              {!isFirst && <View style={{ position: 'absolute', left: -15, top: '25%', width: 2, height: '50%', backgroundColor: '#EF4444', zIndex: -1 }} />}

                              <View style={{ 
                                backgroundColor: theme.colors.card, padding: 12, borderRadius: 12, 
                                borderWidth: 1, borderColor: match.winner_team ? theme.colors.primary : theme.colors.cardBorder, 
                                position: 'relative', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3
                              }}>
                                {/* Conector hacia adelante */}
                                {!isLast && <View style={{ position: 'absolute', right: -15, top: '50%', width: 15, height: 2, backgroundColor: '#EF4444', zIndex: -1 }} />}
                                {/* Conector hacia atrás */}
                                {!isFirst && <View style={{ position: 'absolute', left: -15, top: '50%', width: 15, height: 2, backgroundColor: '#EF4444', zIndex: -1 }} />}
                                
                                <TouchableOpacity 
                                  style={{ borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingBottom: 8, marginBottom: 8 }}
                                  onPress={() => handleMatchClick(match)}
                                >
                                  <Text style={{ color: match.winner_team === 1 ? theme.colors.success : theme.colors.text, fontSize: 13, textAlign: 'center', fontWeight: match.winner_team === 1 ? 'bold' : '600' }}>
                                    {match.t1p1?.initials || '?'} & {match.t1p2?.initials || '?'}
                                  </Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => handleMatchClick(match)}>
                                  <Text style={{ color: match.winner_team === 2 ? theme.colors.success : theme.colors.text, fontSize: 13, textAlign: 'center', fontWeight: match.winner_team === 2 ? 'bold' : '600' }}>
                                    {match.t2p1?.initials || '?'} & {match.t2p2?.initials || '?'}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            </View>
                          ))}
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </ScrollView>

                {tMatches.length > 0 && (
                  <View style={{ marginTop: 8, paddingHorizontal: 16 }}>
                    <Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' }}>Partidas Activas</Text>
                    {tMatches.map(tm => (
                      <TouchableOpacity key={tm.id} style={{ backgroundColor: 'rgba(59,130,246,0.1)', borderColor: '#3B82F6', borderWidth: 1, padding: 16, borderRadius: 12, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }} onPress={() => onWatchLiveMatch && onWatchLiveMatch(tm.id)}>
                        <View>
                          <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>
                            Eq. 1 ({tm.team1_total}) <Text style={{color: theme.colors.textDim}}>vs</Text> Eq. 2 ({tm.team2_total})
                          </Text>
                          <Text style={{ color: '#3B82F6', fontSize: 12, marginTop: 4 }}>Toca para ver en vivo</Text>
                        </View>
                        <Text style={{ fontSize: 24 }}>📺</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
            {activeTab === 'my_tourneys' && t.status === 'completed' && (
              <View style={{ gap: 8 }}>
                <TouchableOpacity style={styles.bracketBtn} onPress={() => {
                  setShowBracketModal(t);
                }}>
                  <Text style={styles.bracketBtnText}>🏆 Ver Torneo</Text>
                </TouchableOpacity>

                {/* VIP Cash Payout Button for Winners */}
                {t.tournament_type === 'vip_cash' && (() => {
                  const finalMatch = tBrackets.find(b => b.round_number === Math.max(...tBrackets.map(m => m.round_number)));
                  let isWinner = false;
                  if (finalMatch && finalMatch.winner_team) {
                    if (finalMatch.winner_team === 1 && (finalMatch.team1_player1 === profileId || finalMatch.team1_player2 === profileId)) isWinner = true;
                    if (finalMatch.winner_team === 2 && (finalMatch.team2_player1 === profileId || finalMatch.team2_player2 === profileId)) isWinner = true;
                  }
                  
                  if (isWinner) {
                    const myParticipant = participants.find(p => p.tournament_id === t.id && p.user_id === profileId);
                    const hasSubmittedPayout = myParticipant?.payout_details != null;
                    
                    return (
                      <View style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: 16, borderRadius: 12, marginTop: 8, borderWidth: 1, borderColor: theme.colors.success }}>
                        <Text style={{ color: theme.colors.success, fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 }}>
                          🎉 ¡Felicidades! Eres el ganador
                        </Text>
                        <Text style={{ color: theme.colors.text, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>
                          Como ganador del torneo VIP, debes rellenar tus datos para recibir el premio.
                        </Text>
                        
                        {hasSubmittedPayout ? (
                           <Text style={{ color: (myParticipant?.payout_details as any)?.paid ? theme.colors.success : theme.colors.textDim, textAlign: 'center', fontStyle: 'italic', fontWeight: 'bold' }}>
                             {(myParticipant?.payout_details as any)?.paid 
                               ? '✅ Pago recibido y completado. ¡Disfruta tu premio!' 
                               : '⏳ Tus datos han sido enviados al administrador. Pronto recibirás tu pago.'}
                           </Text>
                        ) : (
                          <TouchableOpacity 
                            style={[styles.bracketBtn, { backgroundColor: theme.colors.success }]} 
                            onPress={() => setShowPayoutModal(t)}
                          >
                            <Text style={styles.bracketBtnText}>Rellenar Datos (Pago Móvil)</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  }
                  return null;
                })()}
              </View>
            )}

          </View>
        );
      })}
      {tournaments.filter(t => {
        if (activeTab === 'lobby') return t.status === 'registration';
        if (activeTab === 'live') return t.status === 'in_progress';
        if (activeTab === 'my_tourneys') return (t.status === 'completed' || t.status === 'cancelled');
        return false;
      }).length === 0 ? <Text style={styles.emptyText}>No hay torneos en esta pestaña en este momento.</Text> : null}
    </ScrollView>
  );

  const renderAdmin = () => (
    <ScrollView contentContainerStyle={styles.scroll}>
      <TouchableOpacity style={[styles.joinBtn, { backgroundColor: theme.colors.warning, marginBottom: 8 }]} onPress={handleGenerateFakeTournament}>
        <Text style={[styles.joinBtnText, { color: '#000' }]}>🧪 Crear Torneo Falso de Prueba (8 Jugadores)</Text>
      </TouchableOpacity>
      
      {fakeTournamentError && (
        <View style={{ backgroundColor: 'rgba(0,0,0,0.5)', padding: 12, borderRadius: 8, marginBottom: 24, borderWidth: 1, borderColor: fakeTournamentError.startsWith('✅') ? theme.colors.success : theme.colors.danger }}>
          <Text style={{ color: fakeTournamentError.startsWith('✅') ? theme.colors.success : theme.colors.danger, fontWeight: 'bold' }}>
            {fakeTournamentError}
          </Text>
        </View>
      )}

      <Text style={[styles.tName, { marginTop: 12, marginBottom: 12 }]}>Torneos en Registro</Text>
      {tournaments.filter(t => t.status === 'registration' && t.tournament_type === 'brackets').map(t => (
        <View key={t.id} style={styles.tournamentCard}>
          <Text style={styles.tName}>{t.name}</Text>
          <TouchableOpacity style={[styles.joinBtn, { backgroundColor: theme.colors.accent }]} onPress={() => handleGenerateBrackets(t)}>
            <Text style={[styles.joinBtnText, { color: '#000' }]}>🎲 Generar Llaves al Azar</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={[styles.tName, { marginTop: 24, marginBottom: 12 }]}>Torneos en Progreso</Text>
      {tournaments.filter(t => t.status === 'in_progress').map(t => (
        <View key={t.id} style={styles.tournamentCard}>
          <Text style={styles.tName}>{t.name}</Text>
          <TouchableOpacity style={styles.bracketBtn} onPress={() => setShowBracketModal(t)}>
            <Text style={styles.bracketBtnText}>🏆 Ver Llaves (Admin)</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={[styles.tName, { marginTop: 24, marginBottom: 12 }]}>Pagos Pendientes ({participants.filter(p => p.payment_status === 'pending').length})</Text>
      {participants.filter(p => p.payment_status === 'pending').map(p => (
        <View key={p.id} style={styles.tournamentCard}>
          <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: 'bold' }}>
            Jugador: {(p as any).profiles?.display_name || 'Desconocido'}
          </Text>
          <Text style={{ color: theme.colors.textDim, marginBottom: 8 }}>Ref: {p.payment_reference}</Text>
          {p.payment_receipt_url && (
            <Image source={{ uri: p.payment_receipt_url }} style={{ width: '100%', height: 200, resizeMode: 'contain', backgroundColor: '#000', marginBottom: 12 }} />
          )}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity 
              style={[styles.joinBtn, { flex: 1, backgroundColor: theme.colors.success }]}
              onPress={() => handleApprovePayment(p.id, p.tournament_id, tournaments.find(t => t.id === p.tournament_id)?.entry_fee || 0)}
            >
              <Text style={styles.joinBtnText}>Aprobar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.joinBtn, { flex: 1, backgroundColor: theme.colors.danger }]}>
              <Text style={styles.joinBtnText}>Rechazar</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <Text style={[styles.tName, { marginTop: 24, marginBottom: 12, color: theme.colors.success }]}>Premios por Pagar (VIP) ({participants.filter(p => p.payout_details != null && !(p.payout_details as any).paid).length})</Text>
      {participants.filter(p => p.payout_details != null && !(p.payout_details as any).paid).map(p => {
        const details = p.payout_details as any;
        const tournament = tournaments.find(t => t.id === p.tournament_id);
        return (
          <View key={`payout-${p.id}`} style={[styles.tournamentCard, { borderColor: theme.colors.success }]}>
            <Text style={{ color: theme.colors.success, fontSize: 16, fontWeight: 'bold', marginBottom: 4 }}>
              🏆 Ganador: {(p as any).profiles?.display_name || 'Desconocido'}
            </Text>
            <Text style={{ color: theme.colors.textDim, marginBottom: 12 }}>Torneo: {tournament?.name}</Text>
            
            <View style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8 }}>
              <Text style={{ color: theme.colors.text, marginBottom: 4 }}>🏦 Banco: <Text style={{ fontWeight: 'bold' }}>{details.bank}</Text></Text>
              <Text style={{ color: theme.colors.text, marginBottom: 4 }}>🆔 Cédula: <Text style={{ fontWeight: 'bold' }}>{details.id}</Text></Text>
              <Text style={{ color: theme.colors.text }}>📱 Teléfono: <Text style={{ fontWeight: 'bold' }}>{details.phone}</Text></Text>
            </View>

            <TouchableOpacity 
              style={[styles.joinBtn, { backgroundColor: theme.colors.success, marginTop: 12 }]} 
              onPress={async () => {
                try {
                   await supabase.from('tournament_participants')
                     .update({ payout_details: { ...details, paid: true } })
                     .eq('id', p.id);
                   fetchData();
                   Alert.alert('Éxito', 'Marcado como pagado exitosamente.');
                } catch(e) {}
              }}
            >
              <Text style={styles.joinBtnText}>✅ Marcar como Pagado</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Torneos VIP</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.tabsRow}>
        <TouchableOpacity style={[styles.tab, activeTab === 'lobby' && styles.tabActive]} onPress={() => setActiveTab('lobby')}>
          <Text style={[styles.tabText, activeTab === 'lobby' && styles.tabTextActive]}>Lobby</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'live' && styles.tabActive]} onPress={() => setActiveTab('live')}>
          <Text style={[styles.tabText, activeTab === 'live' && styles.tabTextActive]}>En Vivo</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'my_tourneys' && styles.tabActive]} onPress={() => setActiveTab('my_tourneys')}>
          <Text style={[styles.tabText, activeTab === 'my_tourneys' && styles.tabTextActive]}>Historial</Text>
        </TouchableOpacity>
        {localIsAdmin && (
          <TouchableOpacity style={[styles.tab, activeTab === 'admin' && styles.tabActive]} onPress={() => setActiveTab('admin')}>
            <Text style={[styles.tabText, activeTab === 'admin' && styles.tabTextActive]}>Admin</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={theme.colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <>
          {(activeTab === 'lobby' || activeTab === 'live' || activeTab === 'my_tourneys') && renderLobby()}
          {activeTab === 'admin' && localIsAdmin && renderAdmin()}
        </>
      )}

      {/* Join Tournament Modal */}
      <Modal visible={!!showJoinModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{showJoinModal?.tournament_type === 'vip_cash' ? 'Inscripción VIP' : 'Inscripción a Torneo'}</Text>
            <Text style={styles.modalSubtitle}>Torneo: {showJoinModal?.name}</Text>
            
            {showJoinModal?.tournament_type === 'vip_cash' ? (
              <>
                <View style={styles.paymentInfo}>
                  <Text style={{ color: theme.colors.text, fontWeight: 'bold' }}>Datos de Pago Móvil:</Text>
                  <Text style={{ color: theme.colors.textDim }}>Banco: 0102 - Bco. Venezuela</Text>
                  <Text style={{ color: theme.colors.textDim }}>C.I: 12.345.678</Text>
                  <Text style={{ color: theme.colors.textDim }}>Tlf: 0414-1234567</Text>
                  <Text style={{ color: theme.colors.accent, fontWeight: 'bold', marginTop: 8 }}>Monto: Bs {showJoinModal?.entry_fee} (al cambio)</Text>
                </View>

                <TextInput 
                  style={styles.input}
                  placeholder="Número de Referencia (últimos 4 dígitos)"
                  placeholderTextColor={theme.colors.textDim}
                  value={paymentRef}
                  onChangeText={setPaymentRef}
                  keyboardType="numeric"
                />

                <TouchableOpacity style={styles.uploadBtn} onPress={handlePickReceipt}>
                  <Text style={styles.uploadBtnText}>
                    {receiptBase64 ? '✅ Capture adjuntado' : '📸 Subir Capture (Requerido)'}
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.paymentInfo}>
                <Text style={{ color: theme.colors.text, fontWeight: 'bold', textAlign: 'center' }}>Costo de Inscripción:</Text>
                <Text style={{ color: theme.colors.accent, fontSize: 32, fontWeight: '900', textAlign: 'center', marginVertical: 12 }}>
                  {Number(showJoinModal?.entry_points) > 0 ? `🪙 ${showJoinModal?.entry_points}` : '¡GRATIS! 🆓'}
                </Text>
                <Text style={{ color: theme.colors.textDim, textAlign: 'center' }}>
                  {Number(showJoinModal?.entry_points) > 0 ? 'Se descontarán de tu saldo de puntos.' : '¡Inscripción libre y sin costo!'}
                </Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24, width: '100%' }}>
              <TouchableOpacity style={[styles.joinBtn, { flex: 1, backgroundColor: theme.colors.cardBorder }]} onPress={() => { setShowJoinModal(null); setReceiptBase64(null); setPaymentRef(''); }}>
                <Text style={styles.joinBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.joinBtn, { flex: 1 }]} onPress={handleJoinTournament}>
                <Text style={styles.joinBtnText}>Enviar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Tournament Modal (Admin) */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Crear Torneo</Text>
            
            <View style={{ flexDirection: 'row', width: '100%', marginBottom: 16 }}>
              {localIsAdmin && (
                <TouchableOpacity style={[styles.tab, tType === 'vip_cash' && styles.tabActive]} onPress={() => setTType('vip_cash')}>
                  <Text style={[styles.tabText, tType === 'vip_cash' && styles.tabTextActive]}>VIP (Bs)</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.tab, tType === 'brackets' && styles.tabActive]} onPress={() => setTType('brackets')}>
                <Text style={[styles.tabText, tType === 'brackets' && styles.tabTextActive]}>Llaves</Text>
              </TouchableOpacity>
            </View>

            <TextInput style={styles.input} placeholder="Nombre del Torneo" placeholderTextColor={theme.colors.textDim} value={tName} onChangeText={setTName} />
            
            {tType === 'vip_cash' ? (
              <TextInput style={styles.input} placeholder="Precio de Entrada (Bs)" placeholderTextColor={theme.colors.textDim} value={tEntryFee} onChangeText={setTEntryFee} keyboardType="numeric" />
            ) : (
              <>
                <TextInput style={styles.input} placeholder="Precio de Entrada en Puntos (0 para GRATIS)" placeholderTextColor={theme.colors.textDim} value={tEntryPoints} onChangeText={setTEntryPoints} keyboardType="numeric" />
                <Text style={{ color: theme.colors.textDim, fontSize: 11, marginTop: -8, marginBottom: 12, marginLeft: 4 }}>
                  💡 Deja en 0 o vacío para que el torneo sea 100% gratuito.
                </Text>
              </>
            )}
            
            <View style={{ marginBottom: 16, width: '100%' }}>
              <Text style={{ color: theme.colors.textDim, marginBottom: 8, marginLeft: 4 }}>Cantidad de Jugadores:</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {[4, 8, 16, 24, 32].map(num => (
                  <TouchableOpacity
                    key={num}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 16,
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: tMaxPlayers === num.toString() ? theme.colors.accent : theme.colors.cardBorder,
                      backgroundColor: tMaxPlayers === num.toString() ? 'rgba(245, 158, 11, 0.1)' : theme.colors.cardBorder
                    }}
                    onPress={() => setTMaxPlayers(num.toString())}
                  >
                    <Text style={{ 
                      color: tMaxPlayers === num.toString() ? theme.colors.accent : theme.colors.text,
                      fontWeight: tMaxPlayers === num.toString() ? 'bold' : 'normal'
                    }}>{num}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24, width: '100%' }}>
              <TouchableOpacity style={[styles.joinBtn, { flex: 1, backgroundColor: theme.colors.cardBorder }]} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.joinBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.joinBtn, { flex: 1 }]} onPress={handleCreateTournament}>
                <Text style={styles.joinBtnText}>Crear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Partner Selection Modal */}
      <Modal visible={!!showPartnerModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Seleccionar Compañero</Text>
            <Text style={styles.modalSubtitle}>Elige tu dúo fijo para las llaves</Text>
            
            <ScrollView style={{ width: '100%', maxHeight: 300, marginBottom: 16 }}>
              {availablePartners.length === 0 ? (
                <Text style={styles.emptyText}>No hay jugadores disponibles. ¡Dile a tus amigos que se inscriban!</Text>
              ) : (
                availablePartners.map(p => (
                  <TouchableOpacity key={p.user_id} style={[styles.actionBtn, { backgroundColor: theme.colors.cardBorder, marginBottom: 8, flexDirection: 'row', paddingHorizontal: 16 }]} onPress={() => handleSelectPartner(p.user_id)}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>{p.profiles.initials}</Text>
                    </View>
                    <Text style={{ color: theme.colors.text, fontSize: 16, flex: 1 }}>{p.profiles.display_name}</Text>
                    <Text style={{ color: theme.colors.accent }}>Invitar</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <TouchableOpacity style={[styles.joinBtn, { width: '100%', backgroundColor: theme.colors.cardBorder }]} onPress={() => setShowPartnerModal(null)}>
              <Text style={styles.joinBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Bracket Modal */}
      <Modal visible={!!showBracketModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: '80%' }]}>
            <Text style={styles.modalTitle}>Cuadro de Enfrentamientos</Text>
            
            <ScrollView style={{ flex: 1, width: '100%' }}>
              <ScrollView horizontal style={{ flex: 1, width: '100%' }}>
                <View style={{ flexDirection: 'row', paddingVertical: 20 }}>
                {/* Agrupamos por rondas */}
                {[...new Set(bracketsData.map(b => b.round_number))].sort().map(round => {
                  const isLast = round === Math.max(...bracketsData.map(b => b.round_number));
                  const isFirst = round === Math.min(...bracketsData.map(b => b.round_number));
                  
                  const itemHeight = 120 * Math.pow(2, round - 1);
                  
                  return (
                    <View key={`round-${round}`} style={{ width: 160, marginHorizontal: 20, justifyContent: 'flex-start', paddingTop: 40 }}>
                      <Text style={{ position: 'absolute', top: 0, left: 0, right: 0, color: theme.colors.primary, textAlign: 'center', fontWeight: '900', fontSize: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Ronda {round}</Text>
                      {bracketsData.filter(b => b.round_number === round).map(match => (
                        <View key={match.id} style={{ height: itemHeight, justifyContent: 'center', position: 'relative' }}>
                          {/* Línea vertical de conexión (en el centro del espacio entre columnas) */}
                          {!isFirst && <View style={{ position: 'absolute', left: -20, top: '25%', width: 2, height: '50%', backgroundColor: '#EF4444', zIndex: -1 }} />}

                          <View style={{ 
                            backgroundColor: theme.colors.card, padding: 12, borderRadius: 12, 
                            borderWidth: 1, borderColor: match.winner_team ? theme.colors.primary : theme.colors.cardBorder, 
                            position: 'relative', elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3
                          }}>
                            {/* Conector hacia adelante */}
                            {!isLast && <View style={{ position: 'absolute', right: -20, top: '50%', width: 20, height: 2, backgroundColor: '#EF4444', zIndex: -1 }} />}
                            {/* Conector hacia atrás */}
                            {!isFirst && <View style={{ position: 'absolute', left: -20, top: '50%', width: 20, height: 2, backgroundColor: '#EF4444', zIndex: -1 }} />}
                            
                            <TouchableOpacity 
                              style={{ borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingBottom: 8, marginBottom: 8 }}
                              onPress={() => handleMatchClick(match)}
                            >
                              <Text style={{ color: match.winner_team === 1 ? theme.colors.success : theme.colors.text, fontSize: 14, textAlign: 'center', fontWeight: match.winner_team === 1 ? 'bold' : '600' }}>
                                {match.t1p1?.initials || '?'} & {match.t1p2?.initials || '?'}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                              onPress={() => handleMatchClick(match)}
                            >
                              <Text style={{ color: match.winner_team === 2 ? theme.colors.success : theme.colors.text, fontSize: 14, textAlign: 'center', fontWeight: match.winner_team === 2 ? 'bold' : '600' }}>
                                {match.t2p1?.initials || '?'} & {match.t2p2?.initials || '?'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
            </ScrollView>

            <TouchableOpacity style={[styles.joinBtn, { width: '100%', marginTop: 16 }]} onPress={() => setShowBracketModal(null)}>
              <Text style={styles.joinBtnText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={!!showPayoutModal} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: theme.colors.background, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.cardBorder }}>
            <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' }}>
              Datos para tu Premio 🏆
            </Text>
            
            <Text style={{ color: theme.colors.textDim, fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
              Por favor ingresa los datos del Pago Móvil donde deseas recibir tu dinero.
            </Text>

            <TextInput
              style={{ backgroundColor: theme.colors.card, color: theme.colors.text, padding: 14, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.cardBorder }}
              placeholder="Banco (Ej: Banesco, Mercantil)"
              placeholderTextColor={theme.colors.textDim}
              value={payoutBank}
              onChangeText={setPayoutBank}
            />

            <TextInput
              style={{ backgroundColor: theme.colors.card, color: theme.colors.text, padding: 14, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.cardBorder }}
              placeholder="Cédula (Ej: V-12345678)"
              placeholderTextColor={theme.colors.textDim}
              value={payoutId}
              onChangeText={setPayoutId}
            />

            <TextInput
              style={{ backgroundColor: theme.colors.card, color: theme.colors.text, padding: 14, borderRadius: 8, marginBottom: 20, borderWidth: 1, borderColor: theme.colors.cardBorder }}
              placeholder="Teléfono (Ej: 0414-1234567)"
              placeholderTextColor={theme.colors.textDim}
              value={payoutPhone}
              onChangeText={setPayoutPhone}
              keyboardType="phone-pad"
            />

            <TouchableOpacity style={styles.joinBtn} onPress={handleSubmitPayout}>
              <Text style={styles.joinBtnText}>Enviar Datos</Text>
            </TouchableOpacity>

            <TouchableOpacity style={{ marginTop: 16, padding: 12 }} onPress={() => setShowPayoutModal(null)}>
              <Text style={{ color: theme.colors.textDim, textAlign: 'center', fontWeight: 'bold' }}>Cancelar</Text>
            </TouchableOpacity>
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
  headerTitle: { color: theme.colors.accent, fontSize: 18, fontWeight: '900', fontStyle: 'italic' },
  backBtn: { paddingVertical: 6 },
  backBtnText: { color: theme.colors.primary, fontSize: 15, fontWeight: '600' },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder },
  tab: { flex: 1, paddingVertical: 16, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: theme.colors.accent },
  tabText: { color: theme.colors.textDim, fontWeight: 'bold' },
  tabTextActive: { color: theme.colors.accent },
  scroll: { padding: theme.spacing.m, paddingBottom: 40 },
  
  casinoBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderWidth: 1,
    borderColor: theme.colors.accent,
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.l,
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  casinoBannerTitle: { color: theme.colors.accent, fontSize: 24, fontWeight: '900', marginBottom: 4 },
  casinoBannerSub: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },

  tournamentCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.l,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    padding: theme.spacing.l,
    marginBottom: theme.spacing.l,
  },
  tName: { color: theme.colors.text, fontSize: 20, fontWeight: 'bold', marginBottom: theme.spacing.m },
  tStats: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 8, marginBottom: theme.spacing.m },
  tStatBox: { flex: 1, alignItems: 'center' },
  tStatLabel: { color: theme.colors.textDim, fontSize: 11, marginBottom: 2 },
  tStatValue: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  
  joinBtn: {
    backgroundColor: theme.colors.accent,
    paddingVertical: 14,
    borderRadius: theme.borderRadius.m,
    alignItems: 'center',
  },
  joinBtnText: { color: '#000', fontSize: 16, fontWeight: '900', textTransform: 'uppercase' },
  actionBtn: { paddingVertical: 14, borderRadius: theme.borderRadius.m, alignItems: 'center' },
  actionBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  bracketBtn: { backgroundColor: theme.colors.primary, paddingVertical: 14, borderRadius: theme.borderRadius.m, alignItems: 'center', marginTop: 8 },
  bracketBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  emptyText: { color: theme.colors.textDim, textAlign: 'center', fontStyle: 'italic', marginTop: 40 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: theme.spacing.xl },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    alignItems: 'center',
    width: '100%',
  },
  modalTitle: { color: theme.colors.accent, fontSize: 24, fontWeight: '900', marginBottom: 4 },
  modalSubtitle: { color: theme.colors.text, fontSize: 16, marginBottom: theme.spacing.l },
  paymentInfo: { backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 8, width: '100%', marginBottom: 16 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: 8,
    padding: 14,
    color: theme.colors.text,
    fontSize: 16,
    width: '100%',
    marginBottom: 16,
  },
  uploadBtn: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  uploadBtnText: { color: theme.colors.primary, fontWeight: 'bold' },
});

const TournamentTimer = ({ t, onExpire }: { t: Tournament, onExpire: () => void }) => {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (t.status !== 'registration' || t.tournament_type === 'vip_cash') return;
    
    const createdTime = new Date(t.created_at).getTime();
    const expiryTime = createdTime + 5 * 60 * 1000; // 5 minutos

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const remaining = Math.max(0, expiryTime - now);
      setTimeLeft(remaining);

      if (remaining === 0) {
        clearInterval(interval);
        onExpire();
      }
    }, 1000);

    // Ejecutar inmediatamente una vez para inicializar
    const now = new Date().getTime();
    const remaining = Math.max(0, expiryTime - now);
    setTimeLeft(remaining);
    if (remaining === 0) {
      onExpire();
    }

    return () => clearInterval(interval);
  }, [t]);

  if (t.status !== 'registration' || t.tournament_type === 'vip_cash' || timeLeft <= 0) return null;

  const mins = Math.floor(timeLeft / 60000);
  const secs = Math.floor((timeLeft % 60000) / 1000);
  
  return (
    <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: 8, borderRadius: 8, alignItems: 'center', marginBottom: 12 }}>
      <Text style={{ color: theme.colors.danger, fontWeight: 'bold' }}>
        ⏳ Cierra en: {mins}:{secs.toString().padStart(2, '0')}
      </Text>
    </View>
  );
};

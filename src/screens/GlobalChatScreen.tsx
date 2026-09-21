import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, SafeAreaView } from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';

interface ChatMessage {
  id: string;
  user_id: string;
  message: string;
  created_at: string;
  profiles: {
    display_name: string;
    initials: string;
    equipped_items?: any;
  };
}

interface Props {
  onBack: () => void;
  currentUserProfileId: string;
}

export const GlobalChatScreen: React.FC<Props> = ({ onBack, currentUserProfileId }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    fetchMessages();

    // Subscribe to realtime changes
    const channel = supabase.channel('global_chat_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'global_chat' }, async payload => {
        // Fetch the profile for the new message
        const { data: profile } = await supabase.from('profiles').select('display_name, initials, equipped_items').eq('id', payload.new.user_id).single();
        if (profile) {
          const newMsg = { ...payload.new, profiles: profile } as ChatMessage;
          setMessages(prev => {
            // Check if we already added it optimistically
            if (prev.find(m => m.id === newMsg.id)) return prev;
            return [newMsg, ...prev];
          });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Cooldown timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('global_chat')
        .select(`
          id,
          user_id,
          message,
          created_at,
          profiles (display_name, initials, equipped_items)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (data && !error) {
        setMessages(data as unknown as ChatMessage[]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim()) return;
    if (cooldown > 0) return;

    const msgText = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      const { error } = await supabase.from('global_chat').insert({
        user_id: currentUserProfileId,
        message: msgText
      });

      if (error) {
        if (error.message.includes('3 segundos')) {
          setCooldown(3);
          Alert.alert('Calma', 'Estás enviando mensajes muy rápido. Espera 3 segundos.');
        } else {
          Alert.alert('Error', 'No se pudo enviar el mensaje.');
        }
      } else {
        setCooldown(3); // Start 3 second cooldown visually
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isMe = item.user_id === currentUserProfileId;
    const equipped = item.profiles?.equipped_items || {};
    const hasColor = equipped.color && equipped.color !== 'rainbow';
    const isRainbow = equipped.color === 'rainbow';
    
    return (
      <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowThem]}>
        {!isMe && (
          <View style={[
            styles.avatar, 
            equipped.border ? { borderColor: equipped.border, borderWidth: 2 } : {}
          ]}>
            <Text style={styles.avatarText}>{item.profiles?.initials || '??'}</Text>
          </View>
        )}
        <View style={[styles.messageBubble, isMe ? styles.messageBubbleMe : styles.messageBubbleThem]}>
          {!isMe && (
            <Text style={[
              styles.senderName,
              hasColor && { color: equipped.color },
              isRainbow && { color: '#ec4899' } // Fallback pink for rainbow if no gradient
            ]}>
              {equipped.title ? `${equipped.title} ` : ''}{item.profiles?.display_name || 'Desconocido'}
            </Text>
          )}
          <Text style={styles.messageText}>{item.message}</Text>
          <Text style={styles.timeText}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>💬 Chat Global</Text>
        <View style={{ width: 60 }} />
      </View>

      {Platform.OS === 'web' ? (
        <View style={styles.keyboardView}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              keyExtractor={item => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.listContent}
              inverted={true}
              showsVerticalScrollIndicator={false}
            />
          )}

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Escribe algo a la comunidad..."
              placeholderTextColor={theme.colors.textDim}
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={250}
            />
            <TouchableOpacity 
              style={[styles.sendBtn, (!inputText.trim() || cooldown > 0) && styles.sendBtnDisabled]} 
              onPress={handleSend}
              disabled={!inputText.trim() || sending || cooldown > 0}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : cooldown > 0 ? (
                <Text style={styles.sendBtnText}>{cooldown}s</Text>
              ) : (
                <Text style={styles.sendBtnText}>➤</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'padding'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 25} style={styles.keyboardView}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={item => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.listContent}
            inverted={true} // Newest at bottom
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Escribe algo a la comunidad..."
            placeholderTextColor={theme.colors.textDim}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={250}
          />
          <TouchableOpacity 
            style={[styles.sendBtn, (!inputText.trim() || cooldown > 0) && styles.sendBtnDisabled]} 
            onPress={handleSend}
            disabled={!inputText.trim() || sending || cooldown > 0}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : cooldown > 0 ? (
              <Text style={styles.sendBtnText}>{cooldown}s</Text>
            ) : (
              <Text style={styles.sendBtnText}>➤</Text>
            )}
          </TouchableOpacity>
        </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: theme.spacing.m, borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder,
    backgroundColor: theme.colors.card
  },
  backBtn: { padding: theme.spacing.s, width: 60 },
  backBtnText: { color: theme.colors.primary, fontWeight: 'bold' },
  headerTitle: { color: theme.colors.text, fontSize: 18, fontWeight: 'bold' },
  keyboardView: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: theme.spacing.m, gap: theme.spacing.s },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: theme.spacing.s },
  messageRowMe: { justifyContent: 'flex-end' },
  messageRowThem: { justifyContent: 'flex-start' },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.primary,
    justifyContent: 'center', alignItems: 'center', marginRight: theme.spacing.s,
  },
  avatarText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  messageBubble: { maxWidth: '80%', padding: theme.spacing.m, borderRadius: theme.borderRadius.m },
  messageBubbleMe: { backgroundColor: theme.colors.primary, borderBottomRightRadius: 4 },
  messageBubbleThem: { backgroundColor: theme.colors.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: theme.colors.cardBorder },
  senderName: { fontSize: 13, fontWeight: 'bold', marginBottom: 2, color: theme.colors.secondary },
  messageText: { color: '#fff', fontSize: 15, lineHeight: 20 },
  timeText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, alignSelf: 'flex-end', marginTop: 4 },
  inputContainer: {
    flexDirection: 'row', padding: theme.spacing.m, backgroundColor: theme.colors.card,
    borderTopWidth: 1, borderTopColor: theme.colors.cardBorder, alignItems: 'flex-end'
  },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.05)', color: theme.colors.text,
    borderRadius: theme.borderRadius.m, paddingHorizontal: theme.spacing.m, paddingTop: 12, paddingBottom: 12,
    minHeight: 44, maxHeight: 100, marginRight: theme.spacing.m, borderWidth: 1, borderColor: theme.colors.cardBorder
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.primary,
    justifyContent: 'center', alignItems: 'center'
  },
  sendBtnDisabled: { backgroundColor: theme.colors.cardBorder },
  sendBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});

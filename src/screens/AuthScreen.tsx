import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, SafeAreaView, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { theme } from '../theme';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface Props {
  onSessionConfigured: () => void;
  onGuestMode: () => void;
}

export const AuthScreen: React.FC<Props> = ({ onSessionConfigured, onGuestMode }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [initials, setInitials] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Ingresa correo y contraseña');
      return;
    }

    if (!isSupabaseConfigured) {
      Alert.alert('Modo Local', 'Supabase no está configurado.', [{ text: 'OK', onPress: onGuestMode }]);
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      onSessionConfigured();
    }
  };

  const handleRegister = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Ingresa correo y contraseña');
      return;
    }
    if (!displayName.trim()) {
      Alert.alert('Error', 'Ingresa tu nombre');
      return;
    }
    if (!initials.trim() || initials.trim().length > 3) {
      Alert.alert('Error', 'Ingresa tus iniciales (máximo 3 letras)');
      return;
    }

    if (!isSupabaseConfigured) {
      Alert.alert('Modo Local', 'Supabase no está configurado.', [{ text: 'OK', onPress: onGuestMode }]);
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName.trim(),
          initials: initials.trim().toUpperCase(),
        },
      },
    });
    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert(
        '✅ Registro Exitoso', 
        'Tu cuenta ha sido creada correctamente.\\n\\nPor favor, revisa tu bandeja de entrada (o la carpeta de SPAM) para confirmar tu correo electrónico antes de iniciar sesión.'
      );
      setIsRegistering(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.logo}>🁣</Text>
          <Text style={styles.title}>Domino del Cafetín</Text>
          <Text style={{ color: theme.colors.primary, fontWeight: '900', fontSize: 13, letterSpacing: 2, textAlign: 'center', marginBottom: 6 }}>PeSiMiSta EDITION</Text>
          <Text style={styles.subtitle}>
            {isRegistering ? 'Crea tu cuenta para guardar tus resultados' : 'Inicia sesión para ver tus stats'}
          </Text>

          <View style={styles.card}>
            {isRegistering && (
              <>
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Tu Nombre</Text>
                  <TextInput
                    style={styles.input}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder="Ej: Juanito Alcachofa"
                    placeholderTextColor={theme.colors.textDim}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Iniciales (máx 3 letras)</Text>
                  <TextInput
                    style={styles.input}
                    value={initials}
                    onChangeText={(t) => setInitials(t.slice(0, 3).toUpperCase())}
                    placeholder="Ej: ALV"
                    placeholderTextColor={theme.colors.textDim}
                    maxLength={3}
                    autoCapitalize="characters"
                  />
                </View>
              </>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Correo Electrónico</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="tu@correo.com"
                placeholderTextColor={theme.colors.textDim}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Contraseña</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="******"
                placeholderTextColor={theme.colors.textDim}
              />
            </View>

            {isRegistering ? (
              <View style={styles.actions}>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleRegister} disabled={loading}>
                  <Text style={styles.btnText}>{loading ? 'Creando...' : 'Crear Cuenta'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setIsRegistering(false)}>
                  <Text style={styles.linkText}>¿Ya tienes cuenta? Inicia sesión</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.actions}>
                <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin} disabled={loading}>
                  <Text style={styles.btnText}>{loading ? 'Cargando...' : 'Iniciar Sesión'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setIsRegistering(true)}>
                  <Text style={styles.secondaryBtnText}>Registrarse</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Guest Mode Button */}
          <TouchableOpacity style={styles.guestBtn} onPress={onGuestMode}>
            <Text style={styles.guestIcon}>🎲</Text>
            <Text style={styles.guestTitle}>Solo Contar Puntos</Text>
            <Text style={styles.guestSubtitle}>Juega sin cuenta — no se guardan estadísticas</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  logo: {
    fontSize: 48,
    textAlign: 'center',
    marginBottom: theme.spacing.s,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: theme.colors.text,
    textAlign: 'center',
    marginBottom: theme.spacing.s,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textDim,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
  card: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.xl,
    borderRadius: theme.borderRadius.l,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  inputGroup: {
    marginBottom: theme.spacing.l,
  },
  label: {
    color: theme.colors.textDim,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s,
    padding: theme.spacing.m,
    color: theme.colors.text,
    fontSize: 16,
  },
  actions: {
    marginTop: theme.spacing.m,
    gap: theme.spacing.m,
  },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.m,
    borderRadius: theme.borderRadius.full,
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.primary,
    padding: theme.spacing.m,
    borderRadius: theme.borderRadius.full,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: theme.colors.primary,
    fontWeight: 'bold',
    fontSize: 16,
  },
  linkText: {
    color: theme.colors.primary,
    textAlign: 'center',
    fontSize: 14,
    marginTop: theme.spacing.s,
  },
  guestBtn: {
    marginTop: theme.spacing.xl,
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.l,
    borderRadius: theme.borderRadius.l,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderStyle: 'dashed',
  },
  guestIcon: {
    fontSize: 32,
    marginBottom: theme.spacing.s,
  },
  guestTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  guestSubtitle: {
    color: theme.colors.textDim,
    fontSize: 12,
    marginTop: 4,
  },
});

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, SafeAreaView, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import { theme } from '../theme';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { QRScannerModal } from '../components/QRScannerModal';
import { DominoLogo } from '../components/DominoLogo';

interface Props {
  onSessionConfigured: () => void;
  onGuestMode: () => void;
  inviteCode?: string | null;
  initialRecoveryMode?: boolean;
}

export const AuthScreen: React.FC<Props> = ({ onSessionConfigured, onGuestMode, inviteCode, initialRecoveryMode }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [initials, setInitials] = useState('');
  const [accessCode, setAccessCode] = useState(inviteCode || '');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(!!inviteCode);
  const [showScanner, setShowScanner] = useState(false);

  // Estados para Recuperación de Contraseña
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [isSettingNewPassword, setIsSettingNewPassword] = useState(!!initialRecoveryMode);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (initialRecoveryMode) {
      setIsSettingNewPassword(true);
    }
  }, [initialRecoveryMode]);

  useEffect(() => {
    if (inviteCode) {
      setAccessCode(inviteCode);
      setIsRegistering(true);
    }
  }, [inviteCode]);

  const handleSendRecoveryEmail = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      Alert.alert('Correo Requerido', 'Por favor ingresa un correo electrónico válido.');
      return;
    }

    setLoading(true);
    try {
      const redirectTo = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : undefined;

      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo,
      });

      if (error) {
        Alert.alert('Error al Enviar', error.message);
      } else {
        setRecoverySent(true);
        Alert.alert(
          '✅ Enlace Enviado',
          `Hemos enviado las instrucciones para restablecer tu contraseña a:\n\n${cleanEmail}\n\nRevisa tu bandeja de entrada o carpeta de Spam y abre el enlace.`
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'No se pudo enviar el correo de recuperación.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      Alert.alert('Contraseña Muy Corta', 'La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Las contraseñas no coinciden. Por favor verifícalas.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        Alert.alert('Error al Actualizar', error.message);
      } else {
        Alert.alert(
          '✅ ¡Contraseña Actualizada!',
          'Tu contraseña ha sido cambiada con éxito. Ya has iniciado sesión.'
        );
        setIsSettingNewPassword(false);
        setIsForgotPassword(false);
        onSessionConfigured();
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'No se pudo actualizar la contraseña.');
    } finally {
      setLoading(false);
    }
  };

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

    const validCodes = ['CAFETIN', 'PESIMISTAS', 'DOMINO', '0509', 'VIP'];
    if (!validCodes.includes(accessCode.trim().toUpperCase())) {
      Alert.alert(
        '🔒 Código de Acceso Requerido',
        'Para registrarte en Domino del Cafetín necesitas el código de acceso del local. Pídeselo a los organizadores en la mesa.'
      );
      return;
    }

    if (!isSupabaseConfigured) {
      Alert.alert('Modo Local', 'Supabase no está configurado.', [{ text: 'OK', onPress: onGuestMode }]);
      return;
    }

    setLoading(true);
    const { data: signUpData, error } = await supabase.auth.signUp({
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
    } else if (signUpData?.session) {
      Alert.alert('✅ ¡Bienvenido!', 'Tu cuenta ha sido creada exitosamente.');
      onSessionConfigured();
    } else {
      Alert.alert(
        '✅ Registro Exitoso', 
        'Tu cuenta ha sido creada correctamente. Ya puedes iniciar sesión con tu correo y contraseña.'
      );
      setIsRegistering(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={{ alignSelf: 'center', marginBottom: theme.spacing.m }}>
            <DominoLogo size={76} glow={true} />
          </View>
          <Text style={styles.title}>Domino del Cafetín</Text>
          <Text style={{ color: theme.colors.primary, fontWeight: '900', fontSize: 13, letterSpacing: 2, textAlign: 'center', marginBottom: 6 }}>PeSiMiSta EDITION</Text>
          <Text style={styles.subtitle}>
            {isSettingNewPassword
              ? 'Establece tu nueva contraseña para ingresar'
              : isForgotPassword
              ? 'Te ayudamos a recuperar el acceso a tu cuenta'
              : isRegistering
              ? 'Crea tu cuenta para guardar tus resultados'
              : 'Inicia sesión para ver tus stats'}
          </Text>

          <View style={styles.card}>
            {isSettingNewPassword ? (
              <>
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 4 }}>
                    🔒 Nueva Contraseña
                  </Text>
                  <Text style={{ color: theme.colors.textDim, fontSize: 13, lineHeight: 18 }}>
                    Crea una contraseña segura de al menos 6 caracteres para tu cuenta.
                  </Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Nueva Contraseña</Text>
                  <TextInput
                    style={styles.input}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                    placeholder="Mínimo 6 caracteres"
                    placeholderTextColor={theme.colors.textDim}
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Confirmar Contraseña</Text>
                  <TextInput
                    style={styles.input}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    placeholder="Repite la contraseña"
                    placeholderTextColor={theme.colors.textDim}
                  />
                </View>

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleUpdatePassword}
                    disabled={loading}
                  >
                    <Text style={styles.btnText}>
                      {loading ? 'Guardando...' : 'Guardar Nueva Contraseña 🔒'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setIsSettingNewPassword(false)}
                    style={{ marginTop: 12, alignItems: 'center' }}
                  >
                    <Text style={styles.linkText}>Cancelar</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : isForgotPassword ? (
              <>
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 4 }}>
                    🔑 Recuperar Contraseña
                  </Text>
                  <Text style={{ color: theme.colors.textDim, fontSize: 13, lineHeight: 18 }}>
                    Ingresa tu correo electrónico registrado y te enviaremos un enlace seguro para restablecer tu clave.
                  </Text>
                </View>

                {recoverySent ? (
                  <View style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 1,
                    borderColor: theme.colors.success,
                    borderRadius: 14,
                    padding: 16,
                    marginBottom: 16,
                    alignItems: 'center',
                  }}>
                    <Text style={{ fontSize: 32, marginBottom: 8 }}>📬</Text>
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 6 }}>
                      ¡Enlace Enviado!
                    </Text>
                    <Text style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
                      Hemos enviado las instrucciones a {'\n'}
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>{email}</Text>.{'\n\n'}
                      Revisa tu bandeja de entrada o carpeta de Spam y presiona el enlace desde tu teléfono o navegador para crear tu nueva clave.
                    </Text>
                  </View>
                ) : (
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
                )}

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleSendRecoveryEmail}
                    disabled={loading}
                  >
                    <Text style={styles.btnText}>
                      {loading ? 'Enviando...' : recoverySent ? 'Reenviar Correo ✉️' : 'Enviar Enlace de Recuperación ✉️'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setIsForgotPassword(false);
                      setRecoverySent(false);
                    }}
                    style={{ marginTop: 12, alignItems: 'center' }}
                  >
                    <Text style={styles.linkText}>← Volver a Iniciar Sesión</Text>
                  </TouchableOpacity>
                </View>

                <View style={{
                  marginTop: 16,
                  paddingTop: 14,
                  borderTopWidth: 1,
                  borderTopColor: 'rgba(255,255,255,0.08)',
                }}>
                  <Text style={{ color: theme.colors.textDim, fontSize: 11, textAlign: 'center', lineHeight: 16 }}>
                    💡 Si no tienes acceso a tu correo o juegas en la mesa del Cafetín, consulta con el organizador para asistencia directa.
                  </Text>
                </View>
              </>
            ) : (
              <>
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

                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.s }}>
                        <Text style={styles.label}>Código de Acceso del Cafetín 🔒</Text>
                      </View>

                      {/* Botón Destacado para Escanear el QR */}
                      <TouchableOpacity
                        onPress={() => setShowScanner(true)}
                        style={{
                          backgroundColor: 'rgba(59, 130, 246, 0.12)',
                          borderWidth: 1.5,
                          borderColor: '#3b82f6',
                          borderRadius: 14,
                          padding: 12,
                          marginBottom: 10,
                          flexDirection: 'row',
                          alignItems: 'center',
                          shadowColor: '#3b82f6',
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.25,
                          shadowRadius: 8,
                        }}
                        activeOpacity={0.8}
                      >
                        <View style={{
                          width: 42,
                          height: 42,
                          borderRadius: 12,
                          backgroundColor: 'rgba(59, 130, 246, 0.2)',
                          justifyContent: 'center',
                          alignItems: 'center',
                          marginRight: 12,
                        }}>
                          <Text style={{ fontSize: 22 }}>📷</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>
                            Escanear Código QR con Cámara
                          </Text>
                          <Text style={{ color: theme.colors.textDim, fontSize: 11, marginTop: 2 }}>
                            Toca aquí para leer el QR de tu compañero
                          </Text>
                        </View>
                        <Text style={{ color: '#60a5fa', fontSize: 18, fontWeight: 'bold' }}>➜</Text>
                      </TouchableOpacity>

                      <TextInput
                        style={[
                          styles.input,
                          ['CAFETIN', 'PESIMISTAS', 'DOMINO', '0509', 'VIP'].includes(accessCode.trim().toUpperCase())
                            ? { borderColor: theme.colors.success, backgroundColor: 'rgba(16, 185, 129, 0.08)' }
                            : { borderColor: '#eab308' }
                        ]}
                        value={accessCode}
                        onChangeText={setAccessCode}
                        placeholder="O ingresa el código manual (Ej: CAFETIN)"
                        placeholderTextColor={theme.colors.textDim}
                        autoCapitalize="characters"
                      />
                      {['CAFETIN', 'PESIMISTAS', 'DOMINO', '0509', 'VIP'].includes(accessCode.trim().toUpperCase()) ? (
                        <Text style={{ color: theme.colors.success, fontSize: 12, marginTop: 4, fontWeight: '700' }}>
                          ✅ Pase de Invitación VIP Verificado ({accessCode.trim().toUpperCase()})
                        </Text>
                      ) : (
                        <Text style={{ color: theme.colors.textDim, fontSize: 11, marginTop: 4 }}>
                          Presiona el botón arriba para leer el QR o escribe el código.
                        </Text>
                      )}
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

                {!isRegistering && (
                  <TouchableOpacity
                    onPress={() => {
                      setIsForgotPassword(true);
                      setRecoverySent(false);
                    }}
                    style={{ alignSelf: 'flex-end', marginTop: 4, marginBottom: 12 }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: '#60a5fa', fontSize: 13, fontWeight: '700' }}>
                      ¿Olvidaste tu contraseña? 🔑
                    </Text>
                  </TouchableOpacity>
                )}

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
              </>
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

      <QRScannerModal
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScanSuccess={(code) => {
          setAccessCode(code);
          setShowScanner(false);
          Alert.alert('✅ ¡Pase Escaneado!', `Código de acceso detectado y verificado: ${code}`);
        }}
      />
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

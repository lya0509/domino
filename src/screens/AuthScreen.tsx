import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, SafeAreaView, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { theme } from '../theme';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { QRScannerModal } from '../components/QRScannerModal';
import { LegalModal, LegalTab } from '../components/LegalModal';

interface Props {
  onSessionConfigured: () => void;
  onGuestMode: () => void;
  inviteCode?: string | null;
  initialRecoveryMode?: boolean;
}

const isAccessCodeValid = (code: string): boolean => {
  const c = (code || '').trim().toUpperCase();
  if (!c) return false;
  const validCodes = ['CAFETIN', 'PESIMISTAS', 'DOMINO', '0509', 'VIP'];
  return validCodes.some(v => c === v || c.includes(v) || c.includes(`INVITE=${v}`) || c.includes(`CODE=${v}`) || c.includes(`REF=${v}`));
};

export const AuthScreen: React.FC<Props> = ({ onSessionConfigured, onGuestMode, inviteCode, initialRecoveryMode }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [initials, setInitials] = useState('');
  const [accessCode, setAccessCode] = useState(inviteCode || '');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(!!inviteCode);
  const [showScanner, setShowScanner] = useState(false);

  // Modal Legal
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalTab>('terms');

  const openLegal = (tab: LegalTab) => {
    setLegalTab(tab);
    setShowLegalModal(true);
  };

  // Referencias para navegación por teclado
  const displayNameRef = useRef<TextInput>(null);
  const initialsRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  // Estados para visibilidad de contraseñas (ojitos)
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Estados para Recuperación de Contraseña
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [isSettingNewPassword, setIsSettingNewPassword] = useState(
    !!initialRecoveryMode ||
    (Platform.OS === 'web' && typeof window !== 'undefined' && (
      (window.location.hash || '').includes('type=recovery') ||
      (window.location.search || '').includes('type=recovery') ||
      ((window.location.hash || '').includes('access_token') && (window.location.hash || '').includes('type=recovery'))
    ))
  );
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (initialRecoveryMode) {
      setIsSettingNewPassword(true);
    } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      if (hash.includes('type=recovery') || search.includes('type=recovery')) {
        setIsSettingNewPassword(true);
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsSettingNewPassword(true);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
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
      const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
      const webOrigin = isWeb && window.location.origin && !window.location.origin.includes('localhost')
        ? window.location.origin
        : 'https://domino-mauve.vercel.app';
      const redirectTo = `${webOrigin}/`;

      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo,
      });

      if (error) {
        if (error.message.includes('rate limit') || error.message.includes('over_email_send_rate_limit')) {
          Alert.alert(
            '⏳ Límite de Envíos',
            'Por favor espera unos minutos antes de solicitar otro correo de recuperación.'
          );
        } else {
          Alert.alert('Error al Enviar', error.message);
        }
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
        if (error.message.includes('New password should be different')) {
          Alert.alert('Aviso', 'La nueva contraseña debe ser diferente a la que ya tenías.');
        } else {
          Alert.alert('Error al Actualizar', error.message);
        }
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
      Alert.alert('Error', 'Ingresa tu correo y contraseña.');
      return;
    }

    if (!isSupabaseConfigured) {
      Alert.alert('Modo Local', 'Supabase no está configurado.', [{ text: 'OK', onPress: onGuestMode }]);
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);

    if (error) {
      if (
        error.message.includes('Invalid login credentials') ||
        error.message.includes('invalid_grant') ||
        error.message.includes('invalid_credentials')
      ) {
        Alert.alert(
          '❌ Credenciales Incorrectas',
          'El correo electrónico o la contraseña ingresada son incorrectos.\n\nPor favor verifica tus datos e inténtalo de nuevo, o toca "¿Olvidaste tu contraseña?" para restablecerla.'
        );
      } else if (error.message.includes('Email not confirmed')) {
        Alert.alert(
          '✉️ Correo No Confirmado',
          'Debes confirmar tu correo electrónico antes de ingresar. Por favor revisa tu bandeja de entrada o carpeta de Spam.'
        );
      } else {
        Alert.alert('Error al Iniciar Sesión', error.message);
      }
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

    if (!isAccessCodeValid(accessCode)) {
      Alert.alert(
        '📷 Escaneo de QR Requerido',
        'Para registrarte es obligatorio escanear el código QR de un compañero con tu cámara.',
        [
          { text: '📷 Escanear QR', onPress: () => setShowScanner(true) },
          { text: 'Cancelar', style: 'cancel' }
        ]
      );
      return;
    }

    if (!isSupabaseConfigured) {
      Alert.alert('Modo Local', 'Supabase no está configurado.', [{ text: 'OK', onPress: onGuestMode }]);
      return;
    }

    setLoading(true);
    try {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
            initials: initials.trim().toUpperCase(),
            access_code: accessCode.trim(),
          },
        },
      });

      if (error) {
        setLoading(false);
        if (error.message.includes('already registered') || error.message.includes('User already registered')) {
          Alert.alert(
            '⚠️ Correo Ya Registrado',
            'Este correo electrónico ya tiene una cuenta creada.\n\nPor favor inicia sesión o toca "¿Olvidaste tu contraseña?" para recuperar tu acceso.'
          );
        } else if (error.message.includes('Password should be at least')) {
          Alert.alert(
            '🔒 Contraseña Muy Corta',
            'La contraseña debe contener un mínimo de 6 caracteres.'
          );
        } else {
          Alert.alert('Error al Crear Cuenta', error.message);
        }
        return;
      }

      if (signUpData?.session) {
        setLoading(false);
        Alert.alert('✅ ¡Bienvenido!', `¡Tu cuenta ha sido creada exitosamente, ${displayName.trim()}!`);
        onSessionConfigured();
        return;
      }

      // Si Supabase requiere inicio explícito de sesión, intentamos auto-login inmediato
      const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      setLoading(false);

      if (!loginErr && loginData?.session) {
        Alert.alert('✅ ¡Bienvenido!', `¡Tu cuenta ha sido creada exitosamente, ${displayName.trim()}!`);
        onSessionConfigured();
      } else {
        Alert.alert(
          '✅ Cuenta Creada',
          'Tu cuenta fue creada correctamente. Ya puedes iniciar sesión con tu correo y contraseña.'
        );
        setIsRegistering(false);
      }
    } catch (e: any) {
      setLoading(false);
      Alert.alert('Error', e.message || 'No se pudo completar el registro.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={{
            alignSelf: 'center',
            marginBottom: theme.spacing.m,
            width: 80,
            height: 80,
            borderRadius: 20,
            overflow: 'hidden',
            backgroundColor: '#0a0d14',
            borderWidth: 2,
            borderColor: 'rgba(59, 130, 246, 0.4)',
            shadowColor: '#3b82f6',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.5,
            shadowRadius: 12,
            elevation: 8,
          }}>
            <Image
              source={require('../../assets/icon.png')}
              style={[
                { width: '100%', height: '100%' },
                Platform.OS === 'web' ? ({ imageRendering: '-webkit-optimize-contrast' } as any) : {}
              ]}
              resizeMode="cover"
            />
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
                  <View style={styles.passwordWrapper}>
                    <TextInput
                      style={[styles.input, styles.passwordInput]}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      secureTextEntry={!showNewPassword}
                      placeholder="Mínimo 6 caracteres"
                      placeholderTextColor={theme.colors.textDim}
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowNewPassword(!showNewPassword)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      {showNewPassword ? (
                        <EyeOff size={20} color="#94a3b8" />
                      ) : (
                        <Eye size={20} color="#94a3b8" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Confirmar Contraseña</Text>
                  <View style={styles.passwordWrapper}>
                    <TextInput
                      style={[styles.input, styles.passwordInput]}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      secureTextEntry={!showConfirmPassword}
                      placeholder="Repite la contraseña"
                      placeholderTextColor={theme.colors.textDim}
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      {showConfirmPassword ? (
                        <EyeOff size={20} color="#94a3b8" />
                      ) : (
                        <Eye size={20} color="#94a3b8" />
                      )}
                    </TouchableOpacity>
                  </View>
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
                        ref={displayNameRef}
                        style={styles.input}
                        value={displayName}
                        onChangeText={setDisplayName}
                        placeholder="Ej: Juanito Alcachofa"
                        placeholderTextColor={theme.colors.textDim}
                        returnKeyType="next"
                        onSubmitEditing={() => initialsRef.current?.focus()}
                        blurOnSubmit={false}
                        accessibilityLabel="Tu nombre o apodo para jugar"
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.label}>Iniciales (máx 3 letras)</Text>
                      <TextInput
                        ref={initialsRef}
                        style={styles.input}
                        value={initials}
                        onChangeText={(t) => setInitials(t.slice(0, 3).toUpperCase())}
                        placeholder="Ej: ALV"
                        placeholderTextColor={theme.colors.textDim}
                        maxLength={3}
                        autoCapitalize="characters"
                        returnKeyType="next"
                        onSubmitEditing={() => emailRef.current?.focus()}
                        blurOnSubmit={false}
                        accessibilityLabel="Iniciales de jugador de máximo 3 letras"
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.s }}>
                        <Text style={styles.label}>Pase de Invitación / Código QR 🔒</Text>
                      </View>

                      {isAccessCodeValid(accessCode) ? (
                        /* Tarjeta de Código QR Verificado */
                        <View style={{
                          backgroundColor: 'rgba(16, 185, 129, 0.12)',
                          borderWidth: 1.5,
                          borderColor: theme.colors.success,
                          borderRadius: 16,
                          padding: 14,
                          marginBottom: 10,
                        }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{
                              width: 42,
                              height: 42,
                              borderRadius: 12,
                              backgroundColor: 'rgba(16, 185, 129, 0.2)',
                              justifyContent: 'center',
                              alignItems: 'center',
                              marginRight: 12,
                            }}>
                              <Text style={{ fontSize: 22 }}>✅</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '900' }}>
                                Pase de Invitación VIP Activo
                              </Text>
                              <Text style={{ color: '#a7f3d0', fontSize: 12, fontWeight: '700', marginTop: 2 }}>
                                Código: {accessCode.trim().toUpperCase()}
                              </Text>
                            </View>
                            <TouchableOpacity
                              onPress={() => setShowScanner(true)}
                              style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 8,
                              }}
                              activeOpacity={0.7}
                            >
                              <Text style={{ color: '#6ee7b7', fontSize: 11, fontWeight: 'bold' }}>Re-escanear</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        /* Botón Destacado para Escanear el QR con Cámara */
                        <TouchableOpacity
                          onPress={() => setShowScanner(true)}
                          style={{
                            backgroundColor: 'rgba(59, 130, 246, 0.16)',
                            borderWidth: 2,
                            borderColor: '#3b82f6',
                            borderRadius: 16,
                            padding: 14,
                            marginBottom: 10,
                            flexDirection: 'row',
                            alignItems: 'center',
                            shadowColor: '#3b82f6',
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.35,
                            shadowRadius: 10,
                            elevation: 4,
                          }}
                          activeOpacity={0.8}
                        >
                          <View style={{
                            width: 46,
                            height: 46,
                            borderRadius: 14,
                            backgroundColor: '#3b82f6',
                            justifyContent: 'center',
                            alignItems: 'center',
                            marginRight: 12,
                          }}>
                            <Text style={{ fontSize: 24 }}>📷</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '900' }}>
                              Escanear Código QR con Cámara
                            </Text>
                            <Text style={{ color: '#93c5fd', fontSize: 11, marginTop: 2, fontWeight: '600' }}>
                              Toca para abrir el lector y leer el QR de tu compañero
                            </Text>
                          </View>
                          <View style={{
                            backgroundColor: 'rgba(255,255,255,0.1)',
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 8,
                          }}>
                            <Text style={{ color: '#60a5fa', fontSize: 13, fontWeight: '800' }}>Abrir ➜</Text>
                          </View>
                        </TouchableOpacity>
                      )}
                    </View>
                  </>
                )}

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Correo Electrónico</Text>
                  <TextInput
                    ref={emailRef}
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    placeholder="tu@correo.com"
                    placeholderTextColor={theme.colors.textDim}
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    blurOnSubmit={false}
                    accessibilityLabel="Correo electrónico para ingresar o registrarte"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Contraseña</Text>
                  <View style={styles.passwordWrapper}>
                    <TextInput
                      ref={passwordRef}
                      style={[styles.input, styles.passwordInput]}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="password"
                      placeholder="******"
                      placeholderTextColor={theme.colors.textDim}
                      returnKeyType={isRegistering ? 'done' : 'go'}
                      onSubmitEditing={isRegistering ? handleRegister : handleLogin}
                      accessibilityLabel="Contraseña secreta"
                    />
                    <TouchableOpacity
                      style={styles.eyeBtn}
                      onPress={() => setShowPassword(!showPassword)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                    >
                      {showPassword ? (
                        <EyeOff size={20} color="#94a3b8" />
                      ) : (
                        <Eye size={20} color="#94a3b8" />
                      )}
                    </TouchableOpacity>
                  </View>
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

                {/* Aviso Legal de Privacidad y Términos */}
                <View style={styles.legalNoticeContainer}>
                  <Text style={styles.legalNoticeText}>
                    Al continuar o registrarte, aceptas nuestros{' '}
                    <Text style={styles.legalLink} onPress={() => openLegal('terms')}>
                      Términos y Condiciones
                    </Text>
                    {' '}y nuestra{' '}
                    <Text style={styles.legalLink} onPress={() => openLegal('privacy')}>
                      Política de Privacidad
                    </Text>.
                  </Text>
                </View>
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

      <LegalModal
        visible={showLegalModal}
        onClose={() => setShowLegalModal(false)}
        initialTab={legalTab}
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
  passwordWrapper: {
    position: 'relative',
    justifyContent: 'center',
    width: '100%',
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    zIndex: 10,
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
  legalNoticeContainer: {
    marginTop: 18,
    marginBottom: 6,
    paddingHorizontal: 12,
  },
  legalNoticeText: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  legalLink: {
    color: '#60a5fa',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});

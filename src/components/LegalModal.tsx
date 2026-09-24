import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { theme } from '../theme';

export type LegalTab = 'terms' | 'privacy' | 'rules' | 'cookies' | 'contact';

interface Props {
  visible: boolean;
  onClose: () => void;
  initialTab?: LegalTab;
}

export const LegalModal: React.FC<Props> = ({ visible, onClose, initialTab = 'terms' }) => {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab);

  // Sincronizar pestaña inicial al abrir
  React.useEffect(() => {
    if (visible && initialTab) {
      setActiveTab(initialTab);
    }
  }, [visible, initialTab]);

  const tabs: { key: LegalTab; label: string; icon: string }[] = [
    { key: 'terms', label: 'Términos', icon: '📜' },
    { key: 'privacy', label: 'Privacidad', icon: '🔒' },
    { key: 'rules', label: 'Torneos VIP', icon: '🏆' },
    { key: 'cookies', label: 'Cookies', icon: '🍪' },
    { key: 'contact', label: 'Contacto', icon: '📬' },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 24, marginRight: 8 }}>⚖️</Text>
            <View>
              <Text style={styles.headerTitle}>Información Legal</Text>
              <Text style={styles.headerSubtitle}>PeSiMistas Club de Dominó</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            accessibilityLabel="Cerrar ventana legal"
            accessibilityRole="button"
            activeOpacity={0.8}
          >
            <Text style={styles.closeBtnText}>✕ Cerrar</Text>
          </TouchableOpacity>
        </View>

        {/* Tab Selector Bar */}
        <View style={styles.tabBarWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBar}
          >
            {tabs.map((t) => {
              const isActive = activeTab === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.tabItem, isActive && styles.tabItemActive]}
                  onPress={() => setActiveTab(t.key)}
                  activeOpacity={0.7}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                >
                  <Text style={styles.tabIcon}>{t.icon}</Text>
                  <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Content Body */}
        <ScrollView style={styles.contentScroll} contentContainerStyle={styles.contentContainer}>
          {activeTab === 'terms' && (
            <View style={styles.section}>
              <Text style={styles.docTitle}>Términos y Condiciones de Uso</Text>
              <Text style={styles.docDate}>Última actualización: Septiembre 2026</Text>

              <Text style={styles.paragraph}>
                Bienvenido a <Text style={styles.boldText}>PeSiMistas Club de Dominó</Text>. Al acceder,
                registrarte o participar en partidas y torneos organizados en esta plataforma, aceptas
                quedar vinculado por los presentes Términos y Condiciones. Si no estás de acuerdo con
                alguna disposición, debes abstenerte de utilizar la aplicación.
              </Text>

              <Text style={styles.h2}>1. Naturaleza de la Plataforma y Destreza Mental</Text>
              <Text style={styles.paragraph}>
                El dominó tradicional es reconocido internacionalmente como una disciplina de
                <Text style={styles.boldText}> habilidad, cálculo mental y estrategia colectiva</Text>.
                Esta plataforma no es un casino, sala de apuestas ciegas ni juego de azar puro. Los
                resultados dependen de las decisiones tácticas, memoria y coordinación de las parejas.
              </Text>

              <Text style={styles.h2}>2. Monedas y Puntos Virtuales</Text>
              <Text style={styles.paragraph}>
                Los "Puntos de Apuestas", recompensas de racha diaria y monedas virtuales otorgados
                dentro de la app son bienes estrictamente digitales y recreativos.
              </Text>
              <View style={styles.bulletBox}>
                <Text style={styles.bulletItem}>• No constituyen dinero de curso legal ni instrumento financiero.</Text>
                <Text style={styles.bulletItem}>• No devengan intereses de ninguna índole.</Text>
                <Text style={styles.bulletItem}>• No pueden canjearse por divisas fuera de las dinámicas y torneos expresamente autorizados por los organizadores del club.</Text>
              </View>

              <Text style={styles.h2}>3. Fair Play (Juego Limpio) y Conducta</Text>
              <Text style={styles.paragraph}>
                PeSiMistas promueve la sana competencia deportiva y la convivencia armónica. Queda
                estrictamente prohibido:
              </Text>
              <View style={styles.bulletBox}>
                <Text style={styles.bulletItem}>• Colusión fraudulenta: realizar señas prohibidas, compartir manos por medios externos o jugar en connivencia desleal.</Text>
                <Text style={styles.bulletItem}>• Uso de bots o herramientas automáticas que alteren el software.</Text>
                <Text style={styles.bulletItem}>• Insultos, discriminación, acoso o lenguaje difamatorio en el Chat Global o perfiles de usuario.</Text>
                <Text style={styles.bulletItem}>• Creación de cuentas múltiples con el fin de manipular rankings o inflar estadísticas.</Text>
              </View>
              <Text style={styles.paragraph}>
                El equipo organizador y los administradores se reservan el derecho exclusivo de
                suspender, sancionar o expulsar definitivamente cualquier cuenta que vulnere estas reglas.
              </Text>

              <Text style={styles.h2}>4. Exención de Responsabilidad Técnica</Text>
              <Text style={styles.paragraph}>
                PeSiMistas realiza esfuerzos continuos para garantizar la estabilidad del servicio; no
                obstante, no se hace responsable por pérdidas de partidas, puntos o tiempos de turno
                ocasionados por fallas en la conexión a internet del usuario, caídas de suministro
                eléctrico, interrupciones de su operador telefónico o incompatibilidad de hardware.
              </Text>

              <Text style={styles.h2}>5. Edad Mínima</Text>
              <Text style={styles.paragraph}>
                Para participar en la plataforma se requiere tener al menos 14 años de edad (o la edad
                mínima de consentimiento digital en tu jurisdicción). La inscripción y cobro de premios
                en torneos VIP con dinero real está estrictamente reservada para mayores de 18 años.
              </Text>
            </View>
          )}

          {activeTab === 'privacy' && (
            <View style={styles.section}>
              <Text style={styles.docTitle}>Política de Privacidad y Tratamiento de Datos</Text>
              <Text style={styles.docDate}>Compromiso de Privacidad desde el Diseño</Text>

              <Text style={styles.paragraph}>
                En <Text style={styles.boldText}>PeSiMistas</Text> nos tomamos tu privacidad muy en serio.
                Aplicamos el principio de <Text style={styles.boldText}>Minimización de Datos</Text>:
                recopilamos únicamente la información estrictamente necesaria para que puedas jugar y
                competir con tus amigos.
              </Text>

              <Text style={styles.h2}>1. Datos que Recopilamos</Text>
              <View style={styles.bulletBox}>
                <Text style={styles.bulletItem}>
                  <Text style={styles.boldText}>• Correo Electrónico:</Text> Empleado únicamente para
                  autenticar tu cuenta, restablecer contraseñas olvidadas y enviarte alertas críticas de
                  seguridad.
                </Text>
                <Text style={styles.bulletItem}>
                  <Text style={styles.boldText}>• Nombre para Mostrar e Iniciales:</Text> Elegidos por ti
                  para identificarte en la mesa, tabla de líderes y credencial de socio.
                </Text>
                <Text style={styles.bulletItem}>
                  <Text style={styles.boldText}>• Foto de Perfil (Opcional):</Text> Si decides subir una imagen,
                  se almacena de forma segura en nuestro bucket protegido de Supabase Storage.
                </Text>
                <Text style={styles.bulletItem}>
                  <Text style={styles.boldText}>• Estadísticas Deportivas:</Text> Partidas jugadas,
                  victorias, derrotas, zapatos dados y recibidos, y rachas de conexión.
                </Text>
                <Text style={styles.bulletItem}>
                  <Text style={styles.boldText}>• Mensajes de Chat:</Text> Mensajes enviados en el Chat
                  Global para visualización comunitaria en tiempo real.
                </Text>
              </View>

              <Text style={styles.h2}>2. Lo que NUNCA Hacemos con tus Datos</Text>
              <View style={styles.bulletBox}>
                <Text style={styles.bulletItem}>🚫 <Text style={styles.boldText}>NO vendemos</Text> tus datos a agencias de marketing ni terceros.</Text>
                <Text style={styles.bulletItem}>🚫 <Text style={styles.boldText}>NO compartimos</Text> tu correo con otros jugadores ni empresas externas.</Text>
                <Text style={styles.bulletItem}>🚫 <Text style={styles.boldText}>NO rastreamos</Text> tu actividad fuera de la aplicación.</Text>
              </View>

              <Text style={styles.h2}>3. Seguridad y Almacenamiento</Text>
              <Text style={styles.paragraph}>
                Tu información se almacena en la nube mediante Supabase (PostgreSQL), protegida con
                encriptación en reposo y en tránsito mediante HTTPS/TLS. Las contraseñas están protegidas
                mediante algoritmos criptográficos unidireccionales de derivación de claves (bcrypt/Argon2);
                ningún miembro del equipo tiene acceso a tu contraseña real.
              </Text>

              <Text style={styles.h2}>4. Derecho al Olvido y Eliminación de Cuenta</Text>
              <Text style={styles.paragraph}>
                En cumplimiento con las directrices de Apple App Store, Google Play y los estándares de
                protección de datos (RGPD / CCPA), tienes el derecho pleno de solicitar la eliminación
                completa e irreversible de tu cuenta y todos tus datos personales asociados en cualquier
                momento.
              </Text>
              <Text style={styles.paragraph}>
                Puedes ejecutar la eliminación directamente desde tu perfil en la sección
                <Text style={styles.boldText}> "Legal & Seguridad ➜ Eliminar mi cuenta"</Text> o
                contactando a nuestro equipo.
              </Text>
            </View>
          )}

          {activeTab === 'rules' && (
            <View style={styles.section}>
              <Text style={styles.docTitle}>Reglamento Oficial de Torneos VIP</Text>
              <Text style={styles.docDate}>Normativa de Competencias, Pagos y Premiación</Text>

              <Text style={styles.paragraph}>
                Los torneos de PeSiMistas se dividen en torneos recreativos por puntos y
                <Text style={styles.boldText}> Torneos VIP con Pozo de Premios en Metálico</Text>.
                Para garantizar la transparencia, todos los participantes deben adherirse a las
                siguientes reglas:
              </Text>

              <Text style={styles.h2}>1. Inscripción y Validación de Pago</Text>
              <View style={styles.bulletBox}>
                <Text style={styles.bulletItem}>• El registro en un torneo VIP requiere el abono del costo por jugador o por pareja fijado en la convocatoria.</Text>
                <Text style={styles.bulletItem}>• El usuario debe suministrar el número de referencia bancaria y adjuntar el comprobante oficial de pago (Pago Móvil / Transferencia).</Text>
                <Text style={styles.bulletItem}>• La inscripción tiene carácter condicional hasta que el Administrador/Cajero del torneo valida los fondos en cuenta bancaria.</Text>
                <Text style={styles.bulletItem}>• Intentos de ingresar referencias duplicadas o comprobantes adulterados acarrean descalificación automática y expulsión de por vida.</Text>
              </View>

              <Text style={styles.h2}>2. Convocatoria y Puntualidad en Mesa</Text>
              <View style={styles.bulletBox}>
                <Text style={styles.bulletItem}>• Al activarse una ronda de torneo o generarse el emparejamiento de llaves, el sistema notificará a los jugadores convocados.</Text>
                <Text style={styles.bulletItem}>• Se establece un tiempo máximo de tolerancia de 5 minutos en el cafetín (o 30 segundos tras la alerta sonora en la app).</Text>
                <Text style={styles.bulletItem}>• Si un dúo o participante no se presenta en el tiempo reglamentario, se declarará derrota por incomparecencia (Walkover / Forfeit).</Text>
              </View>

              <Text style={styles.h2}>3. Liquidación y Pago de Premios</Text>
              <View style={styles.bulletBox}>
                <Text style={styles.bulletItem}>• El pozo acumulado se entrega íntegramente al campeón (o se distribuye según la tabla de premiación anunciada para primer y segundo lugar).</Text>
                <Text style={styles.bulletItem}>• Los premios se abonan dentro de las 24 horas siguientes a la conclusión de la gran final a los datos de Pago Móvil o cuenta verificada del ganador.</Text>
                <Text style={styles.bulletItem}>• Todos los pagos emitidos quedan registrados con su respectiva captura para total auditoría de los participantes.</Text>
              </View>
            </View>
          )}

          {activeTab === 'cookies' && (
            <View style={styles.section}>
              <Text style={styles.docTitle}>Política de Almacenamiento Local y Cookies</Text>
              <Text style={styles.docDate}>Tecnologías Esenciales y Transparentes</Text>

              <Text style={styles.paragraph}>
                Esta plataforma no utiliza cookies publicitarias, rastreadores de terceros ni scripts
                espía. Empleamos únicamente mecanismos de
                <Text style={styles.boldText}> almacenamiento local técnico estrictamente necesario</Text>
                (a través de <Text style={styles.codeText}>localStorage</Text> en la Web y
                <Text style={styles.codeText}>AsyncStorage</Text> en dispositivos móviles).
              </Text>

              <Text style={styles.h2}>¿Qué información se guarda localmente en tu dispositivo?</Text>
              <View style={styles.bulletBox}>
                <Text style={styles.bulletItem}>
                  <Text style={styles.boldText}>• Token de Sesión Autenticado:</Text> Permite que la app te
                  reconozca cuando vuelvas a abrirla, sin obligarte a reescribir tu contraseña cada vez.
                </Text>
                <Text style={styles.bulletItem}>
                  <Text style={styles.boldText}>• Estado de Partida Activa:</Text> Guarda el estado de la mesa
                  en caso de recarga accidental para que no pierdas tu juego en curso.
                </Text>
                <Text style={styles.bulletItem}>
                  <Text style={styles.boldText}>• Preferencias Visuales:</Text> Recuerda configuraciones como
                  sonidos activados y confirmaciones vistas.
                </Text>
                <Text style={styles.bulletItem}>
                  <Text style={styles.boldText}>• Control de Publicidad Ocasional:</Text> Registra una marca
                  temporal de enfriamiento (30 minutos) para evitar mostrarte anuncios en cada navegación.
                </Text>
              </View>

              <Text style={styles.h2}>¿Cómo puedes borrar estos datos?</Text>
              <Text style={styles.paragraph}>
                Puedes eliminar todos los datos almacenados en cualquier instante simplemente pulsando
                "Cerrar Sesión" en la pantalla de inicio o limpiando la memoria caché y cookies de tu
                navegador web.
              </Text>
            </View>
          )}

          {activeTab === 'contact' && (
            <View style={styles.section}>
              <Text style={styles.docTitle}>Canales de Contacto y Soporte Oficial</Text>
              <Text style={styles.docDate}>Estamos para ayudarte</Text>

              <Text style={styles.paragraph}>
                Si tienes dudas sobre las reglas de juego, requieres soporte técnico con tu cuenta,
                necesitas asistencia con un torneo o deseas ejercer tus derechos de privacidad, comunícate
                con nosotros por cualquiera de los siguientes canales:
              </Text>

              <View style={styles.contactCard}>
                <Text style={styles.contactIcon}>📍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactTitle}>Sede Presencial del Club</Text>
                  <Text style={styles.contactDesc}>Mesa Central del Cafetín — Sede Oficial PeSiMistas</Text>
                </View>
              </View>

              <View style={styles.contactCard}>
                <Text style={styles.contactIcon}>✉️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactTitle}>Correo de Soporte y Privacidad</Text>
                  <Text style={styles.contactDesc}>soporte.pesimistas@gmail.com</Text>
                </View>
                <TouchableOpacity
                  style={styles.copyBtn}
                  onPress={() => {
                    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                      navigator.clipboard.writeText('soporte.pesimistas@gmail.com');
                      Alert.alert('¡Copiado!', 'Correo de soporte copiado al portapapeles.');
                    } else {
                      Alert.alert('Correo de Soporte', 'soporte.pesimistas@gmail.com');
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.copyBtnText}>Copiar</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.contactCard}>
                <Text style={styles.contactIcon}>💬</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactTitle}>Chat en Vivo con Organizadores</Text>
                  <Text style={styles.contactDesc}>
                    Puedes escribir directamente en el Chat Global de la aplicación para asistencia
                    inmediata de los socios y administradores presentes.
                  </Text>
                </View>
              </View>

              <View style={{ marginTop: 24, padding: 14, backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.3)' }}>
                <Text style={{ color: '#93c5fd', fontSize: 12, lineHeight: 18, textAlign: 'center' }}>
                  PeSiMistas Club de Dominó opera como una comunidad deportiva sin fines de lucro fuera de la organización de torneos recreativos debidamente fiscalizados por sus socios.
                </Text>
              </View>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Footer Accept / Close button */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.footerBtnText}>Entendido y Acepto 👍</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0c10',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: '#10131a',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '700',
  },
  closeBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  tabBarWrapper: {
    backgroundColor: '#0e1117',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  tabBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 8,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  tabItemActive: {
    backgroundColor: 'rgba(234, 179, 8, 0.18)',
    borderColor: '#eab308',
  },
  tabIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  tabLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: '#fbbf24',
    fontWeight: '900',
  },
  contentScroll: {
    flex: 1,
    backgroundColor: '#0a0c10',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 30,
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  section: {
    width: '100%',
  },
  docTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 4,
  },
  docDate: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  h2: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 22,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
    paddingLeft: 8,
  },
  paragraph: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
  },
  boldText: {
    color: '#fff',
    fontWeight: '800',
  },
  codeText: {
    color: '#fbbf24',
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  bulletBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    gap: 8,
  },
  bulletItem: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 20,
  },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#11141b',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  contactIcon: {
    fontSize: 26,
    marginRight: 14,
  },
  contactTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  contactDesc: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 16,
  },
  copyBtn: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    marginLeft: 8,
  },
  copyBtnText: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '800',
  },
  footer: {
    padding: 16,
    backgroundColor: '#10131a',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  footerBtn: {
    backgroundColor: '#2563eb',
    width: '100%',
    maxWidth: 400,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  footerBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
});

# PeSiMistas: del dominó a los juegos del cafetín

Fecha: 2026-10-31. Estado: aprobado por el dueño del proyecto el 2026-10-31.

## 1. Intención

PeSiMistas nació como anotador de dominó para el cafetín de la universidad. Los muchachos ahora también juegan UNO y póker sin dinero, así que la app pasa a ser **el lugar donde se anota, se sigue en vivo y se compite en lo que se juega en el cafetín**.

Las partidas siguen siendo presenciales, con cartas y fichas reales. La app solo anota, muestra todo en vivo, avisa y lleva rankings. No es un juego online.

La escena que debe funcionar, en la mañana: alguien entra al cafetín, abre la app y ve quién juega y cómo va el marcador, sin recargar. Se anota en la cola. La app le avisa cuando queda de primero, cuando la partida en curso va a menos de 10 puntos de terminar y cuando le toca, con una cuenta regresiva. Igual con torneos: "empezó uno, ¿te unes?" y "mira cómo va la clasificación".

## 2. Objetivos

1. Corregir lo crítico y lo de seguridad **antes** de agregar juegos, para que no hereden los fallos.
2. Comprobar lo que hoy no se ha podido probar (ver sección 8).
3. Agregar UNO, UNO Flip, UNO No Mercy y póker como juegos anotados, con ranking propio.
4. Dar notificaciones reales con la pantalla bloqueada.
5. Agregar las funciones acordadas: corrección de manos, historial de puntos, temporadas, modo TV, compartir en web, cara a cara y panel admin.
6. Al final, un sistema de personalización (se define cuando se llegue ahí).

## 3. No objetivos

- Jugar en línea o repartir cartas digitales.
- Blackjack.
- Modo individual de dominó: sigue apagado, el club juega 2v2.
- Una app nativa nueva: sigue siendo la web app instalable.

## 4. Lo que sería un fracaso aunque funcione

- Que se puedan farmear puntos pasando de un juego a otro.
- Que quien anota pueda regalar puntos a un amigo.
- Que un error de dedo cambie un resultado sin forma de corregirlo.
- Que se pierda una partida porque el internet del cafetín falló.
- Que quien no sabe póker no pueda seguir la partida.

## 5. Economía (decidido)

- **Un solo saldo de puntos** para toda la app. Ya existe: es `profiles.betting_points`, el mismo que usan tienda, apuestas y Duelo VIP. No hay nada que fusionar.
- **Un ranking por juego.**
- **Fichas de mesa** en póker: valen solo durante esa partida y **nunca** pasan al saldo. Como los billetes del Monopoly.
- **Premio fijo por ganar: +20 puntos** en dominó, UNO y póker, sin importar cuántas fichas o puntos se hayan movido.
  - Se paga al ganador de la partida, no por mano. En dominó lo recibe cada integrante del dúo ganador.
  - **Máximo 3 premios al día por persona**, sumando todos los juegos. Las demás victorias cuentan para el ranking.
  - **Mínimo 3 jugadores registrados** para que póker y UNO paguen premio. Dominó siempre tiene 4.
  - Lo paga el servidor y queda en el historial de puntos.
  - El día se cuenta en hora de Venezuela y cambia a las 7 AM, igual que el bono diario *(decisión del diseñador)*.
  - Los jugadores registrados se cuentan al cerrar la partida. Las personas sin cuenta no cuentan *(decisión del diseñador)*.
  - Las partidas de torneo no pagan +20, porque el torneo ya tiene premio *(decisión del diseñador)*.
  - Si un resultado se corrige después de pagado, el premio se revierte con un movimiento visible en el historial *(decisión del diseñador)*.
  - El tope diario y la revisión del historial son la protección contra partidas repetidas; no se agregan más reglas por ahora *(decisión del diseñador)*.
- **Apuestas de dominó:** el multiplicador sigue entre x1,20 y x3,50, sin subir el tope.
- **Límite de apuesta por persona y partida:** se agrega. Valor inicial 500 puntos *(decisión del diseñador, ajustable)*.
- Los puntos actuales de los usuarios no se tocan.

## 6. Juegos

### Póker

- **Antes de empezar:** se registran los jugadores en el orden de la rueda.
- **Fichas iniciales:** 200 por jugador y entrada de 10 por defecto. Quien reparte puede cambiarlo antes de empezar. Debe servir el ejemplo de entrar con 20.
- **Variante:** la app no impone una. Sirve para póker de 5 cartas y Texas Hold'em, porque ambos se reducen a entrada, rondas de apuestas y ganador. Quien reparte abre una nueva ronda de apuestas cuando haga falta: 5 cartas tiene 2 y Hold'em 4.
- **Quién reparte:** al empezar cada mano, la app pregunta quién reparte y deja marcado al **siguiente en la rueda**, que es como rota en el póker. Se puede cambiar.
- **Si reparte y no juega:** indica "solo reparto". Si también juega, marca entrar o no entrar como los demás.
- **Quién anota:** únicamente quien reparte. Los demás lo ven en vivo.
- **Cada mano:** la app pregunta quién entra. Quien no entra sale de la rueda solo en esa mano, y esa mano no cuenta como jugada para él.
- **Apuestas:** todos entran con el monto de entrada. Si alguien sube, los demás deciden si igualan. Ejemplo acordado: entrada 20, Javier sube 40, quienes igualan llevan 60. La app va sumando.
- **"Sube" significa cuánto se agrega:** en el ejemplo, Javier agrega 40 y el total queda en 60. La pantalla debe decirlo claro, porque en mesas tradicionales "subir a 40" significa llegar a 40.
- **Fichas por jugador:** la app lleva las fichas de cada uno. El ganador se lleva todo lo apostado en la mano, y quien no iguala pierde lo que ya puso.
- **Fin de mano por retirada:** si todos se retiran menos uno, ese gana sin mostrar cartas y no se anota jugada. Esa mano no cuenta para "mejor jugada".
- **Fin de mano con cartas:** se anota quién ganó y con qué jugada. Las 10 jugadas, de mayor a menor: escalera real, escalera de color, póker, full, color, escalera, trío, doble par, un par y carta alta.
- **Empates:** el pozo se reparte en partes iguales. Si el reparto no es exacto, quien reparte indica quién recibe la ficha que sobra.
- **Todo adentro:** quien se queda sin fichas sigue en la mano y solo puede ganar hasta lo que alcanzó a igualar. Cuando pase, quien reparte anota cuánto se lleva cada uno. La app no calcula pozos separados.
- **Correcciones:** quien reparte puede corregir la última mano.
- **Fin de la partida:** la cierra quien reparte cuando quieran terminar.
- **Ayuda:** una tabla de esas 10 jugadas dentro de la app, con diseño propio. No se usa la imagen de PokerStars por su marca.
- **Historial:** cada mano queda guardada con ganador, jugada, total y quién la anotó.
- **Estadísticas:** más manos jugadas y mejor jugada de cada uno.
- **Ganador de la partida:** quien tenga más fichas al cerrar la partida.
- **Sin cuenta:** se pueden anotar jugadores solo con un nombre. Juegan, pero no tienen ranking ni premio.

### UNO, UNO Flip y UNO No Mercy

Se registran los jugadores, sin orden, y al final quién ganó. Tres variantes, con ranking propio cada una *(decisión del diseñador)*. Igual que en póker, se puede anotar a alguien solo con un nombre, sin ranking ni premio. No se llevan los puntos oficiales de UNO (500): el dueño pidió anotar solo al ganador.

### Cola

"Pedir Mesa" sigue siendo solo de dominó *(decisión del diseñador: la escena descrita es de dominó)*.

## 7. Trabajo por fases

El orden importa. Cada fase debe quedar probada antes de pasar a la siguiente.

### Fase 0: conocer producción

Antes de cualquier arreglo, el dueño corre en el SQL Editor una consulta de solo lectura que entrega tablas, permisos, funciones y triggers reales. Con eso se escriben las migraciones y los arreglos. El detalle de la auditoría se guarda en la memoria privada del proyecto, no en este repo.

### Fase 1: críticos

- **Acceso de administrador:** se mantiene el PIN, decisión anterior del dueño, siempre verificado en el servidor con límite de intentos. El valor nuevo no queda en archivos versionados ni en el chat, y el rol sigue siendo `profiles.is_admin`. El dueño elige el valor.
- **Corrección de la última mano:**
  - Pedir confirmación cuando una mano cierra la partida.
  - Deshacer disponible en la pantalla de ganador.
  - Nada se paga hasta que la partida se cierra de verdad.
  - Cerrar una partida con apuestas, Duelo VIP o torneo requiere la confirmación de un jugador rival desde su teléfono.
  - Si nadie responde, la partida queda "por confirmar" y no se paga. Puede confirmarla después cualquier jugador rival o un admin.
  - Si el rival no está de acuerdo, se reabre la última mano para corregirla.
  - Las partidas sin apuestas ni torneo se cierran normal, sin esperar a nadie.
- **Cola offline:** ninguna partida se descarta sola, ni se pierde durante una sincronización, ni se da por guardada si el servidor no la guardó.

### Fase 2: seguridad del servidor

Cerrar los puntos hallados en la auditoría: inscripciones, creación de torneos, quién puede anotar, apostar y editar resultados, datos de pago privados, funciones accesibles sin sesión, permisos de avatares y de cola, avisos falsificables, escrow del Duelo VIP y validación de logros. El detalle vive fuera de este repo público.

### Fase 3: bugs y base ordenada

- Tapete comprado que no se aplica.
- Pantalla en blanco al ir atrás sin sesión.
- Interruptor de Duelo VIP cortado a 390 px.
- Quien se sustituye a sí mismo ya no puede anotar.
- Error de la cola que nunca se muestra.
- Iconos faltantes del service worker.
- Foto que queda al eliminar la cuenta.
- Datos de Pago Móvil de ejemplo y texto "= 1 rondas" (requieren los datos reales del dueño).
- **Migraciones ordenadas:** llevar a una carpeta versionada el esquema completo, incluidas las tablas y funciones que hoy solo existen en producción. Los scripts peligrosos quedan archivados.
- **Pruebas automáticas** de la lógica crítica: puntos, cola y resultados.

### Fase 4: puntos

Historial de puntos por usuario, premio +20 con sus topes y límite de apuesta. Cada usuario arranca con un movimiento inicial igual a su saldo actual *(decisión del diseñador)*.

### Fase 5: multijuego

Póker y las tres variantes de UNO, con vista en vivo, historial, rankings por juego y Home mostrando todo lo que se juega ahora.

### Fase 6: notificaciones

Push real para la web app instalada: quedaste de primero, faltan menos de 10 puntos, te toca, empezó un torneo.

La notificación no puede contar segundo a segundo con la pantalla bloqueada. Se envía el aviso con el tiempo límite y la cuenta regresiva completa se ve al abrir la app. En iPhone requiere instalar la app en la pantalla de inicio.

Los avisos salen de funciones en Supabase. El dueño las publica siguiendo una guía paso a paso, y las llaves de push se guardan como secretos de Supabase, nunca en el repo.

### Fase 7: funciones del club

- **Temporadas mensuales:** ranking que se reinicia cada mes, sin tocar el historial.
- **Modo TV:** marcador, cola y llaves en pantalla grande.
- **Compartir resultado en web:** como imagen.
- **Cara a cara:** historial entre dúos.
- **Panel admin:** pagos, reportes y bloqueo de usuarios.

### Fase 8: personalización

Se define con el dueño al llegar aquí. Debe darle a la gente más en qué gastar puntos.

## 8. Cómo se comprueba lo que hoy no se pudo probar

- **Permisos reales de la base de datos:** el dueño corre en el SQL Editor una consulta de solo lectura y entrega el resultado.
- **Sin proyecto de pruebas:** el dueño decidió no crear una segunda base. Los permisos y funciones del servidor se prueban en el Postgres local de `npm run test:db`, que copia las reglas de producción.
- **Trampas del servidor:** cada una se reproduce y se prueba cerrada en ese Postgres local antes de pasar el SQL al dueño.
- **Pantallas con sesión y eliminar cuenta:** las prueba el dueño con los muchachos en la app real, con una lista corta de pasos, porque requieren cuentas reales.
- **Notificaciones:** en teléfonos reales de los muchachos, Android e iPhone.
- **Cola offline:** con el modo sin conexión del navegador y con wifi sin internet simulado.

## 9. Restricciones

- El repo es público: nada de secretos ni instrucciones de explotación en archivos versionados.
- Producción tiene usuarios reales: el dueño ejecuta el SQL y nada se escribe en producción sin su confirmación.
- Base: Expo SDK 54, React Native Web y Supabase, desplegado en Vercel.
- Internet del cafetín inestable: la anotación debe seguir funcionando sin conexión.
- Antigravity aparece como dueño del backend en `CLAUDE.md`. Para este proyecto, el dueño pidió que Claude Code haga el trabajo completo.

## 10. A criterio de quien construye

Estructura de tablas, nombres, cómo se reparte el código, proveedor de push, diseño visual siguiendo `src/theme.ts`, y detalles de pantallas.

## 11. Pendiente del dueño

- Elegir el nuevo acceso de administrador.
- Datos reales de Pago Móvil.
- Describir la personalización en la fase 8.

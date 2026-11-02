# Base de datos de PeSiMistas

Producción la actualiza el dueño, a mano, en el SQL Editor de Supabase.

## Carpetas

- `migrations/`: los cambios, en orden. Cada archivo dice al inicio cuándo ejecutarlo y si es compatible con la app publicada.
- `audit/`: consultas de solo lectura para ver cómo está producción.
- `archive/aplicados/`: scripts viejos que ya corrieron. Solo sirven como historial.
- `archive/peligrosos/`: **no ejecutar.** Borran datos, meten datos de prueba o deshacen reglas de seguridad.

## Migraciones

| Archivo | Estado |
| --- | --- |
| `20261001_00_esquema_base.sql` | Solo para una base vacía. Producción ya lo tiene y el archivo se detiene si lo intentas allí. |
| `20261031_01_admin_pin.sql` | Ejecutada en producción |
| `20261031_02_cierre_urgente.sql` | Ejecutada en producción |
| `20261101_01_confirmacion_rival.sql` | Ejecutada en producción |
| `20261101_02_seguridad_servidor.sql` | Ejecutada en producción |
| `20261101_03_rachas.sql` | Ejecutada en producción |
| `20261101_04_puntos.sql` | Ejecutada en producción |
| `20261101_05_borrar_chat_messages.sql` | Ejecutada en producción |
| `20261101_06_partidas_abandonadas.sql` | Ejecutada en producción |
| `20261101_07_cola_diaria.sql` | Ejecutada en producción |
| `20261101_08_confirmacion_todas.sql` | Ejecutada en producción |
| `20261101_09_confirmacion_1_minuto.sql` | Ejecutada en producción |
| `20261101_10_notificaciones_push.sql` | Ejecutada en producción |
| `20261101_11_direccion_send_push.sql` | Ejecutada en producción |
| `20261101_12_aviso_turno_antes_del_limite.sql` | Ejecutada en producción |
| `20261101_13_uno.sql` | Ejecutada en producción |
| `20261101_14_poker.sql` | Ejecutada en producción |
| `20261102_15_poker_reglas.sql` | Pendiente. Pegarla después de publicar la app que manda `reopen` al corregir una mano |

`mantenimiento/reinicio_del_club.sql` no es una migración: borra partidas, apuestas y puntos y deja a todos con 1.000. Se ejecuta a mano, una sola vez, cuando el dueño lo decida. Guarda una copia en el esquema `respaldo_reinicio` y se detiene si ya existe. Lo cubre `tests/db/reinicio.mjs`.

## Cómo se prueba

`npm run test:db` levanta un Postgres local (PGlite) con la migración base y las nuevas, e imita los roles de Supabase. No toca producción. El esquema base se genera con `npm run baseline` a partir de `archive/`.

## Función de envío

`functions/send-push/` entrega los avisos de `notification_queue`. En producción su dirección interna es `swift-endpoint`. Necesita los secretos `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` en Supabase. Se publica sin exigir sesión, porque no recibe datos: solo envía lo que la base de datos dejó en cola.

## Tareas automáticas de producción

Corren con `pg_cron`, en hora UTC (Venezuela va 4 horas atrás):

- `limpiar_partidas_zombies`, a las 03:00: partidas abiertas por más de 6 horas.
- `confirmar-partidas-normales`, cada minuto.
- `enviar-notificaciones`, cada minuto: reenvía lo que quedó en cola.
- `confirmar-partidas-de-mesa`, cada minuto: cierra resultados de UNO sin respuesta y anula partidas abiertas por más de 6 horas.
- `vencer-rachas`, a las 11:05.
- `vaciar-cola-diaria`, a las 11:10.
- `cleanup_global_chat`, a las 00:00: borra el chat global con más de 2 días.

## Lo que falta comparar

El esquema base se reconstruyó de los scripts archivados, del código de la app y de producción. Las columnas no se han comparado una por una; para hacerlo, ejecuta `audit/02_columnas_produccion.sql`.

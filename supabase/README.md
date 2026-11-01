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
| `20261101_01_confirmacion_rival.sql` | Pendiente |
| `20261101_02_seguridad_servidor.sql` | Pendiente |
| `20261101_03_rachas.sql` | Pendiente |
| `20261101_04_puntos.sql` | Pendiente |
| `20261101_05_borrar_chat_messages.sql` | Pendiente |

## Cómo se prueba

`npm run test:db` levanta un Postgres local (PGlite) con la migración base y las nuevas, e imita los roles de Supabase. No toca producción. El esquema base se genera con `npm run baseline` a partir de `archive/`.

## Lo que el repo aún no tiene de producción

El esquema base se reconstruyó de los scripts archivados, del código de la app y de la foto de producción. Para compararlo, ejecuta `audit/02_columnas_produccion.sql`.

- Columnas exactas: no se han comparado una por una.
- `global_chat`: el límite de un mensaje cada 3 segundos existe solo en producción; falta su código.
- Registro de usuarios: el disparador que crea el perfil al registrarse no está en el esquema base.

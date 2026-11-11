# NexoScape — Backend

Primera entrega local: NestJS 12, TypeScript estricto ESM, TypeORM/PostgreSQL,
login con Argon2id y sesiones de servidor. No hay empresas ni integrantes.

La guía vigente de configuración, alta inicial, migraciones, pruebas y límites
vive en el coordinador: [autenticación local](../../../docs/03-trabajo/autenticacion-local.md).
Si se clona aislado, solicitar esa configuración; no copiarla ni asumir secretos.
Contrato HTTP versionable: [api/openapi.json](api/openapi.json).

## Estructura

- `src/modules/identity/domain`: modelos independientes de framework y ORM.
- `application`: casos de uso y puertos de persistencia/hash.
- `infrastructure`: adaptadores TypeORM, Argon2 y sesión/CSRF.
- `http`: controlador y guard; ensamblaje en `identity.module.ts`.
- `src/database`: DataSource y migraciones; `synchronize: false`.
- `scripts`: migraciones y alta inicial interactiva sin contraseña por defecto.
- `test/unit` y `test/integration`: negocio y HTTP/PostgreSQL real separado.

## Comandos (Node 24.22.2 y pnpm 11.24.0)

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm typecheck
pnpm build
pnpm test
pnpm format:check
```

Preferir Docker para no cambiar herramientas globales. `pnpm test:integration`
exige NODE_ENV=test y base local `nexo_auth_test`; sus tablas son fixtures
sintéticas descartables, nunca ejecutar contra datos reales.
Migraciones y alta se ejecutan explícitamente con configuración privada del
coordinador. No hay carga automática de `.env` ni auto-registro HTTP.

No exponer este entorno públicamente: falta HTTPS, endurecimiento de imagen,
recuperación, MFA, revisión operacional y CI. Sin cobertura porcentual mínima
aprobada ni nueva integración Git. Leer AGENTS.md y respetar exclusiones.

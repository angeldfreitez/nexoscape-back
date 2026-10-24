# NexoScape — Backend

Backend de un monolito modular. Nombre provisional del producto: NexoScape.

## Estado

Repositorio inicial con documentación y reglas para agentes. No hay aplicación generada, dependencias instaladas ni comandos de arranque o pruebas disponibles. Versiones, configuración y alcance funcional pendientes.

## Dirección técnica aprobada (`planned`)

- Node.js, TypeScript y NestJS.
- PostgreSQL y TypeORM como ORM inicial.
- Arquitectura hexagonal ligera: dominio, aplicación, puertos y adaptadores; persistencia aislada en infraestructura.
- pnpm como gestor de paquetes; Docker para ejecución integrada, todavía sin configurar.

No implementar varios ORM ni un repositorio universal. No asumir módulos del ERP anterior.

## Documentación y trabajo

Leer [AGENTS.md](AGENTS.md). Las decisiones generales viven en el repositorio coordinador, no se duplican aquí. Dentro del checkout integrado, consultar `../../../docs/README.md`; si se clona aislado, solicitar acceso al coordinador. La integración reproducible de submódulos sigue pendiente.

## Archivos locales y secretos

- `.gitignore`: exclusiones de Git, conservando código, migraciones y lockfiles versionables.
- `.codexignore`: convención de exclusiones de contexto para agentes, indicada en `AGENTS.md`; soporte automático no verificado, no es una barrera de seguridad.
- Sólo versionar ejemplos de configuración sintéticos y sin secretos (`.env.example` o `.env.*.example`). No hay archivos de ejemplo creados todavía.

Antes de generar la aplicación, acordar versiones, estructura, scripts, pruebas y configuración. No hay licencia de distribución definida todavía.

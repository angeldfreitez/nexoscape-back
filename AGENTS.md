# NexoScape backend — guía local

Este repositorio será el backend de un monolito modular, no un microservicio por entidad. Stack base y TypeORM aceptados según las decisiones del coordinador; versiones, configuración y alcance funcional pendientes.

En el checkout coordinador, leer primero `../../../AGENTS.md`, `../../../docs/README.md` y la arquitectura bajo `../../../docs/01-arquitectura/`. Si se clona este repo aislado, solicitar el contexto del coordinador antes de generar aplicaciones; no asumir sus documentos disponibles ni importar el ERP anterior.

- Módulos por responsabilidades, dominio independiente de HTTP/persistencia, casos de uso, puertos/adaptadores y controladores delgados.
- No acceder libremente a datos privados de otros módulos. Autorizar en servidor y definir transacciones de invariantes.
- Identidad, inventario y CxC fueron ejemplos, no alcance aprobado.
- Confirmar stack, package manager, dependencias y gates antes de instalar o scaffold.
- Pedir confirmación antes de cada MCP o delegación a subagentes. Engram/Stitch no están autorizados.
- No commits sin instrucción explícita en ese turno; no push ni operaciones Git externas/destructivas sin permiso específico.
- No secretos ni datos reales en repo, logs o fixtures. No tocar producción sin autorización, backup y rollback.
- Mantener pruebas tipadas y revisión de seguridad cuando aplique. No desactivar controles para pasar gates.
- Documentación general y decisiones viven en el coordinador; aquí conservar evidencia y detalles de implementación propios.

## Exclusiones de contexto del proyecto

Antes de explorar archivos de este repositorio, leer `.codexignore` y aplicar sus patrones como convención: no abrir ni incluir su contenido en contexto por defecto. Para una excepción, explicar la necesidad y pedir confirmación específica; preferir ejemplos sintéticos o información redactada. Usar sintaxis tipo gitignore relativa a este repositorio, incluyendo excepciones con `!`.

No se ha verificado soporte automático nativo de `.codexignore`: estas reglas dependen de que el agente siga esta guía, no constituyen aislamiento técnico. `.gitignore` evita incorporar archivos ignorados a Git, pero tampoco impide leerlos ni deja de seguir archivos ya registrados. Los permisos y la gestión de secretos siguen siendo necesarios.

### Búsqueda eficiente y uso de contexto

- Buscar por defecto sólo en fuentes, pruebas, configuración versionable y documentación relevante al objetivo; acotar rutas y patrones antes de leer resultados.
- No recorrer ni buscar contenido por defecto en `node_modules/`, `dist/`, `build/`, `coverage/`, `.angular/`, `.pnpm-store/`, `.cache/`, `.vite/`, `playwright-report/` o `test-results/`, a ninguna profundidad. Aplicar también las demás exclusiones de `.codexignore`.
- Preferir `rg` y `rg --files` respetando `.gitignore`. No usar `--no-ignore`, búsquedas recursivas indiscriminadas ni `find` sobre todo el árbol para explorar el proyecto. Si se incluyen archivos ocultos, conservar las exclusiones y excluir también metadatos `.git/` de las búsquedas de contenido.
- Si la herramienta no respeta archivos ignore, aplicar exclusiones explícitas equivalentes. Revisar primero nombres/rutas; leer después sólo archivos y fragmentos necesarios, con salida limitada.
- Consultar dependencias o resultados generados sólo ante una necesidad concreta de diagnóstico, explicando el motivo y obteniendo la confirmación prevista arriba. No cargar árboles o bundles completos por comodidad.
- Esta regla reduce ruido y contexto; no es una garantía de bloqueo técnico de acceso a archivos.

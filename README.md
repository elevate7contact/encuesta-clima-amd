# Encuesta de clima y cultura · AMD (Vercel + Supabase)

La misma página del artefacto inicial: bienvenida con la escala Nunca–Siempre, encuesta por dimensiones,
preguntas abiertas y, al final de la página, el enlace discreto **Acceso interno** que abre el panel privado
con clave. Ahora vive en tu propio dominio y cualquier persona responde desde el celular, sin cuenta de nadie.

```
index.html          ← toda la página (encuesta + panel). Sin build, sin dependencias.
config.js           ← URL y clave pública de tu Supabase
api/lectura.js      ← función de Vercel: "Lectura con Claude" vía OpenRouter o Anthropic (la clave queda en el servidor)
supabase/schema.sql ← tablas, seguridad y funciones
```

## Cómo se calcula

```
% Promotores  = (Respuestas 5 ÷ Total respuestas) × 100
% Detractores = ((Respuestas 1 + 2 + 3) ÷ Total respuestas) × 100
eNPS          = % Promotores − % Detractores      (entero entre −100 y +100)
```
El índice usa solo las 15 preguntas que se repiten en el cierre de la semana 10. Las abiertas no se miden.

## Puesta en marcha (≈ 20 min)

### 1. Supabase
1. Crea un proyecto en <https://supabase.com>.
2. **SQL Editor** → pega todo `supabase/schema.sql` → **Run**.
3. En el mismo editor, corre **solo esta línea** con la clave que quieras para el panel (mínimo 8 caracteres;
   mejor una frase larga):
   ```sql
   select public.admin_init('tu-clave-larga-aqui');
   ```
4. **Project Settings → API**: copia *Project URL* y la clave *anon / publishable*.

### 2. Configurar la página
Edita `config.js` y pega la URL y la clave pública. (La clave pública no es un secreto; la seguridad está en las funciones del SQL.)

### 3. Vercel
1. Sube esta carpeta a un repositorio (GitHub) e impórtalo en Vercel (*Framework: Other*, sin comando de build).
2. En **Settings → Environment Variables** agrega `SUPABASE_URL`, `SUPABASE_ANON_KEY` y, para el botón
   "Lectura con Claude", `OPENROUTER_API_KEY` (opcional `OPENROUTER_MODEL`, por defecto `anthropic/claude-sonnet-5.5`).
   Si prefieres la API de Anthropic directa, usa `ANTHROPIC_API_KEY` en su lugar. Solo las usa `api/lectura.js`.
   Después de guardarlas, haz *Redeploy*.
3. Despliega y asigna un subdominio de AMD (por ejemplo `clima.tudominio.com`).
   Prueba local opcional: `npx vercel dev`.

### 4. Uso
- **Esta semana**: la medición abierta es *Inicial* (viene así por defecto).
- Abre la página → **Acceso interno** (al final) → tu clave → **Resultados**.
- **Semana 10**: en el panel pulsa **Abrir cierre** y reenvía el mismo enlace.
- **Código de acceso** (opcional): en el panel puedes exigir un código para que solo responda el equipo.
- **Lectura con Claude**: botón en el panel; resume positivos, alertas y recomendaciones.
- **QR**: genéralo con la URL final (se la pides a Claude y queda con el diseño AMD).

## Seguridad y privacidad
- Las tablas están cerradas: desde internet solo se pueden usar las funciones del `schema.sql`.
- La clave del panel se guarda cifrada (bcrypt) y se verifica **en el servidor**. Tras 6 intentos fallidos el panel se bloquea 10 minutos.
  (Contrapartida: alguien que adivine el enlace podría bloquearte ese rato; no obtiene acceso a nada.)
- Las respuestas son anónimas: no se guarda nombre, correo, IP ni identificador de persona; solo el día.
- Duplicados: al ser anónima, no se puede impedir al 100% que alguien responda dos veces. La página recuerda
  en el dispositivo que ya respondió y el código de acceso reduce el riesgo.
- El comparativo inicial vs cierre es de grupo (promedios), no persona a persona.
- Para cambiar la clave: en el panel **Cambiar clave**; si la olvidas, vuelve a correr `admin_init` en el SQL Editor.

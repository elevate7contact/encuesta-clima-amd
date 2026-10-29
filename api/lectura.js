// Función serverless de Vercel: "Lectura con Claude" del panel.
// 1) Valida la clave del administrador contra Supabase.
// 2) Genera la lectura con OpenRouter (si existe OPENROUTER_API_KEY) o con la API de Anthropic.
// Las claves viven solo en las variables de entorno de Vercel (nunca llegan al navegador).

// Limpia espacios, saltos de línea y comillas que a veces se cuelan al pegar una variable.
const clean = (v) => String(v || '').trim().replace(/^["']+|["']+$/g, '').trim();

async function readBody(r) {
  const raw = await r.text();
  let json = {};
  try { json = JSON.parse(raw); } catch (e) { /* respuesta que no es JSON */ }
  return { raw, json };
}
const errText = (json, raw, status, who) => {
  const e = json && json.error;
  const msg = typeof e === 'string' ? e : e && e.message;
  return msg || `${who} respondió HTTP ${status}: ${String(raw).slice(0, 140)}`;
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { pin, prompt } = req.body || {};
  const SUPABASE_URL = clean(process.env.SUPABASE_URL);
  const SUPABASE_ANON_KEY = clean(process.env.SUPABASE_ANON_KEY);
  const OPENROUTER_API_KEY = clean(process.env.OPENROUTER_API_KEY);
  const ANTHROPIC_API_KEY = clean(process.env.ANTHROPIC_API_KEY);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !(OPENROUTER_API_KEY || ANTHROPIC_API_KEY)) {
    return res.status(500).json({
      error: 'Faltan variables de entorno en Vercel: SUPABASE_URL, SUPABASE_ANON_KEY y OPENROUTER_API_KEY (o ANTHROPIC_API_KEY).',
    });
  }
  if (typeof pin !== 'string' || typeof prompt !== 'string' || !pin || !prompt) {
    return res.status(400).json({ error: 'Solicitud incompleta.' });
  }
  if (prompt.length > 40000) return res.status(413).json({ error: 'La solicitud es demasiado larga.' });

  // Revisión de la clave del modelo antes de llamar (sin mostrarla nunca).
  const useOpenRouter = Boolean(OPENROUTER_API_KEY);
  const modelKey = useOpenRouter ? OPENROUTER_API_KEY : ANTHROPIC_API_KEY;
  const keyName = useOpenRouter ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
  if (/[^\x21-\x7E]/.test(modelKey)) {
    return res.status(500).json({ error: `${keyName} tiene caracteres no válidos (espacios, saltos de línea o símbolos raros). Vuelve a pegarla en Vercel.` });
  }
  if (useOpenRouter && !modelKey.startsWith('sk-or-')) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY no parece una clave de OpenRouter: debe empezar con "sk-or-".' });
  }
  if (!useOpenRouter && !modelKey.startsWith('sk-ant-')) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no parece una clave de Anthropic: debe empezar con "sk-ant-".' });
  }

  // 1) La clave del administrador se valida en Supabase (con freno de intentos).
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (/^eyJ/.test(SUPABASE_ANON_KEY)) headers.Authorization = 'Bearer ' + SUPABASE_ANON_KEY;
  let check;
  try {
    const r = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/admin_check_pin', {
      method: 'POST', headers, body: JSON.stringify({ p_pin: pin }),
    });
    check = (await readBody(r)).json;
  } catch (e) {
    return res.status(502).json({ error: 'No pudimos validar la clave (' + ((e && e.message) || 'error desconocido') + ').' });
  }
  if (!check || check.ok !== true) {
    const code = check && check.error;
    return res.status(code === 'bloqueado' ? 429 : 401).json({ error: 'clave no válida' });
  }

  // 2) Lectura
  const who = useOpenRouter ? 'OpenRouter' : 'Anthropic';
  try {
    let r;
    if (useOpenRouter) {
      r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + modelKey, 'X-Title': 'AMD - Diagnostico de clima' },
        body: JSON.stringify({
          model: clean(process.env.OPENROUTER_MODEL) || 'anthropic/claude-sonnet-5.5',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } else {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': modelKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: clean(process.env.ANTHROPIC_MODEL) || 'claude-sonnet-5-5',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    }
    const { raw, json } = await readBody(r);
    if (!r.ok) return res.status(502).json({ error: errText(json, raw, r.status, who) });

    let text = '';
    if (useOpenRouter) {
      const c = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      text = Array.isArray(c) ? c.map((x) => x.text || '').join('') : c || '';
      if (!text && json.error) return res.status(502).json({ error: errText(json, raw, r.status, who) });
    } else {
      text = (json.content || []).map((c) => c.text || '').join('');
    }
    return res.status(200).json({ text: String(text).trim() || 'El modelo no devolvió texto.' });
  } catch (e) {
    const cause = e && e.cause && (e.cause.code || e.cause.message);
    return res.status(502).json({ error: `No pudimos contactar a ${who} (${(e && e.message) || 'error desconocido'}${cause ? ' · ' + cause : ''}).` });
  }
};

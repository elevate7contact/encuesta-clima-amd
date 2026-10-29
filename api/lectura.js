// Función serverless de Vercel: "Lectura con Claude" del panel.
// 1) Valida la clave del administrador contra Supabase.
// 2) Genera la lectura con OpenRouter (si existe OPENROUTER_API_KEY) o con la API de Anthropic.
// Las claves viven solo en las variables de entorno de Vercel (nunca llegan al navegador).

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { pin, prompt } = req.body || {};
  const { SUPABASE_URL, SUPABASE_ANON_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !(OPENROUTER_API_KEY || ANTHROPIC_API_KEY)) {
    return res.status(500).json({
      error: 'Faltan variables de entorno en Vercel: SUPABASE_URL, SUPABASE_ANON_KEY y OPENROUTER_API_KEY (o ANTHROPIC_API_KEY).',
    });
  }
  if (typeof pin !== 'string' || typeof prompt !== 'string' || !pin || !prompt) {
    return res.status(400).json({ error: 'Solicitud incompleta.' });
  }
  if (prompt.length > 40000) return res.status(413).json({ error: 'La solicitud es demasiado larga.' });

  // 1) La clave del administrador se valida en Supabase (con freno de intentos).
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };
  if (/^eyJ/.test(SUPABASE_ANON_KEY)) headers.Authorization = 'Bearer ' + SUPABASE_ANON_KEY;
  let check;
  try {
    const r = await fetch(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/admin_check_pin', {
      method: 'POST', headers, body: JSON.stringify({ p_pin: pin }),
    });
    check = await r.json();
  } catch (e) {
    return res.status(502).json({ error: 'No pudimos validar la clave.' });
  }
  if (!check || check.ok !== true) {
    const code = check && check.error;
    return res.status(code === 'bloqueado' ? 429 : 401).json({ error: 'clave no válida' });
  }

  // 2) Lectura
  try {
    let text = '';
    if (OPENROUTER_API_KEY) {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + OPENROUTER_API_KEY,
          'X-Title': 'AMD - Diagnostico de clima',
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-5.5',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const body = await r.json();
      if (!r.ok) return res.status(502).json({ error: (body.error && body.error.message) || 'Error de OpenRouter.' });
      const c = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
      text = Array.isArray(c) ? c.map((x) => x.text || '').join('') : c || '';
    } else {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const body = await r.json();
      if (!r.ok) return res.status(502).json({ error: (body.error && body.error.message) || 'Error de la API de Anthropic.' });
      text = (body.content || []).map((c) => c.text || '').join('');
    }
    return res.status(200).json({ text: text.trim() || 'El modelo no devolvió texto.' });
  } catch (e) {
    return res.status(502).json({ error: 'No pudimos contactar al proveedor del modelo.' });
  }
};

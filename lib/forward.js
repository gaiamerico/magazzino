// Inoltra le richieste dell'app a Supabase (PostgREST).
// Usato sia dal server sul Mac (server.js) sia dalla funzione Vercel (api/proxy.js).
// La chiave segreta resta qui: l'iPad non la vede mai.

const ALLOWED = [
  /^categorie(\?|$)/,
  /^articoli(\?|$)/,
  /^movimenti(\?|$)/,
  /^rpc\/registra_movimento$/
];
const METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];

function json(status, obj) {
  return { status, text: JSON.stringify(obj) };
}

// Legge una variabile togliendo spazi e virgolette incollate per sbaglio
function env(name) {
  return String(process.env[name] || '').trim().replace(/^["']+|["']+$/g, '').trim();
}

function tipoChiave(key) {
  if (!key) return 'mancante';
  if (key.startsWith('sb_secret_')) return 'secret (ok)';
  if (key.startsWith('sb_publishable_')) return 'publishable (SBAGLIATA: serve la secret)';
  if (key.startsWith('eyJ')) {
    try {
      const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString()).role;
      return role === 'service_role' ? 'service_role (ok)' : role + ' (SBAGLIATA: serve service_role)';
    } catch (e) {
      return 'JWT non leggibile';
    }
  }
  return 'formato sconosciuto';
}

// Controllo configurazione: /api/proxy?p=stato  (non mostra segreti)
async function stato(url, key, appPin) {
  const out = {
    supabase_url: url || 'mancante',
    chiave: tipoChiave(key),
    pin: appPin ? 'impostato (' + appPin.length + ' caratteri)' : 'non impostato',
    gemini: env('GEMINI_API_KEY') ? 'chiave impostata, modello ' + (env('GEMINI_MODEL') || 'gemini-flash-latest') : 'GEMINI_API_KEY mancante (foto disattivate)',
    test_supabase: 'non eseguito'
  };
  if (url && key) {
    try {
      const headers = { apikey: key };
      if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
      const res = await fetch(url + '/rest/v1/categorie?select=codice&limit=1', { headers });
      const text = await res.text();
      out.test_supabase = res.ok ? 'ok' : 'errore ' + res.status + ': ' + text.slice(0, 200);
    } catch (e) {
      out.test_supabase = 'non raggiungibile: ' + e.message;
    }
  }
  return json(200, out);
}

async function forward({ method, path, body, pin }) {
  const url = env('SUPABASE_URL').replace(/\/+$/, '');
  const key = env('SUPABASE_SERVICE_KEY');
  const appPin = env('APP_PIN');
  path = String(path || '');

  if (path === 'stato') return stato(url, key, appPin);

  // Senza configurazione l'app passa in modalità demo (dati locali sull'iPad).
  if (!url || !key) return json(503, { demo: true, message: 'Supabase non configurato' });
  if (appPin && String(pin || '').trim() !== appPin) return json(401, { pin: true, message: 'PIN errato' });

  if (!ALLOWED.some((re) => re.test(path))) return json(403, { message: 'Percorso non consentito' });
  if (!METHODS.includes(method)) return json(405, { message: 'Metodo non consentito' });

  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
  // Le chiavi legacy (JWT "eyJ...") vanno anche in Authorization; le nuove sb_secret_ no.
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;

  try {
    const res = await fetch(url + '/rest/v1/' + path, {
      method,
      headers,
      body: method === 'POST' || method === 'PATCH' ? body || '{}' : undefined
    });
    const text = await res.text();
    // Rifiuto di Supabase (chiave sbagliata o senza permessi): non va confuso con il PIN
    if (res.status === 401 || (res.status === 403 && /permission denied|42501|api key/i.test(text))) {
      let detail = '';
      try { detail = JSON.parse(text).message || ''; } catch (e) { detail = text.slice(0, 120); }
      return json(502, {
        message: 'Supabase ha rifiutato la chiave SUPABASE_SERVICE_KEY (' + tipoChiave(key) + '). ' + detail
      });
    }
    return { status: res.status, text };
  } catch (err) {
    return json(502, { message: 'Supabase non raggiungibile: ' + err.message });
  }
}

module.exports = { forward, env, json };

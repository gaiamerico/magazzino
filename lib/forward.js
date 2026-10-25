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

async function forward({ method, path, body, pin }) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || '';
  const appPin = String(process.env.APP_PIN || '').trim();

  // Senza configurazione l'app passa in modalità demo (dati locali sull'iPad).
  if (!url || !key) return json(503, { demo: true, message: 'Supabase non configurato' });
  if (appPin && String(pin || '').trim() !== appPin) return json(401, { message: 'PIN errato' });

  path = String(path || '');
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
    return { status: res.status, text: await res.text() };
  } catch (err) {
    return json(502, { message: 'Supabase non raggiungibile: ' + err.message });
  }
}

module.exports = { forward };

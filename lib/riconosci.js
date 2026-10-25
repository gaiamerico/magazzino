// Riconoscimento prodotti da foto con l'API Gemini di Google (Google AI Studio).
// Usato da server.js (Mac) e da api/riconosci.js (Vercel).
// La chiave GEMINI_API_KEY resta sul server.

const { env, json } = require('./forward');

const UNITA = ['pz', 'bottiglie', 'lattine', 'conf', 'kg', 'l'];
const MAX_IMAGE = 4 * 1024 * 1024; // base64, ~3 MB di JPEG

function prompt(categorie, articoli) {
  const elenco = articoli.length
    ? articoli.map((a) => '- id ' + a.id + ': ' + a.nome + ' (' + a.categoria + ', ' + a.unita + ')').join('\n')
    : '(nessun articolo)';
  return [
    'Sei l\'assistente di un magazzino domestico. Nella foto ci sono uno o più prodotti da caricare o scaricare.',
    'La foto può essere ruotata o scattata con una fotocamera di bassa qualità.',
    'Per ogni prodotto diverso che vedi:',
    '- nome: nome breve in italiano con marca e formato se leggibili (es. "Acqua San Benedetto 1,5 L");',
    '- categoria: uno di ' + categorie.map((c) => '"' + c.codice + '" (' + c.nome + ')').join(', ') + ';',
    '- unita: uno di ' + UNITA.map((u) => '"' + u + '"').join(', ') + ';',
    '- quantita: quante unità di quel prodotto si vedono (conta le confezioni; se una confezione contiene più pezzi visibili, ad esempio una cassa da 6 bottiglie, conta i pezzi);',
    '- codice_barre: le cifre del codice a barre se leggibili, altrimenti stringa vuota;',
    '- articolo_id: l\'id dell\'articolo già in magazzino che corrisponde allo stesso prodotto (stessa cosa e stesso formato), altrimenti 0;',
    '- confidenza: numero da 0 a 1.',
    'Se non vedi nessun prodotto restituisci un elenco vuoto.',
    '',
    'Articoli già in magazzino:',
    elenco
  ].join('\n');
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    prodotti: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nome: { type: 'STRING' },
          categoria: { type: 'STRING' },
          unita: { type: 'STRING' },
          quantita: { type: 'NUMBER' },
          codice_barre: { type: 'STRING' },
          articolo_id: { type: 'INTEGER' },
          confidenza: { type: 'NUMBER' }
        },
        required: ['nome', 'categoria', 'unita', 'quantita', 'articolo_id']
      }
    }
  },
  required: ['prodotti']
};

// Ripulisce la risposta: categorie, unità e id devono esistere davvero
function normalizza(raw, categorie, articoli) {
  const codici = categorie.map((c) => c.codice);
  const ids = {};
  articoli.forEach((a) => { ids[String(a.id)] = a; });
  return (raw && Array.isArray(raw.prodotti) ? raw.prodotti : []).slice(0, 20).map((p) => {
    const art = ids[String(p.articolo_id)] || null;
    let q = Math.round(Number(p.quantita) || 1);
    if (q < 1) q = 1;
    return {
      nome: String(p.nome || 'Prodotto').slice(0, 80),
      categoria: art ? art.categoria : (codici.indexOf(p.categoria) !== -1 ? p.categoria : codici[0]),
      unita: art ? art.unita : (UNITA.indexOf(p.unita) !== -1 ? p.unita : 'pz'),
      quantita: q,
      codice_barre: String(p.codice_barre || '').replace(/[^0-9]/g, '').slice(0, 20),
      articolo_id: art ? art.id : null,
      confidenza: Math.max(0, Math.min(1, Number(p.confidenza) || 0))
    };
  });
}

async function riconosci({ body, pin }) {
  const key = env('GEMINI_API_KEY');
  const model = env('GEMINI_MODEL') || 'gemini-flash-latest';
  const appPin = env('APP_PIN');

  if (appPin && String(pin || '').trim() !== appPin) return json(401, { pin: true, message: 'PIN errato' });
  if (!key) return json(503, { message: 'Riconoscimento foto non configurato: manca GEMINI_API_KEY sul server' });

  let data;
  try { data = typeof body === 'string' ? JSON.parse(body) : body; } catch (e) { data = null; }
  if (!data || typeof data.image !== 'string') return json(400, { message: 'Foto mancante' });

  const image = data.image.replace(/^data:image\/\w+;base64,/, '');
  if (image.length > MAX_IMAGE) return json(413, { message: 'Foto troppo grande' });

  const categorie = (Array.isArray(data.categorie) ? data.categorie : [])
    .filter((c) => c && c.codice).slice(0, 30)
    .map((c) => ({ codice: String(c.codice), nome: String(c.nome || c.codice) }));
  if (!categorie.length) categorie.push({ codice: 'bere', nome: 'Bere' }, { codice: 'cibo', nome: 'Cibo' });
  const articoli = (Array.isArray(data.articoli) ? data.articoli : [])
    .filter((a) => a && a.id != null && a.nome).slice(0, 500)
    .map((a) => ({ id: a.id, nome: String(a.nome).slice(0, 80), categoria: String(a.categoria || ''), unita: String(a.unita || '') }));

  let res, out;
  try {
    res = await fetch((env('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com') + '/v1beta/models/' +
      encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'image/jpeg', data: image } },
            { text: prompt(categorie, articoli) }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA
        }
      })
    });
    out = await res.json().catch(() => null);
  } catch (err) {
    return json(502, { message: 'Google Gemini non raggiungibile: ' + err.message });
  }

  if (!res.ok) {
    const msg = (out && out.error && out.error.message) || ('errore ' + res.status);
    const hint = res.status === 400 && /api key/i.test(msg) ? ' (controlla GEMINI_API_KEY)' :
      res.status === 404 ? ' (controlla GEMINI_MODEL)' :
      res.status === 429 ? ' (limite di richieste raggiunto, riprova tra poco)' : '';
    return json(502, { message: 'Gemini: ' + msg + hint });
  }

  const cand = out && out.candidates && out.candidates[0];
  const text = cand && cand.content && Array.isArray(cand.content.parts)
    ? cand.content.parts.map((p) => p.text || '').join('') : '';
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) {
    return json(502, { message: 'Risposta di Gemini non leggibile, riprova con un\'altra foto' });
  }
  return json(200, { prodotti: normalizza(parsed, categorie, articoli), modello: model });
}

module.exports = { riconosci, normalizza };

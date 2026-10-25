// Server per il Mac: serve l'app all'iPad in HTTP sulla rete di casa
// e inoltra le richieste a Supabase. Nessuna dipendenza, serve Node 18+.
//   node server.js        ->  http://<nome-mac>.local:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const { forward } = require('./lib/forward');
const { riconosci } = require('./lib/riconosci');

// Carica .env (formato CHIAVE=valore) se presente
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (!m || process.env[m[1]]) return;
    // toglie spazi, commenti a fine riga ("1234  # pin") e virgolette
    const val = m[2].replace(/\s+#.*$/, '').trim().replace(/^["']|["']$/g, '');
    process.env[m[1]] = val;
  });
}

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

function readBody(req, limit) {
  return new Promise((resolve) => {
    let data = '', troppo = false;
    req.on('data', (c) => { if (!troppo) { data += c; if (data.length > (limit || 1e6)) troppo = true; } });
    req.on('end', () => resolve(troppo ? null : data));
    req.on('error', () => resolve(null));
  });
}

function inviaJson(res, result) {
  if (res.headersSent) return;
  res.writeHead(result.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(result.text);
}

// Un errore imprevisto non deve mai spegnere il server
process.on('unhandledRejection', (err) => console.error(new Date().toISOString(), 'Errore:', err));
process.on('uncaughtException', (err) => console.error(new Date().toISOString(), 'Errore:', err));

const server = http.createServer((req, res) => {
  gestisci(req, res).catch((err) => {
    console.error(new Date().toISOString(), req.method, req.url, err);
    inviaJson(res, { status: 500, text: JSON.stringify({ message: 'Errore interno del server: ' + err.message }) });
  });
});

async function gestisci(req, res) {
  const url = new URL(req.url, 'http://localhost');
  console.log(new Date().toISOString(), req.method, url.pathname);

  if (url.pathname === '/api/proxy') {
    const body = await readBody(req, 1e6);
    if (body === null) return inviaJson(res, { status: 413, text: JSON.stringify({ message: 'Richiesta troppo grande' }) });
    return inviaJson(res, await forward({
      method: req.method,
      path: url.searchParams.get('p'),
      body,
      pin: req.headers['x-app-pin']
    }));
  }

  if (url.pathname === '/api/riconosci') {
    if (req.method !== 'POST') return inviaJson(res, { status: 405, text: JSON.stringify({ message: 'Usa POST' }) });
    const body = await readBody(req, 8e6);
    if (body === null) return inviaJson(res, { status: 413, text: JSON.stringify({ message: 'Foto troppo grande' }) });
    const t0 = Date.now();
    const result = await riconosci({ body, pin: req.headers['x-app-pin'] });
    console.log('  riconoscimento: ' + result.status + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
    return inviaJson(res, result);
  }

  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { rel = '/'; }
  let file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Non trovato'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  const mode = process.env.SUPABASE_URL ? 'Supabase' : 'DEMO (Supabase non configurato)';
  console.log('Magazzino in ascolto su http://0.0.0.0:' + PORT + '  -  modalità: ' + mode +
    (process.env.APP_PIN ? '  -  PIN attivo (' + String(process.env.APP_PIN).trim().length + ' cifre)' : '  -  nessun PIN') +
    (process.env.GEMINI_API_KEY ? '  -  foto: Gemini attivo' : '  -  foto: disattivate (manca GEMINI_API_KEY)'));
});

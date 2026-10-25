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
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > (limit || 1e6)) req.destroy(); });
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/proxy') {
    const result = await forward({
      method: req.method,
      path: url.searchParams.get('p'),
      body: await readBody(req),
      pin: req.headers['x-app-pin']
    });
    res.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    return res.end(result.text);
  }

  if (url.pathname === '/api/riconosci') {
    const result = req.method === 'POST'
      ? await riconosci({ body: await readBody(req, 6e6), pin: req.headers['x-app-pin'] })
      : { status: 405, text: JSON.stringify({ message: 'Usa POST' }) };
    res.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    return res.end(result.text);
  }

  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
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
});

server.listen(PORT, '0.0.0.0', () => {
  const mode = process.env.SUPABASE_URL ? 'Supabase' : 'DEMO (Supabase non configurato)';
  console.log('Magazzino in ascolto su http://0.0.0.0:' + PORT + '  -  modalità: ' + mode +
    (process.env.APP_PIN ? '  -  PIN attivo (' + String(process.env.APP_PIN).trim().length + ' cifre)' : '  -  nessun PIN') +
    (process.env.GEMINI_API_KEY ? '  -  foto: Gemini attivo' : '  -  foto: disattivate (manca GEMINI_API_KEY)'));
});

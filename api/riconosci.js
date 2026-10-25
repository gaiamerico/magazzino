// Funzione serverless Vercel: POST /api/riconosci  { image, categorie, articoli }
const { riconosci } = require('../lib/riconosci');

module.exports = async (req, res) => {
  let result;
  if (req.method !== 'POST') {
    result = { status: 405, text: JSON.stringify({ message: 'Usa POST' }) };
  } else {
    result = await riconosci({ body: req.body, pin: req.headers['x-app-pin'] });
  }
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(result.text);
};

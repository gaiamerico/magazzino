// Funzione serverless Vercel: /api/proxy?p=<percorso PostgREST>
const { forward } = require('../lib/forward');

module.exports = async (req, res) => {
  let body = req.body;
  if (body != null && typeof body !== 'string') body = JSON.stringify(body);

  const result = await forward({
    method: req.method,
    path: req.query.p,
    body,
    pin: req.headers['x-app-pin']
  });

  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(result.text);
};

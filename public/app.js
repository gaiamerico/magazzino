/*
 * Magazzino - frontend per iPad iOS 9.3 (Safari 9).
 * Solo ES5: niente let/const, arrow function, template string, fetch.
 * Le chiamate passano da /api/proxy (server sul Mac o funzione Vercel),
 * che aggiunge la chiave Supabase. Se il server non è configurato
 * l'app gira in modalità DEMO con i dati salvati sull'iPad.
 */
(function () {
  'use strict';

  var API = 'api/proxy';
  var UNITA = ['pz', 'bottiglie', 'lattine', 'conf', 'kg', 'l'];

  var state = {
    tab: 'giacenze',
    categorie: [],
    articoli: [],
    movimenti: [],
    filtroCat: 'tutti',
    soloSotto: false,
    cerca: '',
    modal: null,
    busy: false
  };
  var backend = null;

  /* ---------- utilità ---------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(n) {
    n = Math.round(Number(n) * 1000) / 1000;
    return String(n).replace('.', ',');
  }

  function parseNum(s) {
    var n = parseFloat(String(s == null ? '' : s).replace(',', '.'));
    return isNaN(n) ? NaN : n;
  }

  function storeGet(k) {
    try { return window.localStorage.getItem('magazzino_' + k); } catch (e) { return null; }
  }
  function storeSet(k, v) {
    try { window.localStorage.setItem('magazzino_' + k, v); } catch (e) { /* modalità privata */ }
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtData(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function trovaArticolo(id) {
    for (var i = 0; i < state.articoli.length; i++) {
      if (String(state.articoli[i].id) === String(id)) return state.articoli[i];
    }
    return null;
  }

  function nomeCategoria(codice) {
    for (var i = 0; i < state.categorie.length; i++) {
      if (state.categorie[i].codice === codice) return state.categorie[i].nome;
    }
    return codice;
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var t = $('toast');
    t.textContent = msg;
    t.className = isErr ? 'err' : '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'hidden'; }, isErr ? 4000 : 2200);
  }

  /* ---------- backend Supabase (via proxy) ---------- */

  function request(method, path, body, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, API + '?p=' + encodeURIComponent(path) + '&t=' + Date.now(), true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    var pin = storeGet('pin');
    if (pin) xhr.setRequestHeader('X-App-Pin', pin);
    xhr.timeout = 15000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = null;
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) { data = null; }
      if (xhr.status >= 200 && xhr.status < 300) return cb(null, data);
      var msg = (data && (data.message || data.hint || data.error)) ||
        (xhr.status === 0 ? 'Server non raggiungibile' : 'Errore ' + xhr.status);
      cb({ status: xhr.status, message: msg, data: data });
    };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  var serverBackend = {
    load: function (cb) {
      var res = {}, pending = 3, failed = false;
      function done(key) {
        return function (err, data) {
          if (failed) return;
          if (err) { failed = true; return cb(err); }
          res[key] = data || [];
          if (--pending === 0) cb(null, res);
        };
      }
      request('GET', 'categorie?select=*&order=ordine', null, done('categorie'));
      request('GET', 'articoli?select=*&order=nome', null, done('articoli'));
      request('GET', 'movimenti?select=*,articoli(nome,unita)&order=creato_il.desc&limit=200', null, done('movimenti'));
    },
    movimento: function (id, tipo, q, nota, cb) {
      request('POST', 'rpc/registra_movimento',
        { p_articolo_id: id, p_tipo: tipo, p_quantita: q, p_nota: nota || null }, cb);
    },
    crea: function (dati, cb) {
      request('POST', 'articoli', dati, function (err, rows) {
        cb(err, rows && rows[0]);
      });
    },
    aggiorna: function (id, dati, cb) {
      request('PATCH', 'articoli?id=eq.' + encodeURIComponent(id), dati, cb);
    },
    elimina: function (id, cb) {
      request('DELETE', 'articoli?id=eq.' + encodeURIComponent(id), null, cb);
    }
  };

  /* ---------- backend DEMO (dati sull'iPad) ---------- */

  var demoBackend = (function () {
    var db;
    function seed() {
      var now = new Date().toISOString();
      var a = [
        ['Acqua naturale 1,5 L', 'bere', 'bottiglie', 36, 12],
        ['Acqua frizzante 1,5 L', 'bere', 'bottiglie', 8, 12],
        ['Coca-Cola lattina', 'bere', 'lattine', 24, 6],
        ['Birra 33 cl', 'bere', 'bottiglie', 18, 12],
        ['Vino rosso', 'bere', 'bottiglie', 4, 3],
        ['Succo di frutta', 'bere', 'pz', 2, 6],
        ['Pasta spaghetti 500 g', 'cibo', 'conf', 15, 5],
        ['Riso 1 kg', 'cibo', 'conf', 3, 2],
        ['Pomodori pelati', 'cibo', 'pz', 10, 4],
        ['Olio extravergine 1 L', 'cibo', 'bottiglie', 1, 2],
        ['Caffè macinato', 'cibo', 'conf', 6, 2],
        ['Biscotti', 'cibo', 'conf', 5, 2]
      ];
      db = { nextId: 1, nextMov: 1, categorie: [
        { codice: 'bere', nome: 'Bere', ordine: 1 },
        { codice: 'cibo', nome: 'Cibo', ordine: 2 }
      ], articoli: [], movimenti: [] };
      for (var i = 0; i < a.length; i++) {
        db.articoli.push({ id: db.nextId++, nome: a[i][0], categoria: a[i][1], unita: a[i][2],
          quantita: a[i][3], scorta_minima: a[i][4], creato_il: now });
      }
    }
    function save() { storeSet('demo', JSON.stringify(db)); }
    try { db = JSON.parse(storeGet('demo')); } catch (e) { db = null; }
    if (!db || !db.articoli) { seed(); save(); }

    function later(cb, err, data) { setTimeout(function () { cb(err, data); }, 0); }
    function find(id) {
      for (var i = 0; i < db.articoli.length; i++) if (db.articoli[i].id === Number(id)) return db.articoli[i];
      return null;
    }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }

    return {
      load: function (cb) {
        var arts = copy(db.articoli).sort(function (x, y) { return x.nome.localeCompare(y.nome); });
        var movs = copy(db.movimenti).reverse().slice(0, 200);
        for (var i = 0; i < movs.length; i++) {
          var a = find(movs[i].articolo_id);
          movs[i].articoli = a ? { nome: a.nome, unita: a.unita } : null;
        }
        later(cb, null, { categorie: copy(db.categorie), articoli: arts, movimenti: movs });
      },
      movimento: function (id, tipo, q, nota, cb) {
        var a = find(id);
        if (!a) return later(cb, { message: 'Articolo non trovato' });
        if (tipo === 'scarico' && a.quantita < q) return later(cb, { message: 'Quantità insufficiente in magazzino' });
        a.quantita = Math.round((a.quantita + (tipo === 'carico' ? q : -q)) * 1000) / 1000;
        db.movimenti.push({ id: db.nextMov++, articolo_id: a.id, tipo: tipo, quantita: q,
          nota: nota || null, creato_il: new Date().toISOString() });
        save();
        later(cb, null, copy(a));
      },
      crea: function (dati, cb) {
        var a = { id: db.nextId++, nome: dati.nome, categoria: dati.categoria, unita: dati.unita,
          quantita: 0, scorta_minima: dati.scorta_minima || 0, creato_il: new Date().toISOString() };
        db.articoli.push(a);
        save();
        later(cb, null, copy(a));
      },
      aggiorna: function (id, dati, cb) {
        var a = find(id);
        if (!a) return later(cb, { message: 'Articolo non trovato' });
        for (var k in dati) if (dati.hasOwnProperty(k)) a[k] = dati[k];
        save();
        later(cb, null, [copy(a)]);
      },
      elimina: function (id, cb) {
        db.articoli = db.articoli.filter(function (a) { return a.id !== Number(id); });
        db.movimenti = db.movimenti.filter(function (m) { return m.articolo_id !== Number(id); });
        save();
        later(cb, null, []);
      }
    };
  })();

  /* ---------- caricamento dati ---------- */

  function reload(cb) {
    backend.load(function (err, data) {
      if (err) {
        toast(err.message, true);
        if (cb) cb(err);
        return;
      }
      state.categorie = data.categorie;
      state.articoli = data.articoli;
      state.movimenti = data.movimenti;
      render();
      if (cb) cb(null);
    });
  }

  function start() {
    // Prova il server: se non è configurato (503) o non esiste (404 / file://) usa la demo.
    request('GET', 'categorie?select=codice&limit=1', null, function (err) {
      if (!err) {
        backend = serverBackend;
        return reload();
      }
      if (err.status === 401) {
        var pin = window.prompt('Inserisci il PIN del magazzino');
        if (pin !== null) { storeSet('pin', pin); return start(); }
      }
      if (err.status === 503 || err.status === 404 || err.status === 0 || err.status === 401) {
        backend = demoBackend;
        $('badge-demo').className = 'badge';
        if (err.status !== 503 && err.status !== 404) toast('Server non raggiungibile: modalità demo', true);
        return reload();
      }
      $('content').innerHTML = '<div class="empty">Errore: ' + esc(err.message) +
        '<br><br><button class="btn btn-primary" data-action="riprova">Riprova</button></div>';
    });
  }

  /* ---------- render ---------- */

  function render() {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].className = 'tab' + (tabs[i].getAttribute('data-tab') === state.tab ? ' on' : '');
    }
    if (state.tab === 'giacenze') {
      renderToolbar();
      $('toolbar').className = '';
      $('content').className = '';
      renderGriglia();
    } else {
      $('toolbar').className = 'hidden';
      $('content').className = 'no-toolbar';
      renderMovimenti();
    }
  }

  function sottoScorta(a) {
    return Number(a.scorta_minima) > 0 && Number(a.quantita) <= Number(a.scorta_minima);
  }

  function renderToolbar() {
    var nSotto = 0;
    for (var i = 0; i < state.articoli.length; i++) if (sottoScorta(state.articoli[i])) nSotto++;

    var h = '<button class="chip' + (state.filtroCat === 'tutti' ? ' on' : '') +
      '" data-action="filtro" data-cat="tutti">Tutti</button>';
    for (var j = 0; j < state.categorie.length; j++) {
      var c = state.categorie[j];
      h += '<button class="chip' + (state.filtroCat === c.codice ? ' on' : '') +
        '" data-action="filtro" data-cat="' + esc(c.codice) + '">' + esc(c.nome) + '</button>';
    }
    h += '<button class="chip warn' + (state.soloSotto ? ' on' : '') + '" data-action="sotto">Sotto scorta (' +
      nSotto + ')</button>';
    h += '<input id="cerca" class="search" type="search" placeholder="Cerca…" value="' + esc(state.cerca) + '">';
    $('toolbar').innerHTML = h;
  }

  function renderGriglia() {
    var q = state.cerca.toLowerCase();
    var list = state.articoli.filter(function (a) {
      if (state.filtroCat !== 'tutti' && a.categoria !== state.filtroCat) return false;
      if (state.soloSotto && !sottoScorta(a)) return false;
      if (q && a.nome.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });

    if (!list.length) {
      $('content').innerHTML = '<div class="empty">' +
        (state.articoli.length ? 'Nessun articolo trovato' : 'Il magazzino è vuoto.<br>Tocca “+ Articolo” per iniziare.') +
        '</div>';
      return;
    }

    var h = '<div class="grid">';
    for (var i = 0; i < list.length; i++) {
      var a = list[i], low = sottoScorta(a);
      h += '<div class="card cat-' + esc(a.categoria) + (low ? ' low' : '') + '">' +
        '<div class="card-top"><div class="card-name">' + esc(a.nome) + '</div>' +
        '<button class="card-edit" data-action="modifica" data-id="' + a.id + '">⋯</button></div>' +
        '<div class="card-cat">' + esc(nomeCategoria(a.categoria)) + '</div>' +
        '<div class="card-qty">' + fmt(a.quantita) + ' <small>' + esc(a.unita) + '</small></div>' +
        '<div class="card-min">' + (Number(a.scorta_minima) > 0 ?
          (low ? '⚠ Sotto scorta (min ' : 'Scorta minima: ') + fmt(a.scorta_minima) + (low ? ')' : '') : '') +
        '</div>' +
        '<div class="card-actions">' +
        '<button class="btn btn-out" data-action="mov" data-tipo="scarico" data-id="' + a.id + '">− Scarica</button>' +
        '<button class="btn btn-in" data-action="mov" data-tipo="carico" data-id="' + a.id + '">+ Carica</button>' +
        '</div></div>';
    }
    $('content').innerHTML = h + '</div>';
  }

  function renderMovimenti() {
    if (!state.movimenti.length) {
      $('content').innerHTML = '<div class="empty">Nessun movimento registrato</div>';
      return;
    }
    var h = '<div class="list">';
    for (var i = 0; i < state.movimenti.length; i++) {
      var m = state.movimenti[i], inn = m.tipo === 'carico';
      var art = m.articoli || { nome: '(articolo eliminato)', unita: '' };
      h += '<div class="row">' +
        '<div class="row-icon ' + (inn ? 'in' : 'out') + '">' + (inn ? '+' : '−') + '</div>' +
        '<div class="row-main"><div class="row-title">' + esc(art.nome) + '</div>' +
        '<div class="row-sub">' + (inn ? 'Carico' : 'Scarico') + ' · ' + fmtData(m.creato_il) +
        (m.nota ? ' · ' + esc(m.nota) : '') + '</div></div>' +
        '<div class="row-qty ' + (inn ? 'in' : 'out') + '">' + (inn ? '+' : '−') + fmt(m.quantita) +
        ' ' + esc(art.unita) + '</div></div>';
    }
    $('content').innerHTML = h + '</div>';
  }

  /* ---------- modale carico / scarico ---------- */

  function apriMovimento(id, tipo) {
    var a = trovaArticolo(id);
    if (!a) return;
    state.modal = { type: 'mov', id: a.id, tipo: tipo, valore: '' };
    var carico = tipo === 'carico';
    var keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫'];
    var kp = '';
    for (var i = 0; i < keys.length; i++) {
      kp += '<button class="key' + (keys[i] === ',' || keys[i] === '⌫' ? ' fn' : '') +
        '" data-action="key" data-k="' + keys[i] + '">' + keys[i] + '</button>';
    }
    $('modal').innerHTML = '<div class="sheet">' +
      '<h2>' + (carico ? 'Carico' : 'Scarico') + ': ' + esc(a.nome) + '</h2>' +
      '<div class="sub">In magazzino: <b>' + fmt(a.quantita) + ' ' + esc(a.unita) + '</b></div>' +
      '<div class="display" id="display"></div>' +
      '<div class="quick">' +
      '<button class="btn" data-action="add" data-n="1">+1</button>' +
      '<button class="btn" data-action="add" data-n="6">+6</button>' +
      '<button class="btn" data-action="add" data-n="12">+12</button>' +
      '<button class="btn" data-action="add" data-n="24">+24</button>' +
      (!carico ? '<button class="btn" data-action="tutto">Tutto</button>' : '') +
      '</div>' +
      '<div class="keypad">' + kp + '</div>' +
      '<div class="field"><label>Nota (facoltativa)</label>' +
      '<input id="nota" type="text" placeholder="es. fornitore, evento, consumo…" autocomplete="off"></div>' +
      '<div class="sheet-actions">' +
      '<button class="btn" data-action="chiudi">Annulla</button>' +
      '<button class="btn ' + (carico ? 'btn-in' : 'btn-out') + '" data-action="conferma-mov">' +
      (carico ? 'Carica' : 'Scarica') + '</button></div></div>';
    $('modal').className = '';
    aggiornaDisplay();
  }

  function aggiornaDisplay() {
    var a = trovaArticolo(state.modal.id);
    $('display').innerHTML = (state.modal.valore || '0') + ' <small>' + esc(a ? a.unita : '') + '</small>';
  }

  function tasto(k) {
    var v = state.modal.valore;
    if (k === '⌫') v = v.slice(0, -1);
    else if (k === ',') { if (v.indexOf(',') === -1) v = (v || '0') + ','; }
    else if (v.length < 8) v = (v === '0' ? '' : v) + k;
    state.modal.valore = v;
    aggiornaDisplay();
  }

  function aggiungi(n) {
    var cur = parseNum(state.modal.valore);
    if (isNaN(cur)) cur = 0;
    state.modal.valore = fmt(cur + n);
    aggiornaDisplay();
  }

  function confermaMovimento() {
    var m = state.modal, q = parseNum(m.valore);
    if (!(q > 0)) return toast('Inserisci una quantità', true);
    var a = trovaArticolo(m.id);
    if (m.tipo === 'scarico' && a && q > Number(a.quantita)) {
      return toast('Disponibili solo ' + fmt(a.quantita) + ' ' + a.unita, true);
    }
    var nota = $('nota').value;
    occupato(true);
    backend.movimento(m.id, m.tipo, q, nota, function (err) {
      occupato(false);
      if (err) return toast(err.message, true);
      chiudiModale();
      toast((m.tipo === 'carico' ? 'Caricati ' : 'Scaricati ') + fmt(q) + ' ' + (a ? a.unita + ' – ' + a.nome : ''));
      reload();
    });
  }

  /* ---------- modale nuovo / modifica articolo ---------- */

  function apriArticolo(id) {
    var a = id != null ? trovaArticolo(id) : null;
    var cat = a ? a.categoria : (state.filtroCat !== 'tutti' ? state.filtroCat :
      (state.categorie[0] && state.categorie[0].codice));
    state.modal = { type: 'art', id: a ? a.id : null, categoria: cat, unita: a ? a.unita : 'pz' };

    var cats = '';
    for (var i = 0; i < state.categorie.length; i++) {
      var c = state.categorie[i];
      cats += '<button class="chip' + (c.codice === cat ? ' on' : '') + '" data-action="scegli" data-group="categoria" data-v="' +
        esc(c.codice) + '">' + esc(c.nome) + '</button>';
    }
    var unita = UNITA.slice();
    if (a && unita.indexOf(a.unita) === -1) unita.push(a.unita);
    var us = '';
    for (var j = 0; j < unita.length; j++) {
      us += '<button class="chip' + (unita[j] === state.modal.unita ? ' on' : '') + '" data-action="scegli" data-group="unita" data-v="' +
        esc(unita[j]) + '">' + esc(unita[j]) + '</button>';
    }

    $('modal').innerHTML = '<div class="sheet">' +
      '<h2>' + (a ? 'Modifica articolo' : 'Nuovo articolo') + '</h2>' +
      '<div class="field"><label>Nome</label><input id="f-nome" type="text" autocomplete="off" value="' +
      esc(a ? a.nome : '') + '" placeholder="es. Acqua naturale 1,5 L"></div>' +
      '<div class="field"><label>Categoria</label><div class="choices">' + cats + '</div></div>' +
      '<div class="field"><label>Unità di misura</label><div class="choices">' + us + '</div></div>' +
      '<div class="two">' +
      '<div class="field"><label>Scorta minima</label><input id="f-min" type="number" step="any" min="0" value="' +
      (a ? esc(a.scorta_minima) : '') + '" placeholder="0"></div>' +
      (a ? '' : '<div class="field"><label>Quantità iniziale</label><input id="f-qta" type="number" step="any" min="0" placeholder="0"></div>') +
      '</div>' +
      '<div class="sheet-actions">' +
      (a ? '<button class="btn btn-danger" data-action="elimina">Elimina</button>' : '') +
      '<button class="btn" data-action="chiudi">Annulla</button>' +
      '<button class="btn btn-primary" data-action="salva-art">Salva</button></div></div>';
    $('modal').className = '';
  }

  function scegli(el) {
    var group = el.getAttribute('data-group');
    var sib = el.parentNode.children;
    for (var i = 0; i < sib.length; i++) sib[i].className = 'chip';
    el.className = 'chip on';
    state.modal[group] = el.getAttribute('data-v');
  }

  function salvaArticolo() {
    var m = state.modal;
    var nome = $('f-nome').value.replace(/^\s+|\s+$/g, '');
    var min = parseNum($('f-min').value || '0');
    if (!nome) return toast('Inserisci il nome', true);
    if (!m.categoria) return toast('Scegli una categoria', true);
    if (isNaN(min) || min < 0) return toast('Scorta minima non valida', true);
    var dati = { nome: nome, categoria: m.categoria, unita: m.unita, scorta_minima: min };

    occupato(true);
    if (m.id != null) {
      backend.aggiorna(m.id, dati, function (err) {
        occupato(false);
        if (err) return toast(err.message, true);
        chiudiModale();
        toast('Articolo aggiornato');
        reload();
      });
      return;
    }
    var qta = parseNum($('f-qta').value || '0');
    if (isNaN(qta) || qta < 0) { occupato(false); return toast('Quantità iniziale non valida', true); }
    backend.crea(dati, function (err, art) {
      if (err || !art) { occupato(false); return toast(err ? err.message : 'Errore di salvataggio', true); }
      function fine() {
        occupato(false);
        chiudiModale();
        toast('Articolo creato: ' + nome);
        reload();
      }
      if (qta > 0) {
        backend.movimento(art.id, 'carico', qta, 'Giacenza iniziale', function (e2) {
          if (e2) toast(e2.message, true);
          fine();
        });
      } else fine();
    });
  }

  function eliminaArticolo() {
    var a = trovaArticolo(state.modal.id);
    if (!a || !window.confirm('Eliminare "' + a.nome + '" e tutti i suoi movimenti?')) return;
    occupato(true);
    backend.elimina(a.id, function (err) {
      occupato(false);
      if (err) return toast(err.message, true);
      chiudiModale();
      toast('Articolo eliminato');
      reload();
    });
  }

  function chiudiModale() {
    state.modal = null;
    $('modal').className = 'hidden';
    $('modal').innerHTML = '';
  }

  function occupato(b) { state.busy = b; }

  /* ---------- eventi ---------- */

  function actionEl(el) {
    while (el && el !== document) {
      if (el.getAttribute && el.getAttribute('data-action')) return el;
      el = el.parentNode;
    }
    return null;
  }

  document.addEventListener('click', function (e) {
    // tocco sullo sfondo scuro della modale = chiudi
    if (e.target === $('modal')) return chiudiModale();
    var el = actionEl(e.target);
    if (!el) return;
    var act = el.getAttribute('data-action');
    if (state.busy && act !== 'chiudi') return;

    switch (act) {
      case 'tab':
        state.tab = el.getAttribute('data-tab');
        render();
        window.scrollTo(0, 0);
        break;
      case 'filtro':
        state.filtroCat = el.getAttribute('data-cat');
        render();
        break;
      case 'sotto':
        state.soloSotto = !state.soloSotto;
        render();
        break;
      case 'nuovo': apriArticolo(null); break;
      case 'modifica': apriArticolo(el.getAttribute('data-id')); break;
      case 'mov': apriMovimento(el.getAttribute('data-id'), el.getAttribute('data-tipo')); break;
      case 'key': tasto(el.getAttribute('data-k')); break;
      case 'add': aggiungi(Number(el.getAttribute('data-n'))); break;
      case 'tutto':
        state.modal.valore = fmt(trovaArticolo(state.modal.id).quantita);
        aggiornaDisplay();
        break;
      case 'conferma-mov': confermaMovimento(); break;
      case 'scegli': scegli(el); break;
      case 'salva-art': salvaArticolo(); break;
      case 'elimina': eliminaArticolo(); break;
      case 'chiudi': chiudiModale(); break;
      case 'riprova': start(); break;
    }
  }, false);

  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'cerca') {
      state.cerca = e.target.value;
      renderGriglia();
    }
  }, false);

  // Ricarica i dati quando l'app torna in primo piano (es. modifiche da un altro dispositivo)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && backend && !state.modal) reload();
  }, false);

  start();
})();

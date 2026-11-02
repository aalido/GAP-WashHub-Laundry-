/* ==========================================================
   GAP WashHub Laundry POS — application logic
   Plain JavaScript. Data is stored online in Google Firebase
   (Cloud Firestore), so every logged-in device sees the same
   orders in real time. Firestore also keeps a copy on the
   device, so the app keeps working offline and syncs later.
   ========================================================== */
(function () {
  'use strict';

  /* ---------------- Business configuration ---------------- */
  const BUSINESS = {
    name: 'GAP WashHub Laundry',
    address: 'Lot 3 Blk 14E Phase 3C Tamban St. Kaunlaran Village, Caloocan City'
  };
  const TZ = 'Asia/Manila';

  // cat: main | pkg | add  (used for grouping on the POS screen)
  const SERVICES = [
    { id: 'wash',       name: 'Wash',                       price: 65,  cat: 'main' },
    { id: 'wash-dry',   name: 'Wash & Dry',                 price: 130, cat: 'main' },
    { id: 'dry',        name: 'Dry',                        price: 80,  cat: 'main' },
    { id: 'dry-fold',   name: 'Dry & Fold',                 price: 100, cat: 'main' },
    { id: 'wdf',        name: 'Wash, Dry, & Fold',          price: 150, cat: 'main' },
    { id: 'spin-dry',   name: 'Spin & Dry',                 price: 100, cat: 'main' },
    { id: 'pkg-a',      name: 'Package A',                  price: 180, cat: 'pkg' },
    { id: 'pkg-b',      name: 'Package B',                  price: 200, cat: 'pkg' },
    { id: 'pkg-c',      name: 'Package C',                  price: 220, cat: 'pkg' },
    { id: 'free-pkg-a', name: 'Free (Package A)',           price: 0,   cat: 'pkg', free: true },
    { id: 'detergent',  name: 'Addt Detergent',             price: 15,  cat: 'add' },
    { id: 'fabcon',     name: 'Addt Fabcon',                price: 15,  cat: 'add' },
    { id: 'over8-wd',   name: 'Over 8 Kilos (Wash & Dry)',  price: 40,  cat: 'add' },
    { id: 'over8-w',    name: 'Over 8 Kilos (Wash or Dry)', price: 20,  cat: 'add' },
    { id: 'plastic',    name: 'Blue Plastic',               price: 12,  cat: 'add' }
  ];
  const CATEGORIES = [
    { id: 'main', title: 'Laundry Services' },
    { id: 'pkg',  title: 'Packages' },
    { id: 'add',  title: 'Add-ons & Extras' }
  ];

  // Loyalty card: 1 tick per Package A, B or C. Every 7th tick earns 1 free Package A (ticks 7 and 14 on a 14-tick card).
  const LOYALTY = { ticksPerFree: 7, cardSize: 14, freeId: 'free-pkg-a' };
  // Only these packages earn loyalty ticks (1 tick each). Regular laundry services, add-ons and the free package do not.
  const TICK_SERVICES = ['pkg-a', 'pkg-b', 'pkg-c'];

  const DB_KEY = 'gapwashhub_pos_db_v1';
  const DRAFT_KEY = 'gapwashhub_pos_draft_v1';

  /* ---------------- Helpers ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // All money math is done in centavos (integers) to avoid floating point errors.
  const toC = (n) => Math.round(Number(n) * 100);
  const fromC = (c) => c / 100;
  const peso = (n) => {
    const v = Number(n) || 0;
    return (v < 0 ? '-₱' : '₱') + Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  // Sum of expense (negative) lines of an order, as a positive number
  const expenseOf = (o) => fromC(-(o.items || []).reduce((c, i) => c + Math.min(0, toC(i.subtotal)), 0));

  const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('en-PH', {
    timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
  }) : '—';
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
  const fmtLongDate = (d) => new Date(d).toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  // YYYY-MM-DD in Philippine time
  const dateKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  const todayKey = () => dateKey(new Date());
  const keyToLabel = (k) => fmtLongDate(k + 'T12:00:00+08:00');

  /* ---------------- Firebase (shared online storage) ---------------- */
  // From Firebase console → Project settings → Your apps → Web app. These values are not secret:
  // the database is protected by login + the Firestore security rules.
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyB_JaYjEdrUmvplformJNA1PxmVD28ej4E',
    authDomain: 'gap-washhub-laundry.firebaseapp.com',
    projectId: 'gap-washhub-laundry',
    storageBucket: 'gap-washhub-laundry.firebasestorage.app',
    messagingSenderId: '485829846462',
    appId: '1:485829846462:web:31035ba06522753d5b45ef'
  };
  const SETTINGS_KEY = 'gapwashhub_pos_settings_v1'; // paper size etc. stay per device

  // Owner logins (lowercase). The owner sees everything. Every other login is STAFF and cannot see
  // Sales Summary or today's sales, and cannot import, export, edit saved orders, delete orders or delete loyalty cards.
  const OWNER_EMAILS = [
    'alidoalbert8@gmail.com',
    'leaalido16@gmail.com',
    'aaronalido@gmail.com',
    'alidoaaliyah7@gmail.com'
  ];
  const isOwner = () => !!(cloud.user && cloud.user.email && OWNER_EMAILS.includes(cloud.user.email.toLowerCase()));
  function ownerOnly() {
    if (isOwner()) return true;
    toast('Only the owner can do this.');
    return false;
  }
  function applyRole() {
    const staff = !isOwner();
    document.body.classList.toggle('role-staff', staff);
    if (staff && (currentView === 'sales' || currentView === 'activity')) showView('dashboard');
  }

  /* ---------------- Storage ---------------- */
  function emptyDB() { return { version: 1, orders: [], seq: {}, loyaltyAdjust: [], loyaltyDeleted: [], settings: { paper: '80' } }; }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function loadSettings() {
    try { return { paper: '80', ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}) }; } catch (e) { return { paper: '80' }; }
  }

  // `db` is the in-memory copy of the shared data. The Firestore listeners keep it up to date.
  let db = emptyDB();
  db.settings = loadSettings();
  function loadDB() { return db; }

  // Every change: apply to the in-memory copy, send the differences to Firestore, re-render.
  function mutate(fn) {
    const before = clone(db);
    const result = fn(db);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(db.settings)); } catch (e) { /* ignore */ }
    cloud.push(before, db);
    renderAll();
    return result;
  }

  /*
   Firestore layout (designed to keep the free-plan read count low):
     days/{YYYY-MM-DD}  → { orders: { "<orderId>|<token>": order, ... } }   one document per day
     pos/meta           → { loyaltyAdjust: [], loyaltyDeleted: [], seq: { "YYYY-MM-DD": n } }
     counters/{YYYY-MM-DD} → { n }   hands out unique order numbers across devices
  */
  const cloud = {
    fs: null, auth: null, user: null,
    days: new Map(), meta: null,
    ready: { days: false, meta: false },
    pending: 0, fromCache: true, unsub: [], started: false,

    dayOf(o) {
      const m = /^GAP-(\d{2})(\d{2})(\d{2})-/.exec(o.id || '');
      return m ? `20${m[1]}-${m[2]}-${m[3]}` : dateKey(o.createdAt || Date.now());
    },
    // Map key of an order inside its day document. Includes the checkout token so two orders that
    // accidentally got the same number (two devices offline at once) are both kept.
    keyOf(o) { return String(o.id) + '|' + String(o.checkoutToken || ''); },

    // Rebuild the in-memory db from the Firestore documents
    rebuild() {
      const orders = [];
      this.days.forEach((d) => { Object.values((d && d.orders) || {}).forEach((o) => { if (o && o.id) orders.push(o); }); });
      orders.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
      const m = this.meta || {};
      db = { ...emptyDB(), orders,
        seq: { ...(m.seq || {}) },
        loyaltyAdjust: Array.isArray(m.loyaltyAdjust) ? m.loyaltyAdjust : [],
        loyaltyDeleted: Array.isArray(m.loyaltyDeleted) ? m.loyaltyDeleted : [],
        settings: db.settings };
      if (this.ready.days && this.ready.meta) {
        hideAuthScreen();
        renderAll();
        if (!this.fromCache) offerLocalUpload();
      }
      renderSyncStatus();
    },

    // Firestore writes are limited to 500 per batch
    async commit(ops) {
      const F = firebase.firestore;
      for (let i = 0; i < ops.length; i += 400) {
        const batch = this.fs.batch();
        ops.slice(i, i + 400).forEach((op) => {
          if (op.t === 'set') batch.set(op.ref, op.data, op.opt || {});
          else if (op.t === 'update') batch.update(op.ref, new F.FieldPath(...op.path), op.value);
          else if (op.t === 'delete') batch.delete(op.ref);
        });
        this.pending += 1; renderSyncStatus();
        try { await batch.commit(); }
        finally { this.pending -= 1; renderSyncStatus(); }
      }
    },

    // Send what changed between two versions of the db
    push(before, after) {
      if (!this.fs) return;
      const F = firebase.firestore;
      const ops = [];
      const touched = new Set();
      const dayRef = (k) => {
        const ref = this.fs.collection('days').doc(k);
        if (!touched.has(k)) { touched.add(k); ops.push({ t: 'set', ref, data: {}, opt: { merge: true } }); }
        return ref;
      };
      const bMap = new Map(before.orders.map((o) => [this.keyOf(o), o]));
      const aMap = new Map(after.orders.map((o) => [this.keyOf(o), o]));
      aMap.forEach((o, k) => {
        const b = bMap.get(k);
        const clean = clone(o);
        if (b && JSON.stringify(b) === JSON.stringify(clean)) return;
        ops.push({ t: 'update', ref: dayRef(this.dayOf(o)), path: ['orders', k], value: clean });
      });
      bMap.forEach((o, k) => {
        if (aMap.has(k)) return;
        ops.push({ t: 'update', ref: dayRef(this.dayOf(o)), path: ['orders', k], value: F.FieldValue.delete() });
      });
      const metaRef = this.fs.collection('pos').doc('meta');
      const metaData = {};
      if (JSON.stringify(before.loyaltyAdjust || []) !== JSON.stringify(after.loyaltyAdjust || [])) metaData.loyaltyAdjust = clone(after.loyaltyAdjust || []);
      if (JSON.stringify(before.loyaltyDeleted || []) !== JSON.stringify(after.loyaltyDeleted || [])) metaData.loyaltyDeleted = clone(after.loyaltyDeleted || []);
      const seq = {};
      Object.keys(after.seq || {}).forEach((k) => { if ((before.seq || {})[k] !== after.seq[k]) seq[k] = after.seq[k]; });
      if (Object.keys(seq).length) metaData.seq = seq;
      if (Object.keys(metaData).length) ops.push({ t: 'set', ref: metaRef, data: metaData, opt: { merge: true } });
      if (!ops.length) return;
      // Activity log: who changed what, saved together with the change
      const entries = describeChanges(before, after, this.keyOf.bind(this));
      if (entries.length) ops.push(this.logOp(entries));
      this.commit(ops).catch((e) => cloudError(e));
    },

    // One log document per day: logs/{YYYY-MM-DD} → { entries: [...] }
    logOp(entries) {
      const by = (this.user && this.user.email) || '';
      const at = new Date().toISOString();
      const list = entries.map((e) => ({ at, by, action: e.action, order: e.order || '', details: e.details || '',
        id: Math.random().toString(36).slice(2, 10) }));
      return { t: 'set', ref: this.fs.collection('logs').doc(dateKey(at)),
        data: { entries: firebase.firestore.FieldValue.arrayUnion(...list) }, opt: { merge: true } };
    },

    // Activity Log page: listen to one day's log
    logDay: null, logEntries: [], logUnsub: null,
    watchLog(day) {
      if (this.logDay === day && this.logUnsub) return;
      if (this.logUnsub) { this.logUnsub(); this.logUnsub = null; }
      this.logDay = day; this.logEntries = [];
      if (!this.fs || !this.user) return;
      this.logUnsub = this.fs.collection('logs').doc(day).onSnapshot((d) => {
        this.logEntries = (d.exists && Array.isArray(d.data().entries)) ? d.data().entries : [];
        if (currentView === 'activity') renderActivity();
      }, (e) => { console.error(e); this.logEntries = []; if (currentView === 'activity') renderActivity(); });
    },

    // Replace ALL shared data (used by Import). Deletes every day document, then writes the new ones.
    async replaceAll(data) {
      const ops = [];
      const snap = await this.fs.collection('days').get();
      snap.forEach((d) => ops.push({ t: 'delete', ref: d.ref }));
      const byDay = new Map();
      (data.orders || []).forEach((o) => {
        const k = this.dayOf(o);
        if (!byDay.has(k)) byDay.set(k, {});
        byDay.get(k)[this.keyOf(o)] = clone(o);
      });
      byDay.forEach((orders, k) => ops.push({ t: 'set', ref: this.fs.collection('days').doc(k), data: { orders } }));
      ops.push({ t: 'set', ref: this.fs.collection('pos').doc('meta'), data: {
        loyaltyAdjust: clone(data.loyaltyAdjust || []), loyaltyDeleted: clone(data.loyaltyDeleted || []), seq: clone(data.seq || {}) } });
      ops.push(this.logOp([{ action: 'Imported from Excel', details: `Replaced all data with ${(data.orders || []).length} order(s)` }]));
      // Deletes must land before the new documents for the same day, so commit in order
      await this.commit(ops);
    },

    // Ask the server for the next order number of the day, so two devices never use the same one.
    // Returns null when offline or slow; the app then numbers the order on this device.
    async reserveOrderId(nowIso) {
      if (!this.fs || !navigator.onLine) return null;
      const k = dateKey(nowIso);
      const prefix = 'GAP-' + k.replace(/-/g, '').slice(2) + '-';
      let localMax = db.seq[k] || 0;
      db.orders.forEach((o) => { if (String(o.id).startsWith(prefix)) localMax = Math.max(localMax, parseInt(o.id.slice(prefix.length), 10) || 0); });
      const ref = this.fs.collection('counters').doc(k);
      const tx = this.fs.runTransaction(async (t) => {
        const s = await t.get(ref);
        const n = Math.max((s.exists && s.data().n) || 0, localMax) + 1;
        t.set(ref, { n });
        return n;
      });
      const n = await Promise.race([tx, new Promise((r) => setTimeout(() => r(null), 3000))]).catch(() => null);
      return n ? prefix + String(n).padStart(3, '0') : null;
    },

    listen() {
      this.stop();
      this.ready = { days: false, meta: false };
      this.days = new Map(); this.meta = null;
      this.unsub.push(this.fs.collection('days').onSnapshot({ includeMetadataChanges: true }, (snap) => {
        snap.docChanges().forEach((ch) => {
          if (ch.type === 'removed') this.days.delete(ch.doc.id);
          else this.days.set(ch.doc.id, ch.doc.data());
        });
        this.fromCache = snap.metadata.fromCache;
        this.ready.days = true;
        this.rebuild();
      }, (e) => cloudError(e)));
      this.unsub.push(this.fs.collection('pos').doc('meta').onSnapshot((d) => {
        this.meta = d.exists ? d.data() : {};
        this.ready.meta = true;
        this.rebuild();
      }, (e) => cloudError(e)));
    },
    stop() {
      this.unsub.forEach((u) => { try { u(); } catch (e) { /* ignore */ } }); this.unsub = [];
      if (this.logUnsub) { this.logUnsub(); this.logUnsub = null; this.logDay = null; }
    }
  };

  /* ---------------- Activity log ---------------- */
  const itemsText = (o) => (o.items || []).map((i) => `${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ') || '—';
  const payText = (p) => p ? `${peso(p.amount)} ${p.method}${p.ref ? ' (ref ' + p.ref + ')' : ''}` : '';

  // Compare two versions of the data and describe each change in plain words
  function describeChanges(before, after, keyOf) {
    const out = [];
    const bMap = new Map(before.orders.map((o) => [keyOf(o), o]));
    const aMap = new Map(after.orders.map((o) => [keyOf(o), o]));
    aMap.forEach((o, k) => {
      const b = bMap.get(k);
      const name = (o.customer && o.customer.name) || '';
      if (!b) {
        const p = (o.payments || [])[0];
        const kind = toC(o.total) < 0 ? 'New expense' : 'New order';
        out.push({ action: kind, order: o.id, details: `${name} · ${itemsText(o)} · Total ${peso(o.total)} · ${o.paymentStatus}${p ? ' · Received ' + payText(p) : ''}` });
        return;
      }
      if (JSON.stringify(b) === JSON.stringify(o)) return;
      const edits = [];
      const bn = (b.customer && b.customer.name) || '', bc = (b.customer && b.customer.contact) || '', oc = (o.customer && o.customer.contact) || '';
      if (bn !== name) edits.push(`Name: ${bn} → ${name}`);
      if (bc !== oc) edits.push(`Contact: ${bc || '—'} → ${oc || '—'}`);
      if (itemsText(b) !== itemsText(o)) edits.push(`Services: ${itemsText(b)} → ${itemsText(o)}`);
      if (toC(b.total) !== toC(o.total)) edits.push(`Total: ${peso(b.total)} → ${peso(o.total)}`);
      if (b.createdAt !== o.createdAt && b.createdAt && o.createdAt && b.createdAt.slice(0, 16) !== o.createdAt.slice(0, 16)) edits.push(`Date: ${fmtDT(b.createdAt)} → ${fmtDT(o.createdAt)}`);
      if ((b.notes || '') !== (o.notes || '')) edits.push(`Notes: "${b.notes || ''}" → "${o.notes || ''}"`);
      if ((b.loyaltyTicks || 0) !== (o.loyaltyTicks || 0)) edits.push(`Loyalty ticks: ${b.loyaltyTicks || 0} → ${o.loyaltyTicks || 0}`);
      if (edits.length) {
        if (b.paymentStatus !== o.paymentStatus || toC(b.amountPaid) !== toC(o.amountPaid)) edits.push(`Payment: ${b.paymentStatus} ${peso(b.amountPaid)} → ${o.paymentStatus} ${peso(o.amountPaid)}`);
        out.push({ action: 'Edited order', order: o.id, details: `${name} · ` + edits.join(' · ') });
        return;
      }
      const newPays = (o.payments || []).slice((b.payments || []).length);
      if (newPays.length) {
        const paid = b.paymentStatus !== 'PAID' && o.paymentStatus === 'PAID';
        out.push({ action: paid ? 'Marked as paid' : 'Partial payment', order: o.id,
          details: `${name} · Received ${newPays.map(payText).join(', ')}${paid ? '' : ' · Balance ' + peso(o.balance)}` });
      } else if (b.paymentStatus !== o.paymentStatus || toC(b.amountPaid) !== toC(o.amountPaid)) {
        out.push({ action: 'Payment changed', order: o.id, details: `${name} · ${b.paymentStatus} ${peso(b.amountPaid)} → ${o.paymentStatus} ${peso(o.amountPaid)}` });
      }
      if (b.orderStatus !== o.orderStatus) {
        if (o.orderStatus === 'COMPLETED') {
          // Paying an unpaid order also marks it claimed; that is already in the "Marked as paid" line
          if (!(newPays.length && o.paymentStatus === 'PAID' && b.paymentStatus !== 'PAID')) {
            out.push({ action: o.paymentStatus === 'PAID' ? 'Marked as claimed' : 'Released without payment', order: o.id,
              details: `${name}${o.paymentStatus === 'PAID' ? '' : ' · Unpaid balance ' + peso(o.balance)}` });
          }
        } else {
          out.push({ action: 'Undo claim', order: o.id, details: name });
        }
      }
    });
    bMap.forEach((o, k) => {
      if (aMap.has(k)) return;
      out.push({ action: 'Deleted order', order: o.id, details: `${(o.customer && o.customer.name) || ''} · ${itemsText(o)} · Total ${peso(o.total)} · ${o.paymentStatus}` });
    });
    (after.loyaltyAdjust || []).slice((before.loyaltyAdjust || []).length).forEach((a) => {
      out.push({ action: 'Loyalty ticks', details: `${a.name}${a.contact ? ' (' + a.contact + ')' : ''}: ${a.ticks >= 0 ? '+' : ''}${a.ticks} tick(s)${a.freeUsed ? ', ' + a.freeUsed + ' free used' : ''}${a.note ? ' · ' + a.note : ''}` });
    });
    (after.loyaltyDeleted || []).slice((before.loyaltyDeleted || []).length).forEach((x) => {
      out.push({ action: 'Deleted loyalty card', details: `${x.name}${x.contact ? ' (' + x.contact + ')' : ''}` });
    });
    return out;
  }

  const ACTION_CLASS = { 'New order': 'a-new', 'New expense': 'a-new', 'Marked as paid': 'a-pay', 'Partial payment': 'a-pay',
    'Payment changed': 'a-warn', 'Marked as claimed': 'a-claim', 'Released without payment': 'a-warn', 'Undo claim': 'a-warn',
    'Edited order': 'a-warn', 'Deleted order': 'a-del', 'Deleted loyalty card': 'a-del', 'Loyalty ticks': 'a-claim', 'Imported from Excel': 'a-del' };

  function renderActivity() {
    if (!isOwner()) return;
    const day = $('#log-date').value || todayKey();
    if (!$('#log-date').value) $('#log-date').value = day;
    cloud.watchLog(day);
    const people = Array.from(new Set(cloud.logEntries.map((e) => e.by))).sort();
    const sel = $('#log-person');
    const keep = sel.value;
    sel.innerHTML = '<option value="">Everyone</option><option value="__staff">Staff only</option>' +
      people.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
    const who = sel.value;
    const q = $('#log-search').value.trim().toLowerCase();
    const isOwnerEmail = (e) => OWNER_EMAILS.includes(String(e || '').toLowerCase());
    const list = cloud.logEntries.filter((e) =>
      (!who || (who === '__staff' ? !isOwnerEmail(e.by) : e.by === who)) &&
      (!q || [e.by, e.action, e.order, e.details].join(' ').toLowerCase().includes(q))
    ).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const rows = list.map((e) => `<tr>
        <td class="nowrap">${esc(fmtTime(e.at))}</td>
        <td>${esc(e.by)}<br><span class="role-tag ${isOwnerEmail(e.by) ? 'r-owner' : 'r-staff'}">${isOwnerEmail(e.by) ? 'Owner' : 'Staff'}</span></td>
        <td><span class="act-tag ${ACTION_CLASS[e.action] || ''}">${esc(e.action)}</span></td>
        <td>${e.order ? (findOrder(e.order) ? `<button class="link-btn" data-act="receipt" data-id="${esc(e.order)}">${esc(e.order)}</button>` : esc(e.order)) : '—'}</td>
        <td>${esc(e.details)}</td>
      </tr>`).join('');
    $('#log-table').innerHTML = list.length
      ? `<div class="muted small" style="margin-bottom:8px">${list.length} action(s) on ${esc(keyToLabel(day))}</div>
         <div class="table-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Person</th><th>Action</th><th>Order</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty">No activity recorded on ${esc(keyToLabel(day))}.</div>`;
  }

  // Orders saved by the older, offline-only version of the app on this device (same website address)
  let localUploadOffered = false;
  async function offerLocalUpload() {
    if (localUploadOffered) return;
    localUploadOffered = true;
    let old = null;
    try { old = JSON.parse(localStorage.getItem(DB_KEY)); } catch (e) { return; }
    if (!old || !Array.isArray(old.orders) || !old.orders.length) return;
    const have = new Set(db.orders.map((o) => o.id));
    const missing = old.orders.filter((o) => o && o.id && !have.has(o.id));
    if (!missing.length) { localStorage.removeItem(DB_KEY); return; }
    const ok = await ask(`This device has ${missing.length} order(s) saved by the older offline version of the app.\n\nUpload them to the online database so all devices can see them?`, 'Upload', 'primary');
    if (!ok) return;
    mutate((d) => {
      d.orders.push(...missing);
      const keys = (a) => new Set((a || []).map((x) => JSON.stringify(x)));
      const ka = keys(d.loyaltyAdjust); (old.loyaltyAdjust || []).forEach((x) => { if (!ka.has(JSON.stringify(x))) d.loyaltyAdjust.push(x); });
      const kd = keys(d.loyaltyDeleted); (old.loyaltyDeleted || []).forEach((x) => { if (!kd.has(JSON.stringify(x))) d.loyaltyDeleted.push(x); });
      Object.entries(old.seq || {}).forEach(([k, v]) => { d.seq[k] = Math.max(d.seq[k] || 0, v || 0); });
    });
    try { localStorage.setItem(DB_KEY + '_uploaded', localStorage.getItem(DB_KEY)); localStorage.removeItem(DB_KEY); } catch (e) { /* ignore */ }
    toast(`Uploaded ${missing.length} order(s).`);
  }

  function cloudError(e) {
    console.error(e);
    const code = (e && e.code) || '';
    if (code === 'permission-denied') {
      alert('The database refused this request (permission denied).\n\nCheck that you are signed in, and that the Firestore Rules allow signed-in users.');
    } else {
      alert('Could not save to the online database.\n\n' + ((e && e.message) || e) + '\n\nYour last change may not have been saved. Please check your internet and try again.');
    }
  }

  function renderSyncStatus() {
    const el = $('#sync-status');
    if (!el) return;
    const online = navigator.onLine;
    let cls = 'ok'; let txt = '● Online · saved';
    if (!online) { cls = 'off'; txt = '● Offline · will sync later'; }
    else if (cloud.pending > 0) { cls = 'busy'; txt = '● Saving…'; }
    else if (cloud.fromCache) { cls = 'busy'; txt = '● Connecting…'; }
    el.className = 'sync-status ' + cls;
    el.textContent = txt;
    const who = $('#signed-in-as');
    if (who) who.textContent = cloud.user ? cloud.user.email + (isOwner() ? ' · Owner' : ' · Staff') : '';
  }

  /* ---------------- Login screen ---------------- */
  function showAuthScreen(mode) {
    const s = $('#auth-screen');
    s.hidden = false;
    $('#auth-form').hidden = mode !== 'login';
    $('#auth-loading').hidden = mode !== 'loading';
    if (mode === 'login') setTimeout(() => $('#auth-email').focus(), 50);
  }
  function hideAuthScreen() { $('#auth-screen').hidden = true; }

  function authMessage(e) {
    const c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-email|invalid-login/.test(c)) return 'Wrong email or password.';
    if (/too-many-requests/.test(c)) return 'Too many tries. Wait a few minutes, then try again.';
    if (/network-request-failed/.test(c)) return 'No internet connection. Connect and try again.';
    if (/unauthorized-domain/.test(c)) return 'This website address is not allowed yet. In Firebase: Authentication → Settings → Authorized domains → add this site.';
    return (e && e.message) || 'Could not sign in.';
  }

  function startCloud() {
    if (typeof firebase === 'undefined') {
      showAuthScreen('login');
      $('#auth-error').textContent = 'Could not load Firebase. Check your internet connection, then reload the page.';
      $('#auth-submit').disabled = true;
      return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    cloud.auth = firebase.auth();
    cloud.fs = firebase.firestore();
    // Keep a copy on this device so the app opens fast and works offline
    cloud.fs.enablePersistence({ synchronizeTabs: true }).catch(() => { /* not supported: still works online */ });

    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#auth-submit');
      $('#auth-error').textContent = '';
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        await cloud.auth.signInWithEmailAndPassword($('#auth-email').value.trim(), $('#auth-password').value);
        $('#auth-password').value = '';
      } catch (err) {
        $('#auth-error').textContent = authMessage(err);
      } finally {
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    });
    $('#btn-signout').addEventListener('click', async () => {
      if (!(await ask('Sign out of this device?\n\nYou will need the email and password to sign in again.', 'Sign out', 'danger'))) return;
      cloud.stop();
      await cloud.auth.signOut();
    });

    cloud.auth.onAuthStateChanged((user) => {
      cloud.user = user;
      applyRole();
      if (user) {
        showAuthScreen('loading');
        cloud.listen();
      } else {
        cloud.stop();
        db = { ...emptyDB(), settings: db.settings };
        renderAll();
        showAuthScreen('login');
      }
      renderSyncStatus();
    });
    window.addEventListener('online', renderSyncStatus);
    window.addEventListener('offline', renderSyncStatus);
  }

  function findOrder(id) { return db.orders.find((o) => o.id === id); }

  // Order No. format: GAP-YYMMDD-001 (resets daily, always unique)
  function nextOrderId(d, nowIso) {
    const k = dateKey(nowIso);
    let n = d.seq[k] || 0;
    let id;
    do {
      n += 1;
      id = 'GAP-' + k.replace(/-/g, '').slice(2) + '-' + String(n).padStart(3, '0');
    } while (d.orders.some((o) => o.id === id));
    d.seq[k] = n;
    return id;
  }

  function useReservedId(d, id) {
    const m = /^GAP-(\d{2})(\d{2})(\d{2})-(\d+)$/.exec(id);
    if (m) { const k = `20${m[1]}-${m[2]}-${m[3]}`; d.seq[k] = Math.max(d.seq[k] || 0, parseInt(m[4], 10)); }
    return id;
  }

  /* ---------------- Cart (draft order) ---------------- */
  const newToken = () => 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // when: null = use the current time automatically; otherwise a "YYYY-MM-DDTHH:mm" (Manila time) chosen by the teller
  // ticks: null = count loyalty ticks automatically from the services; a number = set by the teller
  // editId: the order being edited (null for a new order)
  function emptyCart() { return { items: [], name: '', contact: '', notes: '', when: null, ticks: null, editId: null, token: newToken() }; }

  // Convert between a Date and the datetime-local input value, always in Philippine time
  function manilaLocal(d) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  const localToISO = (v) => new Date(v + ':00+08:00').toISOString();
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (d && Array.isArray(d.items) && d.token) return d;
    } catch (e) { /* ignore */ }
    return emptyCart();
  }
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cart)); } catch (e) { /* ignore */ } }

  let cart = loadDraft();
  const svc = (id) => SERVICES.find((s) => s.id === id);

  function cartLines() {
    return cart.items.map((it) => {
      // Custom services carry their own name and price; regular ones come from SERVICES
      // Custom items carry their own price; standard items being edited keep the price they were charged
      const base = it.custom ? null : svc(it.id);
      const s = it.custom ? { id: it.id, name: it.name, price: it.price }
        : base && (it.price != null ? { ...base, price: it.price } : base);
      if (!s) return null;
      const line = { id: s.id, name: s.name, price: s.price, qty: it.qty, subtotal: fromC(toC(s.price) * it.qty) };
      if (it.custom) line.custom = true;
      if (toC(s.price) < 0) line.expense = true;
      return line;
    }).filter(Boolean);
  }
  const cartTotal = () => fromC(cartLines().reduce((c, l) => c + toC(l.subtotal), 0));

  function addItem(id) {
    const it = cart.items.find((i) => i.id === id);
    if (it) it.qty += 1; else cart.items.push({ id, qty: 1 });
    saveDraft();
    renderCart();
    $('#order-error').textContent = '';
  }
  function addCustomItem() {
    const nameEl = $('#custom-name');
    const priceEl = $('#custom-price');
    const err = $('#custom-error');
    const name = nameEl.value.trim().replace(/\s+/g, ' ');
    const raw = priceEl.value.trim();
    const price = Number(raw);
    if (!name) { err.textContent = customType === 'expense' ? 'Please type what the expense is for.' : 'Please type the service name.'; nameEl.focus(); return; }
    if (raw === '' || !isFinite(price) || toC(price) === 0) { err.textContent = 'Please enter an amount (not ₱0).'; priceEl.focus(); return; }
    if (Math.abs(price) > 100000) { err.textContent = 'Amount is too large.'; priceEl.focus(); return; }
    // Expenses are always negative. Typing a negative amount also counts as an expense.
    const isExpense = customType === 'expense' || price < 0;
    const p = fromC(toC(isExpense ? -Math.abs(price) : price));
    // Same custom service + same price → just add to its quantity
    const same = cart.items.find((i) => i.custom && i.name.toLowerCase() === name.toLowerCase() && toC(i.price) === toC(p));
    if (same) same.qty += 1;
    else cart.items.push({ id: 'custom-' + Date.now().toString(36), custom: true, name, price: p, qty: 1 });
    err.textContent = '';
    nameEl.value = '';
    priceEl.value = '';
    setCustomType('service'); // back to normal after each add, to avoid accidental expenses
    saveDraft();
    renderCart();
    $('#order-error').textContent = '';
    nameEl.focus();
  }

  let customType = 'service';
  function setCustomType(v) {
    customType = v;
    $$('#custom-type button').forEach((b) => b.classList.toggle('on', b.dataset.val === v));
    $('.custom-svc').classList.toggle('is-expense', v === 'expense');
    $('#custom-name').placeholder = v === 'expense'
      ? 'Expense (e.g. Discount, Bought detergent)'
      : 'Service name (e.g. Comforter, Ironing)';
    $('#btn-add-custom').textContent = v === 'expense' ? '− Add Expense' : '+ Add';
  }

  function changeQty(id, delta) {
    const it = cart.items.find((i) => i.id === id);
    if (!it) return;
    it.qty += delta;
    if (it.qty <= 0) cart.items = cart.items.filter((i) => i.id !== id);
    saveDraft();
    renderCart();
  }
  function removeItem(id) {
    cart.items = cart.items.filter((i) => i.id !== id);
    saveDraft();
    renderCart();
  }

  /* ---------------- Validation ---------------- */
  function normalizeContact(v) { return String(v || '').replace(/[\s\-()]/g, ''); }

  function validateCustomer(name, contact) {
    if (!name) return 'Please enter the customer name.';
    if (name.length < 2) return 'Customer name is too short.';
    if (!contact) return ''; // contact number is optional
    if (/^(\+?63|0)9/.test(contact)) {
      if (!/^(09\d{9}|\+?639\d{9})$/.test(contact)) return 'Invalid mobile number. Use 11 digits, e.g. 09123456789.';
    } else if (!/^\d{7,10}$/.test(contact)) {
      return 'Invalid contact number. Use a mobile number (e.g. 09123456789) or landline.';
    }
    return '';
  }

  /* ---------------- Navigation ---------------- */
  const VIEWS = ['dashboard', 'new', 'paid', 'unpaid', 'completed', 'loyalty', 'sales', 'history', 'activity'];
  let currentView = 'dashboard';

  function showView(name) {
    if (!VIEWS.includes(name)) name = 'dashboard';
    if ((name === 'sales' || name === 'activity') && !isOwner()) name = 'dashboard';
    currentView = name;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (name === 'dashboard') renderDashboard();
    if (name === 'sales') renderSales();
    if (name === 'activity') renderActivity();
    if (name === 'new') setTimeout(() => { if (!$('#cust-name').value) $('#cust-name').focus(); }, 0);
    window.scrollTo(0, 0);
  }

  /* ---------------- UI helpers ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function openModal(sel) { $(sel).hidden = false; document.body.classList.add('modal-open'); }
  function closeModal(sel) {
    $(sel).hidden = true;
    if (!$$('.modal').some((m) => !m.hidden)) document.body.classList.remove('modal-open');
  }

  function ask(message, okText = 'Yes', okClass = 'primary') {
    return new Promise((resolve) => {
      $('#confirm-msg').textContent = message;
      const yes = $('#confirm-yes');
      const no = $('#confirm-no');
      yes.textContent = okText;
      yes.className = 'btn ' + okClass;
      const done = (v) => {
        yes.onclick = no.onclick = null;
        closeModal('#confirm-modal');
        resolve(v);
      };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
      openModal('#confirm-modal');
      yes.focus();
    });
  }

  const payBadge = (o) => o.paymentStatus === 'PAID'
    ? '<span class="badge b-paid">PAID</span>'
    : '<span class="badge b-unpaid">NOT PAID</span>';
  const statusBadge = (o) => toC(o.total) < 0
    ? '<span class="badge b-expense">EXPENSE</span>'
    : o.orderStatus === 'COMPLETED'
    ? '<span class="badge b-completed">COMPLETED / CLAIMED</span>'
    : '<span class="badge b-processing">PROCESSING</span>';
  const methodBadge = (m) => m === 'GCash' ? '<span class="badge b-gcash">GCash</span>'
    : m === 'Cash' ? '<span class="badge b-cash">Cash</span>' : '—';
  const lastPayment = (o) => (o.payments && o.payments.length ? o.payments[o.payments.length - 1] : null);
  const orderStatusText = (o) => o.orderStatus === 'COMPLETED' ? 'COMPLETED / CLAIMED' : 'PROCESSING (For pickup)';

  // Pick-up number = the daily counter at the end of the Order No. (GAP-261008-007 → "007"); restarts every day
  const pickupNo = (o) => { const m = /-(\d+)$/.exec(o.id); return m ? String(parseInt(m[1], 10)).padStart(3, '0') : ''; };
  const hasPickup = (o) => toC(o.total) >= 0 && !!pickupNo(o); // expense records get no pick-up number

  function matches(o, q) {
    if (!q) return true;
    q = q.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, '');
    // "7", "#7" or "007" finds pick-up number 007
    if (/^#?\d{1,4}$/.test(q) && hasPickup(o) && parseInt(qDigits, 10) === parseInt(pickupNo(o), 10)) return true;
    return o.id.toLowerCase().includes(q) ||
      o.customer.name.toLowerCase().includes(q) ||
      (qDigits.length >= 3 && normalizeContact(o.customer.contact).includes(qDigits));
  }

  /* ---------------- Loyalty card ---------------- */
  // Suggested ticks for an order = number of Package A, B and C in it
  function autoTicks(lines) {
    return lines.filter((l) => TICK_SERVICES.includes(l.id)).reduce((n, l) => n + l.qty, 0);
  }
  const cartTicks = () => (cart.ticks == null ? autoTicks(cartLines()) : cart.ticks);
  const freeUsedIn = (items) => (items || []).filter((i) => i.id === LOYALTY.freeId).reduce((n, i) => n + i.qty, 0);

  // One customer = same contact number, or same name when there is no contact number
  function custKey(name, contact) {
    const c = normalizeContact(contact).replace(/^\+?63(?=9)/, '0');
    return c ? 'c:' + c : 'n:' + String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function loyaltyStatus(ticks, used) {
    const t = Math.max(0, ticks);
    const earned = Math.floor(t / LOYALTY.ticksPerFree);
    const card = t === 0 ? 1 : Math.floor((t - 1) / LOYALTY.cardSize) + 1;
    return {
      earned,
      available: Math.max(0, earned - used),
      card,
      onCard: t - (card - 1) * LOYALTY.cardSize,             // ticks on the current card (0–14)
      toNext: LOYALTY.ticksPerFree - (t % LOYALTY.ticksPerFree) // ticks until the next free
    };
  }

  // All loyalty cards, built from saved orders + manual adjustments. upTo (ISO) limits to records up to that time.
  function loyaltyCustomers(upTo, excludeId) {
    const entries = [];
    db.orders.forEach((o) => {
      if (upTo && o.createdAt > upTo) return;
      if (excludeId && o.id === excludeId) return;
      const used = freeUsedIn(o.items);
      if (!o.loyaltyTicks && !used) return;
      entries.push({ name: o.customer.name, contact: o.customer.contact, ticks: o.loyaltyTicks || 0, used, at: o.createdAt });
    });
    (db.loyaltyAdjust || []).forEach((a) => {
      if (upTo && a.at > upTo) return;
      entries.push({ name: a.name, contact: a.contact, ticks: a.ticks || 0, used: a.freeUsed || 0, at: a.at });
    });
    // A name-only record joins the customer with a contact number when exactly one customer has that name
    const byName = new Map();
    entries.forEach((e) => {
      if (!normalizeContact(e.contact)) return;
      const n = custKey(e.name, '');
      if (!byName.has(n)) byName.set(n, new Set());
      byName.get(n).add(custKey(e.name, e.contact));
    });
    // Deleted cards: records for that customer up to the deletion time no longer count
    const deletedAt = new Map();
    (db.loyaltyDeleted || []).forEach((d) => {
      if (upTo && d.at > upTo) return;
      if (!deletedAt.has(d.key) || d.at > deletedAt.get(d.key)) deletedAt.set(d.key, d.at);
    });
    const map = new Map();
    entries.sort((a, b) => a.at.localeCompare(b.at)).forEach((e) => {
      let key = custKey(e.name, e.contact);
      if (key.startsWith('n:') && byName.has(key) && byName.get(key).size === 1) key = Array.from(byName.get(key))[0];
      if (deletedAt.has(key) && e.at <= deletedAt.get(key)) return;
      let c = map.get(key);
      if (!c) { c = { key, name: e.name, contact: e.contact || '', ticks: 0, used: 0, last: e.at }; map.set(key, c); }
      c.ticks += e.ticks;
      c.used += e.used;
      c.last = e.at;
      c.name = e.name;
      if (e.contact) c.contact = e.contact;
    });
    map.forEach((c) => Object.assign(c, loyaltyStatus(c.ticks, c.used)));
    return map;
  }

  function findLoyalty(name, contact, upTo, excludeId) {
    if (!String(name || '').trim() && !normalizeContact(contact)) return null;
    const map = loyaltyCustomers(upTo, excludeId);
    const key = custKey(name, contact);
    if (map.has(key)) return map.get(key);
    if (key.startsWith('c:')) {
      // contact not on file yet: fall back to a name-only card with the same name
      const n = custKey(name, '');
      if (map.has(n)) return map.get(n);
    } else {
      const same = Array.from(map.values()).filter((c) => custKey(c.name, '') === key);
      if (same.length === 1) return same[0];
    }
    return { key, name, contact, ticks: 0, used: 0, last: null, ...loyaltyStatus(0, 0) };
  }

  // 14 boxes; boxes 7 and 14 are the FREE ones. `adding` = ticks this order will add (shown highlighted)
  function cardBoxes(onCard, adding = 0) {
    let html = '<div class="lc-boxes">';
    for (let i = 1; i <= LOYALTY.cardSize; i++) {
      const free = i % LOYALTY.ticksPerFree === 0;
      const cls = i <= onCard ? 'on' : i <= onCard + adding ? 'new' : '';
      html += `<span class="lc-box ${cls}${free ? ' free' : ''}">${free ? 'FREE' : i}</span>`;
    }
    return html + '</div>';
  }

  function renderLoyaltyBox() {
    const ticks = cartTicks();
    $('#tick-count').textContent = ticks;
    $('#tick-mode').textContent = cart.ticks == null ? '(auto)' : '(edited)';
    const name = $('#cust-name').value.trim();
    const box = $('#loyalty-status');
    if (!name) { box.innerHTML = '<span class="muted">Enter the customer name to see their loyalty card.</span>'; return; }
    const c = findLoyalty(name, normalizeContact($('#cust-contact').value), null, cart.editId);
    const inCartFree = freeUsedIn(cart.items);
    const after = loyaltyStatus(c.ticks + ticks, c.used + inCartFree);
    const newFree = after.earned - c.earned;
    // If this order goes past the end of the card, show the new card
    const crosses = after.card > c.card;
    let html = `<div class="lb-line"><b>${c.ticks ? 'Card #' + c.card : 'New card'}</b> · ${c.onCard}/${LOYALTY.cardSize} ticks`;
    html += c.available ? ` · <span class="lb-free">${c.available} FREE Package A available</span>` : '';
    html += '</div>';
    html += crosses ? cardBoxes(after.onCard, 0) : cardBoxes(c.onCard, ticks);
    if (newFree > 0) html += `<div class="lb-earn">🎉 This order earns ${newFree} FREE Package A!</div>`;
    else if (ticks) html += `<div class="muted small">After this order: ${after.toNext} more tick(s) to the next free.</div>`;
    if (c.available && !inCartFree) html += '<div class="lb-hint">Customer can use a free: tap <b>Free (Package A)</b>.</div>';
    box.innerHTML = html;
  }

  /* ---------------- Rendering: services & cart ---------------- */
  function renderServices() {
    $('#service-groups').innerHTML = CATEGORIES.map((c) => `
      <div class="svc-group">
        <div class="svc-group-title">${esc(c.title)}</div>
        <div class="svc-grid">
          ${SERVICES.filter((s) => s.cat === c.id).map((s) => `
            <button type="button" class="svc cat-${s.cat}${s.free ? ' svc-free' : ''}" data-add="${s.id}">
              <span class="svc-name">${esc(s.name)}</span>
              <span class="svc-price">${s.free ? '★ FREE · Loyalty' : peso(s.price)}</span>
              <span class="svc-qty" data-qty-for="${s.id}" hidden></span>
            </button>`).join('')}
        </div>
      </div>`).join('');
  }

  function renderCart() {
    const lines = cartLines();
    $('#cart').innerHTML = lines.length ? lines.map((l) => `
      <div class="cart-item${l.expense ? ' is-expense' : ''}">
        <div>
          <div class="ci-name">${esc(l.name)}${l.expense ? ' <span class="custom-tag expense-tag">expense</span>' : l.custom ? ' <span class="custom-tag">custom</span>' : ''}</div>
          <div class="ci-price">${peso(l.price)} each</div>
        </div>
        <div class="qty">
          <button type="button" data-dec="${l.id}" aria-label="Decrease quantity">−</button>
          <span>${l.qty}</span>
          <button type="button" data-inc="${l.id}" aria-label="Increase quantity">+</button>
        </div>
        <div class="ci-right">
          <div class="ci-sub">${peso(l.subtotal)}</div>
          <button type="button" class="ci-remove" data-remove="${l.id}">Remove</button>
        </div>
      </div>`).join('')
      : '<div class="cart-empty">No services added yet.<br>Tap a service on the left to add it.</div>';
    $('#cart-total').textContent = peso(cartTotal());
    // badges on service cards
    $$('.svc').forEach((b) => {
      const it = cart.items.find((i) => i.id === b.dataset.add);
      b.classList.toggle('in-cart', !!it);
      const q = b.querySelector('.svc-qty');
      q.hidden = !it;
      q.textContent = it ? it.qty : '';
    });
    renderLoyaltyBox();
    $('#edit-banner').hidden = !cart.editId;
    $('#edit-banner-id').textContent = cart.editId || '';
    $('#btn-checkout').textContent = cart.editId ? 'SAVE CHANGES' : 'CHECKOUT';
  }

  // Load a saved order into the order form so it can be changed
  let editReturnView = null;
  async function startEdit(id) {
    if (!ownerOnly()) return;
    db = loadDB();
    const o = findOrder(id);
    if (!o) return;
    if (cart.editId !== id && (cart.items.length || $('#cust-name').value.trim())) {
      const what = cart.editId ? 'the changes to ' + cart.editId : 'the order you are typing';
      if (!(await ask(`Discard ${what} and edit ${o.id} instead?`, 'Yes, edit ' + o.id, 'danger'))) return;
    }
    editReturnView = currentView === 'new' ? null : currentView;
    cart = {
      items: o.items.map((i) => (i.custom ? { id: i.id, custom: true, name: i.name, price: i.price, qty: i.qty }
        : { id: i.id, price: i.price, qty: i.qty })),
      name: o.customer.name,
      contact: o.customer.contact || '',
      notes: o.notes || '',
      when: manilaLocal(o.createdAt),
      ticks: o.loyaltyTicks || 0,
      editId: o.id,
      token: newToken()
    };
    saveDraft();
    syncCartInputs();
    renderCart();
    $('#order-error').textContent = '';
    showView('new');
    toast('Editing ' + o.id + '. Change anything, then tap SAVE CHANGES.');
  }

  async function cancelEdit() {
    if (!(await ask('Cancel editing ' + cart.editId + '? No changes will be saved.', 'Cancel edit', 'danger'))) return;
    cart = emptyCart();
    saveDraft();
    syncCartInputs();
    renderCart();
    if (editReturnView) showView(editReturnView);
    editReturnView = null;
  }

  // Free (Package A): check the customer actually has a free available
  async function addFreeItem() {
    const name = $('#cust-name').value.trim();
    if (!name) {
      $('#order-error').textContent = 'Enter the customer name first, so the free can be checked on their loyalty card.';
      $('#cust-name').focus();
      return;
    }
    const c = findLoyalty(name, normalizeContact($('#cust-contact').value), null, cart.editId);
    const left = c.available - freeUsedIn(cart.items);
    if (left <= 0) {
      const ok = await ask(`${name} has no FREE Package A available.\n\nLoyalty card: ${c.onCard}/${LOYALTY.cardSize} ticks, ${c.toNext} more tick(s) needed for the next free.\n\nAdd the free Package A anyway?`, 'Add anyway', 'danger');
      if (!ok) return;
    }
    addItem(LOYALTY.freeId);
  }

  function syncCartInputs() {
    $('#cust-name').value = cart.name || '';
    $('#cust-contact').value = cart.contact || '';
    $('#order-notes').value = cart.notes || '';
    syncDateField();
  }

  function syncDateField() {
    const el = $('#order-datetime');
    const edited = !!cart.when;
    if (edited) el.value = cart.when;
    else if (document.activeElement !== el) el.value = manilaLocal(new Date());
    el.max = manilaLocal(Date.now() + 60000);
    el.classList.toggle('edited', edited);
    $('#dt-mode').textContent = edited ? '(edited)' : '(auto)';
    $('#btn-dt-now').hidden = !edited;
  }

  function renderCustomerList() {
    const seen = new Map();
    db.orders.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach((o) => {
      const k = o.customer.name.toLowerCase();
      if (!seen.has(k)) seen.set(k, o.customer);
    });
    $('#cust-list').innerHTML = Array.from(seen.values()).slice(0, 300)
      .map((c) => `<option value="${esc(c.name)}">${esc(c.contact)}</option>`).join('');
  }

  /* ---------------- Rendering: order cards ---------------- */
  function itemsBlock(o) {
    return `<div class="ocard-items">${o.items.map((i) =>
      `<div><span>${esc(i.name)} × ${i.qty}</span><span>${peso(i.subtotal)}</span></div>`).join('')}</div>`;
  }

  function orderCard(o, kind) {
    const lp = lastPayment(o);
    let money = `<div class="ocard-kv total"><span>Total Amount</span><span>${peso(o.total)}</span></div>`;
    if (kind === 'unpaid') {
      money += `<div class="ocard-kv"><span>Amount Paid</span><span>${peso(o.amountPaid)}</span></div>
                <div class="ocard-kv balance"><span>Remaining Balance</span><span>${peso(o.balance)}</span></div>`;
    } else {
      money += `<div class="ocard-kv"><span>Payment Method</span><span>${lp ? methodBadge(lp.method) : '—'}</span></div>`;
      if (o.paymentStatus !== 'PAID') money += `<div class="ocard-kv balance"><span>Remaining Balance</span><span>${peso(o.balance)}</span></div>`;
    }

    let dates = `<div class="ocard-kv"><span>Date Ordered</span><span>${fmtDT(o.createdAt)}</span></div>`;
    if (o.paidAt) dates += `<div class="ocard-kv"><span>Date Paid</span><span>${fmtDT(o.paidAt)}</span></div>`;
    if (o.completedAt) dates += `<div class="ocard-kv"><span>Date Completed</span><span>${fmtDT(o.completedAt)}</span></div>`;

    let actions = '';
    if (kind === 'paid') {
      actions = `<button class="btn success big grow" data-act="complete" data-id="${o.id}">MARK AS COMPLETED / CLAIMED</button>`;
    } else if (kind === 'unpaid') {
      actions = `<button class="btn primary big grow" data-act="pay" data-id="${o.id}">MARK AS PAID</button>`;
      if (o.orderStatus !== 'COMPLETED') actions += `<button class="btn ghost small" data-act="claim-unpaid" data-id="${o.id}">Released without payment</button>`;
    } else if (kind === 'completed') {
      if (o.paymentStatus !== 'PAID') actions += `<button class="btn primary grow" data-act="pay" data-id="${o.id}">MARK AS PAID</button>`;
      if (toC(o.total) >= 0) actions += `<button class="btn ghost small" data-act="undo-claim" data-id="${o.id}">Undo claim</button>`;
    }
    actions += `<button class="btn ghost small" data-act="receipt" data-id="${o.id}">View receipt</button>`;
    actions += `<button class="btn ghost small" data-act="print" data-id="${o.id}">Print</button>`;
    actions += `<button class="btn ghost small danger-text" data-act="delete" data-id="${o.id}">Delete</button>`;

    return `
      <article class="ocard">
        <div class="ocard-head">
          <div>
            <div class="ocard-id">${hasPickup(o) ? `<span class="pickup-badge">#${pickupNo(o)}</span> ` : ''}${esc(o.id)}</div>
            <div class="ocard-cust">${esc(o.customer.name)}</div>
            <div class="ocard-contact">${esc(o.customer.contact) || 'No contact number'}</div>
          </div>
          <div class="ocard-badges">${payBadge(o)}${statusBadge(o)}</div>
        </div>
        <div class="ocard-body">
          ${dates}
          ${itemsBlock(o)}
          ${o.notes ? `<div class="ocard-notes"><b>Notes:</b> ${esc(o.notes)}</div>` : ''}
          ${money}
        </div>
        <div class="ocard-actions">${actions}</div>
      </article>`;
  }

  const searchState = { paid: '', unpaid: '', completed: '' };

  function renderList(kind) {
    let list;
    if (kind === 'paid') list = db.orders.filter((o) => o.paymentStatus === 'PAID' && o.orderStatus !== 'COMPLETED');
    if (kind === 'unpaid') list = db.orders.filter((o) => o.paymentStatus !== 'PAID');
    if (kind === 'completed') list = db.orders.filter((o) => o.orderStatus === 'COMPLETED');
    const total = list.length;
    list = list.filter((o) => matches(o, searchState[kind]));
    // Paid/unpaid: oldest first (serve in order). Completed: most recently completed first.
    if (kind === 'completed') list.sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
    else list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const emptyMsg = total === 0
      ? { paid: 'No paid orders waiting to be claimed.', unpaid: 'No unpaid orders. 🎉', completed: 'No completed orders yet.' }[kind]
      : 'No orders match your search.';
    $('#list-' + kind).innerHTML = list.length ? list.map((o) => orderCard(o, kind)).join('') : `<div class="list-empty">${emptyMsg}</div>`;
  }

  /* ---------------- Rendering: dashboard ---------------- */
  function salesForDay(k) {
    // total = NET sales (payments received minus expenses); gross = before expenses
    let total = 0, cash = 0, gcash = 0, expenses = 0;
    const rows = [];
    db.orders.forEach((o) => (o.payments || []).forEach((p, idx) => {
      if (dateKey(p.at) !== k) return;
      const c = toC(p.amount);
      total += c;
      // An order paid in parts counts its expense lines once, on the first payment
      if (idx === 0) expenses += toC(expenseOf(o));
      if (p.method === 'GCash') gcash += c; else cash += c;
      rows.push({ o, p });
    }));
    rows.sort((a, b) => b.p.at.localeCompare(a.p.at));
    return { total: fromC(total), gross: fromC(total + expenses), expenses: fromC(expenses), cash: fromC(cash), gcash: fromC(gcash), rows };
  }

  function stat(label, value, sub, cls = '') {
    return `<div class="stat ${cls}"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  }

  // An order belongs to every day it was ordered OR paid, so an unpaid order shows up again on the day it is paid
  const paidOn = (o, k) => (o.payments || []).some((p) => dateKey(p.at) === k);
  const activeOn = (o, k) => dateKey(o.createdAt) === k || paidOn(o, k);
  const lastActivity = (o) => { const lp = lastPayment(o); return lp && lp.at > o.createdAt ? lp.at : o.createdAt; };

  function renderDashboard() {
    const k = todayKey();
    const todays = db.orders.filter((o) => activeOn(o, k));
    const s = salesForDay(k);
    const unpaid = db.orders.filter((o) => o.paymentStatus !== 'PAID');
    const unpaidAmt = fromC(unpaid.reduce((c, o) => c + toC(o.balance), 0));
    const waiting = db.orders.filter((o) => o.paymentStatus === 'PAID' && o.orderStatus !== 'COMPLETED');
    const completed = db.orders.filter((o) => o.orderStatus === 'COMPLETED');
    const completedToday = completed.filter((o) => o.completedAt && dateKey(o.completedAt) === k);

    $('#dash-date').textContent = fmtLongDate(new Date());
    $('#dash-stats').innerHTML =
      stat('Total Transactions Today', todays.length, 'Ordered or paid today', '') +
      (isOwner() ? stat('Total Sales Today', peso(s.total), `Cash ${peso(s.cash)} · GCash ${peso(s.gcash)}` + (s.expenses ? `<br>After ${peso(s.expenses)} expenses` : ''), 'green') : '') +
      stat('Unpaid Orders', unpaid.length, `Balance: ${peso(unpaidAmt)}`, 'red') +
      stat('Paid – Waiting to be Claimed', waiting.length, '', 'amber') +
      stat('Completed Orders', completedToday.length, `Today · ${completed.length} all-time`, 'gray');

    $('#ql-paid').textContent = waiting.length + ' waiting to be claimed';
    $('#ql-unpaid').textContent = unpaid.length + ' unpaid · ' + peso(unpaidAmt);
    $('#ql-completed').textContent = completed.length + ' claimed orders';

    const recent = todays.slice().sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
    $('#dash-recent').innerHTML = recent.length ? ordersTable(recent) : '<div class="empty">No orders yet today. Click <b>New Order</b> to start.</div>';
  }

  function ordersTable(list) {
    return `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Order No.</th><th>Date &amp; Time</th><th>Customer</th><th>Contact</th><th>Services</th>
      <th class="num">Total</th><th>Payment</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((o) => {
        const lp = lastPayment(o);
        const paidLater = lp && dateKey(lp.at) !== dateKey(o.createdAt);
        return `<tr>
          <td>${hasPickup(o) ? `<span class="pickup-badge">#${pickupNo(o)}</span><br>` : ''}<b>${esc(o.id)}</b></td>
          <td>${fmtDT(o.createdAt)}${paidLater ? `<div class="small paid-later">Paid ${fmtDT(lp.at)}</div>` : ''}</td>
          <td>${esc(o.customer.name)}</td>
          <td>${esc(o.customer.contact) || '—'}</td>
          <td class="small">${o.items.map((i) => esc(i.name) + ' ×' + i.qty).join(', ')}</td>
          <td class="num"><b>${peso(o.total)}</b>${o.balance > 0 ? `<div class="small" style="color:var(--red)">Bal ${peso(o.balance)}</div>` : ''}</td>
          <td>${payBadge(o)} ${lp ? methodBadge(lp.method) : ''}</td>
          <td>${statusBadge(o)}</td>
          <td><div class="row gap"><button class="btn small ghost" data-act="receipt" data-id="${o.id}">Receipt</button>
            <button class="btn small ghost" data-act="edit" data-id="${o.id}">Edit</button>
            <button class="btn small ghost danger-text" data-act="delete" data-id="${o.id}">Delete</button></div></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  /* ---------------- Rendering: sales ---------------- */
  function renderSales() {
    const input = $('#sales-date');
    if (!input.value) input.value = todayKey();
    const k = input.value;
    const s = salesForDay(k);
    const unpaid = db.orders.filter((o) => o.paymentStatus !== 'PAID');
    const unpaidAmt = fromC(unpaid.reduce((c, o) => c + toC(o.balance), 0));
    const txns = db.orders.filter((o) => activeOn(o, k));
    const isToday = k === todayKey();

    $('#sales-day-label').textContent = '— ' + keyToLabel(k);
    $('#sales-stats').innerHTML =
      stat(isToday ? 'Total Sales Today (Net)' : 'Total Sales (Net)', peso(s.total), 'Payments received minus expenses', 'green') +
      stat('Gross Sales', peso(s.gross), 'Before expenses', '') +
      stat('Total Expenses', peso(s.expenses), 'Deducted from sales', 'red') +
      stat('Total Cash (Net)', peso(s.cash), '', '') +
      stat('Total GCash (Net)', peso(s.gcash), '', '') +
      stat('Total Unpaid Amount', peso(unpaidAmt), unpaid.length + ' unpaid order(s), all dates', 'red') +
      stat('Total Transactions', txns.length, 'Orders ordered or paid on this date', 'gray');

    $('#sales-payments').innerHTML = s.rows.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>Time</th><th>Order No.</th><th>Customer</th><th>Method</th><th class="num">Received</th><th class="num">Change</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${s.rows.map(({ o, p }) => `<tr>
        <td>${fmtTime(p.at)}</td><td><b>${esc(o.id)}</b>${dateKey(o.createdAt) !== k ? `<div class="small paid-later">Ordered ${fmtDT(o.createdAt)}</div>` : ''}</td><td>${esc(o.customer.name)}</td>
        <td>${methodBadge(p.method)}${p.ref ? `<div class="small muted">Ref ${esc(p.ref)}</div>` : ''}</td>
        <td class="num">${peso(p.received)}</td><td class="num">${peso(p.change)}</td><td class="num"><b>${peso(p.amount)}</b></td>
        <td><div class="row gap"><button class="btn small ghost" data-act="receipt" data-id="${o.id}">Receipt</button>
          <button class="btn small ghost" data-act="edit" data-id="${o.id}">Edit</button></div></td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="6" class="num"><b>NET TOTAL</b></td><td class="num"><b>${peso(s.total)}</b></td><td></td></tr></tfoot>
      </table></div>` : '<div class="empty">No payments received on this date.</div>';
  }

  /* ---------------- Rendering: history ---------------- */
  function renderHistory() {
    const q = $('#hist-search').value;
    const d = $('#hist-date').value;
    const ps = $('#hist-pay').value;
    const st = $('#hist-status').value;
    const list = db.orders.filter((o) =>
      matches(o, q) &&
      (!d || activeOn(o, d)) &&
      (!ps || o.paymentStatus === ps) &&
      (!st || o.orderStatus === st)
    ).sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
    $('#hist-table').innerHTML = list.length
      ? `<div class="muted small" style="margin-bottom:8px">${list.length} order(s)</div>` + ordersTable(list)
      : '<div class="empty">No orders found.</div>';
  }

  /* ---------------- Rendering: loyalty cards ---------------- */
  function renderLoyaltyView() {
    const q = ($('#loyalty-search').value || '').trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const all = Array.from(loyaltyCustomers().values());
    const list = all.filter((c) => !q || c.name.toLowerCase().includes(q) ||
      (qDigits.length >= 3 && normalizeContact(c.contact).includes(qDigits)))
      .sort((a, b) => (b.available - a.available) || b.last.localeCompare(a.last));
    const withFree = all.filter((c) => c.available > 0).length;
    $('#loyalty-summary').textContent = `${all.length} customer card(s) · ${withFree} with a FREE Package A available`;
    $('#loyalty-list').innerHTML = list.length ? list.map((c) => `
      <article class="ocard lcard${c.available ? ' has-free' : ''}">
        <div class="ocard-head">
          <div>
            <div class="ocard-cust">${esc(c.name)}</div>
            <div class="ocard-contact">${esc(c.contact) || 'No contact number'}</div>
          </div>
          <div class="ocard-badges">
            ${c.available ? `<span class="badge b-free">${c.available} FREE available</span>` : `<span class="badge b-completed">${c.toNext} to next free</span>`}
            <span class="small muted">Card #${c.card}</span>
          </div>
        </div>
        <div class="ocard-body">
          ${cardBoxes(c.onCard)}
          <div class="ocard-kv"><span>Total ticks (all cards)</span><span>${c.ticks}</span></div>
          <div class="ocard-kv"><span>Free earned / used</span><span>${c.earned} / ${c.used}</span></div>
          <div class="ocard-kv"><span>Last visit</span><span>${fmtDT(c.last)}</span></div>
        </div>
        <div class="ocard-actions">
          <button class="btn ghost small" data-loyalty-adjust="${esc(c.key)}">Adjust ticks</button>
          <button class="btn ghost small" data-loyalty-orders="${esc(c.contact || c.name)}">View orders</button>
          <button class="btn ghost small danger-text" data-loyalty-delete="${esc(c.key)}">Delete</button>
        </div>
      </article>`).join('')
      : `<div class="list-empty">${all.length ? 'No customers match your search.' : 'No loyalty cards yet. Ticks are added automatically with each order.'}</div>`;
  }

  function saveLoyaltyAdjust() {
    const err = $('#ladj-error');
    const name = $('#ladj-name').value.trim().replace(/\s+/g, ' ');
    const contact = normalizeContact($('#ladj-contact').value);
    const ticks = parseInt($('#ladj-ticks').value || '0', 10);
    const used = parseInt($('#ladj-used').value || '0', 10);
    const msg = validateCustomer(name, contact);
    if (msg) { err.textContent = msg; return; }
    if (isNaN(ticks) || isNaN(used) || (ticks === 0 && used === 0)) { err.textContent = 'Enter the ticks to add (or remove with a minus sign), and/or free already used.'; return; }
    if (Math.abs(ticks) > 500 || Math.abs(used) > 100) { err.textContent = 'Number is too large.'; return; }
    err.textContent = '';
    mutate((d) => {
      d.loyaltyAdjust = d.loyaltyAdjust || [];
      d.loyaltyAdjust.push({ name, contact, ticks, freeUsed: used, note: $('#ladj-note').value.trim(), at: new Date().toISOString() });
    });
    ['#ladj-name', '#ladj-contact', '#ladj-ticks', '#ladj-used', '#ladj-note'].forEach((s) => { $(s).value = ''; });
    const c = findLoyalty(name, contact);
    toast(`${name}: now ${c.onCard}/${LOYALTY.cardSize} ticks on card #${c.card}, ${c.available} free available.`);
  }

  async function deleteLoyaltyCard(key) {
    if (!ownerOnly()) return;
    const c = loyaltyCustomers().get(key);
    if (!c) return;
    const ok = await ask(`Are you sure you want to delete this loyalty card?\n\n${c.name}${c.contact ? ' (' + c.contact + ')' : ''} · ${c.onCard}/${LOYALTY.cardSize} ticks, ${c.available} free available.\n\nThis permanently removes the card. Orders are not deleted.`, 'Delete card', 'danger');
    if (!ok) return;
    mutate((d) => {
      d.loyaltyDeleted = d.loyaltyDeleted || [];
      // Mark the deletion just after the card's latest record, or now, whichever is later
      const at = new Date(Math.max(Date.now(), new Date(c.last).getTime() + 1)).toISOString();
      d.loyaltyDeleted.push({ key, name: c.name, contact: c.contact || '', at });
    });
    toast(`Loyalty card for ${c.name} deleted.`);
  }

  function renderNavCounts() {
    $('#cnt-paid').textContent = db.orders.filter((o) => o.paymentStatus === 'PAID' && o.orderStatus !== 'COMPLETED').length;
    $('#cnt-unpaid').textContent = db.orders.filter((o) => o.paymentStatus !== 'PAID').length;
  }

  function renderAll() {
    renderNavCounts();
    renderDashboard();
    renderList('paid');
    renderList('unpaid');
    renderList('completed');
    renderSales();
    renderHistory();
    renderLoyaltyView();
    renderCustomerList();
  }

  /* ---------------- Payment (checkout + mark as paid) ---------------- */
  let pay = null;        // current payment session
  let payBusy = false;   // guards against double clicks

  function openCheckout() {
    const name = $('#cust-name').value.trim().replace(/\s+/g, ' ');
    const contact = normalizeContact($('#cust-contact').value);
    let dateErr = '';
    if (cart.when) {
      const t = new Date(localToISO(cart.when)).getTime();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cart.when) || isNaN(t)) dateErr = 'Please enter a valid date and time.';
      else if (t > Date.now() + 60000) dateErr = 'The date and time cannot be in the future.';
    }
    const err = validateCustomer(name, contact) || dateErr || (cartLines().length ? '' : 'Please add at least one laundry service.');
    if (err) {
      $('#order-error').textContent = err;
      if (/name/i.test(err)) $('#cust-name').focus();
      else if (/contact|mobile/i.test(err)) $('#cust-contact').focus();
      else if (/date/i.test(err)) $('#order-datetime').focus();
      return;
    }
    $('#order-error').textContent = '';
    cart.name = name; cart.contact = contact; saveDraft();
    pay = { mode: 'new', due: cartTotal(), status: 'PAID', method: 'Cash', name, lines: cartLines() };
    if (cart.editId) {
      const o = findOrder(cart.editId);
      if (!o) { toast('That order no longer exists.'); cart.editId = null; saveDraft(); renderCart(); return; }
      const lp = lastPayment(o);
      pay.mode = 'edit';
      pay.orderId = o.id;
      pay.status = o.paymentStatus === 'PAID' ? 'PAID' : 'NOT PAID';
      pay.method = lp ? lp.method : 'Cash';
      pay.prev = lp;
      // Partly paid orders open as PAID with the amount already paid filled in, so it is not lost
      if (o.paymentStatus !== 'PAID' && toC(o.amountPaid) > 0) pay.status = 'PAID';
      pay.prefill = o.paymentStatus === 'PAID' ? (lp && toC(lp.received) >= toC(pay.due) ? lp.received : null)
        : toC(o.amountPaid) > 0 ? o.amountPaid : null;
    }
    pay.noCollect = toC(pay.due) <= 0; // expense-only / zero total: nothing to collect
    preparePayModal();
  }

  function openSettle(id) {
    db = loadDB();
    const o = findOrder(id);
    if (!o) return;
    if (o.paymentStatus === 'PAID') { toast('This order is already paid.'); renderAll(); return; }
    pay = { mode: 'settle', orderId: o.id, due: o.balance, status: 'PAID', method: 'Cash', name: o.customer.name, lines: o.items };
    preparePayModal();
  }

  function preparePayModal() {
    const settle = pay.mode === 'settle';
    const edit = pay.mode === 'edit';
    $('#pay-title').textContent = settle ? 'Mark as Paid — ' + pay.orderId : edit ? 'Save Changes — ' + pay.orderId : 'Checkout & Payment';
    $('#pay-cust').textContent = pay.name;
    $('#pay-orderid-row').hidden = !(settle || edit);
    $('#pay-orderid').textContent = pay.orderId || '';
    $('#pay-status-wrap').hidden = settle || pay.noCollect;
    $('#pay-due-label').textContent = settle ? 'BALANCE DUE' : toC(pay.due) < 0 ? 'EXPENSE / CASH OUT' : 'TOTAL AMOUNT';
    $('#pay-total').textContent = peso(pay.due);
    $('#cash-fields').hidden = !!pay.noCollect;
    $('#expense-info').hidden = !pay.noCollect;
    $('#expense-info').innerHTML = toC(pay.due) < 0
      ? `This is an <b>expense</b>. <b>${peso(-pay.due)}</b> will be taken out and deducted from today's sales.<br>Choose where the money is taken from (Cash or GCash).`
      : 'Nothing to collect (total is ₱0.00).';
    const total = fromC(pay.lines.reduce((c, l) => c + toC(l.subtotal), 0));
    $('#pay-summary').innerHTML = `<table class="sum-table">
      <thead><tr><th>Service</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${pay.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${l.qty}</td><td class="num">${peso(l.price)}</td><td class="num">${peso(l.subtotal)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">TOTAL</td><td class="num">${peso(total)}</td></tr></tfoot></table>`;
    $('#pay-received').value = '';
    $('#gcash-ref').value = '';
    $('#pay-error').textContent = '';
    // Payment date: shown when marking an old order as paid, or when editing (new orders use the order date)
    $('#paydate-wrap').hidden = !(settle || edit);
    $('#pay-date').max = manilaLocal(Date.now() + 60000);
    $('#pay-date').value = edit && pay.prev ? manilaLocal(pay.prev.at) : manilaLocal(new Date());
    if (edit && pay.prev) {
      if (pay.prefill != null) $('#pay-received').value = fromC(toC(pay.prefill)).toFixed(2);
      $('#gcash-ref').value = pay.prev.ref || '';
    }
    renderQuickCash();
    setPayStatus(pay.status);
    setPayMethod(pay.method);
    openModal('#pay-modal');
    setTimeout(() => $('#pay-received').focus(), 30);
  }

  function renderQuickCash() {
    const due = pay.due;
    const picks = [];
    if (pay.noCollect) { $('#quick-cash').innerHTML = ''; return; }
    const roundUp = (step) => Math.ceil(due / step) * step;
    [roundUp(50), roundUp(100), 500, 1000].forEach((v) => {
      if (v > due && !picks.includes(v)) picks.push(v);
    });
    $('#quick-cash').innerHTML = picks.slice(0, 4).map((v) => `<button type="button" data-quick="${v}">${peso(v).replace('.00', '')}</button>`).join('');
  }

  function setPayStatus(v) {
    pay.status = v;
    $$('#pay-status-seg button').forEach((b) => b.classList.toggle('on', b.dataset.val === v));
    const unpaid = v === 'NOT PAID';
    $('#pay-fields').hidden = unpaid;
    $('#unpaid-info').hidden = !unpaid;
    $('#unpaid-balance').textContent = peso(pay.due);
    updateChange();
  }

  function setPayMethod(v) {
    pay.method = v;
    $$('#pay-method-seg button').forEach((b) => b.classList.toggle('on', b.dataset.val === v));
    $('#gcash-ref-wrap').hidden = v !== 'GCash';
    updateChange();
  }

  // Returns true when the payment form is valid
  function updateChange() {
    if (!pay) return false;
    const btn = $('#btn-confirm-pay');
    const box = $('#change-box');
    $('#pay-error').textContent = '';
    if (pay.status === 'NOT PAID') {
      btn.textContent = 'SAVE AS NOT PAID';
      btn.className = 'btn danger big';
      btn.disabled = false;
      return true;
    }
    if (pay.noCollect) {
      btn.textContent = toC(pay.due) < 0 ? 'CONFIRM EXPENSE' : 'CONFIRM';
      btn.className = 'btn primary big';
      btn.disabled = false;
      return true;
    }
    btn.textContent = pay.mode === 'edit' ? 'SAVE CHANGES' : 'CONFIRM PAYMENT';
    btn.className = 'btn primary big';
    const raw = $('#pay-received').value.trim();
    box.classList.remove('short');
    $('#change-label').textContent = 'CHANGE';
    $('#short-info').hidden = true;
    if (raw === '') {
      $('#pay-change').textContent = peso(0);
      btn.disabled = true;
      return false;
    }
    const recv = Number(raw);
    if (!isFinite(recv) || recv < 0) {
      $('#pay-change').textContent = '—';
      $('#pay-error').textContent = 'Please enter a valid amount.';
      btn.disabled = true;
      return false;
    }
    const changeC = toC(recv) - toC(pay.due);
    if (changeC < 0) {
      box.classList.add('short');
      $('#change-label').textContent = 'KULANG / SHORT';
      $('#pay-change').textContent = peso(fromC(-changeC));
      if (toC(recv) === 0) {
        $('#pay-error').textContent = 'Amount received is ₱0. Choose NOT PAID instead.';
        btn.disabled = true;
        return false;
      }
      // Partial payment: the amount received is recorded, the kulang goes to NOT PAID as the remaining balance
      $('#short-info').hidden = false;
      $('#short-info').innerHTML = `Partial payment of <b>${peso(recv)}</b> will be recorded.<br>
        Kulang <b>${peso(fromC(-changeC))}</b> will be saved as the remaining balance in <b>NOT PAID</b>.`;
      btn.textContent = 'SAVE PARTIAL PAYMENT';
      btn.className = 'btn danger big';
      btn.disabled = false;
      return true;
    }
    $('#pay-change').textContent = peso(fromC(changeC));
    btn.disabled = false;
    return true;
  }

  async function confirmPayment() {
    if (payBusy || !pay) return;
    if (!updateChange()) {
      if (pay.status === 'PAID' && $('#pay-received').value.trim() === '') $('#pay-error').textContent = 'Enter the amount received or click EXACT AMOUNT.';
      return;
    }
    // When was it paid? New order: the order's date. Mark as paid / edit: the Payment Date field.
    const orderAt = (pay.mode === 'new' || pay.mode === 'edit') && cart.when ? localToISO(cart.when) : new Date().toISOString();
    let payAt = orderAt;
    if (pay.mode !== 'new' && pay.status === 'PAID') {
      const v = $('#pay-date').value;
      const ref = pay.mode === 'edit' ? orderAt : (findOrder(pay.orderId) || {}).createdAt;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) { $('#pay-error').textContent = 'Please enter the payment date and time.'; return; }
      payAt = localToISO(v);
      if (new Date(payAt).getTime() > Date.now() + 60000) { $('#pay-error').textContent = 'The payment date cannot be in the future.'; return; }
      if (ref && payAt < ref.slice(0, 16)) { $('#pay-error').textContent = 'The payment date cannot be before the order date.'; return; }
    }
    payBusy = true;
    $('#btn-confirm-pay').disabled = true;
    try {
      const now = orderAt;
      const session = pay;
      const mkPayment = (dueAmount) => {
        // Expense / zero total: no cash is received and no change is given
        const recv = session.noCollect ? dueAmount : fromC(toC($('#pay-received').value));
        // Short (kulang): only what was received is paid, and there is no change
        const amount = toC(recv) < toC(dueAmount) ? recv : dueAmount;
        return {
          method: session.method,
          amount,
          received: recv,
          change: fromC(toC(recv) - toC(amount)),
          at: payAt,
          ref: session.method === 'GCash' ? $('#gcash-ref').value.trim() : ''
        };
      };
      // Payment fields of a new / edited order. A partial payment leaves the kulang as the balance (NOT PAID).
      const payState = (total, payment) => {
        const paidC = payment ? toC(payment.amount) : 0;
        const full = !!payment && paidC >= toC(total);
        return {
          payments: payment ? [payment] : [],
          amountPaid: fromC(paidC),
          balance: full ? 0 : fromC(toC(total) - paidC),
          paymentStatus: full ? 'PAID' : 'NOT PAID',
          paidAt: full ? payAt : null
        };
      };
      const shortNote = (o) => `✓ Partial payment of ${peso(o.amountPaid)} saved. Kulang ${peso(o.balance)} moved to the NOT PAID list.`;
      let saved = null;
      let note = '';

      if (session.mode === 'new') {
        const token = cart.token;
        const lines = cartLines();
        const total = cartTotal();
        const ticks = cartTicks();
        let duplicate = false;
        // Get a unique order number from the server (falls back to this device when offline)
        const reservedId = cart.items.length ? await cloud.reserveOrderId(now) : null;
        saved = mutate((d) => {
          // Duplicate protection: the same cart can only ever create one order.
          const existing = d.orders.find((o) => o.checkoutToken === token);
          if (existing) { duplicate = true; return existing; }
          const payment = session.status === 'PAID' ? mkPayment(total) : null;
          const o = {
            id: reservedId && !d.orders.some((x) => x.id === reservedId) ? useReservedId(d, reservedId) : nextOrderId(d, now),
            checkoutToken: token,
            createdAt: now,
            customer: { name: cart.name, contact: cart.contact },
            items: lines,
            loyaltyTicks: ticks,
            notes: ($('#order-notes').value || '').trim(),
            total,
            ...payState(total, payment),
            orderStatus: 'PROCESSING',
            completedAt: null
          };
          // Expense-only record: nothing to claim, so it goes straight to Completed
          if (toC(total) < 0) { o.orderStatus = 'COMPLETED'; o.completedAt = now; }
          d.orders.push(o);
          return o;
        });
        cart = emptyCart();
        saveDraft();
        syncCartInputs();
        renderCart();
        note = duplicate ? 'This order was already saved (duplicate prevented).'
          : toC(saved.total) < 0 ? `✓ Expense of ${peso(-saved.total)} recorded and deducted from today's sales.`
          : saved.paymentStatus === 'PAID' ? '✓ Saved. Order moved to PAID BUT NEED TO GET OUT.'
          : toC(saved.amountPaid) > 0 ? shortNote(saved)
          : '✓ Saved as NOT PAID. Order moved to the NOT PAID list.';
      } else if (session.mode === 'edit') {
        const lines = cartLines();
        const total = cartTotal();
        const ticks = cartTicks();
        saved = mutate((d) => {
          const o = d.orders.find((x) => x.id === session.orderId);
          if (!o) return null;
          const payment = session.status === 'PAID' ? mkPayment(total) : null;
          Object.assign(o, {
            createdAt: now,
            customer: { name: cart.name, contact: cart.contact },
            items: lines,
            loyaltyTicks: ticks,
            notes: ($('#order-notes').value || '').trim(),
            total,
            ...payState(total, payment)
          });
          if (toC(total) < 0 && o.orderStatus !== 'COMPLETED') { o.orderStatus = 'COMPLETED'; o.completedAt = now; }
          return o;
        });
        cart = emptyCart();
        saveDraft();
        syncCartInputs();
        renderCart();
        note = !saved ? '' : saved.paymentStatus !== 'PAID' && toC(saved.amountPaid) > 0
          ? '✓ Changes saved to ' + saved.id + '. Kulang ' + peso(saved.balance) + ' is in the NOT PAID list.'
          : '✓ Changes saved to ' + saved.id + '.';
      } else {
        saved = mutate((d) => {
          const o = d.orders.find((x) => x.id === session.orderId);
          if (!o || o.paymentStatus === 'PAID') return o;
          const payment = mkPayment(o.balance);
          o.payments = o.payments || [];
          o.payments.push(payment);
          o.amountPaid = fromC(toC(o.amountPaid) + toC(payment.amount));
          o.balance = fromC(Math.max(0, toC(o.balance) - toC(payment.amount)));
          // Still kulang: the order stays in NOT PAID with the smaller balance
          if (toC(o.balance) > 0) return o;
          o.paymentStatus = 'PAID';
          o.paidAt = payAt;
          // Unpaid customers pay when they pick up, so paying also marks the order as claimed
          if (o.orderStatus !== 'COMPLETED') { o.orderStatus = 'COMPLETED'; o.completedAt = payAt; }
          return o;
        });
        note = saved && saved.paymentStatus !== 'PAID'
          ? `✓ Partial payment recorded. Remaining balance ${peso(saved.balance)} stays in the NOT PAID list.`
          : '✓ Payment recorded. Order moved to COMPLETED ORDERS.';
      }
      pay = null;
      closeModal('#pay-modal');
      if (saved) openReceipt(saved.id, note);
    } finally {
      payBusy = false;
    }
  }

  /* ---------------- Receipt ---------------- */
  function receiptHTML(o) {
    const lp = lastPayment(o);
    const row = (a, b, cls = '') => `<div class="r-row ${cls}"><span>${a}</span><span>${b}</span></div>`;
    const isExpense = toC(o.total) < 0;
    let payBlock = row('Payment Status:', `<b>${o.paymentStatus}</b>`, 'r-status');
    if (isExpense && lp) {
      payBlock = row('Taken From:', esc(lp.method)) +
        (lp.ref ? row('GCash Ref No.:', esc(lp.ref)) : '') +
        row('<b>CASH OUT:</b>', `<b>${peso(-o.total)}</b>`) +
        row('Date:', fmtDT(o.paidAt));
    } else if (o.paymentStatus === 'PAID' && lp) {
      const earlier = fromC(toC(o.amountPaid) - toC(lp.amount)); // earlier partial payments
      payBlock = row('Payment Method:', esc(lp.method)) +
        (lp.ref ? row('GCash Ref No.:', esc(lp.ref)) : '') +
        (toC(earlier) > 0 ? row('Paid Earlier:', peso(earlier)) : '') +
        row('Amount Received:', peso(lp.received)) +
        row('Change:', peso(lp.change)) +
        row('Date Paid:', fmtDT(o.paidAt)) +
        payBlock;
    } else {
      payBlock = row('Payment Method:', lp ? esc(lp.method) : '—') +
        (lp && lp.ref ? row('GCash Ref No.:', esc(lp.ref)) : '') +
        row('Amount Paid:', peso(o.amountPaid)) +
        row('<b>BALANCE DUE:</b>', `<b>${peso(o.balance)}</b>`) +
        payBlock;
    }
    const pickup = hasPickup(o) ? pickupNo(o) : '';
    // Tear-off stub for the customer (top of the receipt)
    const stub = pickup ? `
      <div class="r-stub">
        <div class="r-center r-stub-shop">${esc(BUSINESS.name)}</div>
        <div class="r-center r-stub-label">CUSTOMER COPY · PICK-UP NO.</div>
        <div class="r-pickup-big">${pickup}</div>
        <div class="r-cust-name">${esc(o.customer.name)}</div>
        ${o.paymentStatus !== 'PAID' && toC(o.balance) > 0
          ? `<div class="r-stub-balance">NOT PAID · BALANCE DUE<b>${peso(o.balance)}</b></div>` : ''}
        <div class="r-center r-small">${fmtDT(o.createdAt)} · ${esc(o.id)}</div>
        <div class="r-center r-small">Present this stub when claiming your laundry.</div>
      </div>
      <div class="r-tear">✂ - - - - - - TEAR HERE - - - - - -</div>` : '';
    return `<div class="receipt">
      ${stub || `
      <div class="r-center r-title">${esc(BUSINESS.name)}</div>
      <div class="r-center r-addr">${esc(BUSINESS.address)}</div>
      <div class="r-center r-doc">${isExpense ? 'EXPENSE RECORD' : 'LAUNDRY RECEIPT'}</div>
      <hr class="r-hr">`}
      ${row('Receipt No.:', `<b>${esc(o.id)}</b>`)}
      ${row('Date:', fmtDT(o.createdAt))}
      <div>Customer:</div>
      <div class="r-cust-name">${esc(o.customer.name)}</div>
      ${pickup ? `<div class="r-pickup-mine">PICK-UP NO. <b>${pickup}</b></div>` : ''}
      ${row('Contact No.:', esc(o.customer.contact) || '—')}
      <hr class="r-hr">
      <div class="r-head"><span>SERVICE / QTY × PRICE</span><span>AMOUNT</span></div>
      ${o.items.map((i) => `
        <div class="r-item-name">${esc(i.name)}</div>
        <div class="r-item-line"><span>${i.qty} × ${peso(i.price)}</span><span>${peso(i.subtotal)}</span></div>`).join('')}
      <hr class="r-hr">
      ${row('TOTAL:', peso(o.total), 'r-total')}
      ${isExpense
        ? '<div class="r-big-status r-expense">− EXPENSE / CASH OUT −</div>'
        : o.paymentStatus === 'PAID'
        ? '<div class="r-big-status r-paid">✔ PAID</div>'
        : `<div class="r-big-status r-unpaid"><div class="r-unpaid-title">✖ NOT PAID ✖</div><div class="r-unpaid-bal">BALANCE DUE: ${peso(o.balance)}</div></div>`}
      <hr class="r-hr">
      ${payBlock}
      ${isExpense ? '' : row('Order Status:', `<b>${orderStatusText(o)}</b>`)}
      ${o.completedAt && !isExpense ? row('Date Claimed:', fmtDT(o.completedAt)) : ''}
      ${o.notes ? `<hr class="r-hr"><div><b>Notes:</b></div><div class="r-notes">${esc(o.notes)}</div>` : ''}
      ${isExpense ? '<hr class="r-hr"><div class="r-foot">Recorded by: ____________________</div>' : ''}
    </div>`;
  }

  let receiptOrderId = null;
  let receiptFromCheckout = false;

  function openReceipt(id, note) {
    db = loadDB();
    const o = findOrder(id);
    if (!o) return;
    receiptOrderId = id;
    receiptFromCheckout = !!note;
    $('#receipt-title').textContent = 'Receipt — ' + o.id;
    $('#receipt-preview').innerHTML = receiptHTML(o);
    $('#receipt-note').hidden = !note;
    $('#receipt-note').textContent = note || '';
    $('#paper-size').value = db.settings.paper || '80';
    openModal('#receipt-modal');
    $('#btn-print').focus();
  }

  function printOrder(id) {
    const o = findOrder(id);
    if (!o) return;
    const paper = db.settings.paper || '80';
    const pageCss = paper === '58' ? '@page { size: 58mm auto; margin: 2mm; }'
      : paper === '80' ? '@page { size: 80mm auto; margin: 3mm; }'
      : '@page { size: auto; margin: 12mm; }';
    $('#page-style').textContent = '@media print { ' + pageCss + ' }';
    const area = $('#print-area');
    area.className = 'paper-' + paper;
    area.innerHTML = receiptHTML(o);
    window.print();
  }

  function receiptDone() {
    closeModal('#receipt-modal');
    if (receiptFromCheckout) {
      toast('Order ' + receiptOrderId + ' saved.');
      if (editReturnView) { showView(editReturnView); editReturnView = null; }
      else if (currentView === 'new') $('#cust-name').focus();
    }
    receiptOrderId = null;
  }

  /* ---------------- Order status actions ---------------- */
  async function markCompleted(id) {
    const o = findOrder(id);
    if (!o) return;
    const ok = await ask(`Mark order ${o.id} (${o.customer.name}) as COMPLETED / CLAIMED?\n\nThe customer has picked up the laundry.`, 'Yes, Claimed', 'success');
    if (!ok) return;
    mutate((d) => {
      const x = d.orders.find((y) => y.id === id);
      if (x && x.orderStatus !== 'COMPLETED') { x.orderStatus = 'COMPLETED'; x.completedAt = new Date().toISOString(); }
    });
    toast(`${o.customer.name}'s order moved to Completed Orders.`);
  }

  async function releaseUnpaid(id) {
    const o = findOrder(id);
    if (!o) return;
    const ok = await ask(`Customer ${o.customer.name} still has an unpaid balance of ${peso(o.balance)}.\n\nRelease the laundry anyway? The order will stay in NOT PAID until it is paid.`, 'Release (Unpaid)', 'danger');
    if (!ok) return;
    mutate((d) => {
      const x = d.orders.find((y) => y.id === id);
      if (x && x.orderStatus !== 'COMPLETED') { x.orderStatus = 'COMPLETED'; x.completedAt = new Date().toISOString(); }
    });
    toast('Order marked as claimed. Balance still unpaid.');
  }

  async function undoClaim(id) {
    const o = findOrder(id);
    if (!o) return;
    const ok = await ask(`Undo claim for ${o.id} (${o.customer.name})?\n\nThe order will go back to processing.`, 'Undo claim');
    if (!ok) return;
    mutate((d) => {
      const x = d.orders.find((y) => y.id === id);
      if (x) { x.orderStatus = 'PROCESSING'; x.completedAt = null; }
    });
    toast('Claim undone.');
  }

  async function deleteOrder(id) {
    if (!ownerOnly()) return;
    const o = findOrder(id);
    if (!o) return;
    const paidNote = o.amountPaid > 0 ? `\n\nIts payment of ${peso(o.amountPaid)} will also be removed from the sales totals.` : '';
    const ok = await ask(`Permanently DELETE order ${o.id} (${o.customer.name}, ${peso(o.total)})?${paidNote}\n\nThis cannot be undone.`, 'Delete order', 'danger');
    if (!ok) return;
    mutate((d) => { d.orders = d.orders.filter((x) => x.id !== id); });
    if (receiptOrderId === id) closeModal('#receipt-modal');
    toast(`Order ${o.id} deleted.`);
  }

  /* ---------------- Backup: Excel (.xlsx) export / import ---------------- */
  // The Excel library (SheetJS) is bundled (xlsx.full.min.js) and loaded only when needed.
  let xlsxLoading = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxLoading) {
      xlsxLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'xlsx.full.min.js';
        s.onload = () => resolve(window.XLSX);
        s.onerror = () => { xlsxLoading = null; reject(new Error('Could not load the Excel library.')); };
        document.head.appendChild(s);
      });
    }
    return xlsxLoading;
  }

  const SHEET_ORDERS = 'Orders';
  const SHEET_ITEMS = 'Order Items';
  const SHEET_PAYMENTS = 'Payments';
  const SHEET_DAILY = 'Daily Sales';
  const SHEET_LOYALTY = 'Loyalty Cards';
  const SHEET_LADJ = 'Loyalty Adjustments';
  const SHEET_LDEL = 'Loyalty Deleted Cards';
  const ORDER_COLS = ['Order No', 'Date Ordered', 'Customer', 'Contact', 'Services', 'Total', 'Amount Paid', 'Balance',
    'Payment Status', 'Payment Method', 'Amount Received', 'Change', 'GCash Ref', 'Date Paid', 'Order Status',
    'Date Completed', 'Notes', 'Loyalty Ticks', 'Created (ISO)', 'Paid (ISO)', 'Completed (ISO)'];

  function sheetFrom(XLSX, rows, header, widths) {
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    return ws;
  }

  async function exportBackup() {
    if (!ownerOnly()) return;
    let XLSX;
    try { XLSX = await loadXLSX(); } catch (e) { alert(e.message); return; }
    db = loadDB();
    const orders = db.orders.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const orderRows = orders.map((o) => {
      const lp = lastPayment(o);
      return {
        'Order No': o.id,
        'Date Ordered': fmtDT(o.createdAt),
        'Customer': o.customer.name,
        'Contact': o.customer.contact || '',
        'Services': o.items.map((i) => `${i.name} x${i.qty}`).join(', '),
        'Total': o.total,
        'Amount Paid': o.amountPaid,
        'Balance': o.balance,
        'Payment Status': o.paymentStatus,
        'Payment Method': lp ? lp.method : '',
        'Amount Received': lp ? lp.received : '',
        'Change': lp ? lp.change : '',
        'GCash Ref': lp ? lp.ref || '' : '',
        'Date Paid': o.paidAt ? fmtDT(o.paidAt) : '',
        'Order Status': toC(o.total) < 0 ? 'EXPENSE' : o.orderStatus,
        'Date Completed': o.completedAt ? fmtDT(o.completedAt) : '',
        'Notes': o.notes || '',
        'Loyalty Ticks': o.loyaltyTicks || 0,
        // Exact timestamps, used when importing the file back. Do not edit.
        'Created (ISO)': o.createdAt,
        'Paid (ISO)': o.paidAt || '',
        'Completed (ISO)': o.completedAt || ''
      };
    });

    const itemRows = [];
    orders.forEach((o) => o.items.forEach((i) => itemRows.push({
      'Order No': o.id,
      'Service': i.name,
      'Type': toC(i.subtotal) < 0 ? 'Expense' : i.custom ? 'Custom' : 'Service',
      'Qty': i.qty,
      'Unit Price': i.price,
      'Subtotal': i.subtotal
    })));

    const payRows = [];
    orders.forEach((o) => (o.payments || []).forEach((p) => payRows.push({
      'Order No': o.id,
      'Date Paid': fmtDT(p.at),
      'Method': p.method,
      'Amount': p.amount,
      'Amount Received': p.received,
      'Change': p.change,
      'GCash Ref': p.ref || '',
      'Paid (ISO)': p.at
    })));

    // Daily summary for the owner (not used when importing)
    const days = new Set();
    orders.forEach((o) => { days.add(dateKey(o.createdAt)); (o.payments || []).forEach((p) => days.add(dateKey(p.at))); });
    const dailyRows = Array.from(days).sort().map((k) => {
      const s = salesForDay(k);
      return {
        'Date': k,
        'Transactions': orders.filter((o) => activeOn(o, k)).length,
        'Gross Sales': s.gross,
        'Expenses': s.expenses,
        'Net Sales': s.total,
        'Cash (Net)': s.cash,
        'GCash (Net)': s.gcash
      };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, orderRows, ORDER_COLS,
      [16, 22, 20, 14, 40, 10, 11, 10, 13, 13, 14, 9, 14, 22, 13, 22, 30, 12, 26, 26, 26]), SHEET_ORDERS);
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, itemRows, ['Order No', 'Service', 'Type', 'Qty', 'Unit Price', 'Subtotal'],
      [16, 30, 10, 6, 11, 11]), SHEET_ITEMS);
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, payRows, ['Order No', 'Date Paid', 'Method', 'Amount', 'Amount Received', 'Change', 'GCash Ref', 'Paid (ISO)'],
      [16, 22, 9, 11, 15, 9, 14, 26]), SHEET_PAYMENTS);
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, dailyRows, ['Date', 'Transactions', 'Gross Sales', 'Expenses', 'Net Sales', 'Cash (Net)', 'GCash (Net)'],
      [12, 8, 12, 11, 12, 12, 12]), SHEET_DAILY);

    // Loyalty: a readable summary per customer (not imported) + the manual adjustments (imported)
    const cards = Array.from(loyaltyCustomers().values()).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({
      'Customer': c.name, 'Contact': c.contact, 'Total Ticks': c.ticks, 'Card #': c.card,
      'Ticks on Card': `${c.onCard}/${LOYALTY.cardSize}`, 'Free Earned': c.earned, 'Free Used': c.used,
      'Free Available': c.available, 'Last Visit': fmtDT(c.last)
    }));
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, cards, ['Customer', 'Contact', 'Total Ticks', 'Card #', 'Ticks on Card', 'Free Earned', 'Free Used', 'Free Available', 'Last Visit'],
      [22, 14, 11, 7, 12, 11, 10, 13, 22]), SHEET_LOYALTY);
    const adj = (db.loyaltyAdjust || []).map((a) => ({
      'Customer': a.name, 'Contact': a.contact || '', 'Ticks Added': a.ticks, 'Free Used': a.freeUsed || 0,
      'Note': a.note || '', 'Date': fmtDT(a.at), 'Date (ISO)': a.at
    }));
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, adj, ['Customer', 'Contact', 'Ticks Added', 'Free Used', 'Note', 'Date', 'Date (ISO)'],
      [22, 14, 11, 10, 30, 22, 26]), SHEET_LADJ);
    const dels = (db.loyaltyDeleted || []).map((d) => ({
      'Customer': d.name || '', 'Contact': d.contact || '', 'Card Key': d.key, 'Date Deleted': fmtDT(d.at), 'Date (ISO)': d.at
    }));
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, dels, ['Customer', 'Contact', 'Card Key', 'Date Deleted', 'Date (ISO)'],
      [22, 14, 22, 22, 26]), SHEET_LDEL);

    XLSX.writeFile(wb, 'gap-washhub-data-' + todayKey() + '.xlsx');
    toast('Exported ' + orders.length + ' order(s) to Excel.');
  }

  // Turn an exported Excel workbook back into the app's data
  function dbFromWorkbook(XLSX, wb) {
    const read = (name) => (wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }) : null);
    const orderRows = read(SHEET_ORDERS);
    if (!orderRows) throw new Error('The file has no "' + SHEET_ORDERS + '" sheet. Use a file made with "Export to Excel".');
    const itemRows = read(SHEET_ITEMS) || [];
    const payRows = read(SHEET_PAYMENTS) || [];
    const num = (v) => fromC(toC(Number(String(v).replace(/[₱,\s]/g, '')) || 0));
    const iso = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
    const byName = new Map(SERVICES.map((s) => [s.name.toLowerCase(), s]));

    const orders = [];
    const seen = new Set();
    orderRows.forEach((r, idx) => {
      const id = String(r['Order No'] || '').trim();
      if (!id) return;
      if (seen.has(id)) throw new Error('Duplicate Order No "' + id + '" (row ' + (idx + 2) + ').');
      seen.add(id);
      const items = itemRows.filter((i) => String(i['Order No']).trim() === id).map((i, n) => {
        const name = String(i['Service']).trim();
        const price = num(i['Unit Price']);
        const qty = Math.max(1, parseInt(i['Qty'], 10) || 1);
        const type = String(i['Type']).trim();
        const known = byName.get(name.toLowerCase());
        const isStd = known && toC(known.price) === toC(price) && type !== 'Custom' && type !== 'Expense';
        const line = { id: isStd ? known.id : 'custom-imp-' + idx + '-' + n, name, price, qty, subtotal: fromC(toC(price) * qty) };
        if (!isStd) line.custom = true;
        if (toC(price) < 0) line.expense = true;
        return line;
      });
      const createdAt = iso(r['Created (ISO)']) || new Date().toISOString();
      const payments = payRows.filter((p) => String(p['Order No']).trim() === id).map((p) => ({
        method: String(p['Method'] || '').trim() === 'GCash' ? 'GCash' : 'Cash',
        amount: num(p['Amount']),
        received: num(p['Amount Received']),
        change: num(p['Change']),
        at: iso(p['Paid (ISO)']) || iso(r['Paid (ISO)']) || createdAt,
        ref: String(p['GCash Ref'] || '').trim()
      }));
      const total = items.length ? fromC(items.reduce((c, i) => c + toC(i.subtotal), 0)) : num(r['Total']);
      const paid = String(r['Payment Status']).trim().toUpperCase() === 'PAID';
      const status = String(r['Order Status']).trim().toUpperCase();
      const done = status === 'COMPLETED' || status === 'EXPENSE';
      orders.push({
        id,
        checkoutToken: 'import-' + id,
        createdAt,
        customer: { name: String(r['Customer'] || '').trim() || 'Customer', contact: String(r['Contact'] || '').trim() },
        items,
        notes: String(r['Notes'] || ''),
        loyaltyTicks: Math.max(0, parseInt(r['Loyalty Ticks'], 10) || 0),
        total,
        payments,
        amountPaid: paid ? total : num(r['Amount Paid']),
        balance: paid ? 0 : fromC(toC(total) - toC(num(r['Amount Paid']))),
        paymentStatus: paid ? 'PAID' : 'NOT PAID',
        paidAt: paid ? (iso(r['Paid (ISO)']) || (payments[0] && payments[0].at) || createdAt) : null,
        orderStatus: done ? 'COMPLETED' : 'PROCESSING',
        completedAt: done ? (iso(r['Completed (ISO)']) || createdAt) : null
      });
    });

    // Rebuild the daily order-number counters from the imported IDs
    const seq = {};
    orders.forEach((o) => {
      const m = /^GAP-(\d{2})(\d{2})(\d{2})-(\d+)$/.exec(o.id);
      if (!m) return;
      const k = `20${m[1]}-${m[2]}-${m[3]}`;
      seq[k] = Math.max(seq[k] || 0, parseInt(m[4], 10));
    });
    const loyaltyAdjust = (read(SHEET_LADJ) || []).filter((a) => String(a['Customer']).trim()).map((a) => ({
      name: String(a['Customer']).trim(),
      contact: String(a['Contact'] || '').trim(),
      ticks: parseInt(a['Ticks Added'], 10) || 0,
      freeUsed: parseInt(a['Free Used'], 10) || 0,
      note: String(a['Note'] || ''),
      at: iso(a['Date (ISO)']) || new Date().toISOString()
    }));
    const loyaltyDeleted = (read(SHEET_LDEL) || []).filter((d) => String(d['Card Key']).trim() && iso(d['Date (ISO)'])).map((d) => ({
      key: String(d['Card Key']).trim(),
      name: String(d['Customer'] || '').trim(),
      contact: String(d['Contact'] || '').trim(),
      at: iso(d['Date (ISO)'])
    }));
    return { ...emptyDB(), orders, seq, loyaltyAdjust, loyaltyDeleted, settings: db.settings };
  }

  async function importBackup(file) {
    if (!ownerOnly()) return;
    let data;
    try {
      if (/\.json$/i.test(file.name)) {
        data = JSON.parse(await file.text()); // older JSON backups still work
        if (!data || !Array.isArray(data.orders)) throw new Error('Invalid backup file.');
      } else {
        const XLSX = await loadXLSX();
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        data = dbFromWorkbook(XLSX, wb);
      }
    } catch (e) {
      alert('Could not import this file.\n\n' + (e && e.message ? e.message : ''));
      return;
    }
    const ok = await ask(`Import ${data.orders.length} order(s) from "${file.name}"?\n\nThis REPLACES the shared online data for ALL devices (${db.orders.length} order(s) now). Export first if you want to keep a copy.`, 'Import & Replace', 'danger');
    if (!ok) return;
    if (!navigator.onLine) { alert('Import needs an internet connection. Connect and try again.'); return; }
    toast('Importing… please wait.');
    try {
      await cloud.replaceAll(data);
    } catch (e) {
      cloudError(e);
      return;
    }
    toast('Imported ' + data.orders.length + ' order(s). All devices now see this data.');
  }

  /* ---------------- Clock ---------------- */
  function tick() {
    const now = new Date();
    $('#clock').innerHTML = `<div><b>${now.toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}</b></div>
      <div>${fmtLongDate(now)}</div>`;
    if (!cart.when) syncDateField();
  }

  /* ---------------- Events ---------------- */
  function bindEvents() {
    $('#nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (b) showView(b.dataset.view);
    });
    document.addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) showView(g.dataset.goto);
    });

    // Services & cart
    $('#service-groups').addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]');
      if (!b) return;
      if (b.dataset.add === LOYALTY.freeId) addFreeItem();
      else addItem(b.dataset.add);
    });
    $('#order-datetime').addEventListener('change', (e) => {
      cart.when = e.target.value || null; // clearing the field returns to automatic
      saveDraft();
      syncDateField();
      $('#order-error').textContent = '';
    });
    $('#btn-dt-now').addEventListener('click', () => {
      cart.when = null;
      saveDraft();
      syncDateField();
    });
    $('#btn-add-custom').addEventListener('click', addCustomItem);
    $('#custom-type').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) { setCustomType(b.dataset.val); $('#custom-name').focus(); }
    });
    ['#custom-name', '#custom-price'].forEach((s) => $(s).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addCustomItem(); }
    }));
    $('#cart').addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.inc) changeQty(t.dataset.inc, 1);
      if (t.dataset.dec) changeQty(t.dataset.dec, -1);
      if (t.dataset.remove) removeItem(t.dataset.remove);
    });
    $('#cust-name').addEventListener('input', (e) => {
      cart.name = e.target.value;
      // Autofill contact for returning customers
      const known = db.orders.slice().reverse().find((o) => o.customer.name.toLowerCase() === e.target.value.trim().toLowerCase());
      if (known && !$('#cust-contact').value) { $('#cust-contact').value = known.customer.contact; cart.contact = known.customer.contact; }
      saveDraft();
    });
    $('#cust-contact').addEventListener('input', (e) => {
      const cleaned = e.target.value.replace(/[^\d+\-\s()]/g, '');
      if (cleaned !== e.target.value) e.target.value = cleaned;
      cart.contact = cleaned;
      saveDraft();
    });
    $('#order-notes').addEventListener('input', (e) => { cart.notes = e.target.value; saveDraft(); });
    $('#btn-clear').addEventListener('click', async () => {
      if (!cart.items.length && !$('#cust-name').value && !$('#cust-contact').value && !$('#order-notes').value) return;
      if (!(await ask('Clear the current order?', 'Clear', 'danger'))) return;
      cart = emptyCart();
      saveDraft();
      syncCartInputs();
      renderCart();
      $('#order-error').textContent = '';
    });
    $('#btn-checkout').addEventListener('click', openCheckout);

    // Loyalty: ticks for this order, and refresh the card when the customer changes
    const setTicks = (v) => { cart.ticks = v; saveDraft(); renderLoyaltyBox(); };
    $('#tick-dec').addEventListener('click', () => setTicks(Math.max(0, cartTicks() - 1)));
    $('#tick-inc').addEventListener('click', () => setTicks(Math.min(99, cartTicks() + 1)));
    $('#tick-mode').addEventListener('click', () => setTicks(null));
    ['#cust-name', '#cust-contact'].forEach((s) => $(s).addEventListener('input', renderLoyaltyBox));

    // Loyalty section
    $('#loyalty-search').addEventListener('input', renderLoyaltyView);
    $('#ladj-save').addEventListener('click', saveLoyaltyAdjust);
    $('#loyalty-list').addEventListener('click', (e) => {
      const adj = e.target.closest('[data-loyalty-adjust]');
      const ord = e.target.closest('[data-loyalty-orders]');
      const del = e.target.closest('[data-loyalty-delete]');
      if (del) { deleteLoyaltyCard(del.dataset.loyaltyDelete); return; }
      if (adj) {
        const c = loyaltyCustomers().get(adj.dataset.loyaltyAdjust);
        if (!c) return;
        $('#ladj-name').value = c.name;
        $('#ladj-contact').value = c.contact;
        $('#ladj-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('#ladj-ticks').focus();
      }
      if (ord) {
        showView('history');
        $('#hist-search').value = ord.dataset.loyaltyOrders;
        renderHistory();
      }
    });

    // Payment modal
    $('#pay-status-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setPayStatus(b.dataset.val); });
    $('#pay-method-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setPayMethod(b.dataset.val); });
    $('#pay-received').addEventListener('input', updateChange);
    $('#pay-received').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirmPayment(); } });
    $('#btn-exact').addEventListener('click', () => {
      $('#pay-received').value = fromC(toC(pay.due)).toFixed(2);
      updateChange();
      $('#btn-confirm-pay').focus();
    });
    $('#quick-cash').addEventListener('click', (e) => {
      const b = e.target.closest('[data-quick]');
      if (!b) return;
      $('#pay-received').value = Number(b.dataset.quick).toFixed(2);
      updateChange();
    });
    $('#btn-confirm-pay').addEventListener('click', confirmPayment);

    // Receipt modal
    $('#btn-print').addEventListener('click', () => { if (receiptOrderId) printOrder(receiptOrderId); });
    $('#btn-done').addEventListener('click', receiptDone);
    $('#btn-edit-receipt').addEventListener('click', () => {
      const id = receiptOrderId;
      closeModal('#receipt-modal');
      receiptOrderId = null;
      if (id) startEdit(id);
    });
    $('#btn-cancel-edit').addEventListener('click', cancelEdit);
    $('#paper-size').addEventListener('change', (e) => {
      mutate((d) => { d.settings.paper = e.target.value; });
    });

    // Close buttons
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => {
      const m = b.closest('.modal');
      if (m.id === 'receipt-modal') receiptDone();
      else { closeModal('#' + m.id); if (m.id === 'pay-modal') pay = null; }
    }));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#confirm-modal').hidden) { $('#confirm-no').click(); return; }
      if (!$('#receipt-modal').hidden) { receiptDone(); return; }
      if (!$('#pay-modal').hidden) { closeModal('#pay-modal'); pay = null; }
    });

    // Order card / table actions
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      db = loadDB();
      switch (b.dataset.act) {
        case 'complete': markCompleted(id); break;
        case 'pay': openSettle(id); break;
        case 'claim-unpaid': releaseUnpaid(id); break;
        case 'undo-claim': undoClaim(id); break;
        case 'receipt': openReceipt(id); break;
        case 'edit': startEdit(id); break;
        case 'print': printOrder(id); break;
        case 'delete': deleteOrder(id); break;
      }
    });

    // Searches
    $$('[data-search]').forEach((inp) => inp.addEventListener('input', () => {
      searchState[inp.dataset.search] = inp.value;
      renderList(inp.dataset.search);
    }));
    ['#hist-search', '#hist-date', '#hist-pay', '#hist-status'].forEach((s) => $(s).addEventListener('input', renderHistory));
    $('#hist-reset').addEventListener('click', () => {
      ['#hist-search', '#hist-date', '#hist-pay', '#hist-status'].forEach((s) => { $(s).value = ''; });
      renderHistory();
    });
    $('#sales-date').addEventListener('input', renderSales);
    ['#log-date', '#log-person', '#log-search'].forEach((s) => $(s).addEventListener('input', renderActivity));
    $('#log-today').addEventListener('click', () => { $('#log-date').value = todayKey(); renderActivity(); });

    // Backup
    $('#btn-export').addEventListener('click', exportBackup);
    $('#btn-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) importBackup(f);
    });

    // Keep multiple open tabs in sync
    window.addEventListener('storage', (e) => {
      if (e.key === DRAFT_KEY) { cart = loadDraft(); syncCartInputs(); renderCart(); }
    });
    window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
    window.addEventListener('afterprint', () => { $('#print-area').innerHTML = ''; });
  }

  /* ---------------- Init ---------------- */
  function init() {
    renderServices();
    syncCartInputs();
    renderCart();
    bindEvents();
    renderAll();
    tick();
    setInterval(tick, 1000);
    // refresh "today" figures every minute (handles midnight rollover)
    setInterval(() => { if (currentView === 'dashboard') renderDashboard(); }, 60000);
    showView(location.hash.slice(1) || 'dashboard');
    startCloud();
  }

  init();
})();

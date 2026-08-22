/* Supabase bridge for the school website + admin panel.
   Exposes window.SB — a tiny wrapper around @supabase/supabase-js v2.
   All functions resolve to { ok, data|url|error }. Never throws. */
(function () {
  var CACHE = {};

  function lib() {
    return (window.supabase && window.supabase.createClient) ? window.supabase : null;
  }

  function client(url, key) {
    if (!url || !key || !lib()) return null;
    var id = url + '|' + key;
    if (!CACHE[id]) CACHE[id] = lib().createClient(url, key, { auth: { persistSession: true, storageKey: 'nspnsa-sb-auth', experimental: { passkey: true } } });
    return CACHE[id];
  }

  function ready() { return !!lib(); }

  function configured(cfg) {
    return !!(cfg && cfg.url && cfg.key && /^https:\/\/.+\.supabase\.co\/?$/.test(String(cfg.url).trim()));
  }

  async function load(cfg, row) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.from('site_content').select('data, updated_at').eq('key', row || 'cms').maybeSingle();
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, data: res.data ? res.data.data : null, updatedAt: res.data ? res.data.updated_at : null };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function save(cfg, data, row) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.from('site_content')
        .upsert({ key: row || 'cms', data: data, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function signIn(cfg, email, password) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.auth.signInWithPassword({ email: String(email || '').trim(), password: password || '' });
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, user: res.data.user };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function session(cfg) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false };
    try {
      var res = await c.auth.getSession();
      return { ok: !!(res.data && res.data.session), user: res.data && res.data.session ? res.data.session.user : null };
    } catch (e) { return { ok: false }; }
  }

  /* ── password recovery ─────────────────────────────────────────── */
  async function resetPassword(cfg, email, redirectTo) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.auth.resetPasswordForEmail(String(email || '').trim(), redirectTo ? { redirectTo: redirectTo } : undefined);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function sendOtp(cfg, email) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.auth.signInWithOtp({ email: String(email || '').trim(), options: { shouldCreateUser: false } });
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function verifyOtp(cfg, email, token) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.auth.verifyOtp({ email: String(email || '').trim(), token: String(token || '').trim(), type: 'email' });
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, user: res.data.user };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function updatePassword(cfg, password) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.auth.updateUser({ password: password });
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function signOut(cfg) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (c) { try { await c.auth.signOut(); } catch (e) {} }
    return { ok: true };
  }

  /* ── passkey / WebAuthn (Supabase Auth beta) ───────────────────── */
  var PK_MSG = {
    passkey_disabled: 'ยังไม่ได้เปิดใช้ Passkey ในโปรเจกต์ Supabase',
    too_many_passkeys: 'บัญชีนี้มี Passkey ครบจำนวนสูงสุดแล้ว',
    webauthn_credential_exists: 'อุปกรณ์นี้ลงทะเบียน Passkey ไว้แล้ว',
    webauthn_credential_not_found: 'ไม่พบ Passkey นี้ในระบบ — ลงทะเบียนใหม่ก่อน',
    webauthn_challenge_not_found: 'คำขอยืนยันหมดอายุแล้ว ลองใหม่อีกครั้ง',
    webauthn_challenge_expired: 'หมดเวลายืนยัน ลองใหม่อีกครั้ง',
    webauthn_verification_failed: 'ยืนยันตัวตนไม่สำเร็จ',
    email_not_confirmed: 'อีเมลนี้ยังไม่ได้ยืนยันในระบบ'
  };

  function pkErr(e) {
    if (!e) return 'ไม่สำเร็จ';
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') return 'ยกเลิกการยืนยัน หรือหมดเวลา';
    return PK_MSG[e.code] || String(e.message || e);
  }

  /* เบราว์เซอร์รองรับ WebAuthn และอยู่บน https หรือไม่ */
  function passkeyReady() {
    return !!(window.PublicKeyCredential && window.isSecureContext);
  }

  async function signInPasskey(cfg) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    if (!c.auth.signInWithPasskey) return { ok: false, error: 'ไลบรารี Supabase เวอร์ชันนี้ยังไม่รองรับ Passkey' };
    try {
      var res = await c.auth.signInWithPasskey();
      if (res.error) return { ok: false, error: pkErr(res.error) };
      return { ok: true, user: res.data.user };
    } catch (e) { return { ok: false, error: pkErr(e) }; }
  }

  async function registerPasskey(cfg) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    if (!c.auth.registerPasskey) return { ok: false, error: 'ไลบรารี Supabase เวอร์ชันนี้ยังไม่รองรับ Passkey' };
    try {
      var res = await c.auth.registerPasskey();
      if (res.error) return { ok: false, error: pkErr(res.error) };
      return { ok: true, passkey: res.data };
    } catch (e) { return { ok: false, error: pkErr(e) }; }
  }

  async function listPasskeys(cfg) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c || !c.auth.passkey) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.auth.passkey.list();
      if (res.error) return { ok: false, error: pkErr(res.error) };
      return { ok: true, rows: res.data || [] };
    } catch (e) { return { ok: false, error: pkErr(e) }; }
  }

  async function deletePasskey(cfg, id) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c || !c.auth.passkey) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.auth.passkey.delete({ passkeyId: id });
      if (res && res.error) return { ok: false, error: pkErr(res.error) };
      return { ok: true };
    } catch (e) { return { ok: false, error: pkErr(e) }; }
  }

  async function renamePasskey(cfg, id, name) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c || !c.auth.passkey) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.auth.passkey.update({ passkeyId: id, friendlyName: String(name || '').slice(0, 120) });
      if (res && res.error) return { ok: false, error: pkErr(res.error) };
      return { ok: true };
    } catch (e) { return { ok: false, error: pkErr(e) }; }
  }

  async function upload(cfg, bucket, file, folder) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    var b = bucket || 'school-media';
    var ext = (file.name || 'img.jpg').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    var path = (folder ? folder + '/' : '') + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    try {
      var res = await c.storage.from(b).upload(path, file, { cacheControl: '31536000', upsert: false, contentType: file.type || undefined });
      if (res.error) return { ok: false, error: res.error.message };
      var pub = c.storage.from(b).getPublicUrl(path);
      return { ok: true, url: pub.data.publicUrl, path: path };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  /* ── สถิติผู้เข้าชม (ผ่าน RPC เท่านั้น ดู sql/analytics.sql) ─────────── */
  function device() {
    var w = window.innerWidth || 0;
    return w < 700 ? 'mobile' : (w < 1100 ? 'tablet' : 'desktop');
  }

  function visitorId() {
    try {
      var v = localStorage.getItem('nspnsa-vid');
      if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('nspnsa-vid', v); }
      return v;
    } catch (e) { return ''; }
  }

  async function logView(cfg, path) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false };
    try {
      var res = await c.rpc('log_view', {
        p_path: path || location.pathname || '/',
        p_ref: document.referrer || '',
        p_device: device(),
        p_visitor: visitorId()
      });
      return res.error ? { ok: false, error: res.error.message } : { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function viewStats(cfg) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.rpc('view_stats');
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, data: res.data || null };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function ping(cfg) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.from('site_content').select('key').limit(1);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function logEdit(cfg, text, by) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false };
    try {
      var res = await c.from('edit_log').insert({ text: String(text || '').slice(0, 300), by_name: String(by || '').slice(0, 120) });
      return res.error ? { ok: false, error: res.error.message } : { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  async function editLog(cfg, limit) {
    var c = client(cfg && cfg.url, cfg && cfg.key);
    if (!c) return { ok: false, error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล' };
    try {
      var res = await c.from('edit_log').select('created_at,text,by_name').order('created_at', { ascending: false }).limit(limit || 20);
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, rows: (res.data || []).map(function (r) { return { at: r.created_at, text: r.text, by: r.by_name || 'ผู้ดูแลระบบ' }; }) };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  }

  window.SB = { ready: ready, configured: configured, load: load, save: save, signIn: signIn, session: session, signOut: signOut, resetPassword: resetPassword, sendOtp: sendOtp, verifyOtp: verifyOtp, updatePassword: updatePassword, passkeyReady: passkeyReady, signInPasskey: signInPasskey, registerPasskey: registerPasskey, listPasskeys: listPasskeys, deletePasskey: deletePasskey, renamePasskey: renamePasskey, upload: upload, ping: ping, logView: logView, viewStats: viewStats, logEdit: logEdit, editLog: editLog };
})();

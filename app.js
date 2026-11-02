'use strict';
/* טעמים — מערכת פניות קוראים. Backend: Supabase (anon insert-only; reviewer reads via sign-in). */
const SUPABASE_URL = 'https://gpipsjqkntcyczoxnnwa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9zCWAwdh5h1euDJ67i0LuA_nSM9iW_Y';
const APP_VERSION = '20';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: 'implicit' } });
const STATUSES = ['חדש', 'בבדיקה', 'זומן לראיון', 'התקבל', 'נדחה'];
const OTHER = 'אחר';
/* טקסטי הקריאה הקבועים — סופקו על ידי מנהל היוזמה, כולל ניקוד וטעמים */
const TORAH_REF = 'בראשית א, פסוקים א–ב';
const TORAH_TEXT = "בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃ וְהָאָ֗רֶץ הָיְתָ֥ה תֹ֙הוּ֙ וָבֹ֔הוּ וְחֹ֖שֶׁךְ עַל־פְּנֵ֣י תְה֑וֹם וְר֣וּחַ אֱלֹהִ֔ים מְרַחֶ֖פֶת עַל־פְּנֵ֥י הַמָּֽיִם׃";
const HAFTARAH_REF = 'הפטרת בראשית — ישעיהו מב, פסוקים ה–ו';
const HAFTARAH_TEXT = "כֹּֽה־אָמַ֞ר הָאֵ֣ל׀ יְהוָ֗ה בּוֹרֵ֤א הַשָּׁמַ֙יִם֙ וְנ֣וֹטֵיהֶ֔ם רֹקַ֥ע הָאָ֖רֶץ וְצֶאֱצָאֶ֑יהָ נֹתֵ֤ן נְשָׁמָה֙ לָעָ֣ם עָלֶ֔יהָ וְר֖וּחַ לַהֹלְכִ֥ים בָּֽהּ׃ אֲנִ֧י יְהוָ֛ה קְרָאתִ֥יךָֽ בְצֶ֖דֶק וְאַחְזֵ֣ק בְּיָדֶ֑ךָ וְאֶצָּרְךָ֗ וְאֶתֶּנְךָ֛ לִבְרִ֥ית עָ֖ם לְא֥וֹר גּוֹיִֽם׃";
const KIND_LABELS = { torah: 'תורה', haftarah: 'הפטרה' };


/* ---------- עזר ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL') + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}
function fmtSize(b) {
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  return Math.round((b || 0) / 1024) + ' KB';
}
function statusClass(s) { return 'st-' + String(s).replace(/\s+/g, '-'); }
function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : 'webm';
}
function extFromMime(mime) {
  if (/mp4|m4a/.test(mime)) return 'm4a';
  if (/mpeg|mp3/.test(mime)) return 'mp3';
  if (/ogg/.test(mime)) return 'ogg';
  if (/wav/.test(mime)) return 'wav';
  return 'webm';
}
function safeFileName(n) {
  /* מפתח האחסון חייב ASCII — שמות קבצים בעברית נשמרים במלואם בעמודת filename בבסיס הנתונים */
  let s = String(n || 'audio').replace(/[^\x20-\x7E]/g, '_').replace(/[\\/:*?"<>|#%&{}$!'@+`=~\s]/g, '_');
  s = s.replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 80);
  return s || 'audio';
}

/* ---------- "אחר" מחייב פירוש ---------- */
/* לכל select שיש בו אופציית "אחר" מוסיפים שדה טקסט חובה שמופיע בבחירת אחר */
function wireOtherField(select) {
  const hasOther = [...select.options].some(o => o.value === OTHER || o.text === OTHER);
  if (!hasOther) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'other-text';
  input.placeholder = 'פרטו…';
  input.hidden = true;
  (select.closest('label') || select.parentElement).appendChild(input);
  const sync = () => {
    const isOther = select.value === OTHER;
    input.hidden = !isOther;
    input.required = isOther;
    if (!isOther) input.value = '';
  };
  select.addEventListener('change', sync);
  sync();
}
/* מחזיר את הערך הסופי של select: אם נבחר אחר — "אחר: <פירוש>" */
function selectFinalValue(select) {
  if (select.value !== OTHER) return select.value;
  const input = (select.closest('label') || select.parentElement).querySelector('.other-text');
  return OTHER + ': ' + (input ? input.value.trim() : '');
}

/* ---------- ניתוב ---------- */
function route() {
  const admin = location.hash.startsWith('#admin');
  document.getElementById('view-apply').hidden = admin;
  document.getElementById('view-admin').hidden = !admin;
  if (admin) renderAdmin();
}
window.addEventListener('hashchange', route);

/* ---------- טופס מועמד ---------- */
let sampleCount = 0;
function recorderSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
    (window.MediaRecorder || window.AudioContext || window.webkitAudioContext));
}
function canEncodeAacMp4() {
  try { return !!(window.MediaRecorder && MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2')); } catch (e) { return false; }
}
/* קידוד WAV (PCM 16-bit מונו) — מתנגן בכל דפדפן, בלי איבוד איכות */
function encodeWavBuffers(chunks, sampleRate) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const pcm = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { pcm.set(c, off); off += c.length; }
  const buf = new ArrayBuffer(44 + total * 2);
  const v = new DataView(buf);
  const wr = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  wr(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); wr(8, 'WAVE');
  wr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wr(36, 'data'); v.setUint32(40, total * 2, true);
  for (let i = 0; i < total; i++) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
function addSampleRow(kind) {
  kind = (kind === 'haftarah') ? 'haftarah' : 'torah';
  const isTorah = kind === 'torah';
  if (isTorah) sampleCount++;
  const wrap = document.createElement('div');
  wrap.className = 'sample-row';
  wrap.dataset.kind = kind;
  wrap.innerHTML =
    '<div class="row-head"><span>' + (isTorah ? 'דוגמה ' + sampleCount : 'הפטרה') + '</span>' +
    (isTorah ? '<button type="button" class="remove-sample" title="הסרה">✕</button>' : '') + '</div>' +
    '<div class="verse-box">' +
    '<div class="verse-ref">הטקסט לקריאה: ' + (isTorah ? TORAH_REF : HAFTARAH_REF) + '</div>' +
    '<div class="verse-text">' + (isTorah ? TORAH_TEXT : HAFTARAH_TEXT) + '</div>' +
    '</div>' +
    '<label>העלאת קבצי אודיו <span class="hint">(אפשר כמה קבצים, וגם הקלטה בדף — כל מה שמצורף נשלח)</span>' +
    '<input type="file" accept="audio/*" class="sample-file" multiple></label>' +
    '<div class="rec-block">' +
    '<button type="button" class="btn btn-soft rec-btn">הקלטה כאן בדף</button>' +
    '<span class="rec-state"></span>' +
    '<audio class="rec-play" controls hidden></audio>' +
    '</div>' +
    '<ul class="attached-list"></ul>' +
    '<p class="hint rec-unsupported" hidden>הדפדפן לא תומך בהקלטה ישירה — אפשר להעלות קובץ אודיו קיים.</p>' +
    '<label>נוסח הדוגמה <span class="req">*</span>' +
    '<select class="sample-nusach" required>' +
    '<option value="">בחרו…</option><option>אשכנזי</option><option>ספרדי ירושלמי</option><option>ספרדי מרוקאי</option><option>תימני</option><option>אחר</option>' +
    '</select></label>';
  const removeBtn = wrap.querySelector('.remove-sample');
  if (removeBtn) removeBtn.addEventListener('click', () => {
    stopRecording(wrap);
    wrap.remove();
    renumberSamples();
  });
  wrap._items = [];
  wrap.querySelector('.sample-file').addEventListener('change', ev => {
    [...ev.target.files].forEach(f => addItem(wrap, { blob: f, name: f.name, type: f.type || 'audio/webm', size: f.size }));
    ev.target.value = '';
  });
  wrap.querySelector('.sample-nusach').required = isTorah;
  wireOtherField(wrap.querySelector('.sample-nusach'));
  setupRecorder(wrap);
  document.getElementById(isTorah ? 'samples-list' : 'haftarah-block').appendChild(wrap);
}
function renumberSamples() {
  document.querySelectorAll('#samples-list .sample-row .row-head span')
    .forEach((el, i) => { el.textContent = 'דוגמה ' + (i + 1); });
}

function addItem(row, item) {
  row._items.push(item);
  renderAttached(row);
}
function renderAttached(row) {
  const ul = row.querySelector('.attached-list');
  ul.innerHTML = '';
  if (!row._items.length) return;
  const head = document.createElement('li');
  head.className = 'attached-head';
  head.textContent = 'מצורפים לשליחה: ' + row._items.length;
  ul.appendChild(head);
  row._items.forEach((it, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = it.name + ' (' + fmtSize(it.size) + ')';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'attach-remove';
    rm.title = 'הסרה';
    rm.textContent = '✕';
    rm.addEventListener('click', () => {
      if (row._previewItem === it) {
        const player = row.querySelector('.rec-play');
        player.hidden = true;
        player.removeAttribute('src');
        row._previewItem = null;
      }
      row._items.splice(row._items.indexOf(it), 1);
      renderAttached(row);
    });
    li.appendChild(span);
    li.appendChild(rm);
    ul.appendChild(li);
  });
}

/* ---------- הקלטה בדף ---------- */
function setupRecorder(row) {
  const btn = row.querySelector('.rec-btn');
  const state = row.querySelector('.rec-state');
  const player = row.querySelector('.rec-play');
  if (!recorderSupported()) {
    btn.hidden = true;
    row.querySelector('.rec-unsupported').hidden = false;
    return;
  }
  row._recorder = null;
  row._chunks = [];
  btn.addEventListener('click', async () => {
    if ((row._recorder && row._recorder.state === 'recording') || row._wavRec) { stopRecording(row); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      /* סדר עדיפויות לפורמט: AAC ב-MP4 (אם הדפדפן יודע) > WAV ללא איבוד (עובד בכל דפדפן) > ברירת מחדל */
      if (!canEncodeAacMp4() && (window.AudioContext || window.webkitAudioContext)) {
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const srcNode = actx.createMediaStreamSource(stream);
        const proc = actx.createScriptProcessor(4096, 1, 1);
        row._wavChunks = [];
        proc.onaudioprocess = e => { row._wavChunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
        srcNode.connect(proc); proc.connect(actx.destination);
        row._wavRec = { actx, proc, srcNode, stream, sampleRate: actx.sampleRate };
        btn.textContent = 'עצירת הקלטה';
        state.textContent = 'מקליט… לחצו שוב לעצירה';
        player.hidden = true;
        return;
      }
      const rec = canEncodeAacMp4() ? new MediaRecorder(stream, { mimeType: 'audio/mp4;codecs=mp4a.40.2' }) : new MediaRecorder(stream);
      row._recorder = rec;
      row._chunks = [];
      rec.ondataavailable = e => { if (e.data.size) row._chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const mime = rec.mimeType || 'audio/webm';
        const blob = new Blob(row._chunks, { type: mime });
        const item = { blob, name: 'recording-' + Date.now() + '.' + extFromMime(mime), type: mime, size: blob.size, recorded: true };
        addItem(row, item);
        row._previewItem = item;
        player.src = URL.createObjectURL(blob);
        player.hidden = false;
        btn.textContent = 'הקלטה כאן בדף';
        state.textContent = 'נשמרה הקלטה (' + fmtSize(blob.size) + ') — נוספה לרשימת המצורפים; אפשר להאזין לפני השליחה';
      };
      rec.start();
      btn.textContent = 'עצירת הקלטה';
      state.textContent = 'מקליט… לחצו שוב לעצירה';
      player.hidden = true;
    } catch (err) {
      state.textContent = 'לא ניתן לגשת למיקרופון — בדקו הרשאות או העלו קובץ.';
    }
  });
}
function stopRecording(row) {
  if (row._recorder && row._recorder.state === 'recording') row._recorder.stop();
  if (row._wavRec) stopWavRecording(row);
}
function stopWavRecording(row) {
  const w = row._wavRec;
  if (!w) return;
  row._wavRec = null;
  try { w.proc.disconnect(); w.srcNode.disconnect(); } catch (e) {}
  w.stream.getTracks().forEach(t => t.stop());
  const blob = encodeWavBuffers(row._wavChunks || [], w.sampleRate);
  w.actx.close();
  const btn = row.querySelector('.rec-btn');
  const state = row.querySelector('.rec-state');
  const player = row.querySelector('.rec-play');
  const item = { blob, name: 'recording-' + Date.now() + '.wav', type: 'audio/wav', size: blob.size, recorded: true };
  addItem(row, item);
  row._previewItem = item;
  player.src = URL.createObjectURL(blob);
  player.hidden = false;
  if (btn) btn.textContent = 'הקלטה כאן בדף';
  if (state) state.textContent = 'נשמרה הקלטה (' + fmtSize(blob.size) + ') — נוספה לרשימת המצורפים; אפשר להאזין לפני השליחה';
}

function showError(msg) {
  const e = document.getElementById('form-error');
  e.textContent = msg;
  e.hidden = false;
  e.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function submitForm(ev) {
  ev.preventDefault();
  const f = ev.target;
  document.getElementById('form-error').hidden = true;

  const required = ['name', 'phone', 'area', 'yeshiva', 'nusach', 'employment', 'military'];
  for (const k of required) {
    if (!f.elements[k].value.trim()) { showError('חסר שדה חובה — בדקו שכל השדות המסומנים * מולאו.'); return; }
  }
  if (!document.getElementById('consent-check').checked) { showError('כדי לשלוח צריך לאשר את ההסכמה לשימוש בהקלטות.'); return; }
  for (const sel of f.querySelectorAll('select')) {
    if (sel.value === OTHER) {
      const t = (sel.closest('label') || sel.parentElement).querySelector('.other-text');
      if (!t || !t.value.trim()) { showError('בכל בחירת "אחר" צריך לפרט בכתב — השלימו את השדה החסר.'); return; }
    }
  }
  const rows = [...document.querySelectorAll('#samples-list .sample-row, #haftarah-block .sample-row')];
  const samples = [];
  for (const row of rows) {
    const kind = row.dataset.kind || 'torah';
    const nusachSel = row.querySelector('.sample-nusach');
    const nusach = nusachSel.value ? selectFinalValue(nusachSel) : '';
    const desc = kind === 'haftarah' ? HAFTARAH_REF : TORAH_REF;
    const items = row._items || [];
    if (items.length && !nusachSel.value) { showError('בחרו נוסח לכל דוגמת קריאה.'); return; }
    for (const it of items) {
      samples.push({ blob: it.blob, name: it.name, type: it.type || 'audio/webm', size: it.size, nusach, desc, kind });
    }
  }
  if (!samples.some(s => s.kind === 'torah')) { showError('צרפו לפחות דוגמת קריאה אחת — בהעלאה או בהקלטה בדף.'); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'שולח…';
  try {
    const publicId = crypto.randomUUID();
    /* 1. העלאת ההקלטות לאחסון הפרטי */
    const uploaded = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const path = publicId + '/' + (i + 1) + '-' + safeFileName(s.name);
      const up = await sb.storage.from('samples').upload(path, s.blob, { contentType: s.type });
      if (up.error) throw new Error('upload (' + s.name + '): ' + up.error.message);
      uploaded.push({ path, s });
    }
    /* 2. רשומת המועמדות */
    const ins = await sb.from('applications').insert({
      public_id: publicId,
      name: f.elements.name.value.trim(),
      phone: f.elements.phone.value.trim(),
      email: f.elements.email.value.trim() || null,
      area: f.elements.area.value.trim(),
      yeshiva: f.elements.yeshiva.value.trim(),
      nusach: selectFinalValue(f.elements.nusach),
      experience: f.elements.experience.value.trim() || null,
      employment: selectFinalValue(f.elements.employment),
      military: selectFinalValue(f.elements.military),
      notes: f.elements.notes.value.trim() || null
    });
    if (ins.error) throw new Error('insert application: ' + ins.error.message);
    /* 3. רשומות הדוגמאות */
    const sampleRows = uploaded.map(({ path, s }) => ({
      application_public_id: publicId,
      path,
      filename: s.name,
      content_type: s.type,
      size_bytes: s.size,
      nusach: s.nusach,
      description: s.desc || null,
      kind: s.kind || 'torah'
    }));
    const insS = await sb.from('samples').insert(sampleRows);
    if (insS.error) throw new Error('insert samples: ' + insS.error.message);

    f.reset();
    document.querySelectorAll('#apply-form .other-text').forEach(t => { t.hidden = true; t.required = false; });
    document.getElementById('samples-list').innerHTML = '';
    document.getElementById('haftarah-block').innerHTML = '';
    sampleCount = 0; addSampleRow(); addSampleRow('haftarah');
    document.getElementById('apply-form').hidden = true;
    document.querySelector('#view-apply .intro').hidden = true;
    document.getElementById('apply-success').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showError('השליחה נכשלה (' + (err && err.message ? err.message : 'תקלה') + '). נסו שוב, ואם זה חוזר — צרו קשר.');
  } finally {
    btn.disabled = false; btn.textContent = 'שליחת מועמדות';
  }
}

/* ---------- מסך ניהול ---------- */
let adminApps = [];
async function renderAdmin() {
  const { data } = await sb.auth.getSession();
  const ok = !!data.session;
  document.getElementById('admin-gate').hidden = ok;
  document.getElementById('admin-panel').hidden = !ok;
  if (ok) refreshAdminList();
}
async function sendMagicLink() {
  const email = document.getElementById('admin-email').value.trim();
  const msg = document.getElementById('gate-msg');
  const err = document.getElementById('gate-error');
  err.hidden = true; msg.hidden = true;
  if (!email) { err.textContent = 'מלאו דוא״ל ואז בקשו קישור.'; err.hidden = false; return; }
  const redirectTo = window.location.origin + window.location.pathname + '?auth=1';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
  if (error) {
    const code = (error && error.code) || '';
    if (error.status === 429 || code === 'over_email_send_rate_limit') {
      err.textContent = 'יותר מדי בקשות כרגע — ממתינים כמה דקות ומנסים שוב.';
    } else if (error.status === 422 || code === 'signup_disabled' || code === 'otp_disabled' || code === 'user_not_found') {
      err.textContent = 'לא הצלחנו לשלוח קישור לכתובת הזו. אם אתם רשומים כבוחנים — פנו לצוות טעמים ונטפל בזה.';
    } else {
      err.textContent = 'שליחת הקישור נכשלה כרגע — נסו שוב בעוד כמה דקות. אם זה חוזר, פנו לצוות טעמים.';
    }
    err.hidden = false; return;
  }
  msg.textContent = 'נשלח קישור כניסה לדוא״ל. לוחצים עליו — וחוזרים לכאן מחוברים.';
  msg.hidden = false;
}
async function signOut() {
  await sb.auth.signOut();
  renderAdmin();
}
async function refreshAdminList() {
  const { data, error } = await sb
    .from('applications')
    .select('*, samples(*)')
    .order('created_at', { ascending: false });
  if (error) {
    document.getElementById('apps-list').innerHTML =
      '<p class="error">טעינת הפניות נכשלה: ' + esc(error.message) + '</p>';
    return;
  }
  adminApps = data || [];
  /* קישורי האזנה חתומים לכל דוגמה */
  for (const a of adminApps) {
    for (const s of (a.samples || [])) {
      const r = await sb.storage.from('samples').createSignedUrl(s.path, 3600);
      s.signedUrl = r.data && r.data.signedUrl ? r.data.signedUrl : null;
      /* להקלטות webm/opus (הקלטה בדף מ-Chrome) מחפשים עותק AAC שהומר — Safari באייפון לא מנגן webm */
      s.convSignedUrl = null;
      s.needsRepair = null;
      if (/webm|ogg|opus|wav/i.test(s.content_type || '')) {
        const convPath = s.path.replace(/\.[a-z0-9]+$/i, '.conv.m4a');
        const rc = await sb.storage.from('samples').createSignedUrl(convPath, 3600);
        s.convSignedUrl = rc.data && rc.data.signedUrl ? rc.data.signedUrl : null;
        if (!s.convSignedUrl) s.needsRepair = convPath;
      }
    }
  }
  renderStats();
  renderApps(document.getElementById('search').value.trim());
  repairMissingConversions(); /* רקע — לא חוסם את התצוגה */
}
/* תיקון אוטומטי: דוגמת webm/opus בלי עותק AAC מומרת בדפדפן של הבוחן (אם הוא יודע לקודד AAC)
   ומועלית כעותק נוסף לצד המקור. המקור לא נוגע; כישלון פשוט משאיר את המצב כמו שהוא. */
let repairRunning = false;
async function repairMissingConversions() {
  if (repairRunning || !canEncodeAacMp4()) return;
  repairRunning = true;
  let changed = false;
  try {
    for (const a of adminApps) {
      for (const s of (a.samples || [])) {
        if (!s.needsRepair || !s.signedUrl) continue;
        try {
          const buf = await (await fetch(s.signedUrl)).arrayBuffer();
          const actx = new (window.AudioContext || window.webkitAudioContext)();
          const audio = await actx.decodeAudioData(buf);
          const off = new OfflineAudioContext(audio.numberOfChannels, audio.length, audio.sampleRate);
          const srcNode = off.createBufferSource();
          srcNode.buffer = audio;
          const dest = off.createMediaStreamDestination();
          srcNode.connect(dest);
          const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/mp4;codecs=mp4a.40.2' });
          const chunks = [];
          rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
          const stopped = new Promise(res => { rec.onstop = res; });
          rec.start();
          srcNode.start();
          await off.startRendering();
          await new Promise(r => setTimeout(r, 250));
          rec.stop();
          await stopped;
          await actx.close();
          const blob = new Blob(chunks, { type: 'audio/mp4' });
          if (blob.size < 1000) continue;
          /* בדיקת שלמות לפני העלאה: משך ההמרה חייב להתאים למקור */
          const verify = new (window.AudioContext || window.webkitAudioContext)();
          const outAudio = await verify.decodeAudioData(await blob.arrayBuffer());
          await verify.close();
          if (Math.abs(outAudio.duration - audio.duration) > 1 || outAudio.duration < 2) continue;
          const up = await sb.storage.from('samples').upload(s.needsRepair, blob, { contentType: 'audio/mp4' });
          if (up.error) continue;
          /* הופך לקובץ הפעיל: שורת הדוגמה מצביעה ל-M4A; המקור נשאר באחסון כגיבוי */
          const newName = String(s.filename || 'recording').replace(/\.[a-z0-9]+$/i, '.m4a');
          const upd = await sb.from('samples').update({ path: s.needsRepair, filename: newName, content_type: 'audio/mp4', size_bytes: blob.size }).eq('id', s.id);
          if (upd.error) continue;
          s.path = s.needsRepair;
          s.filename = newName;
          s.content_type = 'audio/mp4';
          s.size_bytes = blob.size;
          const rc = await sb.storage.from('samples').createSignedUrl(s.needsRepair, 3600);
          s.signedUrl = rc.data && rc.data.signedUrl ? rc.data.signedUrl : s.signedUrl;
          s.needsRepair = null;
          changed = true;
        } catch (e) { /* נשאר כמו שהוא */ }
      }
    }
  } finally {
    repairRunning = false;
  }
  if (changed) renderApps(document.getElementById('search').value.trim());
}
function renderStats() {
  const byStatus = {};
  adminApps.forEach(a => { byStatus[a.status] = (byStatus[a.status] || 0) + 1; });
  let html = '<span class="stat-chip">סך הכול: ' + adminApps.length + '</span>';
  for (const s of STATUSES) {
    if (byStatus[s]) html += '<span class="stat-chip">' + esc(s) + ': ' + byStatus[s] + '</span>';
  }
  document.getElementById('stats').innerHTML = html;
}
function field(label, val) {
  return val ? '<div class="field"><b>' + label + ':</b> ' + esc(val) + '</div>' : '';
}
function renderApps(filter) {
  const list = document.getElementById('apps-list');
  list.innerHTML = '';
  const q = (filter || '').toLowerCase();
  const shown = adminApps.filter(a =>
    !q || [a.name, a.phone, a.yeshiva, a.nusach, a.area, a.status]
      .some(v => (v || '').toLowerCase().includes(q)));
  document.getElementById('empty-state').hidden = shown.length > 0;

  for (const a of shown) {
    const card = document.createElement('div');
    card.className = 'app-card';
    let samplesHtml = '';
    (a.samples || []).forEach(s => {
      const dlName = a.name + ' - ' + s.nusach + (s.description ? ' - ' + s.description : '') + '.' + extOf(s.filename);
      samplesHtml +=
        '<div class="sample-item">' +
        '<div class="sample-meta"><span class="kind-chip">' + (KIND_LABELS[s.kind] || KIND_LABELS.torah) + '</span>' + esc(s.nusach) +
        (s.description ? ' — ' + esc(s.description) : '') +
        ' <span style="opacity:.6">(' + esc(s.filename) + ', ' + fmtSize(s.size_bytes) + ')</span></div>' +
        (s.signedUrl
          ? (s.convSignedUrl
              ? '<audio controls preload="metadata">' +
                '<source src="' + esc(s.convSignedUrl) + '" type="audio/mp4">' +
                '<source src="' + esc(s.signedUrl) + '" type="' + esc(s.content_type || 'audio/webm') + '">' +
                '</audio>'
              : '<audio controls preload="metadata" src="' + esc(s.signedUrl) + '"></audio>') +
            '<a class="dl-link" href="' + esc(s.signedUrl) + '" download="' + esc(dlName) + '">הורדת ההקלטה</a>'
          : '<div class="error">לא ניתן לגשת להקלטה כרגע.</div>') +
        '</div>';
    });
    const statusOpts = STATUSES.map(s =>
      '<option' + (s === a.status ? ' selected' : '') + '>' + s + '</option>').join('');
    card.innerHTML =
      '<div class="app-head"><h3>' + esc(a.name) + '</h3>' +
      '<span class="app-date">' + fmtDate(a.created_at) + '</span></div>' +
      '<span class="status-chip ' + statusClass(a.status) + '">' + esc(a.status) + '</span>' +
      '<div class="fields" style="margin-top:10px">' +
      field('טלפון', a.phone) + field('דוא״ל', a.email) +
      field('אזור', a.area) + field('ישיבה', a.yeshiva) +
      field('נוסח עיקרי', a.nusach) + field('ניסיון', a.experience) +
      field('מעמד תעסוקתי', a.employment) + field('מצב צבאי', a.military) +
      (a.notes ? field('הערות המועמד', a.notes) : '') +
      '</div>' +
      '<div class="samples-block"><b>דוגמאות קריאה (' + (a.samples || []).length + ')</b>' + samplesHtml + '</div>' +
      '<div class="status-row"><b>סטטוס:</b><select class="status-select">' + statusOpts + '</select></div>' +
      '<textarea class="notes-area" rows="2" placeholder="הערות צוות (לא גלוי למועמד)">' + esc(a.reviewer_notes || '') + '</textarea>' +
      '<div class="app-actions">' +
      '<button class="btn btn-soft notes-save">שמירת הערות</button>' +
      '<button class="btn btn-danger del-btn">מחיקת פנייה</button>' +
      '</div>';
    card.querySelector('.status-select').addEventListener('change', async ev => {
      const r = await sb.from('applications').update({ status: ev.target.value }).eq('public_id', a.public_id);
      if (r.error) alert('עדכון הסטטוס נכשל: ' + r.error.message);
      refreshAdminList();
    });
    card.querySelector('.notes-save').addEventListener('click', async () => {
      const r = await sb.from('applications')
        .update({ reviewer_notes: card.querySelector('.notes-area').value }).eq('public_id', a.public_id);
      if (r.error) alert('שמירת ההערות נכשלה: ' + r.error.message);
      refreshAdminList();
    });
    card.querySelector('.del-btn').addEventListener('click', async () => {
      if (!confirm('למחוק את הפנייה של ' + a.name + '? ההקלטות יימחקו גם כן.')) return;
      const paths = (a.samples || []).map(s => s.path);
      if (paths.length) await sb.storage.from('samples').remove(paths);
      const r = await sb.from('applications').delete().eq('public_id', a.public_id);
      if (r.error) alert('המחיקה נכשלה: ' + r.error.message);
      refreshAdminList();
    });
    list.appendChild(card);
  }
}

/* ---------- ייצוא ---------- */
function exportXlsx() {
  if (!adminApps.length) { alert('אין פניות לייצוא.'); return null; }
  const headers = ['שם', 'טלפון', 'דוא"ל', 'אזור מגורים', 'ישיבה', 'נוסח עיקרי', 'ניסיון',
    'מעמד תעסוקתי', 'מצב צבאי', 'דוגמאות קריאה',
    'הערות המועמד', 'סטטוס', 'הערות צוות', 'תאריך הגשה'];
  const rows = adminApps.map(a => [
    a.name, a.phone, a.email || '', a.area, a.yeshiva, a.nusach, a.experience || '',
    a.employment, a.military,
    (a.samples || []).map(s => (KIND_LABELS[s.kind] || KIND_LABELS.torah) + ': ' + s.nusach + (s.description ? ' (' + s.description + ')' : '')).join('; '),
    a.notes || '', a.status, a.reviewer_notes || '',
    new Date(a.created_at).toLocaleString('he-IL')
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, 'פניות');
  return wb;
}
function downloadXlsx() {
  const wb = exportXlsx();
  if (wb) XLSX.writeFile(wb, 'taamim-applications.xlsx');
}
async function downloadZip() {
  const wb = exportXlsx();
  if (!wb) return;
  const zip = new JSZip();
  zip.file('taamim-applications.xlsx', XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
  for (const a of adminApps) {
    const dir = zip.folder(a.public_id.slice(0, 8) + ' - ' + a.name);
    for (let i = 0; i < (a.samples || []).length; i++) {
      const s = a.samples[i];
      if (!s.signedUrl) continue;
      try {
        const resp = await fetch(s.signedUrl);
        const blob = await resp.blob();
        dir.file((i + 1) + ' - ' + (KIND_LABELS[s.kind] || KIND_LABELS.torah) + ' - ' + s.nusach + (s.description ? ' - ' + s.description : '') + '.' + extOf(s.filename), blob);
      } catch (e) { /* מדלגים על קובץ שנכשל */ }
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'taamim-applications.zip';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------- אתחול ---------- */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#apply-form select').forEach(wireOtherField);
  addSampleRow();
  addSampleRow('haftarah');
  document.getElementById('add-sample').addEventListener('click', () => addSampleRow('torah'));
  document.getElementById('apply-form').addEventListener('submit', submitForm);
  document.getElementById('magic-btn').addEventListener('click', sendMagicLink);
  const vb = document.getElementById('app-version');
  if (vb) vb.textContent = 'גרסה ' + APP_VERSION;
  document.getElementById('admin-email').addEventListener('keydown', e => { if (e.key === 'Enter') sendMagicLink(); });
  document.getElementById('signout-btn').addEventListener('click', signOut);
  document.getElementById('export-xlsx').addEventListener('click', downloadXlsx);
  document.getElementById('export-zip').addEventListener('click', downloadZip);
  document.getElementById('search').addEventListener('input', e => renderApps(e.target.value.trim()));
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' && !location.hash.startsWith('#admin')) { location.hash = '#admin'; return; }
    if (location.hash.startsWith('#admin')) renderAdmin();
  });
  route();
});

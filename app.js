'use strict';
/* טעמים — מערכת פניות קוראים. גרסת בדיקה: הנתונים נשמרים בדפדפן בלבד (IndexedDB). */
const ADMIN_CODE = 'taamim2026';
const DB_NAME = 'taamimReadersDB';
const STORE = 'applications';
const STATUSES = ['חדש', 'בבדיקה', 'זומן לראיון', 'התקבל', 'נדחה'];
let db = null;

/* ---------- IndexedDB ---------- */
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = e => { db = e.target.result; res(db); };
    r.onerror = e => rej(e.target.error);
  });
}
function store(mode) { return db.transaction(STORE, mode).objectStore(STORE); }
function addApp(rec) {
  return new Promise((res, rej) => {
    const q = store('readwrite').add(rec);
    q.onsuccess = () => res(q.result);
    q.onerror = e => rej(e.target.error);
  });
}
function allApps() {
  return new Promise((res, rej) => {
    const q = store('readonly').getAll();
    q.onsuccess = () => res(q.result || []);
    q.onerror = e => rej(e.target.error);
  });
}
function putApp(rec) {
  return new Promise((res, rej) => {
    const q = store('readwrite').put(rec);
    q.onsuccess = () => res();
    q.onerror = e => rej(e.target.error);
  });
}
function delApp(id) {
  return new Promise((res, rej) => {
    const q = store('readwrite').delete(id);
    q.onsuccess = () => res();
    q.onerror = e => rej(e.target.error);
  });
}
function clearApps() {
  return new Promise((res, rej) => {
    const q = store('readwrite').clear();
    q.onsuccess = () => res();
    q.onerror = e => rej(e.target.error);
  });
}

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
  return Math.round(b / 1024) + ' KB';
}
function statusClass(s) { return 'st-' + String(s).replace(/\s+/g, '-'); }

/* ---------- ניתוב ---------- */
function route() {
  const admin = location.hash === '#admin';
  document.getElementById('view-apply').hidden = admin;
  document.getElementById('view-admin').hidden = !admin;
  if (admin) renderAdmin();
}
window.addEventListener('hashchange', route);

/* ---------- טופס מועמד ---------- */
let sampleCount = 0;
function addSampleRow() {
  sampleCount++;
  const wrap = document.createElement('div');
  wrap.className = 'sample-row';
  wrap.innerHTML =
    '<div class="row-head"><span>דוגמה ' + sampleCount + '</span>' +
    '<button type="button" class="remove-sample" title="הסרה">✕</button></div>' +
    '<label>קובץ אודיו <span class="req">*</span>' +
    '<input type="file" accept="audio/*" class="sample-file" required></label>' +
    '<div class="grid-2">' +
    '<label>נוסח הדוגמה <span class="req">*</span>' +
    '<select class="sample-nusach" required>' +
    '<option value="">בחרו…</option><option>אשכנז</option><option>ספרד</option><option>תימן</option><option>אחר</option>' +
    '</select></label>' +
    '<label>מה מוקלט? (פרשה / פסוקים)' +
    '<input type="text" class="sample-desc" placeholder="למשל: בראשית א׳"></label>' +
    '</div>';
  wrap.querySelector('.remove-sample').addEventListener('click', () => {
    wrap.remove();
    renumberSamples();
  });
  document.getElementById('samples-list').appendChild(wrap);
}
function renumberSamples() {
  document.querySelectorAll('#samples-list .sample-row .row-head span')
    .forEach((el, i) => { el.textContent = 'דוגמה ' + (i + 1); });
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

  const required = ['name', 'phone', 'area', 'yeshiva', 'nusach', 'employment', 'military', 'residency'];
  for (const k of required) {
    if (!f.elements[k].value.trim()) { showError('חסר שדה חובה — בדקו שכל השדות המסומנים * מולאו.'); return; }
  }
  const rows = [...document.querySelectorAll('#samples-list .sample-row')];
  const samples = [];
  for (const row of rows) {
    const file = row.querySelector('.sample-file').files[0];
    const nusach = row.querySelector('.sample-nusach').value;
    const desc = row.querySelector('.sample-desc').value.trim();
    if (file && !nusach) { showError('בחרו נוסח לכל דוגמת קריאה.'); return; }
    if (file) samples.push({ name: file.name, type: file.type, size: file.size, nusach, desc, blob: file });
  }
  if (!samples.length) { showError('צרפו לפחות דוגמת קריאה אחת.'); return; }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = 'שולח…';
  try {
    await addApp({
      createdAt: new Date().toISOString(),
      name: f.elements.name.value.trim(),
      phone: f.elements.phone.value.trim(),
      email: f.elements.email.value.trim(),
      area: f.elements.area.value.trim(),
      yeshiva: f.elements.yeshiva.value.trim(),
      nusach: f.elements.nusach.value,
      experience: f.elements.experience.value.trim(),
      employment: f.elements.employment.value,
      military: f.elements.military.value,
      residency: f.elements.residency.value,
      birthYear: f.elements.birthYear.value.trim(),
      notes: f.elements.notes.value.trim(),
      status: 'חדש',
      reviewerNotes: '',
      samples
    });
    f.reset();
    document.getElementById('samples-list').innerHTML = '';
    sampleCount = 0; addSampleRow();
    document.getElementById('apply-form').hidden = true;
    document.querySelector('#view-apply .intro').hidden = true;
    document.getElementById('apply-success').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showError('משהו השתבש בשמירה. נסו שוב, ואם זה חוזר — צרו קשר.');
  } finally {
    btn.disabled = false; btn.textContent = 'שליחת מועמדות 🚀';
  }
}

/* ---------- מסך ניהול ---------- */
let adminApps = [];
function renderAdmin() {
  const ok = sessionStorage.getItem('taamimAdminOK') === '1';
  document.getElementById('admin-gate').hidden = ok;
  document.getElementById('admin-panel').hidden = !ok;
  if (ok) refreshAdminList();
}
function tryGate() {
  const val = document.getElementById('admin-code').value;
  if (val === ADMIN_CODE) {
    sessionStorage.setItem('taamimAdminOK', '1');
    document.getElementById('gate-error').hidden = true;
    renderAdmin();
  } else {
    document.getElementById('gate-error').hidden = false;
  }
}
async function refreshAdminList() {
  adminApps = (await allApps()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  renderStats();
  renderApps(document.getElementById('search').value.trim());
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
    (a.samples || []).forEach((s, i) => {
      const url = URL.createObjectURL(s.blob);
      samplesHtml +=
        '<div class="sample-item">' +
        '<div class="sample-meta">🎵 ' + esc(s.nusach) +
        (s.desc ? ' — ' + esc(s.desc) : '') +
        ' <span style="opacity:.6">(' + esc(s.name) + ', ' + fmtSize(s.size) + ')</span></div>' +
        '<audio controls preload="metadata" src="' + url + '"></audio>' +
        '<a class="dl-link" href="' + url + '" download="' + esc(a.name + ' - ' + s.nusach + (s.desc ? ' - ' + s.desc : '') + '.' + extOf(s.name)) + '">⬇ הורדת ההקלטה</a>' +
        '</div>';
    });
    const statusOpts = STATUSES.map(s =>
      '<option' + (s === a.status ? ' selected' : '') + '>' + s + '</option>').join('');
    card.innerHTML =
      '<div class="app-head"><h3>' + esc(a.name) + '</h3>' +
      '<span class="app-date">' + fmtDate(a.createdAt) + '</span></div>' +
      '<span class="status-chip ' + statusClass(a.status) + '">' + esc(a.status) + '</span>' +
      '<div class="fields" style="margin-top:10px">' +
      field('טלפון', a.phone) + field('דוא״ל', a.email) +
      field('אזור', a.area) + field('ישיבה', a.yeshiva) +
      field('נוסח עיקרי', a.nusach) + field('ניסיון', a.experience) +
      field('מעמד תעסוקתי', a.employment) + field('מצב צבאי', a.military) +
      field('מעמד בישראל', a.residency) + field('שנת לידה', a.birthYear) +
      (a.notes ? field('הערות המועמד', a.notes) : '') +
      '</div>' +
      '<div class="samples-block"><b>דוגמאות קריאה (' + (a.samples || []).length + ')</b>' + samplesHtml + '</div>' +
      '<div class="status-row"><b>סטטוס:</b><select class="status-select">' + statusOpts + '</select></div>' +
      '<textarea class="notes-area" rows="2" placeholder="הערות צוות (לא גלוי למועמד)">' + esc(a.reviewerNotes || '') + '</textarea>' +
      '<div class="app-actions">' +
      '<button class="btn btn-soft notes-save">שמירת הערות</button>' +
      '<button class="btn btn-danger del-btn">מחיקת פנייה</button>' +
      '</div>';
    card.querySelector('.status-select').addEventListener('change', async ev => {
      a.status = ev.target.value;
      await putApp(a);
      refreshAdminList();
    });
    card.querySelector('.notes-save').addEventListener('click', async () => {
      a.reviewerNotes = card.querySelector('.notes-area').value;
      await putApp(a);
      refreshAdminList();
    });
    card.querySelector('.del-btn').addEventListener('click', async () => {
      if (confirm('למחוק את הפנייה של ' + a.name + '?')) {
        await delApp(a.id);
        refreshAdminList();
      }
    });
    list.appendChild(card);
  }
}
function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1] : 'mp3';
}

/* ---------- ייצוא ---------- */
function exportXlsx() {
  if (!adminApps.length) { alert('אין פניות לייצוא.'); return null; }
  const headers = ['שם', 'טלפון', 'דוא"ל', 'אזור מגורים', 'ישיבה', 'נוסח עיקרי', 'ניסיון',
    'מעמד תעסוקתי', 'מצב צבאי', 'מעמד בישראל', 'שנת לידה', 'דוגמאות קריאה',
    'הערות המועמד', 'סטטוס', 'הערות צוות', 'תאריך הגשה'];
  const rows = adminApps.map(a => [
    a.name, a.phone, a.email || '', a.area, a.yeshiva, a.nusach, a.experience || '',
    a.employment, a.military, a.residency, a.birthYear || '',
    (a.samples || []).map(s => s.nusach + (s.desc ? ' (' + s.desc + ')' : '')).join('; '),
    a.notes || '', a.status, a.reviewerNotes || '',
    new Date(a.createdAt).toLocaleString('he-IL')
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
    const dir = zip.folder(String(a.id) + ' - ' + a.name);
    (a.samples || []).forEach((s, i) => {
      dir.file((i + 1) + ' - ' + s.nusach + (s.desc ? ' - ' + s.desc : '') + '.' + extOf(s.name), s.blob);
    });
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
document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  addSampleRow();
  document.getElementById('add-sample').addEventListener('click', addSampleRow);
  document.getElementById('apply-form').addEventListener('submit', submitForm);
  document.getElementById('gate-btn').addEventListener('click', tryGate);
  document.getElementById('admin-code').addEventListener('keydown', e => { if (e.key === 'Enter') tryGate(); });
  document.getElementById('export-xlsx').addEventListener('click', downloadXlsx);
  document.getElementById('export-zip').addEventListener('click', downloadZip);
  document.getElementById('clear-all').addEventListener('click', async () => {
    if (confirm('למחוק את כל הפניות? אי אפשר לשחזר.')) { await clearApps(); refreshAdminList(); }
  });
  document.getElementById('search').addEventListener('input', e => renderApps(e.target.value.trim()));
  route();
});

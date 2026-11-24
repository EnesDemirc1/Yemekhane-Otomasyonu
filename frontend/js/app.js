const state = { user: null, options: null, page: 'menu', date: new Date().toLocaleDateString('en-CA'), hall: 1, meal: 2, reservations: [] };
const content = document.querySelector('#content');
const loginScreen = document.querySelector('#login-screen');
const appScreen = document.querySelector('#app-screen');

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'İstek tamamlanamadı.');
  return data;
}

function money(value) { return `${Number(value || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`; }
function dateLabel(date) { return new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${date}T12:00:00`)); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function notify(message, error = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.className = `notice${error ? ' error' : ''}`;
  window.setTimeout(() => toast.classList.add('hidden'), 4200);
}
function heading(kicker, title, subtitle = '', actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div><div class="heading-actions">${actions}</div></div>`;
}
function setPage(page) {
  state.page = page;
  document.querySelectorAll('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  renderPage();
}

async function showApp(user) {
  state.user = user;
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  document.querySelector('#user-name').textContent = `${user.ad} ${user.soyad}`;
  document.querySelector('#user-role').textContent = ({ ogrenci: 'Öğrenci', personel: 'Personel', yonetici: 'Yönetici' })[user.rol] || user.rol;
  document.querySelector('#user-avatar').textContent = user.ad.slice(0, 1).toLocaleUpperCase('tr-TR');
  document.querySelector('#admin-nav').classList.toggle('hidden', user.rol !== 'yonetici');
  state.options = await api('/secenekler');
  await setPage('menu');
}

async function renderPage() {
  try {
    if (state.page === 'menu') return await renderMenu();
    if (state.page === 'reservations') return await renderReservations();
    if (state.page === 'balance') return await renderBalance();
    if (state.page === 'reviews') return await renderReviews();
    if (state.page === 'profile') return await renderProfile();
    if (state.page === 'admin') return await renderAdmin();
  } catch (error) { notify(error.message, true); }
}

function filters() {
  const hallOptions = state.options.yemekhaneler.map(hall => `<option value="${hall.id}" ${Number(state.hall) === Number(hall.id) ? 'selected' : ''}>${escapeHtml(hall.ad)}</option>`).join('');
  const mealOptions = state.options.ogunler.map(meal => `<option value="${meal.id}" ${Number(state.meal) === Number(meal.id) ? 'selected' : ''}>${escapeHtml(meal.ad)}</option>`).join('');
  return `<select id="hall-filter" class="select" aria-label="Yemekhane">${hallOptions}</select><select id="meal-filter" class="select" aria-label="Öğün">${mealOptions}</select>`;
}

async function renderMenu() {
  const data = await api(`/menu?yemekhane=${state.hall}&tarih=${state.date}&ogun=${state.meal}`);
  const menus = data.menuler;
  const hall = state.options.yemekhaneler.find(item => Number(item.id) === Number(state.hall));
  const actions = `${filters()}`;
  content.innerHTML = `${heading('Günün menüsü', dateLabel(state.date), 'Kampüs mutfağından bugün senin için.', actions)}
    <div class="hero"><div><div class="eyebrow">Bugün kampüste</div><h2>İyi bir öğle molası ver.</h2><p>${escapeHtml(hall?.ad || '')} · Taze menüler, net içerik bilgisi.</p></div><div class="hero-stat"><strong>${menus.reduce((sum, item) => sum + Number(item.bos_yer || 0), 0).toLocaleString('tr-TR')}</strong><span> boş yer</span></div></div>
    <div class="metrics"><div class="metric"><span class="metric-label">Seçili yemekhane</span><strong>${escapeHtml(hall?.ad || '—')}</strong></div><div class="metric"><span class="metric-label">Öğün</span><strong>${escapeHtml(state.options.ogunler.find(item => Number(item.id) === Number(state.meal))?.ad || '—')}</strong></div><div class="metric"><span class="metric-label">Menü sayısı</span><strong>${menus.length}</strong></div></div>
    <div class="day-picker" aria-label="Haftalık menü">${Array.from({ length: 7 }, (_, offset) => { const day = new Date(`${state.date}T12:00:00`); day.setDate(day.getDate() + offset); const value = day.toLocaleDateString('en-CA'); return `<button class="day-chip ${value === state.date ? 'active' : ''}" data-date="${value}">${offset === 0 ? 'Bugün · ' : ''}${escapeHtml(new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' }).format(day))}</button>`; }).join('')}</div>
    <div class="section-title"><h2>Bugünün tabakları</h2><span class="muted">${escapeHtml(dateLabel(state.date))}</span></div>
    <div class="menu-list">${menus.length ? menus.map(menuCard).join('') : '<div class="empty">Bu tarih ve öğün için yayımlanmış menü bulunmuyor.</div>'}</div>`;
  document.querySelector('#hall-filter').addEventListener('change', event => { state.hall = event.target.value; renderMenu(); });
  document.querySelector('#meal-filter').addEventListener('change', event => { state.meal = event.target.value; renderMenu(); });
  content.querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => { state.date = button.dataset.date; renderMenu(); }));
  content.querySelectorAll('[data-reserve]').forEach(button => button.addEventListener('click', () => reserve(button.dataset.reserve)));
}

function menuCard(menu) {
  const end = new Date(String(menu.rezervasyon_son).replace(' ', 'T'));
  const expired = end.getTime() <= Date.now();
  const price = Number(menu.fiyat);
  const half = Number(menu.ogun_id) !== 1;
  const items = menu.yemekler.map(dish => `<li><span class="dish-info"><strong>${escapeHtml(dish.ad)}</strong><small>${escapeHtml(dish.kategori)}${dish.vejetaryen ? ' · Vejetaryen' : ''}${dish.alerjenler.length ? ` · ${escapeHtml(dish.alerjenler.join(', '))}` : ''}</small>${dish.uyarili ? '<span class="badge warn">Alerjen tercihinle eşleşiyor</span>' : ''}</span><span class="dish-kcal">${dish.kalori} kcal</span></li>`).join('');
  return `<article class="menu-card"><div class="menu-top"><div><div class="eyebrow">${escapeHtml(menu.ogun)} · ${escapeHtml(menu.yemekhane)}</div><h3>${escapeHtml(dateLabel(menu.tarih))}</h3><div class="menu-meta">${menu.bos_yer} / ${menu.kapasite} boş yer · Rezervasyon ${escapeHtml(String(menu.rezervasyon_son).slice(11, 16))}'e kadar</div></div><div class="price">${money(price)}</div></div><ul class="dish-list">${items}<li><strong>Toplam enerji</strong><strong>${menu.toplam_kalori.toLocaleString('tr-TR')} kcal</strong></li></ul><div class="menu-footer"><span class="badge">${menu.ortalama_puan ? `★ ${menu.ortalama_puan} · ${menu.oy_sayisi} değerlendirme` : 'Henüz puanlanmadı'}</span><div class="toolbar">${half ? `<label class="muted"><input type="checkbox" data-half="${menu.menu_id}"> Yarım</label>` : ''}<button class="button small" data-reserve="${menu.menu_id}" ${expired || Number(menu.bos_yer) < 1 ? 'disabled' : ''}>${expired ? 'Süre doldu' : 'Yer ayır'}</button></div></div></article>`;
}

async function reserve(menuId) {
  const half = Boolean(document.querySelector(`[data-half="${menuId}"]`)?.checked);
  try {
    const result = await api('/rezervasyonlar', { method: 'POST', body: JSON.stringify({ menu_id: Number(menuId), yari_porsiyon: half }) });
    state.user.bakiye = result.bakiye;
    notify(`Rezervasyonun hazır · ${money(result.ucret)} · Yeni bakiye ${money(result.bakiye)}`);
    await renderMenu();
  } catch (error) { notify(error.message, true); }
}

async function renderReservations() {
  state.reservations = await api('/rezervasyonlar');
  content.innerHTML = `${heading('Hesabım', 'Rezervasyonlarım', 'Yemek planını görüntüle ve uygun olanları yönet.')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Tarih & öğün</th><th>Yemekhane</th><th>Porsiyon</th><th>Ücret</th><th>Durum</th><th></th></tr></thead><tbody>${state.reservations.length ? state.reservations.map(item => {
    const canCancel = item.durum === 'aktif' && new Date(String(item.rezervasyon_son).replace(' ', 'T')).getTime() > Date.now();
    return `<tr><td>${escapeHtml(item.tarih)}<br><span class="muted">${escapeHtml(item.ogun)}</span></td><td>${escapeHtml(item.yemekhane)}</td><td>${item.porsiyon === 'yarim' ? 'Yarım' : 'Tam'}</td><td>${money(item.ucret)}</td><td><span class="badge ${item.durum === 'iptal' ? 'dark' : ''}">${({ aktif: 'Aktif', kullanildi: 'Kullanıldı', iptal: 'İptal' })[item.durum]}</span></td><td>${canCancel ? `<button class="button danger small" data-cancel="${item.rezervasyon_id}">İptal et</button>` : ''}</td></tr>`;
  }).join('') : '<tr><td colspan="6">Henüz rezervasyonun bulunmuyor.</td></tr>'}</tbody></table></div>`;
  content.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', async () => {
    try { const result = await api(`/rezervasyonlar/${button.dataset.cancel}/iptal`, { method: 'POST', body: '{}' }); notify(`Rezervasyon iptal edildi · İade ${money(result.iade)}`); await renderReservations(); }
    catch (error) { notify(error.message, true); }
  }));
}

async function renderBalance() {
  const data = await api('/bakiye');
  content.innerHTML = `${heading('Hesabım', 'Bakiyem', 'Harcama ve yükleme geçmişin.')}<div class="hero"><div><div class="eyebrow">Kullanılabilir bakiye</div><h2>Öğünlerini planlamaya devam et.</h2></div><div class="hero-stat"><strong>${money(data.bakiye)}</strong></div></div><div class="card"><div class="section-title"><h2>Hızlı bakiye yükle</h2><span class="muted">10 – 1.000 ₺</span></div><form id="topup-form" class="toolbar"><input class="field" type="number" min="10" max="1000" step="0.01" name="tutar" placeholder="Tutar (₺)" required><button class="button">Bakiye ekle</button></form></div><div class="section-title"><h2>Hareket geçmişi</h2><span class="muted">Son 100 işlem</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>İşlem</th><th>Açıklama</th><th>Tarih</th><th>Tutar</th></tr></thead><tbody>${data.hareketler.length ? data.hareketler.map(item => `<tr><td>${({ yukleme: 'Bakiye yükleme', rezervasyon: 'Rezervasyon', iade: 'İade' })[item.tur] || item.tur}</td><td>${escapeHtml(item.aciklama || '—')}</td><td>${new Date(item.olusturma).toLocaleString('tr-TR')}</td><td>${money(item.tutar)}</td></tr>`).join('') : '<tr><td colspan="4">Hareket bulunmuyor.</td></tr>'}</tbody></table></div>`;
  document.querySelector('#topup-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { const amount = Number(new FormData(event.target).get('tutar')); const result = await api('/bakiye/yukle', { method: 'POST', body: JSON.stringify({ tutar: amount }) }); notify(`Yeni bakiye ${money(result.bakiye)}`); await renderBalance(); }
    catch (error) { notify(error.message, true); }
  });
}

async function renderReviews() {
  const entries = await api('/degerlendirmeler');
  content.innerHTML = `${heading('Topluluk', 'Değerlendirme', 'Deneyimini paylaş, menülerin gelişmesine katkı sağla.')}<div class="menu-list">${entries.length ? entries.map(item => `<article class="card"><div class="eyebrow">${escapeHtml(item.yemekhane)} · ${escapeHtml(item.ogun)}</div><h2>${escapeHtml(item.tarih)}</h2>${item.puan ? `<span class="badge">Kaydedilen puanın: ${item.puan} / 5</span>` : '<span class="badge dark">Henüz değerlendirmedin</span>'}<form class="review-form" data-review="${item.menu_id}" style="margin-top:16px"><div class="form-grid"><div class="form-field"><label>Puan</label><select class="field" name="puan">${[5,4,3,2,1].map(n => `<option value="${n}" ${Number(item.puan) === n ? 'selected' : ''}>${n} yıldız</option>`).join('')}</select></div><div class="form-field"><label>Yorum</label><input class="field" name="yorum" maxlength="500" value="${escapeHtml(item.yorum || '')}" placeholder="Kısa bir not (isteğe bağlı)"></div></div><button class="button small" style="margin-top:12px">Değerlendirmeyi kaydet</button></form></article>`).join('') : '<div class="empty">Değerlendirebileceğin kullanılmış bir rezervasyon henüz yok.</div>'}</div>`;
  content.querySelectorAll('.review-form').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault(); const values = new FormData(form);
    try { await api('/degerlendirmeler', { method: 'POST', body: JSON.stringify({ menu_id: Number(form.dataset.review), puan: Number(values.get('puan')), yorum: values.get('yorum') }) }); notify('Değerlendirmen kaydedildi.'); await renderReviews(); }
    catch (error) { notify(error.message, true); }
  }));
}

async function renderProfile() {
  const data = await api('/profil');
  const selected = new Set((data.kullanici.alerjenler || []).map(Number));
  content.innerHTML = `${heading('Hesabım', 'Profil & alerjenler', 'Seçimlerin menü kartlarında sana özel uyarı oluşturur.')}<div class="card"><div class="eyebrow">${escapeHtml(data.kullanici.eposta)}</div><h2>${escapeHtml(data.kullanici.ad)} ${escapeHtml(data.kullanici.soyad)}</h2><p class="muted">${({ ogrenci: 'Öğrenci', personel: 'Personel', yonetici: 'Yönetici' })[data.kullanici.rol]}</p><form id="allergen-form"><div class="section-title"><h2>Kaçınmam gereken alerjenler</h2><span class="muted">Birden fazla seçebilirsin</span></div><div class="allergen-grid">${data.alerjenler.map(allergen => `<label class="check-item"><input type="checkbox" name="alerjen" value="${allergen.id}" ${selected.has(Number(allergen.id)) ? 'checked' : ''}>${escapeHtml(allergen.ad)}</label>`).join('')}</div><button class="button" style="margin-top:18px">Tercihlerimi kaydet</button></form></div>`;
  document.querySelector('#allergen-form').addEventListener('submit', async event => {
    event.preventDefault(); const ids = [...new FormData(event.target).getAll('alerjen')].map(Number);
    try { await api('/profil/alerjenler', { method: 'POST', body: JSON.stringify({ alerjenler: ids }) }); state.user.alerjenler = ids; notify('Alerjen tercihleriniz güncellendi.'); }
    catch (error) { notify(error.message, true); }
  });
}

async function renderAdmin() {
  if (state.user.rol !== 'yonetici') throw new Error('Bu ekran için yönetici yetkisi gerekiyor.');
  const [menus] = await Promise.all([api('/yonetim/menuler')]);
  const dishOptions = state.options.yemekler.map(dish => `<label class="check-item"><input type="checkbox" name="yemekler" value="${dish.id}">${escapeHtml(dish.kategori)} · ${escapeHtml(dish.ad)}</label>`).join('');
  content.innerHTML = `${heading('Yönetim', 'Menü stüdyosu', 'Menü yayımla, doluluğu ve topluluk puanını takip et.')}<div class="card"><h2>Menü oluştur / düzenle</h2><form id="menu-form" class="form-grid"><div class="form-field"><label>Yemekhane</label><select class="field" name="yemekhane_id">${state.options.yemekhaneler.map(item => `<option value="${item.id}">${escapeHtml(item.ad)}</option>`).join('')}</select></div><div class="form-field"><label>Tarih</label><input class="field" name="tarih" type="date" value="${state.date}" required></div><div class="form-field"><label>Öğün</label><select class="field" name="ogun_id">${state.options.ogunler.map(item => `<option value="${item.id}">${escapeHtml(item.ad)}</option>`).join('')}</select></div><div class="form-field"><label>Öğrenci fiyatı (₺)</label><input class="field" name="ogrenci_fiyati" type="number" min="0" step="0.01" value="35" required></div><div class="form-field"><label>Personel fiyatı (₺)</label><input class="field" name="personel_fiyati" type="number" min="0" step="0.01" value="55" required></div><div class="form-field" style="grid-column:1/-1"><label>Menüdeki yemekler</label><div class="allergen-grid">${dishOptions}</div></div><div><button class="button">Menüyü kaydet</button></div></form></div><div class="section-title"><h2>Menü performansı</h2></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Tarih</th><th>Yemekhane · öğün</th><th>Doluluk</th><th>Puan</th><th>Fiyatlar</th></tr></thead><tbody>${menus.map(item => `<tr><td>${escapeHtml(item.tarih)}</td><td>${escapeHtml(item.yemekhane)} · ${escapeHtml(item.ogun)}</td><td>${item.rezerve} / ${item.kapasite} · %${item.doluluk_yuzde}</td><td>${item.ortalama_puan ? `★ ${item.ortalama_puan} · ${item.oy_sayisi} oy` : '—'}</td><td>${money(item.ogrenci_fiyati)} / ${money(item.personel_fiyati)}</td></tr>`).join('')}</tbody></table></div>`;
  document.querySelector('#menu-form').addEventListener('submit', async event => {
    event.preventDefault(); const form = new FormData(event.target);
    const body = { yemekhane_id: Number(form.get('yemekhane_id')), tarih: form.get('tarih'), ogun_id: Number(form.get('ogun_id')), ogrenci_fiyati: Number(form.get('ogrenci_fiyati')), personel_fiyati: Number(form.get('personel_fiyati')), yemekler: form.getAll('yemekler').map(Number) };
    try { await api('/yonetim/menuler', { method: 'POST', body: JSON.stringify(body) }); notify('Menü kaydedildi.'); await renderAdmin(); }
    catch (error) { notify(error.message, true); }
  });
}

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await api('/auth/giris', { method: 'POST', body: JSON.stringify({ eposta: document.querySelector('#email').value, sifre: document.querySelector('#password').value }) });
    document.querySelector('#login-message').innerHTML = '';
    await showApp(result.kullanici);
  } catch (error) { document.querySelector('#login-message').innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`; }
});
document.querySelector('#logout').addEventListener('click', async () => {
  await api('/auth/cikis', { method: 'POST', body: '{}' });
  state.user = null;
  appScreen.classList.add('hidden');
  loginScreen.classList.remove('hidden');
});
document.querySelectorAll('.nav-button').forEach(button => button.addEventListener('click', () => setPage(button.dataset.page)));
api('/auth/me').then(showApp).catch(() => loginScreen.classList.remove('hidden'));

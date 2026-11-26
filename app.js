'use strict';
const $ = (s) => document.querySelector(s);
const isi = $('#isi'), menu = $('#menu');
let token = simpanan('token'), beranda = null, kamera = null, pantauGps = null, posisi = null, foto = null, timerJam = null;
let halaman = 'absen', subAdmin = 'harian', versiTampil = 0;

function simpanan(k, v) {
  try {
    if (v === undefined) return localStorage.getItem(k) || '';
    if (v === '') localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch (e) { /* penyimpanan browser diblokir */ }
  return v || '';
}
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tgl = (s) => new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const lama = (m) => m ? Math.floor(m / 60) + ' j ' + (m % 60) + ' m' : '-';
const label = (s) => `<span class="label ${esc(s)}">${esc(s)}</span>`;
const namaLokasi = (id) => (beranda.semuaLokasi.find((l) => l.id === id) || {}).nama || id || '-';

let timerPesan;
function pesan(teks, salah) {
  const p = $('#pesan');
  p.textContent = teks; p.className = salah ? 'salah' : ''; p.hidden = false;
  clearTimeout(timerPesan);
  timerPesan = setTimeout(() => { p.hidden = true; }, salah ? 7000 : 4500);
}
let sibuk = 0;
function tunggu(on, teks) {
  sibuk = Math.max(0, sibuk + (on ? 1 : -1));
  if (on) $('#teksTunggu').textContent = teks || 'Memuat…';
  $('#tunggu').hidden = !sibuk;
}

async function api(aksi, args, teks) {
  tunggu(true, teks);
  try {
    for (let coba = 1; ; coba++) {
      let hasil;
      try {
        // text/plain menghindari preflight CORS yang tidak didukung Apps Script
        const r = await fetch(window.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ aksi, args }) });
        hasil = await r.json();
      } catch (e) {
        throw new Error('Gagal menghubungi server. Periksa internet lalu cek riwayat sebelum mengulang.');
      }
      if (hasil.ok) return hasil.data;
      if (hasil.error.startsWith('SERVER_SIBUK') && coba < 3) {
        await new Promise((s) => setTimeout(s, 2000 + Math.random() * 3000));
        continue;
      }
      if (hasil.error.startsWith('SESI_HABIS')) keluar();
      throw new Error(hasil.error.replace(/^[A-Z_]+: /, ''));
    }
  } finally { tunggu(false); }
}
const galat = (e) => pesan(e.message, true);

/* ===== Kerangka halaman ===== */
function matikanPerangkat() {
  if (kamera) kamera.getTracks().forEach((t) => t.stop());
  if (pantauGps !== null) navigator.geolocation.clearWatch(pantauGps);
  kamera = null; pantauGps = null; posisi = null; foto = null;
  clearInterval(timerJam);
}
function keluar() {
  matikanPerangkat();
  token = simpanan('token', ''); beranda = null; halaman = 'absen';
  tampilLogin();
}
$('#keluar').onclick = keluar;

function tampilLogin() {
  versiTampil++;
  menu.hidden = true; $('#keluar').hidden = true; $('#judul').textContent = 'Absensi';
  isi.innerHTML = `<form class="kartu" id="formMasuk"><h2>Masuk</h2>
    <label for="id">ID Karyawan</label><input id="id" autocomplete="username" autocapitalize="characters" required>
    <label for="pin">PIN (6 angka)</label><input id="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" required>
    <button class="tombol">Masuk</button></form>`;
  $('#formMasuk').onsubmit = async (e) => {
    e.preventDefault();
    try {
      token = simpanan('token', (await api('login', [$('#id').value.trim(), $('#pin').value])).token);
      await buka('absen');
    } catch (x) { galat(x); }
  };
}

async function buka(nama) {
  matikanPerangkat();
  const versi = ++versiTampil;
  halaman = nama;
  try {
    if (nama === 'absen' || !beranda) {
      const b = await api('beranda', [token]);
      if (versi !== versiTampil) return;
      beranda = b;
    }
    $('#judul').textContent = beranda.perusahaan;
    $('#keluar').hidden = false;
    const daftar = [['absen', 'Absen'], ['riwayat', 'Riwayat'], ['izin', 'Izin'], ['akun', 'Akun']];
    if (beranda.saya.admin) daftar.push(['admin', 'Admin']);
    menu.hidden = false;
    menu.innerHTML = daftar.map(([k, t]) => `<button data-h="${k}" class="${k === nama ? 'aktif' : ''}">${t}</button>`).join('');
    menu.querySelectorAll('button').forEach((b) => { b.onclick = () => buka(b.dataset.h); });
    window.scrollTo(0, 0);
    await ({ absen: tampilAbsen, riwayat: tampilRiwayat, izin: tampilIzin, akun: tampilAkun, admin: tampilAdmin })[nama](versi);
  } catch (e) {
    galat(e);
    if (token && !beranda) {
      isi.innerHTML = '<button class="tombol" id="lagi">Coba lagi</button>';
      $('#lagi').onclick = () => buka(nama);
    }
  }
}

/* ===== Absen ===== */
function tampilAbsen() {
  const b = beranda, c = b.catatan;
  const aksi = b.status === 'BELUM' ? 'MASUK' : (b.status === 'MASUK' ? 'PULANG' : null);
  isi.innerHTML = `<div class="kartu tengah"><strong>${esc(b.saya.nama)}</strong>
      <p class="redup">${esc(b.saya.id)} · ${esc(b.saya.divisi)}</p>
      <div class="jam" id="jam"></div><p class="redup">${tgl(b.hariIni)} · Shift ${esc(b.shift.nama)} ${esc(b.shift.masuk)}–${esc(b.shift.pulang)}</p></div>
    <div class="kartu dua tengah"><div><p class="redup">Masuk${c && c.tanggal !== b.hariIni ? ' (' + tgl(c.tanggal) + ')' : ''}</p><h2>${esc(c ? c.masuk : '--:--')}</h2>${c ? label(c.status) : ''}</div>
      <div><p class="redup">Pulang</p><h2>${esc(c && c.pulang ? c.pulang : '--:--')}</h2></div></div>
    <div id="area">${aksi ? `<button class="tombol ${aksi === 'MASUK' ? 'hijau' : 'merah'}" id="mulai">Absen ${aksi === 'MASUK' ? 'Masuk' : 'Pulang'}</button>` : '<div class="kartu tengah">Absensi hari ini sudah lengkap.</div>'}</div>`;
  const zona = (b.lokasi[0] || {}).zona || 'Asia/Jakarta';
  const detak = () => { const j = $('#jam'); if (j) j.textContent = new Date().toLocaleTimeString('en-GB', { timeZone: zona }); };
  detak(); timerJam = setInterval(detak, 1000);
  if (aksi) $('#mulai').onclick = () => mulaiRekam(aksi);
}

function jarak(a, b, c, d) {
  const r = Math.PI / 180;
  const h = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
}

async function mulaiRekam(aksi) {
  const versi = versiTampil;
  $('#area').innerHTML = `<div class="kartu"><div class="kamera"><video id="video" autoplay playsinline muted></video><img id="hasil" alt="Hasil selfie" hidden></div>
    <div class="gps" id="gps">Mencari lokasi…</div>
    <div id="cadangan" hidden><label for="berkas">Kamera tidak bisa dibuka. Ambil foto lewat sini:</label><input type="file" id="berkas" accept="image/*" capture="user"></div>
    <button class="tombol" id="jepret" disabled>Ambil Selfie</button>
    <button class="tombol kedua" id="ulang" hidden>Ulangi Foto</button>
    <button class="tombol hijau" id="kirim" hidden disabled>Kirim Absen ${aksi === 'MASUK' ? 'Masuk' : 'Pulang'}</button>
    <button class="tombol kedua" id="batal">Batal</button></div>`;
  $('#batal').onclick = () => buka('absen');
  $('#jepret').onclick = () => { const v = $('#video'); if (v.videoWidth) pakaiFoto(bingkai(v, v.videoWidth, v.videoHeight, true)); };
  $('#ulang').onclick = () => { foto = null; if ($('#berkas')) $('#berkas').value = ''; aturTombol(); };
  $('#kirim').onclick = () => kirimAbsen(aksi);
  $('#berkas').onchange = async (e) => {
    try { if (e.target.files[0]) pakaiFoto(await dariBerkas(e.target.files[0], true)); } catch (x) { galat(x); }
  };

  if (!navigator.geolocation) statusGps('tidak', 'Perangkat tidak mendukung lokasi.');
  else pantauGps = navigator.geolocation.watchPosition((p) => {
    posisi = { lat: p.coords.latitude, lng: p.coords.longitude, akurasi: p.coords.accuracy, waktu: Date.now() };
    nilaiPosisi();
  }, (e) => {
    posisi = null;
    statusGps('tidak', e.code === 1 ? 'Izin lokasi ditolak. Aktifkan di pengaturan browser lalu ulangi.' : 'Lokasi belum didapat. Pastikan GPS aktif.');
    aturTombol();
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });

  try {
    const aliran = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 } }, audio: false });
    if (versi !== versiTampil || !$('#video')) { aliran.getTracks().forEach((t) => t.stop()); return; }
    kamera = aliran;
    $('#video').srcObject = aliran;
    $('#video').onloadedmetadata = aturTombol;
  } catch (e) {
    if (versi !== versiTampil) return;
    if (beranda.bolehUpload) $('#cadangan').hidden = false;
    else pesan('Kamera tidak bisa dibuka. Izinkan akses kamera di browser (buka lewat Chrome/Safari).', true);
  }
}

function statusGps(kelas, teks) { const g = $('#gps'); if (g) { g.className = 'gps ' + kelas; g.textContent = teks; } }
function nilaiPosisi() {
  const dekat = beranda.lokasi.map((l) => ({ ...l, jarak: jarak(posisi.lat, posisi.lng, l.lat, l.lng) })).sort((a, b) => a.jarak - b.jarak);
  const cocok = dekat.find((l) => l.jarak <= l.radius);
  const akurat = posisi.akurasi <= beranda.maksAkurasi;
  posisi.sah = !!cocok && akurat;
  const detail = ` (akurasi ±${Math.round(posisi.akurasi)} m)`;
  if (!dekat.length) statusGps('tidak', 'Belum ada lokasi absen untuk akun Anda.');
  else if (!akurat) statusGps('', 'Menunggu GPS lebih akurat' + detail);
  else if (cocok) statusGps('ok', `Di area ${cocok.nama}, ${Math.round(cocok.jarak)} m dari titik${detail}`);
  else statusGps('tidak', `Di luar area. Terdekat ${dekat[0].nama}, ${Math.round(dekat[0].jarak)} m (radius ${dekat[0].radius} m)${detail}`);
  aturTombol();
}
function aturTombol() {
  if (!$('#jepret')) return;
  const v = $('#video');
  $('#jepret').hidden = !!foto; $('#jepret').disabled = !(kamera && v.videoWidth);
  $('#ulang').hidden = !foto; $('#kirim').hidden = !foto; $('#kirim').disabled = !(foto && posisi && posisi.sah);
  $('#hasil').hidden = !foto; v.hidden = !!foto;
}

/** Kecilkan foto dan cap nama, waktu, serta koordinat. */
function bingkai(sumber, lebar, tinggi, cap) {
  const skala = Math.min(1, 720 / Math.max(lebar, tinggi));
  const c = document.createElement('canvas');
  c.width = Math.round(lebar * skala); c.height = Math.round(tinggi * skala);
  const g = c.getContext('2d');
  g.drawImage(sumber, 0, 0, c.width, c.height);
  if (cap) {
    const huruf = Math.max(12, Math.round(c.width / 32));
    const baris = [`${beranda.saya.id} - ${beranda.saya.nama}`, new Date().toLocaleString('id-ID'), posisi ? `${posisi.lat.toFixed(6)}, ${posisi.lng.toFixed(6)}` : ''];
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, c.height - huruf * 4.4, c.width, huruf * 4.4);
    g.fillStyle = '#fff'; g.font = `${huruf}px sans-serif`;
    baris.forEach((t, i) => g.fillText(t, huruf * .6, c.height - huruf * (3 - i * 1.25), c.width - huruf));
  }
  return c.toDataURL('image/jpeg', 0.72);
}
function dariBerkas(file, cap) {
  return new Promise((ok, gagal) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { ok(bingkai(img, img.naturalWidth, img.naturalHeight, cap)); URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); gagal(new Error('Berkas bukan foto yang bisa dibaca.')); };
    img.src = url;
  });
}
function pakaiFoto(data) { foto = data; $('#hasil').src = data; aturTombol(); }

async function kirimAbsen(aksi) {
  if (!foto || !posisi) return;
  if (Date.now() - posisi.waktu > 120000) { await segarkanGps(); }
  const tombol = $('#kirim');
  tombol.disabled = true;
  try {
    const h = await api('absen', [token, { aksi, foto, lat: posisi.lat, lng: posisi.lng, akurasi: posisi.akurasi }], 'Mengirim absen…');
    pesan(h.pesan);
    await buka('absen');
  } catch (e) { galat(e); if (tombol.isConnected) aturTombol(); }
}
function segarkanGps() {
  return new Promise((ok) => navigator.geolocation.getCurrentPosition((p) => {
    posisi = { lat: p.coords.latitude, lng: p.coords.longitude, akurasi: p.coords.accuracy, waktu: Date.now() };
    nilaiPosisi(); ok();
  }, () => ok(), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
}

/* ===== Riwayat dan akun ===== */
function tampilRiwayat() {
  isi.innerHTML = '<h2>14 absensi terakhir</h2>' + (beranda.riwayat.map((r) => `<div class="kartu"><div class="baris"><strong>${tgl(r.tanggal)}</strong>${label(r.status)}</div>
    <p class="redup">Masuk ${esc(r.masuk)} · Pulang ${esc(r.pulang || '-')} · Durasi ${lama(r.durasi)}</p>
    ${r.terlambat ? `<p class="redup">Terlambat ${r.terlambat} menit</p>` : ''}${r.pulangCepat ? `<p class="redup">Pulang cepat ${r.pulangCepat} menit</p>` : ''}</div>`).join('') || '<div class="kartu">Belum ada data.</div>');
}
function tampilAkun() {
  isi.innerHTML = `<form class="kartu" id="formPin"><h2>Ganti PIN</h2>
    <label for="lama">PIN lama</label><input id="lama" type="password" inputmode="numeric" maxlength="6" required>
    <label for="baru">PIN baru (6 angka)</label><input id="baru" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" required>
    <label for="baru2">Ulangi PIN baru</label><input id="baru2" type="password" inputmode="numeric" maxlength="6" required>
    <button class="tombol">Simpan PIN</button></form>`;
  $('#formPin').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#baru').value !== $('#baru2').value) return pesan('Ulangan PIN tidak sama.', true);
    try {
      token = simpanan('token', (await api('gantiPin', [token, $('#lama').value, $('#baru').value])).token);
      $('#formPin').reset(); pesan('PIN diganti.');
    } catch (x) { galat(x); }
  };
}

/* ===== Izin ===== */
function kartuIzin(r, admin) {
  return `<div class="kartu"><div class="baris"><strong>${admin ? esc(r.nama) + ' · ' : ''}${esc(r.jenis)}</strong>${label(r.status)}</div>
    <p class="redup">${tgl(r.dari)}${r.sampai !== r.dari ? ' – ' + tgl(r.sampai) : ''}</p><p>${esc(r.alasan)}</p>
    ${r.catatan ? `<p class="redup">Catatan admin: ${esc(r.catatan)}</p>` : ''}
    ${admin && r.adaLampiran ? `<button class="tombol kedua" data-foto="${esc(r.id)}" data-jenis="izin">Lihat Lampiran</button>` : ''}
    ${admin && r.status === 'MENUNGGU' ? `<div class="dua"><button class="tombol hijau" data-id="${esc(r.id)}" data-putus="DISETUJUI">Setujui</button><button class="tombol merah" data-id="${esc(r.id)}" data-putus="DITOLAK">Tolak</button></div>` : ''}</div>`;
}
async function tampilIzin(versi) {
  const hari = beranda.hariIni;
  isi.innerHTML = `<form class="kartu" id="formIzin"><h2>Ajukan izin</h2>
    <label for="jenis">Jenis</label><select id="jenis"><option value="IZIN">Izin</option><option value="SAKIT">Sakit</option><option value="CUTI">Cuti</option></select>
    <div class="dua"><div><label for="dari">Dari</label><input type="date" id="dari" value="${hari}" required></div><div><label for="sampai">Sampai</label><input type="date" id="sampai" value="${hari}" required></div></div>
    <label for="alasan">Alasan</label><textarea id="alasan" rows="3" maxlength="500" required></textarea>
    <label for="lampiran">Foto surat / bukti (opsional)</label><input type="file" id="lampiran" accept="image/*">
    <button class="tombol">Kirim Pengajuan</button></form><h2>Pengajuan saya</h2><div id="daftar"></div>`;
  $('#formIzin').onsubmit = async (e) => {
    e.preventDefault();
    const tombol = e.target.querySelector('button');
    tombol.disabled = true;
    try {
      const f = $('#lampiran').files[0];
      const d = { jenis: $('#jenis').value, dari: $('#dari').value, sampai: $('#sampai').value, alasan: $('#alasan').value, lampiran: f ? await dariBerkas(f, false) : '' };
      pesan((await api('ajukanIzin', [token, d], 'Mengirim…')).pesan);
      await buka('izin');
    } catch (x) { galat(x); tombol.disabled = false; }
  };
  const d = await api('izinSaya', [token]);
  if (versi === versiTampil) $('#daftar').innerHTML = d.map((r) => kartuIzin(r)).join('') || '<div class="kartu">Belum ada pengajuan.</div>';
}

/* ===== Admin ===== */
function pasangFoto(wadah) {
  wadah.querySelectorAll('[data-foto]').forEach((b) => { b.onclick = async () => {
    try {
      $('#lihatFoto img').src = await api('adminFoto', [token, b.dataset.foto, b.dataset.jenis]);
      $('#lihatFoto').showModal();
    } catch (e) { galat(e); }
  }; });
}
$('#lihatFoto button').onclick = () => $('#lihatFoto').close();
const pilihLokasi = () => `<label for="lokasi">Lokasi</label><select id="lokasi"><option value="">Semua lokasi</option>${beranda.semuaLokasi.map((l) => `<option value="${esc(l.id)}">${esc(l.nama)}</option>`).join('')}</select>`;

async function tampilAdmin() {
  isi.innerHTML = `<div class="sub">${[['harian', 'Harian'], ['rekap', 'Rekap'], ['persetujuan', 'Persetujuan']].map(([k, t]) => `<button data-s="${k}" class="${k === subAdmin ? 'aktif' : ''}">${t}</button>`).join('')}</div><div id="panel"></div>`;
  isi.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => { subAdmin = b.dataset.s; buka('admin'); }; });
  await ({ harian: adminHarian, rekap: adminRekap, persetujuan: adminIzin })[subAdmin]();
}

async function adminHarian() {
  const panel = $('#panel');
  panel.innerHTML = `<div class="kartu"><label for="tanggal">Tanggal</label><input type="date" id="tanggal" value="${beranda.hariIni}">${pilihLokasi()}</div><div id="data"></div>`;
  let urutan = 0;
  const muat = async () => {
    const ini = ++urutan;
    try {
      const d = await api('adminHarian', [token, $('#tanggal').value, $('#lokasi').value]);
      if (ini !== urutan || !panel.isConnected) return;
      const r = d.ringkasan;
      $('#data').innerHTML = `<div class="angka">${[['Terjadwal', r.total], ['Hadir', r.hadir], ['Terlambat', r.terlambat], ['Izin', r.izin], ['Belum / alpa', r.belum]].map(([t, n]) => `<div><b>${n}</b>${t}</div>`).join('')}</div>` +
        d.baris.map((x) => `<div class="kartu"><div class="baris"><strong>${esc(x.nama)}</strong>${label(x.status)}</div><p class="redup">${esc(x.idKaryawan)} · ${esc(x.divisi)}</p>
          ${x.masuk ? `<p class="redup">Masuk ${esc(x.masuk)} di ${esc(namaLokasi(x.lokasiMasuk))} (${esc(x.jarak)} m)${x.terlambat ? ' · telat ' + x.terlambat + ' mnt' : ''}<br>Pulang ${x.pulang ? esc(x.pulang) + ' di ' + esc(namaLokasi(x.lokasiPulang)) : '-'}${x.pulangCepat ? ' · cepat ' + x.pulangCepat + ' mnt' : ''}</p>
          <div class="dua">${x.fotoMasuk ? `<button class="tombol kedua" data-foto="${esc(x.id)}" data-jenis="masuk">Foto Masuk</button>` : ''}${x.fotoPulang ? `<button class="tombol kedua" data-foto="${esc(x.id)}" data-jenis="pulang">Foto Pulang</button>` : ''}</div>` : ''}</div>`).join('');
      pasangFoto($('#data'));
    } catch (e) { galat(e); }
  };
  $('#tanggal').onchange = muat; $('#lokasi').onchange = muat;
  await muat();
}

function unduhCsv(nama, kepala, baris) {
  const sel = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const teks = '﻿' + [kepala, ...baris].map((r) => r.map(sel).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([teks], { type: 'text/csv;charset=utf-8' }));
  a.download = nama; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
function adminRekap() {
  const hari = beranda.hariIni;
  $('#panel').innerHTML = `<div class="kartu"><div class="dua"><div><label for="dari">Dari</label><input type="date" id="dari" value="${hari.slice(0, 8)}01"></div><div><label for="sampai">Sampai</label><input type="date" id="sampai" value="${hari}"></div></div>${pilihLokasi()}<button class="tombol" id="tampil">Tampilkan</button></div><div id="data"></div>`;
  $('#tampil').onclick = async () => {
    try {
      const dari = $('#dari').value, sampai = $('#sampai').value;
      const d = await api('adminRekap', [token, dari, sampai, $('#lokasi').value], 'Menghitung rekap…');
      const kolom = [['Hadir', 'hadir'], ['Terlambat', 'terlambat'], ['Menit telat', 'menitTerlambat'], ['Pulang cepat', 'pulangCepat'], ['Lupa pulang', 'tanpaPulang'], ['Izin', 'izin'], ['Sakit', 'sakit'], ['Cuti', 'cuti'], ['Alpa', 'alpa']];
      $('#data').innerHTML = `<div class="dua"><button class="tombol kedua" id="csvRekap">Unduh Rekap</button><button class="tombol kedua" id="csvRinci">Unduh Rincian</button></div>
        <div class="gulir"><table><thead><tr><th>Nama</th>${kolom.map(([t]) => `<th>${t}</th>`).join('')}<th>Jam kerja</th></tr></thead><tbody>${d.rekap.map((r) => `<tr><td>${esc(r.nama)}</td>${kolom.map(([, k]) => `<td>${r[k]}</td>`).join('')}<td>${lama(r.menitKerja)}</td></tr>`).join('')}</tbody></table></div>`;
      $('#csvRekap').onclick = () => unduhCsv(`rekap_${dari}_${sampai}.csv`, ['ID', 'Nama', 'Divisi', ...kolom.map(([t]) => t), 'Menit kerja'],
        d.rekap.map((r) => [r.id, r.nama, r.divisi, ...kolom.map(([, k]) => r[k]), r.menitKerja]));
      $('#csvRinci').onclick = () => unduhCsv(`rincian_${dari}_${sampai}.csv`, ['Tanggal', 'ID', 'Nama', 'Status', 'Masuk', 'Pulang', 'Menit telat', 'Menit pulang cepat', 'Menit kerja', 'Lokasi masuk', 'Lokasi pulang'],
        d.rincian.map((r) => [r.tanggal, r.id, r.nama, r.status, r.masuk, r.pulang, r.terlambat, r.pulangCepat, r.durasi, r.lokasiMasuk ? namaLokasi(r.lokasiMasuk) : '', r.lokasiPulang ? namaLokasi(r.lokasiPulang) : '']));
    } catch (e) { galat(e); }
  };
}

async function adminIzin() {
  const panel = $('#panel');
  const d = await api('adminIzin', [token]);
  if (!panel.isConnected) return;
  panel.innerHTML = d.map((r) => kartuIzin(r, true)).join('') || '<div class="kartu">Belum ada pengajuan.</div>';
  pasangFoto(panel);
  panel.querySelectorAll('[data-putus]').forEach((b) => { b.onclick = async () => {
    const catatan = window.prompt(b.dataset.putus === 'DITOLAK' ? 'Alasan penolakan (opsional):' : 'Catatan (opsional):', '');
    if (catatan === null) return;
    try {
      pesan((await api('adminProsesIzin', [token, b.dataset.id, b.dataset.putus, catatan])).pesan);
      await buka('admin');
    } catch (e) { galat(e); }
  }; });
}

/* ===== Mulai ===== */
if (!/^https:\/\//.test(window.API_URL || '')) {
  isi.innerHTML = '<div class="kartu"><h2>Belum tersambung</h2><p>Isi URL web app Apps Script di berkas <b>config.js</b>, lalu unggah ulang.</p></div>';
} else if (token) buka('absen'); else tampilLogin();

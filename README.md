# Monopoli Nusantara

Game papan Monopoli edisi Nusantara yang bisa dimainkan **sendiri lawan bot, berempat di satu perangkat, atau online beda perangkat**. Tanpa akun, tanpa server sendiri — ruang online dibuat dengan kode 6 huruf, host memegang state otoritatif dan tamu mengirim niat main.

## Main

Buka link deploy (Vercel) lalu pilih:

- **Main di perangkat ini** — 1 sampai 4 orang bergantian di satu layar. Kursi kosong bisa diisi bot: mudah, sedang, atau sulit.
- **Buat ruang online** — jadi host, bagikan kode ke pasangan/teman. Mereka pilih **Gabung ruang**, masukkan kode dan nama. Kursi yang tersisa bisa diisi bot agar tetap berempat.
- **Gabung ruang** — masukkan kode dari host lalu main dari perangkat sendiri.

Catatan online: tab host harus tetap terbuka selama main. Bila tamu diam 60 detik, kursinya otomatis diambil alih bot sedang supaya permainan tidak macet.

## Aturan singkat

- Modal awal Rp 1.500.000. Lewat atau berhenti di MULAI: terima Rp 200.000.
- Mendarat di properti kosong: beli, atau properti ditawarkan ke pemain lain satu per satu (tanpa lelang harga).
- Kumpulkan satu warna lengkap untuk sewa ganda dan hak membangun rumah (harus rata, maksimal jadi hotel).
- Dadu kembar: lempar lagi. Tiga kali kembar beruntun: masuk penjara.
- Dari penjara: bebas dengan dadu kembar, bayar denda Rp 50.000, atau pakai kartu bebas penjara.
- Boleh dagang properti + uang dengan pemain lain kapan pun di giliran sendiri.
- Kekurangan uang: bangunan terjual dan properti terhipotek otomatis; tetap kurang berarti bangkrut. Pemain terakhir yang bertahan menang.

## Jalan lokal

Butuh Node.js saja, tanpa install apa pun:

```sh
node server.mjs monopoli 4173
# buka http://127.0.0.1:4173/
```

(`server.mjs` hanya helper statis lokal, tidak ikut deploy.)

## Test

```sh
cd monopoli
node test.mjs      # mesin aturan: invariant + 150 game simulasi
node test-bot.mjs  # bot 3 level + dagang + serialisasi state
```

## Struktur

- `index.html` — rangka halaman
- `styles.css` + `tokens.css` + `base.css` — tema Hum (kertas krem, kontrol kartu)
- `data.js` — papan 40 petak + kartu Kesempatan/Dana Umum
- `game.js` — mesin aturan murni (tanpa DOM): giliran, sewa, penjara, dagang, bangkrut
- `bot.js` — bot mudah/sedang/sulit + dagang
- `net.js` — jaringan P2P host-otoritatif (lokal + PeerJS internet)
- `ui.js` — papan, token, panel, modal, lobi online

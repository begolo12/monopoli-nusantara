/* Papan Monopoli edisi Nusantara: 40 petak, harga dalam Rupiah (ribuan x 1000). */
(function (root) {
  'use strict';
  var K = function (n) { return n * 1000; };

  var GROUPS = {
    brown:     { label: 'Coklat',   size: 2 },
    lightblue: { label: 'Biru Muda', size: 3 },
    pink:      { label: 'Merah Muda', size: 3 },
    orange:    { label: 'Jingga',   size: 3 },
    red:       { label: 'Merah',    size: 3 },
    yellow:    { label: 'Kuning',   size: 3 },
    green:     { label: 'Hijau',    size: 3 },
    blue:      { label: 'Biru Tua', size: 2 },
    rail:      { label: 'Stasiun',  size: 4 },
    util:      { label: 'Utilitas', size: 2 }
  };

  function prop(id, name, group, price, rent, house) {
    return { id: id, name: name, type: 'prop', group: group, price: K(price), rent: rent.map(K), house: K(house) };
  }

  var BOARD = [
    { id: 0,  name: 'MULAI', type: 'go' },
    prop(1,  'Jl. Braga',        'brown', 60,  [2, 10, 30, 90, 160, 250], 50),
    { id: 2,  name: 'Dana Umum', type: 'chest' },
    prop(3,  'Jl. Malioboro',    'brown', 60,  [4, 20, 60, 180, 320, 450], 50),
    { id: 4,  name: 'Pajak Penghasilan', type: 'tax', amount: K(200) },
    { id: 5,  name: 'Stasiun Gambir', type: 'rail', group: 'rail', price: K(200) },
    prop(6,  'Pantai Kuta',      'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
    { id: 7,  name: 'Kesempatan', type: 'chance' },
    prop(8,  'Danau Toba',       'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
    prop(9,  'Gunung Bromo',     'lightblue', 120, [8, 40, 100, 300, 450, 600], 50),
    { id: 10, name: 'PENJARA', type: 'jail' },
    prop(11, 'Kota Bandung',     'pink', 140, [10, 50, 150, 450, 625, 750], 100),
    { id: 12, name: 'Listrik PLN', type: 'util', group: 'util', price: K(150) },
    prop(13, 'Kota Surabaya',    'pink', 140, [10, 50, 150, 450, 625, 750], 100),
    prop(14, 'Kota Medan',       'pink', 160, [12, 60, 180, 500, 700, 900], 100),
    { id: 15, name: 'Stasiun Gubeng', type: 'rail', group: 'rail', price: K(200) },
    prop(16, 'Kota Makassar',    'orange', 180, [14, 70, 200, 550, 750, 950], 100),
    { id: 17, name: 'Dana Umum', type: 'chest' },
    prop(18, 'Kota Palembang',   'orange', 180, [14, 70, 200, 550, 750, 950], 100),
    prop(19, 'Kota Balikpapan',  'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
    { id: 20, name: 'PARKIR GRATIS', type: 'parking' },
    prop(21, 'Kota Manado',      'red', 220, [18, 90, 250, 700, 875, 1050], 150),
    { id: 22, name: 'Kesempatan', type: 'chance' },
    prop(23, 'Pulau Lombok',     'red', 220, [18, 90, 250, 700, 875, 1050], 150),
    prop(24, 'Labuan Bajo',      'red', 240, [20, 100, 300, 750, 925, 1100], 150),
    { id: 25, name: 'Stasiun Tugu', type: 'rail', group: 'rail', price: K(200) },
    prop(26, 'Candi Borobudur',  'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
    prop(27, 'Raja Ampat',       'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
    { id: 28, name: 'Air PDAM', type: 'util', group: 'util', price: K(150) },
    prop(29, 'Pulau Komodo',     'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
    { id: 30, name: 'MASUK PENJARA', type: 'gotojail' },
    prop(31, 'Kota Semarang',    'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
    prop(32, 'Kota Yogyakarta',  'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
    { id: 33, name: 'Dana Umum', type: 'chest' },
    prop(34, 'Kota Jakarta',     'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
    { id: 35, name: 'Stasiun Bandung', type: 'rail', group: 'rail', price: K(200) },
    { id: 36, name: 'Kesempatan', type: 'chance' },
    prop(37, 'Pantai Nusa Dua',  'blue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
    { id: 38, name: 'Pajak Mewah', type: 'tax', amount: K(100) },
    prop(39, 'Jl. Sudirman',     'blue', 400, [50, 200, 600, 1400, 1700, 2000], 200)
  ];

  var CHANCE = [
    { text: 'Maju ke MULAI. Kumpulkan Rp 200.000.', fx: { t: 'move', to: 0 } },
    { text: 'Maju ke Jl. Sudirman.', fx: { t: 'move', to: 39 } },
    { text: 'Maju ke Labuan Bajo.', fx: { t: 'move', to: 24 } },
    { text: 'Maju ke stasiun terdekat. Bila dimiliki, bayar sewa dua kali lipat.', fx: { t: 'rail' } },
    { text: 'Maju ke stasiun terdekat. Bila dimiliki, bayar sewa dua kali lipat.', fx: { t: 'rail' } },
    { text: 'Maju ke utilitas terdekat. Bila dimiliki, lempar dadu dan bayar 10 kali angka dadu.', fx: { t: 'util' } },
    { text: 'Mundur tiga petak.', fx: { t: 'back', n: 3 } },
    { text: 'Masuk penjara. Langsung masuk, jangan lewat MULAI.', fx: { t: 'jail' } },
    { text: 'Kartu bebas penjara. Simpan sampai dibutuhkan.', fx: { t: 'jailcard' } },
    { text: 'Bayar setiap pemain Rp 50.000.', fx: { t: 'payEach', n: K(50) } },
    { text: 'Bank membayar dividen Rp 50.000.', fx: { t: 'gain', n: K(50) } },
    { text: 'Menangkan kompetisi teka-teki silang. Terima Rp 100.000.', fx: { t: 'gain', n: K(100) } },
    { text: 'Perbaikan umum: bayar Rp 25.000 per rumah dan Rp 100.000 per hotel.', fx: { t: 'repair', house: K(25), hotel: K(100) } }
  ];

  var CHEST = [
    { text: 'Maju ke MULAI. Kumpulkan Rp 200.000.', fx: { t: 'move', to: 0 } },
    { text: 'Kesalahan bank menguntungkanmu. Terima Rp 200.000.', fx: { t: 'gain', n: K(200) } },
    { text: 'Bayar biaya dokter Rp 50.000.', fx: { t: 'pay', n: K(50) } },
    { text: 'Hasil penjualan saham. Terima Rp 50.000.', fx: { t: 'gain', n: K(50) } },
    { text: 'Kartu bebas penjara. Simpan sampai dibutuhkan.', fx: { t: 'jailcard' } },
    { text: 'Masuk penjara. Langsung masuk, jangan lewat MULAI.', fx: { t: 'jail' } },
    { text: 'Dana liburan cair. Terima Rp 100.000.', fx: { t: 'gain', n: K(100) } },
    { text: 'Refund pajak penghasilan. Terima Rp 20.000.', fx: { t: 'gain', n: K(20) } },
    { text: 'Ulang tahunmu! Kumpulkan Rp 10.000 dari tiap pemain.', fx: { t: 'gainEach', n: K(10) } },
    { text: 'Bayar biaya rumah sakit Rp 100.000.', fx: { t: 'pay', n: K(100) } },
    { text: 'Bayar uang sekolah Rp 150.000.', fx: { t: 'pay', n: K(150) } },
    { text: 'Bayaran konsultasi. Terima Rp 25.000.', fx: { t: 'gain', n: K(25) } },
    { text: 'Perbaikan jalan: bayar Rp 40.000 per rumah dan Rp 115.000 per hotel.', fx: { t: 'repair', house: K(40), hotel: K(115) } },
    { text: 'Asuransi jatuh tempo. Terima Rp 100.000.', fx: { t: 'gain', n: K(100) } },
    { text: 'Denda membuang sampah. Bayar Rp 25.000.', fx: { t: 'pay', n: K(25) } },
    { text: 'Memenangkan kontes foto. Terima Rp 10.000.', fx: { t: 'gain', n: K(10) } }
  ];

  var RULES = {
    startCash: K(1500),
    goSalary: K(200),
    jailFine: K(50),
    jailMaxTurns: 3
  };

  root.MonoData = { BOARD: BOARD, GROUPS: GROUPS, CHANCE: CHANCE, CHEST: CHEST, RULES: RULES };
})(typeof window !== 'undefined' ? window : globalThis);

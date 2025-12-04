require('dotenv').config();
var express = require('express');
var sqlite3 = require('sqlite3').verbose();
var cors = require('cors');
var bcrypt = require('bcrypt');
var jwt = require('jsonwebtoken');
var twilio = require('twilio'); // Twilio varsa kalsın yoksa hata vermez, null kontrolü var.

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNo = process.env.TWILIO_PHONE_NUMBER;

var app = express();
var port = 3000;

app.use(express.json());
app.use(cors());

// --- Yardımcı Fonksiyon: Türkçe Karakter Çeviri (Kullanıcı adı oluşumu için) ---
function trKarakterCevir(metin) {
    var trMap = {
        'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ş': 's', 'Ş': 's',
        'ü': 'u', 'Ü': 'u', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', ' ': ''
    };
    return metin.replace(/[çÇğĞşŞüÜıİöÖ ]/g, function(s) { return trMap[s]; }).toLowerCase();
}

var smsClient = null;
if (accountSid && authToken) {
    smsClient = new twilio(accountSid, authToken);
}

var db = new sqlite3.Database('hrs.db');
var GIZLI_KOD = "supersecretjwtkey";

// --- VERİTABANI KURULUMU ---
db.serialize(function() {
    // Hastalar Tablosu
    db.run("CREATE TABLE IF NOT EXISTS kullanicilar (id INTEGER PRIMARY KEY AUTOINCREMENT, adSoyad TEXT NOT NULL, tcKimlik TEXT UNIQUE NOT NULL, telefon TEXT NOT NULL, sifre TEXT NOT NULL, created_at TEXT)");
    
    // Doktorlar Tablosu (GÜNCELLENDİ: k_adi, sifre eklendi)
    // randevu_araligi: 15, 30, 45, 60 dk
    db.run(`CREATE TABLE IF NOT EXISTS doktorlar (
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        doktor_ad TEXT NOT NULL, 
        klinik TEXT NOT NULL, 
        randevu_default_sure_dk INTEGER DEFAULT 30,
        kullanici_adi TEXT UNIQUE,
        sifre TEXT
    )`);

    // Randevular Tablosu
    db.run("CREATE TABLE IF NOT EXISTS randevular (id INTEGER PRIMARY KEY AUTOINCREMENT, hasta_ad_soyad TEXT, tarih TEXT NOT NULL, saat TEXT NOT NULL, telefon TEXT, doktor_ad TEXT NOT NULL, klinik TEXT NOT NULL, hastane_ad TEXT, randevu_sure_dk INTEGER NOT NULL, created_at TEXT)");

    // Bloklu Saatler (Doktorun kapattığı saatler veya tam gün izinler)
    db.run("CREATE TABLE IF NOT EXISTS bloklu_saatler (id INTEGER PRIMARY KEY AUTOINCREMENT, doktor_ad TEXT, tarih TEXT, baslangic_saat TEXT, bitis_saat TEXT, aciklama TEXT)");

    // Admin Tablosu
    db.run("CREATE TABLE IF NOT EXISTS yoneticiler (id INTEGER PRIMARY KEY AUTOINCREMENT, k_adi TEXT UNIQUE, sifre TEXT)");

    // Varsayılan Admin Ekleme (Eğer yoksa)
    db.get("SELECT count(*) as sayi FROM yoneticiler", function(err, row) {
        if (row.sayi == 0) {
            var adminPass = "admin123"; // Varsayılan şifre
            bcrypt.hash(adminPass, 10, function(err, hash) {
                db.run("INSERT INTO yoneticiler (k_adi, sifre) VALUES (?, ?)", ["admin", hash]);
                console.log("Varsayılan Admin oluşturuldu. K.Adı: admin, Şifre: admin123");
            });
        }
    });
});

// --- MIDDLEWARE: Token Kontrolü (Rol Destekli) ---
function tokenKontrol(req, res, next) {
    var baslik = req.headers.authorization;
    if (!baslik) return res.status(401).json({ message: "Giriş yapmalısınız." });
    
    var token = baslik.split(" ")[1];
    jwt.verify(token, GIZLI_KOD, function(err, decoded) {
        if (err) return res.status(403).json({ message: "Geçersiz oturum." });
        req.user = decoded; // decoded içinde {id, role, isim} olacak
        next();
    });
}

// --- SMS FONKSİYONU ---
function smsAt(numara, mesaj) {
    if(smsClient && numara) {
        var temizNo = numara.replace(" ", "");
        if(temizNo.indexOf("0") == 0) temizNo = temizNo.substring(1);
        var gonderilecek = "+90" + temizNo;
        smsClient.messages.create({
            body: mesaj, from: twilioNo, to: gonderilecek
        }).catch(err => console.log("SMS Hatası:", err));
    }
}

// --- ORTAK GİRİŞ (LOGIN) ---
app.post("/login", function(req, res) {
    // BURASI DEĞİŞTİ: Hem 'kimlik' (yeni sistem) hem 'tcKimlik' (eski sistem) kabul ediliyor.
    var kimlik = req.body.kimlik || req.body.tcKimlik; 
    var sifre = req.body.sifre;
    
    // Eğer tip gelmezse (eski giriş sayfası) varsayılan olarak 'hasta' kabul et.
    var tip = req.body.tip || 'hasta'; 

    if (!kimlik || !sifre) {
        return res.status(400).json({ message: "Lütfen tüm alanları doldurun." });
    }

    if(tip === 'admin') {
        db.get("SELECT * FROM yoneticiler WHERE k_adi = ?", [kimlik], function(err, admin) {
            if(!admin) return res.status(400).json({ message: "Admin bulunamadı." });
            bcrypt.compare(sifre, admin.sifre, function(err, match) {
                if(match) {
                    var token = jwt.sign({ id: admin.id, role: 'admin', isim: 'Yönetici' }, GIZLI_KOD, { expiresIn: "12h" });
                    res.json({ message: "Admin girişi başarılı", token, role: 'admin' });
                } else res.status(400).json({ message: "Şifre yanlış." });
            });
        });
    } 
    else if (tip === 'doktor') {
        db.get("SELECT * FROM doktorlar WHERE kullanici_adi = ?", [kimlik], function(err, dr) {
            if(!dr) return res.status(400).json({ message: "Doktor bulunamadı." });
            bcrypt.compare(sifre, dr.sifre, function(err, match) {
                if(match) {
                    var token = jwt.sign({ id: dr.id, role: 'doktor', isim: dr.doktor_ad, klinik: dr.klinik }, GIZLI_KOD, { expiresIn: "12h" });
                    res.json({ message: "Doktor girişi başarılı", token, role: 'doktor' });
                } else res.status(400).json({ message: "Şifre yanlış." });
            });
        });
    } 
    else { // Varsayılan: Hasta Girişi (TC ile)
        db.get("SELECT * FROM kullanicilar WHERE tcKimlik = ?", [kimlik], function(err, kul) {
            // Hata ayıklama için konsola yazdıralım
            if(!kul) {
                console.log("Aranan TC:", kimlik, "- Bulunamadı.");
                return res.status(400).json({ message: "Kayıtlı hasta bulunamadı." });
            }
            bcrypt.compare(sifre, kul.sifre, function(err, match) {
                if(match) {
                    var token = jwt.sign({ id: kul.id, role: 'hasta', isim: kul.adSoyad }, GIZLI_KOD, { expiresIn: "24h" });
                    res.json({ message: "Giriş başarılı", token, role: 'hasta' });
                } else res.status(400).json({ message: "Şifre yanlış." });
            });
        });
    }
});

// --- HASTA KAYIT ---
app.post("/register", function(req, res) {
    var gelen = req.body;
    bcrypt.hash(gelen.sifre, 10, function(err, hash) {
        var tarih = new Date().toISOString();
        db.run("INSERT INTO kullanicilar (adSoyad, tcKimlik, telefon, sifre, created_at) VALUES (?, ?, ?, ?, ?)", 
            [gelen.adSoyad, gelen.tcKimlik, gelen.telefon, hash, tarih], 
            function(err) {
                if (err) res.status(500).json({ message: "TC kullanılıyor olabilir." });
                else res.json({ message: "Kayıt tamam." });
            }
        );
    });
});

// --- ADMIN: DOKTOR EKLEME ---
app.post('/admin/doktor-ekle', tokenKontrol, function(req, res) {
    if(req.user.role !== 'admin') return res.status(403).json({message: "Yetkisiz işlem"});

    var { adSoyad, klinik } = req.body;
    
    // Otomatik Kimlik Oluşturma
    // Örn: Ad: Berke Boran, Klinik: Üroloji
    // k_adi: berke.boran
    // sifre_ham: berkeboran.uroloji
    
    var temizAd = trKarakterCevir(adSoyad).replace(" ", "."); // berke.boran
    var temizKlinik = trKarakterCevir(klinik);
    
    var kAdi = temizAd;
    var hamSifre = trKarakterCevir(adSoyad).replace(".","") + "." + temizKlinik; // berkeboran.uroloji

    bcrypt.hash(hamSifre, 10, function(err, hash) {
        db.run("INSERT INTO doktorlar (doktor_ad, klinik, randevu_default_sure_dk, kullanici_adi, sifre) VALUES (?, ?, ?, ?, ?)",
            [adSoyad, klinik, 30, kAdi, hash], // Varsayılan 30 dk
            function(err) {
                if(err) res.status(500).json({message: "Veritabanı hatası veya kullanıcı adı çakışması."});
                else res.json({
                    message: "Doktor eklendi.",
                    bilgi: {
                        kullanici_adi: kAdi,
                        sifre: hamSifre
                    }
                });
            }
        );
    });
});

// --- DOKTOR: AYARLARI GÜNCELLE (Şifre & Süre) ---
app.put('/doktor/me', tokenKontrol, function(req, res) {
    if(req.user.role !== 'doktor') return res.status(403).json({message: "Sadece doktorlar."});

    var { yeniSifre, randevuSure } = req.body;
    var drId = req.user.id;

    if(yeniSifre) {
        bcrypt.hash(yeniSifre, 10, function(err, hash) {
            db.run("UPDATE doktorlar SET sifre = ? WHERE id = ?", [hash, drId]);
        });
    }

    if(randevuSure) {
        db.run("UPDATE doktorlar SET randevu_default_sure_dk = ? WHERE id = ?", [randevuSure, drId]);
    }

    res.json({message: "Bilgiler güncellendi."});
});

// --- DOKTOR: SAAT BLOKLAMA (İzin/Mola) ---
app.post('/doktor/blok', tokenKontrol, function(req, res) {
    if(req.user.role !== 'doktor') return res.status(403).json({message: "Yetkisiz"});
    
    var { tarih, baslangic, bitis, aciklama } = req.body;
    // Eğer tüm gün ise frontend'den baslangic: 00:00, bitis: 23:59 gelir.

    db.run("INSERT INTO bloklu_saatler (doktor_ad, tarih, baslangic_saat, bitis_saat, aciklama) VALUES (?, ?, ?, ?, ?)",
        [req.user.isim, tarih, baslangic, bitis, aciklama],
        function(err) {
            if(err) res.status(500).json({message: "Hata"});
            else res.json({message: "Saatler kapatıldı."});
        }
    );
});

// --- DOKTOR: KENDİ RANDEVULARINI GÖRME ---
app.get('/doktor/randevular', tokenKontrol, function(req, res) {
    if(req.user.role !== 'doktor') return res.status(403).json({message: "Yetkisiz"});
    
    db.all("SELECT * FROM randevular WHERE doktor_ad = ? ORDER BY tarih DESC, saat ASC", [req.user.isim], function(err, rows) {
        res.json(rows);
    });
});

// --- GENEL: UYGUN SAATLERİ HESAPLAMA (Gelişmiş Algoritma) ---
app.get("/uygun-saatler", function(req, res) {
    var drIsim = req.query.doktor_ad;
    var tarih = req.query.tarih;

    // Önce doktorun varsayılan süresini alalım (15, 30, 45, 60?)
    db.get("SELECT randevu_default_sure_dk FROM doktorlar WHERE doktor_ad = ?", [drIsim], function(err, dr) {
        if(!dr) return res.json([]);

        var aralik = dr.randevu_default_sure_dk; // Örn: 15
        var tumSaatler = [];
        
        // 09:00 - 17:00 arası (Basit olsun diye sabit mesai varsayıyoruz, istenirse DB'ye eklenir)
        var baslangicDk = 9 * 60; // 540 dk
        var bitisDk = 17 * 60;    // 1020 dk

        for (var d = baslangicDk; d < bitisDk; d += aralik) {
            var hh = Math.floor(d / 60);
            var mm = d % 60;
            var sStr = (hh < 10 ? "0"+hh : hh) + ":" + (mm < 10 ? "0"+mm : mm);
            tumSaatler.push(sStr);
        }

        // Dolu saatleri çek (Randevular + Bloklu Saatler)
        var sql = `
            SELECT saat as baslangic, randevu_sure_dk as sure, 'randevu' as tip FROM randevular WHERE doktor_ad=? AND tarih=?
            UNION
            SELECT baslangic_saat as baslangic, 0 as sure, 'blok' as tip, bitis_saat as bitis FROM bloklu_saatler WHERE doktor_ad=? AND tarih=?
        `;

        db.all("SELECT saat, randevu_sure_dk FROM randevular WHERE doktor_ad=? AND tarih=?", [drIsim, tarih], function(err, randevular) {
            db.all("SELECT baslangic_saat, bitis_saat FROM bloklu_saatler WHERE doktor_ad=? AND tarih=?", [drIsim, tarih], function(err, bloklar) {
                
                var doluDakikalar = new Set();

                // 1. Randevuları işaretle
                randevular.forEach(r => {
                    var [sa, da] = r.saat.split(":").map(Number);
                    var basla = sa * 60 + da;
                    var bit = basla + r.randevu_sure_dk;
                    for(var i = basla; i < bit; i++) doluDakikalar.add(i);
                });

                // 2. Blokları işaretle
                bloklar.forEach(b => {
                    var [bs, bd] = b.baslangic_saat.split(":").map(Number);
                    var [bts, btd] = b.bitis_saat.split(":").map(Number);
                    var basla = bs * 60 + bd;
                    var bit = bts * 60 + btd;
                    for(var i = basla; i < bit; i++) doluDakikalar.add(i);
                });

                var musaitler = [];
                var simdi = new Date();
                var bugunStr = simdi.toISOString().split('T')[0];
                var suanDk = simdi.getHours() * 60 + simdi.getMinutes();

                tumSaatler.forEach(saatStr => {
                    var [h, m] = saatStr.split(":").map(Number);
                    var dk = h * 60 + m;
                    var randevuBitis = dk + aralik;

                    // Geçmiş saat kontrolü
                    if(tarih == bugunStr && dk <= suanDk) return;

                    // Çakışma kontrolü (Başlangıçtan bitişe kadar olan aralıkta dolu dakika var mı?)
                    var cakisma = false;
                    for(var k = dk; k < randevuBitis; k++) {
                        if(doluDakikalar.has(k)) {
                            cakisma = true;
                            break;
                        }
                    }

                    if(!cakisma) musaitler.push(saatStr);
                });

                res.json(musaitler);
            });
        });
    });
});

// --- DİĞER APILER (Aynen korunabilir veya güncellenebilir) ---
app.get('/doktorlar', function(req, res) {
    // Sadece ad, klinik ve süre dönüyoruz, şifre dönmemeli
    db.all("SELECT id, doktor_ad, klinik, randevu_default_sure_dk FROM doktorlar", function(err, satirlar) {
        res.json(satirlar);
    });
});

// Hasta Randevu Al (Mevcut kodunun tokenKontrol ile korunan hali)
app.post('/randevular', tokenKontrol, function(req, res) {
    if(req.user.role !== 'hasta') return res.status(403).json({message: "Sadece hastalar randevu alabilir."});
    
    var veri = req.body;
    // Basit çakışma kontrolü yerine server tarafında tekrar detaylı kontrol eklenebilir
    // Şimdilik basit insert yapıyoruz (bloklu saat kontrolü eklenmeli idealde)
    var created = new Date().toISOString();
    
    db.run("INSERT INTO randevular (hasta_ad_soyad, tarih, saat, telefon, doktor_ad, klinik, hastane_ad, randevu_sure_dk, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [req.user.isim, veri.tarih, veri.saat, '0555', veri.doktor_ad, veri.klinik, 'Merkez Hastanesi', veri.randevu_sure_dk, created],
        function(err) {
            if(err) res.status(500).json({message: "Hata"});
            else res.json({message: "Randevu alındı"});
        }
    );
});

app.get('/randevularim', tokenKontrol, function(req, res) {
    // Hasta kendi randevularını görür
    var sql = "SELECT * FROM randevular WHERE hasta_ad_soyad = ? ORDER BY tarih DESC";
    db.all(sql, [req.user.isim], function(err, rows) {
        res.json(rows);
    });
});

// --- ADMIN: DOKTOR SİLME ---
app.delete('/admin/doktor/:id', tokenKontrol, function(req, res) {
    // Sadece admin yetkisi olanlar silebilir
    if(req.user.role !== 'admin') return res.status(403).json({message: "Yetkisiz işlem"});

    var id = req.params.id;
    
    // Önce doktoru silelim
    db.run("DELETE FROM doktorlar WHERE id = ?", [id], function(err) {
        if(err) {
            res.status(500).json({message: "Doktor silinemedi."});
        } else {
            // İsteğe bağlı: Doktorun gelecekteki randevularını da silebilirsiniz veya tutabilirsiniz.
            // Şimdilik sadece doktoru siliyoruz.
            res.json({message: "Doktor başarıyla silindi."});
        }
    });
});

// ... (Önceki kodlar aynı kalacak)

// --- YENİ EKLENEN: ADMIN İÇİN TÜM DOKTOR LİSTESİ (Kullanıcı Adı Dahil) ---
app.get('/admin/doktorlar', tokenKontrol, function(req, res) {
    if(req.user.role !== 'admin') return res.status(403).json({message: "Yetkisiz"});

    // Admin panelinde ID (kullanıcı adı) gözüksün diye onu da seçiyoruz
    db.all("SELECT id, doktor_ad, klinik, kullanici_adi, randevu_default_sure_dk FROM doktorlar", function(err, satirlar) {
        if(err) res.status(500).json([]);
        else res.json(satirlar);
    });
});

// --- HASTALAR İÇİN DOKTOR LİSTESİ (Randevu Al Sayfası İçin) ---
app.get('/doktorlar', function(req, res) {
    // Burada şifre gibi özel bilgileri göndermiyoruz, sadece randevu için gerekenler.
    db.all("SELECT id, doktor_ad, klinik, randevu_default_sure_dk FROM doktorlar", function(err, satirlar) {
        res.json(satirlar);
    });
});
// --- HERKES İÇİN DOKTOR LİSTESİ (Randevu Al Sayfası İçin) ---
// Dikkat: Burada 'tokenKontrol' YOK. Çünkü sayfa yüklenince dropdown dolmalı.
app.get('/doktorlar', function(req, res) {
    db.all("SELECT id, doktor_ad, klinik, randevu_default_sure_dk FROM doktorlar", function(err, satirlar) {
        if(err) {
            console.log(err);
            res.json([]);
        } else {
            res.json(satirlar);
        }
    });
});

// ... (Diğer kodlar aynı kalacak)
app.listen(port, () => console.log("Sunucu :3000 portunda çalışıyor."));
// --- RANDEVU İPTAL ETME (SİLME) ---
app.delete('/randevular/:id', tokenKontrol, function(req, res) {
    var silinecekId = req.params.id;
    var userId = req.user.id; // Token'dan gelen kullanıcı ID'si

    // 1. Önce token sahibinin adını veritabanından bulalım
    db.get("SELECT adSoyad FROM kullanicilar WHERE id = ?", [userId], function(err, user) {
        if(!user) {
            return res.status(401).json({ message: "Kullanıcı doğrulanamadı." });
        }

        // 2. Randevuyu veritabanından silmeye çalış
        // GÜVENLİK: Sadece ID'si tutan VE Hasta adı eşleşen randevuyu siler.
        // Böylece başkasının randevusunu silemezler.
        var sql = "DELETE FROM randevular WHERE id = ? AND hasta_ad_soyad = ?";
        
        db.run(sql, [silinecekId, user.adSoyad], function(err) {
            if(err) {
                console.log("Silme hatası:", err);
                return res.status(500).json({ message: "Sunucu hatası oluştu." });
            }

            // this.changes = Veritabanında işlem gören satır sayısı
            if (this.changes > 0) {
                res.json({ message: "Randevu başarıyla iptal edildi." });
            } else {
                // Eğer 0 satır silindiyse, randevu yok demektir veya kullanıcıya ait değildir.
                res.status(404).json({ message: "Randevu bulunamadı veya iptal edilemedi." });
            }
        });
    });
});


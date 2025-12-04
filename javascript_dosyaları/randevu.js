var anaUrl = "http://localhost:3000";
var tumDoktorlar = []; 

window.onload = function() {
    tarihKisiti();
    verileriGetir();
    
    var klinikKutu = document.getElementById("select-klinik");
    var doktorKutu = document.getElementById("select-doktor");
    var tarihKutu = document.getElementById("input-tarih");
    var form = document.getElementById("form-randevu");

    klinikKutu.onchange = function() {
        doktorlariDoldur();
    };

    doktorKutu.onchange = function() {
        saatleriGetir();
    };

    tarihKutu.onchange = function() {
        saatleriGetir();
    };
    
    form.onsubmit = function(e) {
        e.preventDefault();
        randevuKaydet();
    };
};

function tarihKisiti() {
    var simdi = new Date();
    var gun = simdi.getDate();
    var ay = simdi.getMonth() + 1;
    var yil = simdi.getFullYear();

    if(gun < 10) gun = "0" + gun;
    if(ay < 10) ay = "0" + ay;

    var formatli = yil + "-" + ay + "-" + gun;
    document.getElementById("input-tarih").setAttribute("min", formatli);
}

async function verileriGetir() {
    try {
        var cevap = await fetch(anaUrl + "/doktorlar");
        var veriler = await cevap.json();
        tumDoktorlar = veriler; 

        var klinikSelect = document.getElementById("select-klinik");
        var eklenenler = [];

        klinikSelect.innerHTML = '<option value="">-- Seçiniz --</option>';

        for (var i = 0; i < veriler.length; i++) {
            var satir = veriler[i];
            var klinikAdi = satir.klinik;
            
            if (eklenenler.indexOf(klinikAdi) == -1) {
                eklenenler.push(klinikAdi);
                klinikSelect.innerHTML += '<option value="' + klinikAdi + '">' + klinikAdi + '</option>';
            }
        }
    } catch (hata) {
        console.log("Hata oldu: " + hata);
    }
}

function doktorlariDoldur() {
    var secilenKlinik = document.getElementById("select-klinik").value;
    var doktorSelect = document.getElementById("select-doktor");
    var saatSelect = document.getElementById("select-saat");

    doktorSelect.innerHTML = '<option value="">-- Seçiniz --</option>';
    saatSelect.innerHTML = '<option value="">-- Tarih ve Doktor Seçiniz --</option>';
    saatSelect.disabled = true;

    for (var i = 0; i < tumDoktorlar.length; i++) {
        var dr = tumDoktorlar[i];
        if (dr.klinik == secilenKlinik) {
            doktorSelect.innerHTML += '<option value="' + dr.doktor_ad + '" data-sure="' + dr.randevu_default_sure_dk + '">' + dr.doktor_ad + '</option>';
        }
    }
}



async function saatleriGetir() {
    var drVal = document.getElementById("select-doktor").value;
    var tarihVal = document.getElementById("input-tarih").value;
    var saatSelect = document.getElementById("select-saat");

    if (drVal == "" || tarihVal == "") {
        return;
    }

    saatSelect.innerHTML = '<option>Yükleniyor...</option>';
    saatSelect.disabled = true;

    try {
        var url = anaUrl + "/uygun-saatler?doktor_ad=" + drVal + "&tarih=" + tarihVal;
        var cevap = await fetch(url);
        var saatler = await cevap.json();

        saatSelect.innerHTML = "";

        if (saatler.length == 0) {
            saatSelect.innerHTML = '<option value="">Dolu</option>';
        } else {
            saatSelect.innerHTML = '<option value="">-- Saat Seçiniz --</option>';
            for (var i = 0; i < saatler.length; i++) {
                saatSelect.innerHTML += '<option value="' + saatler[i] + '">' + saatler[i] + '</option>';
            }
            saatSelect.disabled = false;
        }

    } catch (hata) {
        console.log(hata);
        saatSelect.innerHTML = '<option>Hata</option>';
    }
}

async function randevuKaydet() {
    var token = localStorage.getItem("token");
    if(!token) {
        window.location.href = "/html_dosyaları/giris.html";
        return;
    }

    var drSelect = document.getElementById("select-doktor");
    var saatSelect = document.getElementById("select-saat");
    var klinikSelect = document.getElementById("select-klinik");
    var tarihInput = document.getElementById("input-tarih");


    var secilenDrOption = drSelect.options[drSelect.selectedIndex];
    var sure = secilenDrOption.getAttribute("data-sure");
    if(!sure) sure = 30;

    var veri = {
        tarih: tarihInput.value,
        saat: saatSelect.value,
        doktor_ad: drSelect.value,
        klinik: klinikSelect.value,
        hastane_ad: "Merkez Hastanesi",
        randevu_sure_dk: sure
    };

    try {
        var istek = await fetch(anaUrl + "/randevular", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify(veri)
        });

        var cevap = await istek.json();

        if (istek.status == 200) {
            alert("Randevunuz başarıyla oluşturuldu.");
            window.location.href = "/html_dosyaları/randevularım.html";
        } else {
            alert("Hata: " + cevap.message);
        }

    } catch (e) {
        alert("Sunucu hatası.");
    }
}

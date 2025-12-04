var anaUrl = "http://localhost:3000";

var form = document.getElementById("girisFormu");

if(form) {
    form.addEventListener("submit", function(olay) {
        olay.preventDefault();
        girisYap();
    });
}

async function girisYap() {
    var tcInput = document.getElementById("tcKimlik");
    var sifreInput = document.getElementById("sifre");
    
    var tcError = document.getElementById("tcError");
    var passError = document.getElementById("passError");
    
    // Hataları sıfırla
    tcError.style.display = "none";
    passError.style.display = "none";
    tcInput.style.borderColor = "#e2e8f0";
    sifreInput.style.borderColor = "#e2e8f0";

    var tcVal = tcInput.value;
    var passVal = sifreInput.value;
    var hataVar = false;

    // --- 1. TC KONTROLÜ ---
    // Sadece rakamlardan oluşmalı ve 11 hane olmalı
    var sayiRegex = /^[0-9]+$/;
    if (tcVal.length !== 11 || !sayiRegex.test(tcVal)) {
        tcError.style.display = "block";
        tcInput.style.borderColor = "var(--danger)";
        hataVar = true;
    }

    // --- 2. ŞİFRE KONTROLÜ ---
    // En az 8 karakter olmalı
    if (passVal.length < 8) {
        passError.style.display = "block";
        sifreInput.style.borderColor = "var(--danger)";
        hataVar = true;
    }

    if(hataVar) return; // Hata varsa sunucuya gitme

    // --- SUNUCU İSTEĞİ ---
    var gonderilecek = {
        kimlik: tcVal,
        sifre: passVal,
        tip: 'hasta'
    };

    var btn = document.getElementById("btnGiris");
    btn.innerText = "Kontrol ediliyor...";
    btn.disabled = true;

    try {
        var istek = await fetch(anaUrl + "/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(gonderilecek)
        });

        var cevap = await istek.json();

        if (istek.ok) {
            localStorage.setItem("token", cevap.token);
            localStorage.setItem("role", "hasta");
            window.location.href = "/html_dosyaları/anasayfa.html";
        } else {
            alert("Hata: " + cevap.message);
            btn.innerText = "Giriş Yap";
            btn.disabled = false;
        }

    } catch (hata) {
        alert("Sistem hatası oluştu.");
        console.log(hata);
        btn.innerText = "Giriş Yap";
        btn.disabled = false;
    }
}

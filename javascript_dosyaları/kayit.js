var sunucuUrl = "http://localhost:3000";

async function kayitOl(olay) {
    olay.preventDefault(); 

    var ad = document.getElementById("input-ad").value;
    var tc = document.getElementById("input-tc").value;
    var tel = document.getElementById("input-tel").value;
    var pas1 = document.getElementById("input-sifre").value;
    var pas2 = document.getElementById("input-sifre2").value;

    var tcUyari = document.getElementById("tcUyari");
    var passUyari = document.getElementById("passUyari");
    
    // Uyarıları gizle
    tcUyari.style.display = "none";
    passUyari.style.display = "none";

    // --- KONTROLLER ---
    
    // TC Kontrolü (11 hane ve sayı)
    if (tc.length !== 11 || !/^[0-9]+$/.test(tc)) {
        tcUyari.style.display = "block";
        return;
    }

    // Şifre Uzunluk Kontrolü
    if (pas1.length < 8) {
        passUyari.innerText = "Şifre en az 8 karakter olmalıdır.";
        passUyari.style.display = "block";
        return;
    }

    // Şifre Eşleşme Kontrolü
    if (pas1 !== pas2) {
        alert("Şifreler birbirini tutmuyor!");
        return;
    }

    var gonderilecek = {
        adSoyad: ad,
        tcKimlik: tc,
        telefon: tel,
        sifre: pas1
    };

    try {
        var istek = await fetch(sunucuUrl + "/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(gonderilecek)
        });

        var sonuc = await istek.json();

        if (istek.status == 200) {
            alert("Kayıt başarılı! Giriş sayfasına yönlendiriliyorsunuz.");
            window.location.href = "index.html";
        } else {
            alert("Hata: " + sonuc.message);
        }

    } catch (hata) {
        alert("Bağlantı hatası oluştu.");
    }
}
# Çıkış ve isim uyarısı düzeltmesi

23 Ekim 2026 teslimatı; testler 22 Ekim 2026 tarihinde tamamlandı. Yalnız istenen iki davranış ve bunların doğrulaması değiştirildi.

## Değişen kaynak dosyaları

- `server/engine.ts`: isteğe bağlı `leftAt`, aktif katılımcı ayrımı, açık ayrılmada hedef/oy temizliği, sahiplik devri, avcı ve zafer sırası, tamamlanmadı kapanışı. Eski kayıtlar desteklenir.
- `server/index.ts`: üyelik arama, `/api/me`, yeniden bağlantı, yayın ve komut yetkisi artık tarihsel ayrılmış oyuncuyu aktif üye saymaz. Komut oda kodu denetlenir. Ayrılma ve sonuç aynı mevcut transaction yoluyla saklanır.
- `shared/protocol.ts`: zorunlu komut `roomCode`, herkese açık ayrıldı durumu, ortak isim doğrulaması ve Türkçe hata mesajları.
- `client/main.tsx`: her fazda üstte çıkış düğmesi, aktif maç onayı, hata durumunda ekranda kalma; isim alanında erişilebilir, odaklanan hata gösterimi.
- `client/style.css`: mobil çıkış düğmesi, yerel dialog görünümü ve isim hatası stili.
- `tests/leave.test.ts`, `tests/server.test.ts`, `tests/engine.test.ts`, `tests/e2e/leave.spec.ts`, `tests/e2e/game.spec.ts`: yeni regresyonlar ve oda kodunu taşıyan mevcut test mesajları.
- `README.md`: güncel çıkış/üyelik kuralları. `TEST-RESULTS.md`: doğrulama sonuçları.

`server/store.ts`, Prisma şeması ve migration dosyaları değiştirilmedi. Profil çerezi silinmez. Mevcut geçmiş silinmez. Ayrılma kaydı oda JSONB durumunda tutulur; ayrıca migration gerekmez.

## GitHub ve Render'a aktarma

Bu çalışmada commit, push veya canlı deploy yapılmadı.

1. Güncel ZIP içindeki yukarıda listelenen dosyaları, Render'ın bağlı olduğu gerçek GitHub deposunun yerel kopyasına aynı göreli yollarla aktarın. Kendi `.env`, Render ayarları ve projeye sonradan eklediğiniz diğer dosyaları koruyun.
2. GitHub deposunda `git diff --stat` ve `git diff` ile değişiklikleri inceleyin. `npm ci`, `npm run db:generate`, `npm test`, `npm run build` çalıştırın. Playwright tarayıcıları kuruluysa `npm run test:e2e` de çalıştırın. Varsayılan testler yalnız yeni, ayrı `.test-data` kayıtlarını kullanır. Canlı veritabanını test için kullanmayın.
3. Yalnız ilgili dosyaları stage edip kendi commit'inizi oluşturun. `.env`, veritabanı dosyaları, `.test-data`, `node_modules` ve test oturum verilerini eklemeyin. Ardından Render'ın bağlı olduğu dala push edin. Bu adımları kullanıcı olarak siz başlatmalısınız.
4. Render'da bağlı dalı ve otomatik deploy ayarını kontrol edin. Otomatik dağıtım açıksa push yayını tetikleyebilir; kapalıysa ilgili commit için manuel dağıtım başlatın. Mevcut build/start komutları ve PostgreSQL bağlantısı korunabilir; bu düzeltme yeni ortam değişkeni gerektirmez.
5. Yeni istemci ve sunucu birlikte yayımlansın. Komutlar artık oda kodu taşıdığı için açık eski sekmeleri yenileyin. 360 px görünümde boş isim, aktif maçtan onaylı çıkış, yenileme ve yeni oda oluşturmayı canlıda kısa bir smoke test ile kontrol edin.

Canlı veritabanında `prisma migrate reset`, volume silme veya geçmiş temizleme komutu çalıştırmayın.

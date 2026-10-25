# Gece Kasabası — Vampir Köylü

Türkçe, telefon öncelikli, gerçek zamanlı 5–16 kişilik oyun. Her oyuncu kendi cihazından katılır. Ses ve genel yazılı sohbet içermez; yan yana veya harici sesli iletişim ile oynanır. Vampirlerin özel paneli yalnız hedef seçimlerini gösterir.

## Hızlı başlatma: Docker

Docker Desktop'ın Linux container motorunu açın. Bu klasörde:

```sh
docker compose up --build -d
```

Bilgisayarda `http://localhost:3000` açın. Compose PostgreSQL'i başlatır, migration uygular ve uygulamayı çalıştırır. Veriler `postgres_data` volume'ünde kalır. Durdurmak için `docker compose down`; **`-v` eklemek veritabanını siler**.

Yerel varsayılan parola yalnız geliştirme içindir. Üretimde `.env` içinde `POSTGRES_PASSWORD`, `NODE_ENV=production`, `PUBLIC_ORIGIN=https://oyun.example.com` ve güvenilen ters vekil kullanıyorsanız `TRUST_PROXY=1` tanımlayın. Paroladaki URI özel karakterlerini DATABASE_URL içinde kodlayın. Compose varsayılan HTTP yerel ağ denemesine izin vermek için `development` kullanır; uygulama yine derlenmiş React dosyalarını sunar.

## Doğrudan geliştirme

Node.js 22 veya 24 ve PostgreSQL 16+ gerekir.

```sh
npm ci
```

`.env.example` dosyasını `.env` adıyla kopyalayın ve `DATABASE_URL` değerini ayarlayın. PowerShell: `Copy-Item .env.example .env`.

```sh
# Yalnız veritabanını Docker ile çalıştırmak isterseniz:
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run dev
```

Geliştirme arayüzü `http://localhost:5173`; Vite `/api` ve `/socket.io` isteklerini Node sunucusuna aktarır. Oturum ve Socket.IO aynı origin üzerinde çalışır. Arka uç varsayılan `0.0.0.0:3000`, Vite `0.0.0.0:5173` dinler.

Derlenmiş uygulama:

```sh
npm run build
npm start
```

Bu modda hem arayüz hem API/Socket.IO `http://localhost:3000` adresindedir. PostgreSQL bağlantısı kurulamazsa sunucu başlamaz; üretimde belleğe veya dosya depolamasına sessiz geçiş yapılmaz.

## Telefonda / aynı Wi-Fi ağında

1. Bilgisayar ve telefon aynı yerel ağa bağlı olsun. Misafir Wi-Fi ağında cihaz yalıtımı açıksa bağlantı kurulamayabilir.
2. Windows'ta `ipconfig` ile aktif Wi-Fi/Ethernet adaptörünün IPv4 adresini bulun; örnek `192.168.1.42`.
3. Derlenmiş uygulama veya Compose için telefonda `http://192.168.1.42:3000`; Vite için `http://192.168.1.42:5173` açın.
4. **Telefondaki `localhost` telefonu ifade eder; bilgisayarınızı göstermez.** Davet bağlantısını oluştururken bilgisayarda da yerel IP adresini açın. Böylece QR ve davet bağlantısı doğru adresi taşır.
5. Windows Güvenlik Duvarı bağlantıyı engellerse yalnız Özel ağ profilinde kullanılan TCP portuna izin verin. Yönetici PowerShell örneği:

```powershell
New-NetFirewallRule -DisplayName 'Gece Kasabasi yerel' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private
# Vite kullanıyorsanız ayrıca 5173 gerekir.
```

İşiniz bittiğinde `Remove-NetFirewallRule -DisplayName 'Gece Kasabasi yerel'` ile kuralı kaldırabilirsiniz. Veritabanı portunu telefona/internete açmayın; Compose 5432'yi yalnız bilgisayarın loopback adresine bağlar. Güvenlik duvarı kuralları bu proje tarafından otomatik değiştirilmez.

HTTP yerel IP'de pano, paylaşım menüsü ve ana ekrana ekleme gibi özellikler tarayıcı tarafından kısıtlanabilir. Kopyalama başarısızsa bağlantı metin olarak gösterilir; QR her zaman kullanılabilir. UUID üretimi HTTPS olmayan LAN için `getRandomValues` geri dönüşünü destekler.

## İnternetten arkadaşlarla oynamak

Kalıcı Node.js süreci, PostgreSQL ve HTTPS/WSS destekleyen bir sunucu gerekir. Yalnız statik barındırma veya kısa ömürlü serverless fonksiyon yeterli değildir. Bir Node örneği çalıştırın. Ters vekilde `/socket.io` için WebSocket yükseltmesini, HTTP uzun yoklamayı ve en az 65 saniyelik bağlantı zaman aşımını destekleyin. Örnek Nginx yapılandırması `deploy/nginx.conf` dosyasındadır.

- TLS sertifikası ile aynı origin üzerinden arayüz, API ve Socket.IO sunun.
- `NODE_ENV=production` oturum çerezini `Secure` yapar; bu modda düz HTTP'de oturum çalışmaz.
- `PUBLIC_ORIGIN` tam HTTPS adresi olmalı; sonunda `/` bulunmamalı.
- `TRUST_PROXY=1` yalnız uygulamaya doğrudan erişim kapalı ve tam bir güvenilen vekil varsa kullanılmalı.
- PostgreSQL için kalıcı disk, düzenli yedek, güçlü parola ve erişim sınırları kullanın.
- Birden çok Node örneği desteklenmez. Yeniden başlatırken eski örneği durdurun; rolling deployment ile eşzamanlı iki sunucu çalıştırmayın.

Bu teslimatta herkese açık internete dağıtım yapılmadı; harici hesap veya ücretli servis zorunlu değildir.

## Oyun kuralları

Oda kapasitesi 5–16; rol toplamı kapasiteye eşit olmalıdır. Her özel rol en fazla bir kez bulunur. Vampir sayısı diğer oyunculardan kesinlikle az olmalıdır. Başka rol uyumsuzluğu yoktur. Arayüzdeki **başlangıç önerisi** denge garantisi değildir; arkadaş grubunuzla ayarlayın. Oyun başlayabilmesi için kapasite dolmalı, herkes bağlı ve hazır olmalıdır. Ayar değişikliği tüm hazır durumlarını sıfırlar.

| Rol     | Takım ve yetenek                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Köylü   | Köylü takımı; yalnız gündüz oy kullanır.                                                                                                                                                                                               |
| Vampir  | Vampir takımı; diğer vampirleri bilir. Yaşayan vampir olmayan bir hedef seçer. En çok seçilen tek hedefe saldırılır; en yüksek oy eşitliğinde veya seçim yoksa saldırı olmaz. Yalnız yaşayan vampirler güncel takım seçimlerini görür. |
| Doktor  | Köylü takımı; bir yaşayan oyuncuyu korur, kendisini seçebilir. Önceki gece koruduğu kişiyi sonraki gece koruyamaz. Bir gece seçim yapmazsa önceki gece hedefi boş kabul edilir. Koruma yalnız o geceki vampir saldırısına uygulanır.   |
| Kâhin   | Köylü takımı; kendisi dışındaki yaşayan birini inceler. Gece sonunda yalnız kendisine “Vampir / Vampir değil” bilgisi gelir; aynı gece elense bile sonucu alır.                                                                        |
| Avcı    | Köylü takımı; elenince 15 saniyede yaşayan başka birini seçebilir. Seçim süresi bitene kadar değişebilir, bir kez uygulanır. Seçmezse geçer. Doktor korumasını yok sayar.                                                              |
| Soytarı | Bağımsız; yalnız gündüz oylamasıyla elenirse kazanır ve maç biter. Gece veya avcı elemesi zafer getirmez. Kâhine vampir değil görünür.                                                                                                 |

Gece eylemleri eşzamanlıdır; herkes seçim yapsa bile süre erken bitmez. Önce kâhin bilgisi ve doktor koruması hesaplanır, ardından vampir saldırısı uygulanır. Gece özeti saldırının başarısızlık nedenini açıklamaz. Eylem yapmayan oyuncunun yeteneği kullanılmaz.

Gündüz yaşayan her oyuncunun bir oyu vardır; kendine oy veremez, pas geçebilir ve süre bitene kadar oyunu değiştirebilir. Kullanılmayan oy pas sayılır. Oylama sırasında yalnız kaç kişinin oy kullandığı gösterilir. Süre sonunda tek bir aday en çok oyu alır ve pas sayısını aşarsa elenir. Aday eşitliği veya pasın eşit/üstün olması kimseyi elemez. Sonuçta aday toplamları ve pas sayısı açıklanır; kimin kime oy verdiği yayımlanmaz.

Zafer sırası: gündüz elenen soytarı → bekleyen avcı eylemi → hiç yaşayan yoksa beraberlik → vampir yoksa köylü takımı → vampir sayısı diğer yaşayanlara eşit/üstünse vampirler. Aksi halde oyun devam eder. Elenen oyuncular konuşmamalıdır; uygulama fiziksel veya harici konuşmayı denetlemez. Elenenler herkese açık akışı, kendi rolünü ve kendi önceki bilgilerini görür; yeni oy/gece eylemi gönderemez.

## Oturum, profil ve geçmiş

Hesap gerekmez. Kalıcı misafir profili, bu tarayıcıda bir yıllık HttpOnly/SameSite=Strict çereze bağlıdır. Veritabanında yalnız token'ın SHA-256 özeti tutulur. Oda kodu kimlik doğrulama anahtarı değildir. Çerezi silmek veya başka tarayıcıya geçmek eski profile erişimi kaybettirir; cihazlar arasında eşitleme yoktur.

Son 100 maçın sonuçları ve özeti profil ekranında gösterilir. Bu pencerenin galibiyet/mağlubiyet/beraberlik/tamamlanmadı sayıları hesaplanır. Takım kazandığında elenmiş üyeler de kazanır; soytarı köylü zaferinden pay almaz. Tamamlanmayan maçlar kazanma/kaybetme sonucu üretmez. Geçmiş kaydı yalnız maç bittikten veya tamamlanmadı olarak kapandıktan sonra oluşturulur; devam eden maçın rolleri geçmişten alınamaz.

Bağlantı kesilmesi oyuncuyu öldürmez ve rolü değiştirmez. Sayaçlar işler; yeniden bağlanırken güncel görünüm gönderilir. Son bağlanan sekme etkin olur ve önceki bağlantıya açıklama gönderilip bağlantı kapatılır. Ev sahibi herhangi bir fazda açıkça ayrılırsa hemen, bağlantısı kesilirse 20 saniye sonra katılım sırasındaki ilk bağlı oyuncuya sahiplik geçer. Açık ayrılmada bağlı kimse yoksa ilk kalan katılımcı sahip olur. Herkes 30 dakika bağlantısızsa maç “tamamlanmadı” olarak kapanır.

Üstteki “Oyundan çık” düğmesi aktif maçta onay ister. Sunucu kaydı başarıyla tamamlayınca ana ekrana dönülür; çerez, profil ve geçmiş korunur. Ayrılan oyuncu yeni oda kurabilir veya başka odaya katılabilir. Aktif maçtaki tarihsel rol kaydı saklanır, fakat oyuncu artık üye veya yaşayan oyuncu sayılmaz; eski odadan görünüm alamaz. Kendi oyları/eylemleri ve kendisini hedefleyen bekleyen seçimler temizlenir. Geçersiz oylar sonuçta pas sayılır. Ayrılma avcı/soytarı yeteneğini tetiklemez. Bekleyen avcı ayrılırsa seçimi iptal edilip oyun devam eder; başka katılımcı ayrıldığında bekleyen avcı çözümlenmeden takım zaferi verilmez. Açıkça ayrılmamış hiç katılımcı kalmazsa takım zaferinden önce maç tamamlanmadı kapanır. Bu kurallar sekme kapatmaya veya geçici bağlantı kesilmesine uygulanmaz.

İsim alanı boş veya yalnız boşluksa devam etme denemesinde alan altında açıklama ve kırmızı kenarlık gösterilir. 2–20 karakter ve mevcut karakter sınırlaması ortak istemci/sunucu şemasıyla doğrulanır. Geçerli isimde uyarı temizlenir.

## Mimari ve kurtarma

- `shared/protocol.ts`: ortak tipler, metinler ve Zod şemaları.
- `server/engine.ts`: Socket.IO/React/veritabanından bağımsız durum makinesi.
- `server/index.ts`: HttpOnly oturum, aynı origin denetimi, hız sınırları, Socket.IO ve zamanlayıcı.
- `server/store.ts`: PostgreSQL/Prisma saklama ve yalnız `NODE_ENV=test` altında kullanılabilen atomik dosya test adaptörü.
- `client/`: React mobil arayüz. Özel bilgiler varsayılan kapalıdır ve görünürlük kaybında gizlenir.
- `prisma/`: şema ve ilk migration. `Room.state` yetkili sunucu durumunu JSONB olarak saklar. `Match` ve `Participation` sonuçları tutar.

Her komut tek sunucu kuyruğunda işlenir. Mevcut durum kopyalanır; doğrulama ve geçiş kopyada yapılır; PostgreSQL transaction tamamlanınca belleğe alınır ve yetkili görünümler yayımlanır. Kayıt başarısızsa başarısız durum yayımlanmaz. Oyun sonu ile maç/katılımcı kayıtları aynı transaction içindedir; `Match.id` upsert tekrar istatistik üretmez.

Faz sürümü, son tarih, oturum üyeliği, rol, hedef ve benzersiz eylem UUID'si doğrulanır. Aynı fazda tekrar işlenen UUID reddedilir; önceki fazdan gelen mesaj sürümle reddedilir. Geçişler süre damgasını önceki fazın son tarihinden ilerletir. Sunucu açılışta durumları yükler ve geçmiş süreleri sırayla çözer; çözümleme fazı da saklandığından ölüm iki kez uygulanmaz. Aşırı eski bir durum için 5000 geçiş güvenlik üst sınırı vardır; bu sınırda maç tamamlanmadı kapanır.

Sunucu her oyuncu için **izin verilen alanları seçerek** ayrı görünüm üretir. Tam durum yayınlanmaz. Herkese açık oyuncu listesinde rol ancak oda ayarıyla elenince veya maç bitince yer alır. Kâhin geçmişi ve vampir hedefleri uygun özel görünümde bulunur; oda sahibi istisna değildir. HTTP oturum/oyun yanıtlarında `no-store`; service worker yoktur. Token ve roller loglanmaz.

### Faz sözleşmesi

Tüm fazlarda ayrıca açık ayrılma komutu kabul edilir. Çıkış onayı sırasında faz değişebilir; bu nedenle yalnız `leave` için eski faz sürümü/zaman aşımı kabul edilir, ancak **oda kodu ve aktif üyelik her zaman doğrulanır**. Diğer bütün komutlarda faz ve son tarih denetimi devam eder. Yeni `roomCode` alanı eski odadan gecikmiş komutların yeni odada çalışmasını engeller. Yayından sonra eski açık istemciler sayfayı yenilemelidir.

Oyuncunun isteğe bağlı `leftAt` alanı JSONB oda durumuna kaydedilir. Eski kayıtlarda alan yoksa oyuncu ayrılmamış kabul edilir. Veritabanı migration veya sıfırlama gerekmez; tarihsel oyuncular yeniden maç lobisine alınmaz.

| Faz              | Eylem / yetki                                   | Süre dolumu ve sonraki faz                  | Gösterilen bilgi                                   |
| ---------------- | ----------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| Lobi             | Herkes hazır/ayrıl; sahip ayar/çıkar/başlat     | Süre yok; başlat → rol gösterimi            | Liste, hazır, ayarlar                              |
| Rol gösterimi    | Oyuncu yerel kartı açar/gizler                  | 8 sn → gece                                 | Kendi rolü, vampirin takımı                        |
| Gece             | Yaşayan vampir/doktor/kâhin geçerli hedef seçer | Ayarlı süre → gece çözümlemesi              | Kendi rol/seçimi; vampirin takım seçimleri         |
| Gece çözümlemesi | Komut yok                                       | 1 sn → avcı, gündüz veya oyun sonu          | Önceki özel geçmiş, açık akış                      |
| Avcı             | Yalnız bekleyen avcı yaşayan hedef seçer        | 15 sn → beklenen gündüz/gece veya oyun sonu | Avcı kimliği ve kendi seçimi; açık akış            |
| Gündüz           | Yazılım eylemi yok; konuşma                     | Ayarlı süre → oylama                        | Gece özeti; kendi geçmiş bilgileri                 |
| Oylama           | Yaşayanlar hedef/pas seçer                      | Ayarlı süre → oy çözümlemesi                | Oy kullanan sayısı, kendi oyu; aday sayıları gizli |
| Oy çözümlemesi   | Komut yok                                       | 1 sn → avcı, gece veya oyun sonu            | Çözümleme tamamlanınca aday toplamları             |
| Oyun sonu        | Sahip yeniden oyna; herkes ayrılabilir          | Yeniden oyna → lobi                         | Bütün roller, sonuç ve tur günlüğü                 |

## Testler

```sh
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

`npm test` oyun motoru ve gerçek HTTP/Socket.IO sunucu testlerini çalıştırır. Varsayılan entegrasyon testleri `.test-data` altında dosya test adaptörü kullanır. Playwright da varsayılan olarak ayrı test verisi ile 3100 portunda sunucu açar; 3100 ve 3101 test portları boş olmalıdır. Üretim istemcisinde sabit rol atama veya test kontrol uçları yoktur. Birim testleri yalnız modül içi fixture'larla sabit roller kullanır; tarayıcı testinde roller gerçek rastgele dağıtılır.

Gerçek PostgreSQL ile test için migration uygulanmış, yalnız testlere ayrılmış bir veritabanı kullanın. Testler yeni profiller/odalar oluşturur, geri yükleme sınamasında yalnız kendi odalarının son tarihini değiştirir:

```powershell
$env:TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/TEST_DATABASE'
npm test
$env:E2E_DATABASE_URL=$env:TEST_DATABASE_URL
npm run test:e2e
```

Bash'te aynı değişkenleri `export` ile ayarlayın. Son rapor `TEST-RESULTS.md` içindedir. Playwright HTML raporu `playwright-report/`, başarısızlık izleri ve ekran görüntüleri `test-results/` altındadır.

## Mobil / PWA

360 px'den başlayan portre yerleşimi; en az 44 px düğmeler; safe-area ve dinamik ekran yüksekliği; normal belge kaydırmasıyla klavye erişimi; renk yanında metin/ikon; reduced-motion desteği. Sayaç sunucunun bitiş zamanı ve saat farkına dayanır. Arka plandaki zamanlayıcı duraklasa bile geri dönünce kalan süre yeniden hesaplanır. Ses varsayılan kapalı ve yalnız isteğe bağlı kısa faz bildirimi olarak bulunur.

Manifest ve 192/512 PNG ikonlar dahildir. HTTPS'te tarayıcınızın “Ana ekrana ekle” seçeneğini kullanabilirsiniz. Oyun çevrimdışı çalışmaz; özel oyun verileri için service worker önbelleği kullanılmaz. Yerel HTTP'de PWA kurulum desteği tarayıcıya bağlıdır.

## Bilinen sınırlar

- Tek Node örneği; dağıtık kilit ve yatay ölçekleme yoktur. Odalar bellekte de tutulur; geniş ölçek için oda arşivleme/temizleme gerekir.
- Bu sürüm sohbet, ses aktarımı, hesap girişi, cihazlar arası profil veya parola kurtarma içermez.
- Sunucu saatinin güvenilir/NTP ile ayarlı olması gerekir. Uzun veritabanı kesintisinde yeni eylemler kaydedilemez; arayüz hata gösterir.
- Geçmiş ekranındaki istatistikler son 100 maçla sınırlıdır.
- Gerçek iPhone/Android cihaz testi ve halka açık HTTPS/WSS dağıtımı yapılmadı. Tarayıcı emülasyonu gerçek cihaz doğrulaması değildir.
- Docker Compose dosyası sağlandı; bu ortamda Docker motorunun pipe erişimi reddedildiğinden Docker çalıştırma sonucu ayrıca doğrulanamadı.

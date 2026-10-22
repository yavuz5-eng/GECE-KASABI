# Doğrulama raporu

Tarih: 22 Ekim 2026. Windows, Node.js 24.15.0, gerçek yerel PostgreSQL 18.4, Prisma 6.19.3. PostgreSQL uygulama/test/önizleme verileri ayrı şemalarda çalıştırıldı. Harici kullanıcı verisi kullanılmadı.

## Başarılı sonuçlar

| Kontrol | Gerçek sonuç |
| --- | --- |
| `npm run db:generate` | Prisma istemcisi üretildi. |
| `npm run db:migrate` | İlk migration boş PostgreSQL şemalarına başarıyla uygulandı. |
| `npm run build` | TypeScript denetimi ve Vite üretim derlemesi başarılı. |
| `TEST_DATABASE_URL=… npm test` | **46/46 test geçti**: 36 motor, 8 HTTP/Socket.IO entegrasyonu, 2 depolama testi. Son koşu yaklaşık 14,6 saniye. |
| `E2E_DATABASE_URL=… npm run test:e2e` | **4/4 Playwright testi geçti**, süreç çıkış kodu 0. Yaklaşık 1,8 dakika. |

Tarayıcı matrisi: Chromium 156 ve WebKit 27.2. Her tarayıcıda altı bağımsız çerez/oturum bağlamı kullanıldı. Oyuncular 360×800 ve 390×844 ekranlara dağıtıldı. Masaüstü 1440×1000 kullanıldı.

Ek yerel Chromium kontrolünde 360 ve 390 px ana sayfa/ayar ekranlarında yatay taşma olmadığı; ana sayfadaki bütün düğmelerin en az 44×44 px olduğu ölçüldü. Form alanına odaklanıp katılım/oluşturma düğmesine kaydırma kontrol edildi. Bu kontrol gerçek telefon klavyesi açılışını taklit etmez. `docs/` altındaki mobil ve masaüstü görüntüler görsel olarak incelendi.

Tam maç senaryosu arayüz üzerinden oda oluşturma, altı oyuncunun katılımı, hazır olma, gerçek rastgele rol dağıtımı, vampir saldırısı/doktor koruması, bağlantının kesilip gelmesi, sayfa yenileme, aynı rolün korunması, gündüz oylaması, köylü zaferi, yeniden maç lobisi ve geçmiş kaydını kapsar. İkinci senaryo masaüstü ana sayfa, kurallar, QR ve aynı oturumun son sekmesinin etkin olmasını doğrular.

Sunucu testleri çerez bayraklarını, oturumsuz Socket.IO bağlantısının reddini, farklı origin'den yazmanın reddini, altı bağımsız misafiri, oyun başladıktan sonra katılım engelini, iki odanın yalıtımını, başka odadaki hedefin reddini, sahte playerId alanını, tekrar ve eski faz eylemlerini kapsar. Sunucu süreci durdurulup saklanmış fazın süresi dolmuş hale getirilerek yeniden başlatılır; aynı rol/kimlik geri gelir ve eleme yalnız bir kez uygulanır. İkinci yeniden başlatmada da ölüm sayısı değişmez. Lobi sahibinin ayrılması ve sahipliğin devri doğrulanır.

Motor testleri önerilen dağılımları 5–16 oyuncu için ayrı ayrı sınar. Vampir hedef eşitliği, doktorun ardışık hedef kısıtı, kâhinin öldüğü gece sonuç alması, özel bilgi sızıntısı, avcı/soytarı öncelikleri, pas/eşitlik, zaferler ve elenen oyuncunun eylem yapamaması doğrulanır. Gece bütün eylemler geldiğinde erken bitmez.

Depolama testleri misafir profilinin saklanmasını, devam eden oyunun geçmişte görünmemesini, aynı sonucun iki kez kaydedilmesinin tek geçmiş satırı üretmesini, elenmiş takım üyesine galibiyet verilmesini ve tamamlanmayan oyunun galibiyet/mağlubiyet üretmemesini hem test adaptöründe hem gerçek PostgreSQL'de doğrular.

## Düzeltmeler ve sınırlar

İlk tarayıcı koşusunda oyun günlüğündeki metni birebir eşleştiren test seçicisi, tur etiketi yüzünden başarısız oldu; seçici düzeltildikten sonra iki tarayıcıda tam maç başarılı oldu. Windows'ta test sunucusunu sarmalayan npm sürecinin kapanışını bekleme sorunu, doğrudan Node alt sürecini başlatıp kapatan Playwright global setup ile giderildi; son koşu normal sonlandı.

Çalışmaya ara verildiğinde tur kapsamlı ağ izni sona erdi; geçici PostgreSQL erişimi engellendi. İzin yenilenip geçici veritabanı yeniden çalıştırıldıktan sonra yukarıdaki son testler başarıyla tamamlandı. Bu erişim hataları başarılı test sonucu olarak sayılmadı.

- **Gerçek iPhone veya Android cihaz testi yapılmadı.** Viewport emülasyonu ve Windows WebKit, fiziksel iOS Safari doğrulamasının yerine geçmez. Sanal klavye ve ekran kilidi davranışları gerçek cihazda ayrıca denenmelidir.
- Docker motoruna named-pipe erişimi reddedildi; Compose ile container çalıştırma doğrulanamadı. Veritabanı ve Node uygulaması doğrudan çalıştırıldı ve test edildi.
- Halka açık HTTPS/WSS dağıtımı, dış ağ testi, büyük yük testi ve üretim güvenlik denetimi yapılmadı.
- Yerel ağdaki gerçek telefonla bağlantı ve HTTPS PWA kurulumu ayrıca doğrulanmalıdır.

Kaynak, `.env.example`, migration, Docker Compose ve kurulum açıklamaları teslimata dahildir. Gerçek gizli anahtar veya oturum çerezi kaynak paketine eklenmemiştir.

import { test, expect, type Page } from "@playwright/test";
async function connected(p: Page) {
  await expect(p.getByText("● Çevrimiçi")).toBeVisible();
}
async function noOverflow(p: Page) {
  expect(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
}
test("six mobile sessions play a complete match, reconnect, refresh and rematch", async ({
  browser,
}, info) => {
  const contexts = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      browser.newContext({
        viewport:
          i % 2 ? { width: 390, height: 844 } : { width: 360, height: 800 },
      }),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    for (let i = 0; i < pages.length; i++) {
      await pages[i].goto("/");
      await connected(pages[i]);
      await pages[i].getByLabel("Takma adın").fill(`Oyuncu${i}`);
    }
    await pages[0]
      .getByRole("button", { name: "Oda oluştur", exact: false })
      .click();
    await pages[0].getByLabel("Gece süresi", { exact: true }).fill("10");
    await pages[0].getByLabel("Gündüz süresi", { exact: true }).fill("15");
    await pages[0].getByLabel("Oylama süresi", { exact: true }).fill("10");
    await pages[0]
      .getByRole("button", { name: "Odayı oluştur", exact: true })
      .click();
    const code = await pages[0].getByTestId("room-code").innerText();
    for (let i = 1; i < 6; i++) {
      await pages[i].getByLabel("Oda kodu", { exact: true }).fill(code);
      await pages[i]
        .getByRole("button", { name: "Odaya katıl", exact: false })
        .click();
      await expect(pages[i].getByTestId("room-code")).toHaveText(code);
    }
    for (const p of pages) {
      await noOverflow(p);
      await p.getByRole("button", { name: "Hazırım", exact: true }).click();
    }
    await pages[0].getByRole("button", { name: "Geceyi başlat" }).click();
    await expect(
      pages[0].getByRole("heading", { name: "Gece", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const roles: string[] = [];
    for (const p of pages) {
      await p
        .getByRole("button", {
          name: "Rolümü ve özel bilgilerimi göster",
          exact: false,
        })
        .click();
      roles.push(await p.getByTestId("my-role").innerText());
    }
    const vampire = roles.indexOf("Vampir"),
      doctor = roles.indexOf("Doktor"),
      villager = roles.indexOf("Köylü");
    await pages[vampire]
      .getByRole("button", { name: `🦊 Oyuncu${villager}`, exact: true })
      .click();
    await pages[doctor]
      .getByRole("button", { name: `🦊 Oyuncu${villager}`, exact: true })
      .click();
    await contexts[villager].setOffline(true);
    await pages[villager].waitForTimeout(400);
    await contexts[villager].setOffline(false);
    await pages[villager].reload();
    await connected(pages[villager]);
    await expect(pages[villager].getByTestId("room-code")).toHaveText(code);
    await expect(
      pages[0].getByRole("heading", { name: "Gündüz · Tartışma", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await pages[villager]
      .getByRole("button", {
        name: "Rolümü ve özel bilgilerimi göster",
        exact: false,
      })
      .click();
    await expect(pages[villager].getByTestId("my-role")).toHaveText("Köylü");
    await expect(
      pages[0].getByText("Bu gece kimse elenmedi.", { exact: false }),
    ).toBeVisible();
    await pages[0].screenshot({
      path: info.outputPath("mobile-game.png"),
      fullPage: true,
    });
    await expect(
      pages[0].getByRole("heading", { name: "Oylama", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    for (let i = 0; i < 6; i++) {
      await pages[i]
        .getByRole("button", {
          name: i === vampire ? "Pas" : `🦊 Oyuncu${vampire}`,
          exact: true,
        })
        .click();
    }
    for (const p of pages) {
      await expect(
        p.getByRole("heading", { name: "Köylü takımı kazandı" }),
      ).toBeVisible({ timeout: 15000 });
      await noOverflow(p);
    }
    await pages[0].getByRole("button", { name: "Yeniden oyna" }).click();
    await expect(
      pages[0].getByRole("button", { name: "Hazırım", exact: true }),
    ).toBeVisible();
    await pages[0].getByRole("button", { name: "Odadan ayrıl" }).click();
    await pages[0]
      .getByRole("button", { name: "Profil ve geçmiş", exact: false })
      .click();
    await expect(
      pages[0].getByText("Köylü takımı kazandı", { exact: false }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
test("desktop, help, QR and latest-tab policy", async ({ browser }, info) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const p = await context.newPage();
  try {
    await p.goto("/");
    await connected(p);
    await noOverflow(p);
    await p.screenshot({
      path: info.outputPath("desktop-home.png"),
      fullPage: true,
    });
    await p
      .getByRole("button", { name: "Nasıl oynanır?", exact: false })
      .click();
    await expect(
      p.getByRole("heading", { name: "Kim kazanır?" }),
    ).toBeVisible();
    await p.getByRole("button", { name: "Geri dön", exact: false }).click();
    await p.getByLabel("Takma adın").fill("EvSahibi");
    await p.getByRole("button", { name: "Oda oluştur", exact: false }).click();
    await p.getByRole("button", { name: "Odayı oluştur", exact: true }).click();
    await p.getByRole("button", { name: "QR kodu" }).click();
    await expect(p.locator(".qr svg")).toBeVisible();
    const code = await p.getByTestId("room-code").innerText();
    const second = await context.newPage();
    await second.goto("/");
    await expect(second.getByTestId("room-code")).toHaveText(code);
    await expect(
      p.getByText("Bu oturumun son açılan sekmesi etkin.", { exact: false }),
    ).toBeVisible();
    await expect(
      second.getByRole("button", { name: "Hazırım", exact: true }),
    ).toBeEnabled();
  } finally {
    await context.close();
  }
});

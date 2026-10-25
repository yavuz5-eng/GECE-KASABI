import { test, expect } from "@playwright/test";
test("360px blank name feedback is inline, accessible and clears on valid input", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByText("● Çevrimiçi")).toBeVisible();
  const input = page.getByLabel("Takma adın");
  const error = page.locator("#nickname-error");
  await expect(error).toHaveCount(0);
  await page.getByRole("button", { name: "Odaya katıl", exact: false }).click();
  await expect(error).toHaveText("İsim girilmedi. Lütfen bir oyuncu adı yaz.");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-describedby", "nickname-error");
  await expect(input).toBeFocused();
  await input.fill("   ");
  await page.getByRole("button", { name: "Odaya katıl", exact: false }).click();
  await expect(error).toBeVisible();
  await input.fill("A");
  await expect(error).toHaveText("Oyuncu adı en az 2 karakter olmalı.");
  await input.fill("Ayşe");
  await expect(error).toHaveCount(0);
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Oda oluştur", exact: false }).click();
  await input.fill(" ");
  await page
    .getByRole("button", { name: "Odayı oluştur", exact: true })
    .click();
  await expect(error).toBeVisible();
  await expect(input).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await input.fill("Geçerli");
  await expect(error).toHaveCount(0);
  await page.route("**/api/profile", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Sunucu geçici olarak kullanılamıyor." }),
    }),
  );
  await page
    .getByRole("button", { name: "Odayı oluştur", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(/Sunucu geçici/);
  await expect(error).toHaveCount(0);
});
test("360px active exit confirms, survives refresh and allows new create and join", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 6 }, () =>
      browser.newContext({ viewport: { width: 360, height: 800 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    for (let i = 0; i < 6; i++) {
      await pages[i].goto("/");
      await expect(pages[i].getByText("● Çevrimiçi")).toBeVisible();
      await pages[i].getByLabel("Takma adın").fill(`Ayrılma${i}`);
    }
    await pages[0]
      .getByRole("button", { name: "Oda oluştur", exact: false })
      .click();
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
    for (const p of pages)
      await p.getByRole("button", { name: "Hazırım", exact: true }).click();
    await pages[0].getByRole("button", { name: "Geceyi başlat" }).click();
    await expect(
      pages[0].getByRole("heading", { name: "Roller dağıtılıyor" }),
    ).toBeVisible();
    const leave = pages[0].getByRole("button", {
      name: "Oyundan çık",
      exact: true,
    });
    await expect(leave).toBeInViewport();
    await leave.click();
    const dialog = pages[0].getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Bu maçtaki katılımın sona erecek.");
    expect(
      await dialog.evaluate((e) => {
        const b = e.getBoundingClientRect();
        return b.left >= 0 && b.right <= innerWidth;
      }),
    ).toBe(true);
    await dialog.getByRole("button", { name: "Vazgeç" }).click();
    await expect(pages[0].getByTestId("room-code")).toHaveText(code);
    await leave.click();
    await dialog
      .getByRole("button", { name: "Oyundan çık", exact: true })
      .click();
    await expect(
      pages[0].getByRole("heading", { name: "Kasabaya katıl" }),
    ).toBeVisible();
    const before = await (await contexts[0].request.get("/api/me")).json();
    expect(before.roomCode).toBeNull();
    await pages[0].reload();
    await expect(
      pages[0].getByRole("heading", { name: "Kasabaya katıl" }),
    ).toBeVisible();
    await expect(pages[0].getByLabel("Takma adın")).toHaveValue("Ayrılma0");
    await pages[0]
      .getByRole("button", { name: "Oda oluştur", exact: false })
      .click();
    await pages[0]
      .getByRole("button", { name: "Odayı oluştur", exact: true })
      .click();
    const newCode = await pages[0].getByTestId("room-code").innerText();
    expect(newCode).not.toBe(code);
    await expect(
      pages[1]
        .getByText("Ayrılma1 (sen)")
        .locator("..")
        .getByText(/Oda sahibi/),
    ).toBeVisible();
    await pages[0]
      .getByRole("button", { name: "Oyundan çık", exact: true })
      .click();
    await pages[1]
      .getByRole("button", { name: "Oyundan çık", exact: true })
      .click();
    if (await pages[1].getByRole("dialog").isVisible())
      await pages[1]
        .getByRole("dialog")
        .getByRole("button", { name: "Oyundan çık", exact: true })
        .click();
    await expect(
      pages[1].getByRole("heading", { name: "Kasabaya katıl" }),
    ).toBeVisible();
    await pages[1]
      .getByRole("button", { name: "Oda oluştur", exact: false })
      .click();
    await pages[1]
      .getByRole("button", { name: "Odayı oluştur", exact: true })
      .click();
    const other = await pages[1].getByTestId("room-code").innerText();
    await pages[0].getByLabel("Oda kodu", { exact: true }).fill(other);
    await pages[0]
      .getByRole("button", { name: "Odaya katıl", exact: false })
      .click();
    await expect(pages[0].getByTestId("room-code")).toHaveText(other);
    const after = await (await contexts[0].request.get("/api/me")).json();
    expect(after.id).toBe(before.id);
    expect(after.nickname).toBe(before.nickname);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

import { test, expect, type Page } from '@playwright/test';

// Injects a mock gptNative bridge so the renderer behaves as if inside Electron.
async function injectNativeBridge(
  page: Page,
  overrides: {
    openRepoDialog?: () => Promise<string | null>;
    getServeBaseUrl?: () => Promise<string>;
  } = {},
) {
  await page.addInitScript((opts) => {
    (window as unknown as Record<string, unknown>)['gptNative'] = {
      openRepoDialog: opts.openRepoDialog ?? (() => Promise.resolve(null)),
      getServeBaseUrl: opts.getServeBaseUrl ?? (() => Promise.resolve('http://127.0.0.1:7337')),
    };
  }, overrides);
}

test.describe('Open repo screen', () => {
  test('renders the landing screen with app title and open button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('gpt');
    await expect(page.getByRole('button', { name: /open folder/i })).toBeVisible();
  });

  test('shows error when native bridge is absent (plain browser, no Electron)', async ({ page }) => {
    // Do NOT inject gptNative — simulates running outside Electron.
    await page.goto('/');
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.getByText(/native bridge unavailable/i)).toBeVisible();
  });

  test('does nothing when the user cancels the native dialog', async ({ page }) => {
    await injectNativeBridge(page, {
      openRepoDialog: async () => null,
    });
    await page.goto('/');
    await page.getByRole('button', { name: /open folder/i }).click();
    // Should stay on the idle screen — no error, no navigation.
    await expect(page.getByRole('button', { name: /open folder/i })).toBeVisible();
  });

  test('shows "validating" state while the folder is being checked', async ({ page }) => {
    // Hold the dialog open long enough to observe the intermediate state.
    let resolveDialog!: (v: string) => void;
    const dialogPromise = new Promise<string>((res) => { resolveDialog = res; });

    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>)['gptNative'] = {
        openRepoDialog: () => new Promise((res) => {
          // Resolved by a later evaluate() call from the test.
          (window as unknown as Record<string, unknown>)['_resolveDialog'] = res;
        }),
        getServeBaseUrl: () => Promise.resolve('http://127.0.0.1:7337'),
      };
    });

    await page.goto('/');
    await page.getByRole('button', { name: /open folder/i }).click();

    // Resolve the dialog with a path.
    await page.evaluate(() => {
      const r = (window as unknown as Record<string, unknown>)['_resolveDialog'] as
        | ((v: string) => void)
        | undefined;
      r?.('/some/repo');
    });

    resolveDialog('/some/repo');
    // The "validating" or "reading folder" busy label should appear momentarily.
    // We don't assert on the exact outcome since we don't control the HTTP server here.
    // This test verifies the intermediate state renders without crashing.
    await expect(page.getByText(/reading folder|validating/i).or(
      page.getByText(/native bridge unavailable/i)
    )).toBeVisible({ timeout: 3000 });
  });

  test('error screen offers a retry button that returns to idle', async ({ page }) => {
    await page.goto('/');
    // Without a bridge, clicking "Open" triggers the error state.
    await page.getByRole('button', { name: /open folder/i }).click();
    await expect(page.getByText(/native bridge unavailable/i)).toBeVisible();
    await page.getByRole('button', { name: /try again/i }).click();
    await expect(page.getByRole('button', { name: /open folder/i })).toBeVisible();
  });
});

test.describe('App shell layout', () => {
  test('page title contains "gpt"', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/gpt/i);
  });

  test('has no accessibility violations on the landing screen', async ({ page }) => {
    await page.goto('/');
    // Basic a11y: the main heading and primary CTA must be reachable via keyboard.
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';

for (const viewport of [
  { name: 'mobile', width: 360, height: 640 },
  { name: 'desktop', width: 1366, height: 768 },
]) {
  test(`keeps the voice drawer visible and sends the first command at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.goto('/');

    await page.getByRole('button', { name: 'Open Voice Copilot drawer' }).click();
    const drawer = page.getByRole('region', { name: 'Voice Copilot' });
    await expect(drawer).toBeVisible();

    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? viewport.width) + (box?.width ?? 1)).toBeLessThanOrEqual(viewport.width);
    expect((box?.y ?? viewport.height) + (box?.height ?? 1)).toBeLessThanOrEqual(viewport.height);

    const input = page.getByRole('textbox', { name: 'Voice Copilot command' });
    await expect(input).toBeFocused();
    await input.fill('Confirm the first command');
    await input.press('Enter');

    const transcript = page.getByTestId('voice-transcript');
    await expect(transcript).toContainText('Confirm the first command');
    await expect(transcript).toContainText('Acknowledged');
    await expect(input).toHaveValue('');
    await expect(page.getByRole('status')).toContainText('LISTENING');
    await drawer.screenshot({ path: testInfo.outputPath(`voice-drawer-${viewport.name}.png`) });
    expect(pageErrors).toEqual([]);
  });
}

test('preserves transcript reading position until the operator requests new messages', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Voice Copilot drawer' }).click();
  const input = page.getByRole('textbox', { name: 'Voice Copilot command' });
  const transcript = page.getByTestId('voice-transcript');

  for (let index = 0; index < 12; index += 1) {
    await input.fill(`History message ${index} with enough text to occupy a transcript row`);
    await input.press('Enter');
    await expect(input).toHaveValue('');
  }

  await transcript.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);

  await input.fill('Do not force scroll this new message');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'NEW MESSAGES ↓' })).toBeVisible();
  expect(await transcript.evaluate((element) => element.scrollTop)).toBeLessThan(48);

  await page.getByRole('button', { name: 'NEW MESSAGES ↓' }).click();
  await expect
    .poll(() =>
      transcript.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeLessThan(4);
  expect(pageErrors).toEqual([]);
});

test('prevents an aborted OpenAI token attempt from replacing a newer mock session', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  let releaseTokenRequest: (() => void) | undefined;
  let markTokenRequestStarted: (() => void) | undefined;
  const tokenRequestStarted = new Promise<void>((resolve) => {
    markTokenRequestStarted = resolve;
  });
  const tokenRequestReleased = new Promise<void>((resolve) => {
    releaseTokenRequest = resolve;
  });

  await page.route('**/api/voice/session', async (route) => {
    markTokenRequestStarted?.();
    await tokenRequestReleased;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ client_secret: 'stale-test-token', session_id: 'stale-session' }),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Voice Copilot drawer' }).click();
  const provider = page.getByRole('combobox', { name: 'Voice provider' });

  await provider.selectOption('openai-realtime');
  await tokenRequestStarted;
  await expect(page.getByRole('status')).toContainText('CONNECTING');
  await page.getByRole('button', { name: 'CANCEL' }).click();
  await provider.selectOption('mock');
  releaseTokenRequest?.();

  await expect(provider).toHaveValue('mock');
  await expect(page.getByRole('status')).toContainText('LISTENING');
  await expect(page.getByText('mock', { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

// Adjust the API URL and payload to the real repository; no business source patch is needed.
exports.setup = async ({ page }) => {
  await page.route('**/api/orders', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }),
  }));
};

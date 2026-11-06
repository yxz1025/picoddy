// Runs only inside OpenSandbox. Host-level egress rules must prevent access to private networks.
import { readFile, unlink, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function browse(request, dependencies) {
  dependencies ??= { chromium: (await import('playwright-core')).chromium, mkdir };
  let browser;
  try {
  if (request.screenshot !== undefined && typeof request.screenshot !== 'boolean') throw new Error('Invalid screenshot option');
  const url=new URL(request.url);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid URL');
  browser=await dependencies.chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const context=await browser.newContext({acceptDownloads:false,viewport:{width:1440,height:1000}});
  const page=await context.newPage();
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
  const text=(await page.locator('body').innerText({timeout:10000})).slice(0,30000);
  const links=await page.locator('a[href]').evaluateAll(elements=>elements.slice(0,60).map(a=>({text:a.textContent?.slice(0,120),url:a.href})));
  let screenshot;
  if (request.screenshot === true) {
    await dependencies.mkdir('/workspace/output',{recursive:true});
    screenshot='/workspace/output/browser.png';
    await page.screenshot({path:screenshot,fullPage:false});
  }
  return {title:await page.title(),url:page.url(),text,links,...(screenshot ? {screenshot} : {})};
  } finally { await browser?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path=process.argv[2];
  if (!/^\/workspace\/\.browser-[0-9a-f-]{36}\.json$/.test(path || '')) throw new Error('Invalid request path');
  try {
    const request=JSON.parse(await readFile(path,'utf8'));
    await unlink(path);
    process.stdout.write(JSON.stringify(await browse(request)));
  } finally { await unlink(path).catch(()=>{}); }
}

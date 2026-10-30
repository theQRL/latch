// Regenerate the checked-in card using the app's own vault illustration and fonts.
// Requires Chrome locally; run: node build-tools/render-social-card.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const font = async path => (await readFile(new URL(path, root))).toString('base64');
const component = await read('shared/src/components/VaultLatch.vue');
const vault = component.match(/<template>([\s\S]*?)<\/template>/)[1]
  .replace(':class="{ \'vault-open\': open }"', '');
const vaultCss = component.match(/<style scoped>([\s\S]*?)<\/style>/)[1];
const html = `<!doctype html><html><head><style>
@font-face{font-family:Archivo;src:url(data:font/woff2;base64,${await font('shared/assets/fonts/archivo.woff2')})}
@font-face{font-family:Source;src:url(data:font/woff2;base64,${await font('shared/assets/fonts/source-sans-3.woff2')})}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;color:#edf2f5;background:#0a1720;font-family:Source}
.card{position:relative;width:100%;height:100%;padding:76px;background:radial-gradient(ellipse at 80% 44%,#253d4c 0,transparent 48%),linear-gradient(130deg,#102430,#08151e)}
.card:after{content:'';position:absolute;inset:24px;border:1px solid #354f5e;border-radius:24px;pointer-events:none}
.brand{font:600 47px Archivo;letter-spacing:-1.8px}.brand span{color:#ffa729;padding:0 16px;font-weight:300}
h1{font:600 58px/1.12 Archivo;letter-spacing:-2px;margin:65px 0 22px;max-width:650px}
p{font:400 25px/1.4 Source;color:#a9bdc9;margin:0}.footer{position:absolute;bottom:65px;left:76px;right:76px;display:flex;justify-content:space-between;font-size:19px;letter-spacing:1px;color:#8ba5b5}.footer b{color:#ffa729;font-weight:500}
.art{position:absolute;left:815px;top:220px;width:192px;height:192px;filter:drop-shadow(0 24px 24px #0008)}
${vaultCss}
.art .vault-art{transform:scale(1.85);margin:0}.art .vault-frame{box-shadow:inset 0 1px 0 #7391a344,0 0 50px #ffa72908}
</style></head><body><main class="card"><div class="brand">QRL<span>|</span>Latch</div><h1>Airgapped<br>QRL v2.0 Signer</h1><p>Post-quantum, airgapped transactions</p><div class="art">${vault}</div><div class="footer"><span>latch.theqrl.org</span><b>QRL est. 2016</b></div></main></body></html>`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
 const page = await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
 await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:new URL('shared/assets/social-card.png',root).pathname});
} finally {await browser.close();}

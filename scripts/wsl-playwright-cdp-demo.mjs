#!/usr/bin/env node
import { chromium } from "playwright";

const cdpPort = process.env.CDP_PORT ?? "9222";
const targetUrl = process.env.TARGET_URL ?? "https://example.com";
const endpoint = `http://127.0.0.1:${cdpPort}`;

async function main() {
    const browser = await chromium.connectOverCDP(endpoint);
    const existingContexts = browser.contexts();
    const context = existingContexts.length > 0 ? existingContexts[0] : await browser.newContext();
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    await browser.close();
    console.log(`Opened ${targetUrl} through ${endpoint}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

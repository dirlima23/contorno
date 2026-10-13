import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',timeout:45000,workers:1,use:{viewport:{width:1440,height:1100},launchOptions:{executablePath:process.env.CONTORNO_BROWSER || '/usr/bin/chromium',args:['--no-sandbox']}}});

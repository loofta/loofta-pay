const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Tesseract = require('tesseract.js');

puppeteer.use(StealthPlugin());

// Load Excel and extract tweet links
const workbook = xlsx.readFile('./submission_week3_taraxa.xlsx');
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(worksheet);

// Create folder to save screenshots
const screenshotDir = path.resolve(__dirname, 'tweets');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

// Extract tweet IDs
const tweetList = [];

data.forEach(entry => {
  const links = entry['Submission Links'];
  if (links && typeof links === 'string') {
    const urls = links.split(',').map(url => url.trim());
    urls.forEach(url => {
      const match = url.match(/x\.com\/[^/]+\/status\/(\d+)/);
      if (match) {
        tweetList.push({ tweetId: match[1], url });
      }
    });
  }
});

(async () => {
  const browser = await puppeteer.launch({ headless: false }); // debug mode
  const page = await browser.newPage();

  // Optional: use a real browser UA
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
  );

  for (const tweet of tweetList) {
    try {
      console.log(`📸 Opening tweet: ${tweet.url}`);
      await page.goto(tweet.url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 7000)); // wait to render

      const screenshotPath = path.join(screenshotDir, `tweet_${tweet.tweetId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      console.log(`✅ Saved screenshot: ${screenshotPath}`);

      // Optional OCR
      const { data: { text } } = await Tesseract.recognize(screenshotPath, 'eng');
      console.log(`🔍 OCR for ${tweet.tweetId}:\n${text.split('\n').slice(0, 10).join('\n')}`);

    } catch (error) {
      console.error(`❌ Error with tweet ${tweet.tweetId}:`, error.message);
    }
  }

  await browser.close();
})();

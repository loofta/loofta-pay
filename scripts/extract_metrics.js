const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");

// Folder where tweet images are stored
const imageDir = path.join(__dirname, "tweets");
const outputFile = path.join(__dirname, "tweet_metrics.json");

const extractEngagementNumbers = (text) => {
  const numbers = text.match(/\b\d{1,6}\b/g) || [];
  const [replies, retweets, likes, views] = numbers.slice(-4).map(Number);
  return {
    views: views || 0,
    likes: likes || 0,
    retweets: retweets || 0,
    replies: replies || 0,
  };
};

(async () => {
  const files = fs.readdirSync(imageDir).filter(file => file.endsWith(".png"));
  const metrics = {};

  let totalViews = 0;
  let totalEngagement = 0;

  for (const file of files) {
    const tweetId = file.split("_")[1]?.replace(".png", "");
    const imgPath = path.join(imageDir, file);
    const croppedPath = path.join(imageDir, `cropped_${file}`);

    console.log(`📸 Processing ${file}`);

    // Step 1: Crop bottom 25%
    const metadata = await sharp(imgPath).metadata();
    const cropHeight = Math.round(metadata.height * 0.25);
    await sharp(imgPath)
      .extract({ left: 0, top: metadata.height - cropHeight, width: metadata.width, height: cropHeight })
      .toFile(croppedPath);

    // Step 2: OCR
    const { data: { text } } = await Tesseract.recognize(croppedPath, "eng");

    // Step 3: Extract metrics
    const result = extractEngagementNumbers(text);
    const engagement = result.likes + result.retweets + result.replies;
    totalViews += result.views;
    totalEngagement += engagement;

    metrics[tweetId] = {
      ...result,
      engagement,
      engagementRate: result.views ? (engagement / result.views).toFixed(4) : "0.0000"
    };

    console.log(`✅ ${tweetId}`, metrics[tweetId]);
  }

  const summary = {
    totalTweets: files.length,
    totalViews,
    totalEngagement,
    averageEngagementRate: totalViews ? (totalEngagement / totalViews).toFixed(4) : "0.0000"
  };

  const output = {
    summary,
    tweets: metrics
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log("\n📊 Summary:");
  console.log(summary);
  console.log(`\n💾 Results saved to ${outputFile}`);
})();

const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const { Redis } = require("@upstash/redis");

const app = express();
const PORT = process.env.PORT || 10000;

const XML_FEED_URL = "https://tdl.apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/eas/recent/2023-08-21T11:40:43Z";

// Redis via Upstash
const redis = new Redis({
  url: process.env.http://generous-glowworm-62892.upstash.io,
  token: process.env.AfWsAAIjcDEwYjczM2E1MDI5NDY0ZWY4OGQyYTdlNDgyMWQ5ZDMxMnAxMA,
});

const parser = new xml2js.Parser({
  explicitArray: false,
  ignoreAttrs: false,
  tagNameProcessors: [xml2js.processors.stripPrefix],
});

let lastValidAlert = null;
let lastUpdated = null;

async function fetchAndCacheXML() {
  try {
    console.log("🔄 Fetching latest XML feed...");

    const response = await axios.get(XML_FEED_URL, { responseType: "text" });

    if (!response.data || response.data.trim() === "") {
      console.log("⚠️ Empty feed — retaining previous alert.");
      return;
    }

    const parsed = await parser.parseStringPromise(response.data);

    if (!parsed || !parsed.alerts || !parsed.alerts.alert) {
      console.log("⚠️ Invalid XML structure — retaining previous alert.");
      return;
    }

    let alerts = parsed.alerts.alert;
    if (!Array.isArray(alerts)) {
      alerts = [alerts];
    }

    if (alerts.length > 2) {
      alerts = alerts.slice(0, 2); // assume reverse-chronological order
    }

    const newestAlert = alerts[0];

    if (newestAlert) {
      lastValidAlert = newestAlert;
      lastUpdated = new Date().toISOString();

      // Cache in Redis
      await redis.set("lastValidAlert", JSON.stringify(lastValidAlert));
      await redis.set("lastUpdated", lastUpdated);

      console.log("✅ Cached new alert at", lastUpdated);
      console.log("🧠 Alert ID:", newestAlert.identifier);
    } else {
      console.log("⚠️ No usable alert — retaining previous.");
    }
  } catch (err) {
    console.error("❌ Error fetching or parsing feed:", err.message);
  }
}

// Attempt to restore from Redis on startup
async function restoreFromRedis() {
  try {
    const alertJSON = await redis.get("lastValidAlert");
    const updated = await redis.get("lastUpdated");

    if (alertJSON && updated) {
      lastValidAlert = JSON.parse(alertJSON);
      lastUpdated = updated;
      console.log("♻️ Restored alert from Redis cache.");
    } else {
      console.log("ℹ️ No cached alert found in Redis.");
    }
  } catch (err) {
    console.error("❌ Redis restore error:", err.message);
  }
}

// Initial restore and fetch
restoreFromRedis().then(fetchAndCacheXML);
setInterval(fetchAndCacheXML, 45 * 1000);

// JSON feed route
app.get("/json-feed", async (req, res) => {
  if (lastValidAlert) {
    return res.json({
      lastUpdated,
      alert: lastValidAlert,
    });
  }

  // fallback to Redis
  try {
    const alertJSON = await redis.get("lastValidAlert");
    const updated = await redis.get("lastUpdated");

    if (alertJSON) {
      return res.json({
        lastUpdated: updated,
        alert: JSON.parse(alertJSON),
      });
    }
  } catch (err) {
    console.error("❌ Redis fallback failed:", err.message);
  }

  return res.status(503).json({ message: "No alerts available yet." });
});

// Debug route
app.get("/debug", async (req, res) => {
  const redisAlert = await redis.get("lastValidAlert");
  const redisTime = await redis.get("lastUpdated");

  res.json({
    inMemory: lastValidAlert ? "✅ Exists" : "❌ Missing",
    redis: redisAlert ? "✅ Found" : "❌ Missing",
    redisData: redisAlert
      ? {
          alert: JSON.parse(redisAlert),
          lastUpdated: redisTime,
        }
      : null,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://0.0.0.0:10000`);
});

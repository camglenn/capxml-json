const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const { Redis } = require("@upstash/redis");

const app = express();
const PORT = process.env.PORT || 10000;

const XML_FEED_URL = "https://tdl.apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/eas/recent/2023-08-21T11:40:43Z";

// Redis via Upstash
const redis = new Redis({
  url: process.env.REDIS_REST_URL || "https://generous-glowworm-62892.upstash.io",
  token: process.env.REDIS_REST_TOKEN || "AfWsAAIjcDEwYjczM2E1MDI5NDY0ZWY4OGQyYTdlNDgyMWQ5ZDMxMnAxMA",
});

const parser = new xml2js.Parser({
  explicitArray: false,
  ignoreAttrs: false,
  tagNameProcessors: [xml2js.processors.stripPrefix],
});

let lastValidAlert = null;
let lastUpdated = null;

// Hardcoded alert object
const hardcodedAlert = {
  identifier: "All-Channels--8675309",
  sender: "IPAWS-PMO-TESTER-SW",
  sent: "2025-04-08T16:40:46-04:00",
  status: "Actual",
  msgType: "Alert",
  source: "IPAWS-PMO-TESTING",
  scope: "Public",
  code: "IPAWSv1.0",
  info: {
    language: "en-US",
    category: "CBRNE",
    event: "Child Abduction Emergency",
    responseType: "Evacuate",
    urgency: "Immediate",
    severity: "Severe",
    certainty: "Observed",
    eventCode: {
      valueName: "SAME",
      value: "CAE",
    },
    effective: "2025-04-08T16:40:46-04:00",
    expires: "2025-04-08T16:45:46-04:00",
    senderName: "120006,IPAWS-Test-COG,PMO Tester",
    headline: "Amber Alert Issued for Abducted Children",
    description:
      'Any County Sheriff\'s Department AMBER Alert: 6-year-old siblings Jane and John Doe were kidnapped in a stolen red older model Ford Explorer at 7:00 AM today on Any Road. Both siblings are [description]. Suspect is a [description]. If you see the vehicle, call authorities. DO NOT approach. Stay tuned to local media and the Any County Sheriff\'s Department social media pages for more information. This is a simulation. This is only a test.',
    instruction:
      "If you see the suspect's vehicle, the suspect, or the victims, you're asked to call authorities immediately. DO NOT approach the suspect who is believed to be armed and dangerous. This is a simulation. This is only a test.",
    parameter: [
      { valueName: "EAS-ORG", value: "CIV" },
      { valueName: "timezone", value: "EST" },
      { valueName: "WEAHandling", value: "Imminent Threat" },
      {
        valueName: "CMAMtext",
        value: "This is where the 90 character English text to WEA goes. http://www.fema.gov",
      },
      {
        valueName: "CMAMlongtext",
        value:
          "This is where the 360 character description in English goes. Evacuation Order for Hwy east of the Park",
      },
    ],
    resource: [
        {   
            resourceDesc: "Amber Alert Simulation", 
            mimeType: "audio/mpeg", 
            uri: "https://e8484bfa-eb42-48d2-8683-1fcde18bf0dd.s3.us-east-1.amazonaws.com/cae_alert_audio_simulation.mp3",
        },
        {   
            resourceDesc: "Iowa Snow Totals", 
            mimeType: "image/png", 
            uri: "https://d2v2309fx2p6c5.cloudfront.net/iowa_snow_totals.png",
        },
        {   
            resourceDesc: "Iowa Forecast Snowfall", 
            mimeType: "image/png", 
            uri: "https://d2v2309fx2p6c5.cloudfront.net/iowa_forecast_snowfall.png",
        },
      ],
    area: {
      areaDesc: "Alexandria",
      polygon: "38.8512,-77.1912 38.8107,-77.1908 38.8001,-77.0713 38.8503,-77.0701 38.8512,-77.1912",
      geocode: {
        valueName: "SAME",
        value: "051059",
      },
    },
  },
};

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

    // Reverse the order to newest-first
    alerts = alerts.reverse();

    // Limit to 1 from feed + 1 hardcoded
    const selectedAlerts = [alerts[0], hardcodedAlert];

    const newestAlert = selectedAlerts[0];

    if (newestAlert) {
      lastValidAlert = selectedAlerts;
      lastUpdated = new Date().toISOString();

      await redis.set("lastValidAlert", JSON.stringify(lastValidAlert));
      await redis.set("lastUpdated", lastUpdated);

      console.log("✅ Cached alerts at", lastUpdated);
      console.log("🧠 Newest Alert ID:", newestAlert.identifier);
    } else {
      console.log("⚠️ No usable alert — retaining previous.");
    }
  } catch (err) {
    console.error("❌ Error fetching or parsing feed:", err.message);
  }
}

async function restoreFromRedis() {
  try {
    const alertJSON = await redis.get("lastValidAlert");
    const updated = await redis.get("lastUpdated");

    if (alertJSON && updated) {
      lastValidAlert = JSON.parse(alertJSON);
      lastUpdated = updated;
      console.log("♻️ Restored alerts from Redis cache.");
    } else {
      console.log("ℹ️ No cached alerts found in Redis.");
    }
  } catch (err) {
    console.error("❌ Redis restore error:", err.message);
  }
}

restoreFromRedis().then(fetchAndCacheXML);
setInterval(fetchAndCacheXML, 10 * 1000);

app.get("/json-feed", async (req, res) => {
  if (lastValidAlert) {
    return res.json({
      lastUpdated,
      alerts: lastValidAlert,
    });
  }

  try {
    const alertJSON = await redis.get("lastValidAlert");
    const updated = await redis.get("lastUpdated");

    if (alertJSON) {
      return res.json({
        lastUpdated: updated,
        alerts: JSON.parse(alertJSON),
      });
    }
  } catch (err) {
    console.error("❌ Redis fallback failed:", err.message);
  }

  return res.status(503).json({ message: "No alerts available yet." });
});

app.get("/debug", async (req, res) => {
  const redisAlert = await redis.get("lastValidAlert");
  const redisTime = await redis.get("lastUpdated");

  res.json({
    inMemory: lastValidAlert ? "✅ Exists" : "❌ Missing",
    redis: redisAlert ? "✅ Found" : "❌ Missing",
    redisData: redisAlert
      ? {
          alerts: JSON.parse(redisAlert),
          lastUpdated: redisTime,
        }
      : null,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
});
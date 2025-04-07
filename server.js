const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");
const redis = require("redis");

const app = express();
const PORT = process.env.PORT || 4000;

const XML_FEED_URL = "https://tdl.apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/eas/recent/2023-08-21T11:40:43Z";

const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [xml2js.processors.stripPrefix]
});

// 🔌 Redis client setup
const redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: () => 1000, // retry every 1s if disconnected
    }
});

redisClient.on("error", (err) => console.error("❌ Redis error:", err));
redisClient.connect().then(() => {
    console.log("🔗 Connected to Redis.");
});

// In-memory cache fallback
let lastValidAlert = null;
let lastUpdated = null;

// Restore from Redis on startup
async function loadCachedAlert() {
    try {
        const redisData = await redisClient.get("lastValidAlert");
        if (redisData) {
            const { alert, lastUpdated: cachedTime } = JSON.parse(redisData);
            lastValidAlert = alert;
            lastUpdated = cachedTime;
            console.log("📦 Loaded alert from Redis:", alert?.identifier || "No ID");
        } else {
            console.log("📭 Redis empty at startup.");
        }
    } catch (err) {
        console.error("❌ Error loading cache from Redis:", err.message);
    }
}

// Fetch and cache alerts
async function fetchAndCacheXML() {
    try {
        console.log("🔄 Fetching latest XML feed...");

        const response = await axios.get(XML_FEED_URL, { responseType: "text" });

        if (!response.data || response.data.trim() === "") {
            console.log("⚠️ Empty feed — retaining previous alert.");
            return;
        }

        const parsed = await parser.parseStringPromise(response.data);

        if (!parsed?.alerts?.alert) {
            console.log("⚠️ No valid alerts in feed — retaining previous alert.");
            return;
        }

        let alerts = parsed.alerts.alert;

        if (!Array.isArray(alerts)) {
            alerts = [alerts];
        }

        if (alerts.length > 2) {
            alerts = alerts.slice(0, 2);
        }

        const newestAlert = alerts[0];

        if (newestAlert) {
            lastValidAlert = newestAlert;
            lastUpdated = new Date().toISOString();

            console.log("✅ New alert cached:", newestAlert.identifier);

            // Save to Redis
            await redisClient.set(
                "lastValidAlert",
                JSON.stringify({ alert: lastValidAlert, lastUpdated }),
                { EX: 60 * 60 * 24 } // expire in 24 hours
            );

            console.log("💾 Alert saved to Redis.");
        } else {
            console.log("⚠️ Feed structure OK but alert empty — retaining previous.");
        }
    } catch (err) {
        console.error("❌ Error fetching XML feed:", err.message);
    }
}

// Load initial cache from Redis
loadCachedAlert();

// Periodic fetch
setInterval(fetchAndCacheXML, 45 * 1000);

// API Endpoint
app.get("/json-feed", (req, res) => {
    if (lastValidAlert) {
        res.json({
            lastUpdated,
            alert: lastValidAlert
        });
    } else {
        res.status(503).json({
            message: "No alerts available yet. Please try again later."
        });
    }
});

// 🔍 Debug Endpoint
app.get("/debug", async (req, res) => {
    const redisValue = await redisClient.get("lastValidAlert");

    res.json({
        inMemory: lastValidAlert ? "✅ Exists" : "❌ Null",
        redis: redisValue ? "✅ Found" : "❌ Not found",
        redisData: redisValue ? JSON.parse(redisValue) : null
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});

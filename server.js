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

// Redis client setup
const redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: () => 1000, // Retry every 1s
    }
});

redisClient.on("error", (err) => console.error("❌ Redis error:", err));

let lastValidAlert = null;
let lastUpdated = null;

// Load from Redis on startup
async function loadCachedAlert() {
    try {
        const redisData = await redisClient.get("lastValidAlert");
        if (redisData) {
            const { alert, lastUpdated: cachedTime } = JSON.parse(redisData);
            lastValidAlert = alert;
            lastUpdated = cachedTime;
            console.log("📦 Loaded alert from Redis:", alert?.identifier || "No ID");
        } else {
            console.log("📭 Redis is empty at startup.");
        }
    } catch (err) {
        console.error("❌ Error loading Redis cache:", err.message);
    }
}

// Fetch and cache new alerts
async function fetchAndCacheXML() {
    try {
        console.log("🔄 Fetching XML feed...");

        const response = await axios.get(XML_FEED_URL, { responseType: "text" });

        if (!response.data || response.data.trim() === "") {
            console.log("⚠️ Empty feed — keeping previous alert.");
            return;
        }

        const parsed = await parser.parseStringPromise(response.data);

        if (!parsed?.alerts?.alert) {
            console.log("⚠️ No valid alerts in parsed XML.");
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

            console.log("✅ Caching new alert:", newestAlert.identifier);

            await redisClient.set(
                "lastValidAlert",
                JSON.stringify({ alert: lastValidAlert, lastUpdated }),
                { EX: 60 * 60 * 24 } // Expires after 24 hours
            );

            console.log("💾 Alert saved to Redis.");
        } else {
            console.log("⚠️ Feed was valid but no usable alerts.");
        }
    } catch (err) {
        console.error("❌ Error during XML fetch:", err.message);
    }
}

// Serve one alert
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

// Ping endpoint to check server is up
app.get("/ping", (req, res) => {
    res.send("pong");
});

// Debug endpoint
app.get("/debug", async (req, res) => {
    const redisValue = await redisClient.get("lastValidAlert");

    res.json({
        inMemory: lastValidAlert ? "✅ Exists" : "❌ Null",
        redis: redisValue ? "✅ Found" : "❌ Not found",
        redisData: redisValue ? JSON.parse(redisValue) : null
    });
});
console.log("🛠️ /debug and /ping routes are ready");

// Start the app after Redis connects
(async () => {
    try {
        await redisClient.connect();
        console.log("🔗 Connected to Redis.");
        await loadCachedAlert(); // Load any saved alert
        await fetchAndCacheXML(); // Get a fresh one right away
        setInterval(fetchAndCacheXML, 45 * 1000); // Re-fetch every 45 seconds

        app.listen(PORT, () => {
            console.log(`🚀 Server running at http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("❌ Failed to start app:", err);
    }
})();

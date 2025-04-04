const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();
const PORT = process.env.PORT || 4000;

const XML_FEED_URL = "https://tdl.apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/public/recent/2023-08-21T11:40:43Z";

const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [xml2js.processors.stripPrefix]
});

let lastValidAlert = null;
let lastUpdated = null;

// Fetch and cache only one valid alert (newest after discarding oldest if needed)
async function fetchAndCacheXML() {
    try {
        console.log("🔄 Fetching latest XML feed...");

        const response = await axios.get(XML_FEED_URL, { responseType: "text" });

        if (!response.data || response.data.trim() === "") {
            console.log("⚠️ Empty response from feed — keeping last valid alert.");
            return;
        }

        const parsed = await parser.parseStringPromise(response.data);

        if (!parsed || !parsed.alerts || !parsed.alerts.alert) {
            console.log("⚠️ Parsed XML has no valid 'alerts' — keeping last valid alert.");
            return;
        }

        let alerts = parsed.alerts.alert;

        // Normalize alerts to array
        if (!Array.isArray(alerts)) {
            alerts = [alerts];
        }

        // Discard oldest if more than 2
        if (alerts.length > 2) {
            alerts = alerts.slice(0, 2); // Keep the two newest
        }

        // Take the newest from the two (first in the list)
        const newestAlert = alerts[0];

        if (newestAlert) {
            lastValidAlert = newestAlert;
            lastUpdated = new Date().toISOString();
            console.log("✅ Cached 1 newest alert at", lastUpdated);
        } else {
            console.log("⚠️ No valid alerts to cache.");
        }
    } catch (err) {
        console.error("❌ Error during fetch:", err.message);
    }
}

// Initial fetch
fetchAndCacheXML();

// Repeat every 45 seconds
setInterval(fetchAndCacheXML, 45 * 1000);

// API endpoint that always returns exactly one alert
app.get("/json-feed", (req, res) => {
    if (lastValidAlert) {
        res.json({
            lastUpdated,
            alert: lastValidAlert
        });
    } else {
        res.json({
            message: "No alerts have been received yet."
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});

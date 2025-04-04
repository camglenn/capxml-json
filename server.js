const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();
const PORT = process.env.PORT || 4000;

const XML_FEED_URL = "https://tdl.apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/eas/recent/2023-08-21T11:40:43Z";

const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [xml2js.processors.stripPrefix]
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

        // Keep only the two most recent (discard oldest if more than 2)
        if (alerts.length > 2) {
            alerts = alerts.slice(0, 2); // assumes feed is in reverse-chron order
        }

        const newestAlert = alerts[0];

        if (newestAlert) {
            lastValidAlert = newestAlert;
            lastUpdated = new Date().toISOString();
            console.log("✅ New alert cached at", lastUpdated);
        } else {
            console.log("⚠️ No usable alert in feed — retaining previous alert.");
        }
    } catch (err) {
        console.error("❌ Error fetching XML feed:", err.message);
    }
}

// Initial fetch
fetchAndCacheXML();

// Repeat every 45 seconds
setInterval(fetchAndCacheXML, 45 * 1000);

// Serve the most recent alert
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

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});

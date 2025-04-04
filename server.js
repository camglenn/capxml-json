const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();
const PORT = process.env.PORT || 4000;

const XML_FEED_URL = "https://tdl.apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/eas/recent";

const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [xml2js.processors.stripPrefix]
});

let lastValidAlert = null;
let lastUpdated = null;

// Fetch and cache the latest valid alert
async function fetchAndCacheXML() {
    try {
        const response = await axios.get(XML_FEED_URL, { responseType: "text" });
        const parsed = await parser.parseStringPromise(response.data);

        const alerts = parsed?.alerts?.alert;

        if (alerts) {
            // Normalize: if multiple alerts, take the first (newest)
            const newestAlert = Array.isArray(alerts) ? alerts[0] : alerts;

            lastValidAlert = newestAlert;
            lastUpdated = new Date().toISOString();

            console.log("✅ New alert cached at", lastUpdated);
        } else {
            console.log("⚠️ No alerts in feed at", new Date().toISOString());
        }
    } catch (err) {
        console.error("❌ Error during fetch:", err.message);
    }
}

// Initial fetch
fetchAndCacheXML();

// Repeat every 45 seconds
setInterval(fetchAndCacheXML, 45 * 1000);

// API endpoint
app.get("/json-feed", (req, res) => {
    if (lastValidAlert) {
        res.json({
            lastUpdated,
            alert: lastValidAlert
        });
    } else {
        res.json({
            message: "Feed not available yet. Try again shortly."
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});

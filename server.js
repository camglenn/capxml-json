const express = require("express");
const axios = require("axios");
const xml2js = require("xml2js");

const app = express();
const PORT = process.env.PORT || 4000;

// Replace with your XML feed URL
const XML_FEED_URL = "https://tdl.apps.fema.gov/IPAWSOPEN_EAS_SERVICE/rest/eas/recent/2023-08-21T11:40:43";

// Create an instance of the XML parser with improved options
const parser = new xml2js.Parser({
    explicitArray: false, // avoid wrapping everything in arrays
    ignoreAttrs: false,   // keep attributes like id, type, etc.
    tagNameProcessors: [xml2js.processors.stripPrefix] // strip namespace prefixes like ns1:
});

// Function to fetch and convert XML to JSON
async function fetchAndConvertXML() {
    try {
        console.log("Fetching XML from:", XML_FEED_URL);

        const response = await axios.get(XML_FEED_URL, { responseType: "text" });

        const jsonData = await parser.parseStringPromise(response.data);
        return jsonData;

    } catch (error) {
        console.error("Error fetching or parsing XML:", error.message);
        return { error: "Failed to fetch or parse XML feed" };
    }
}

// API Endpoint to serve JSON
app.get("/json-feed", async (req, res) => {
    const jsonFeed = await fetchAndConvertXML();
    res.json(jsonFeed);
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

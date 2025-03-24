require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require("fs");
const { MongoClient } = require("mongodb");
const express = require("express");
const path = require("path");

// Initialize the bot
const bot = new Telegraf(process.env.BOT_TOKEN);
const BASE_URL = "https://alphaapis.org/terabox";
const CHANNEL_USERNAME = "@awt_bots";
const MONGO_URI = process.env.MONGO_URI;
const DUMP_CHANNEL_ID = process.env.DUMP_CHANNEL_ID || ""; // Add to .env file
const WEB_PORT = process.env.WEB_PORT || 3000;

// MongoDB setup
const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let usersCollection;
let downloadsCollection;

// Web server for serving downloaded files
const app = express();
const downloadsPath = path.join(__dirname, "downloads");

// Create downloads directory if it doesn't exist
if (!fs.existsSync(downloadsPath)) {
    fs.mkdirSync(downloadsPath);
}

// Connect to MongoDB
(async () => {
    await client.connect();
    const db = client.db("telegramBot");
    usersCollection = db.collection("users");
    downloadsCollection = db.collection("downloads");
    console.log("📂 Connected to MongoDB");
})();

// Serve static files from downloads directory
app.use('/downloads', express.static(downloadsPath));

// Add a simple homepage
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>TeraBox Downloader</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                    h1 { color: #0088cc; }
                    .form-group { margin-bottom: 15px; }
                    input[type="text"] { width: 70%; padding: 8px; }
                    button { background: #0088cc; color: white; border: none; padding: 10px 15px; cursor: pointer; }
                    .downloads { margin-top: 30px; }
                </style>
            </head>
            <body>
                <h1>TeraBox Downloader</h1>
                <div class="form-group">
                    <input type="text" id="terabox-url" placeholder="Enter TeraBox URL or ID">
                    <button onclick="downloadFile()">Download</button>
                </div>
                <div id="status"></div>
                <div class="downloads">
                    <h2>Recent Downloads</h2>
                    <div id="downloads-list">Loading...</div>
                </div>
                
                <script>
                    // Load recent downloads
                    fetch('/api/recent-downloads')
                        .then(res => res.json())
                        .then(data => {
                            const list = document.getElementById('downloads-list');
                            if (data.length === 0) {
                                list.innerHTML = '<p>No recent downloads</p>';
                                return;
                            }
                            
                            list.innerHTML = data.map(item => 
                                \`<p><a href="/downloads/\${item.fileName}" target="_blank">\${item.fileName}</a> - \${new Date(item.date).toLocaleString()}</p>\`
                            ).join('');
                        })
                        .catch(err => {
                            document.getElementById('downloads-list').innerHTML = '<p>Error loading downloads</p>';
                        });
                    
                    // Download function
                    function downloadFile() {
                        const url = document.getElementById('terabox-url').value;
                        const statusDiv = document.getElementById('status');
                        
                        if (!url) {
                            statusDiv.innerHTML = '<p style="color: red">Please enter a valid URL</p>';
                            return;
                        }
                        
                        statusDiv.innerHTML = '<p>Processing your request...</p>';
                        
                        fetch(\`/api/download?url=\${encodeURIComponent(url)}\`)
                            .then(res => res.json())
                            .then(data => {
                                if (data.success) {
                                    statusDiv.innerHTML = \`<p style="color: green">Download started! <a href="/downloads/\${data.fileName}" target="_blank">Click here</a> when done.</p>\`;
                                } else {
                                    statusDiv.innerHTML = \`<p style="color: red">Error: \${data.message}</p>\`;
                                }
                            })
                            .catch(err => {
                                statusDiv.innerHTML = '<p style="color: red">An error occurred</p>';
                            });
                    }
                </script>
            </body>
        </html>
    `);
});

// API endpoint for recent downloads
app.get('/api/recent-downloads', async (req, res) => {
    try {
        const downloads = await downloadsCollection.find({})
            .sort({ date: -1 })
            .limit(10)
            .toArray();
        res.json(downloads);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch downloads' });
    }
});

// API endpoint for downloading
app.get('/api/download', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ success: false, message: 'Missing URL parameter' });
    }
    
    try {
        const videoId = extractTeraboxId(url);
        if (!videoId) {
            return res.status(400).json({ success: false, message: 'Invalid TeraBox URL' });
        }
        
        // Just start the download process and return
        // The actual download will happen in the background
        downloadTeraboxFile(videoId, null, 'web').then(result => {
            console.log('Web download result:', result);
        }).catch(error => {
            console.error('Web download error:', error);
        });
        
        res.json({ 
            success: true, 
            message: 'Download started', 
            fileName: `terabox_${videoId}.mp4` 
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'An error occurred while processing your request'
        });
    }
});

// Helper functions
async function isUserMember(userId) {
    try {
        const chatMember = await bot.telegram.getChatMember(CHANNEL_USERNAME, userId);
        return ["member", "administrator", "creator"].includes(chatMember.status);
    } catch (error) {
        console.error("Error checking membership:", error.message);
        return false;
    }
}

async function saveUser(userId) {
    await usersCollection.updateOne({ userId }, { $set: { userId, lastActive: new Date() } }, { upsert: true });
}

async function saveDownload(fileName, fileSize, source) {
    await downloadsCollection.insertOne({
        fileName,
        fileSize,
        date: new Date(),
        source
    });
}

function extractTeraboxId(text) {
    const match = text.match(/\/s\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : text.trim();
}

async function downloadTeraboxFile(videoId, ctx, source = 'telegram') {
    try {
        console.log(`Downloading file with ID: ${videoId} from ${source}`);
        
        // Send processing message if in Telegram context
        let processingMsg;
        if (ctx) {
            processingMsg = await ctx.reply("⏳ Fetching video link...");
        }
        
        // Get file info from API
        const response = await axios.get(`${BASE_URL}?id=${videoId}`);
        console.log("API Response:", response.data);
        
        if (!response.data || response.data.success !== true) {
            if (ctx) {
                await ctx.reply("❌ Failed to fetch video. Please check the link.");
            }
            return { success: false, message: "Failed to fetch video" };
        }
        
        const downloadUrl = response.data.data.downloadLink;
        const fileName = response.data.data.filename || `terabox_${videoId}.mp4`;
        const fileSize = parseInt(response.data.data.size, 10) || 0;
        const sanitizedFileName = fileName.replace(/[^\w\s.-]/gi, '_');
        const filePath = path.join(downloadsPath, sanitizedFileName);
        
        console.log("Download URL:", downloadUrl);
        console.log("File size:", fileSize);
        
        if (!downloadUrl) {
            if (ctx) {
                await ctx.reply("❌ No download link found.");
            }
            return { success: false, message: "No download link found" };
        }
        
        // Check if file is too large for Telegram (if source is telegram)
        const fileSizeMB = fileSize / 1024 / 1024;
        const maxSizeMB = 50; // 50MB max for Telegram
        
        if (source === 'telegram' && fileSize > maxSizeMB * 1024 * 1024) {
            // If we have a dump channel and the file is too large for direct sending
            if (DUMP_CHANNEL_ID) {
                if (ctx) {
                    await ctx.reply(`📦 File is ${fileSizeMB.toFixed(2)}MB, uploading to channel instead...`);
                }
            } else {
                if (ctx) {
                    await ctx.reply(`🚨 Video is too large for Telegram (${fileSizeMB.toFixed(2)}MB)! Download manually: ${downloadUrl}`);
                }
                return { success: false, message: "File too large" };
            }
        }
        
        // Start downloading the file
        let progressMessage;
        if (ctx) {
            progressMessage = await ctx.reply("✅ Video found! 🔄 Downloading (0%)...");
        }
        
        const videoResponse = await axios({
            method: "GET",
            url: downloadUrl,
            responseType: "stream",
        });
        
        const writer = fs.createWriteStream(filePath);
        let downloadedSize = 0;
        const totalSize = fileSize;
        
        let lastProgress = 0;
        videoResponse.data.on("data", async (chunk) => {
            downloadedSize += chunk.length;
            const progress = Math.floor((downloadedSize / totalSize) * 100);
            
            if (progress >= lastProgress + 10 && ctx && progressMessage) {
                lastProgress = progress;
                try {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        progressMessage.message_id,
                        null,
                        `✅ Video found! 🔄 Downloading (${progress}%)...`
                    );
                } catch (error) {
                    console.error("Failed to update message:", error.message);
                }
            }
        });
        
        videoResponse.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on("finish", async () => {
                console.log(`✅ Video saved as: ${filePath}`);
                
                // Save download record
                await saveDownload(sanitizedFileName, fileSize, source);
                
                if (ctx) {
                    if (progressMessage) {
                        await ctx.telegram.editMessageText(
                            ctx.chat.id,
                            progressMessage.message_id,
                            null,
                            "✅ Download complete! Sending video..."
                        );
                    }
                    
                    // Handle based on file size
                    if (fileSize <= maxSizeMB * 1024 * 1024) {
                        // Send directly to user
                        await ctx.replyWithVideo({ source: filePath });
                        
                        // Clean up messages
                        if (progressMessage) {
                            await ctx.telegram.deleteMessage(ctx.chat.id, progressMessage.message_id);
                        }
                        if (processingMsg) {
                            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
                        }
                    } else if (DUMP_CHANNEL_ID) {
                        // Send to dump channel and share the link
                        try {
                            const sentMessage = await bot.telegram.sendVideo(
                                DUMP_CHANNEL_ID,
                                { source: filePath },
                                { caption: `Requested by user: ${ctx.from.id}` }
                            );
                            
                            // Send the user a link to the file in the channel
                            const fileLink = `https://t.me/${DUMP_CHANNEL_ID.replace('@', '')}/${sentMessage.message_id}`;
                            await ctx.reply(`🎬 Your video is ready! Get it here: ${fileLink}`);
                            
                            // Clean up messages
                            if (progressMessage) {
                                await ctx.telegram.deleteMessage(ctx.chat.id, progressMessage.message_id);
                            }
                            if (processingMsg) {
                                await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
                            }
                        } catch (error) {
                            console.error("Error sending to dump channel:", error);
                            await ctx.reply(`❌ Failed to upload to channel. Download from web: ${process.env.WEB_URL || 'our website'}/downloads/${sanitizedFileName}`);
                        }
                    }
                }
                
                resolve({ 
                    success: true, 
                    filePath, 
                    fileName: sanitizedFileName 
                });
            });
            
            writer.on("error", (err) => {
                console.error("Error saving video:", err.message);
                if (ctx) {
                    ctx.reply("❌ Error downloading video.");
                }
                reject({ success: false, message: err.message });
            });
        });
    } catch (error) {
        console.error("Error fetching Terabox video:", error.message);
        if (ctx) {
            ctx.reply("❌ Something went wrong. Try again later.");
        }
        return { success: false, message: error.message };
    }
}

// Bot commands
bot.start((ctx) => ctx.reply("Send me a TeraBox link or Video ID, and I'll download it for you!"));

bot.command('dump', async (ctx) => {
    if (!DUMP_CHANNEL_ID) {
        return ctx.reply("❌ Dump channel functionality is not configured.");
    }
    
    ctx.reply(`🗂 Files are dumped to ${DUMP_CHANNEL_ID} when they're too large for direct sharing.`);
});

bot.command('web', (ctx) => {
    const webUrl = process.env.WEB_URL || `http://localhost:${WEB_PORT}`;
    ctx.reply(`🌐 You can also access and download files through our web interface:\n${webUrl}`);
});

bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    if (!(await isUserMember(userId))) {
        return ctx.reply(`❌ You must join ${CHANNEL_USERNAME} to use this bot.`);
    }
    await saveUser(userId);
    
    const text = ctx.message.text.trim();
    const videoId = extractTeraboxId(text);
    
    if (!videoId) {
        return ctx.reply("❌ Invalid TeraBox link. Please send a correct link or ID.");
    }
    
    console.log("Extracted Video ID:", videoId);
    
    // Launch the download process
    downloadTeraboxFile(videoId, ctx);
});

// Start the bot and web server
bot.launch();
console.log("🚀 TeraBox Video Bot is running...");

// Start web server
app.listen(WEB_PORT, () => {
    console.log(`🌐 Web server running on port ${WEB_PORT}`);
});

// Enable graceful stop
process.once('SIGINT', () => {
    bot.stop('SIGINT');
    client.close();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    client.close();
});

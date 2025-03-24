require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require("fs");
const { MongoClient } = require("mongodb");

const bot = new Telegraf(process.env.BOT_TOKEN);
const BASE_URL = "https://alphaapis.org/terabox";
const CHANNEL_USERNAME = "@terao2";
const DUMP_CHANNEL_ID = process.env.DUMP_CHANNEL_ID; // Add this to your .env file
const MONGO_URI = process.env.MONGO_URI;

const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let usersCollection;

(async () => {
    try {
        await client.connect();
        usersCollection = client.db("telegramBot").collection("users");
        console.log("📂 Connected to MongoDB");
    } catch (error) {
        console.error("Failed to connect to MongoDB:", error.message);
        process.exit(1);
    }
})();

async function isUserMember(userId) {
    try {
        const chatMember = await bot.telegram.getChatMember(CHANNEL_USERNAME, userId);
        return ["member", "administrator", "creator"].includes(chatMember.status);
    } catch (error) {
        console.error("Error checking membership:", error.message);
        return false;
    }
}

async function saveUser(userId, username = null) {
    try {
        await usersCollection.updateOne(
            { userId }, 
            { $set: { userId, username, lastActivity: new Date() } }, 
            { upsert: true }
        );
    } catch (error) {
        console.error("Error saving user:", error.message);
    }
}

function extractTeraboxId(text) {
    const match = text.match(/\/s\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : text.trim();
}

// Function to send file to dump channel
async function sendToDumpChannel(filePath, caption, ctx) {
    try {
        if (!DUMP_CHANNEL_ID) {
            console.warn("DUMP_CHANNEL_ID not configured, skipping dump channel upload");
            return null;
        }
        
        const message = await bot.telegram.sendVideo(
            DUMP_CHANNEL_ID, 
            { source: filePath },
            { 
                caption: caption,
                parse_mode: "HTML"
            }
        );
        
        console.log(`✅ Video sent to dump channel, message ID: ${message.message_id}`);
        return message;
    } catch (error) {
        console.error("Error sending to dump channel:", error.message);
        await ctx.reply("⚠️ Could not save to dump channel, but sending you the file directly.");
        return null;
    }
}

bot.start((ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    saveUser(userId, username);
    return ctx.reply("Welcome to TeraBox Downloader Bot! Send me a TeraBox link or Video ID, and I'll download it for you!");
});

bot.help((ctx) => {
    return ctx.reply(
        "How to use this bot:\n\n" +
        "1. Join our channel: " + CHANNEL_USERNAME + "\n" +
        "2. Send a TeraBox link (e.g., https://teraboxapp.com/s/abc123)\n" +
        "3. Wait for the bot to process and download your file\n\n" +
        "For support, contact @admin"
    );
});

bot.command("stats", async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
        return ctx.reply("⛔ This command is only for admins");
    }
    
    try {
        const totalUsers = await usersCollection.countDocuments();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const activeToday = await usersCollection.countDocuments({
            lastActivity: { $gte: today }
        });
        
        return ctx.reply(
            "📊 Bot Statistics\n\n" +
            `Total Users: ${totalUsers}\n` +
            `Active Today: ${activeToday}`
        );
    } catch (error) {
        console.error("Error fetching stats:", error.message);
        return ctx.reply("❌ Error fetching statistics");
    }
});

bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username;
    
    // Save/update user in database
    await saveUser(userId, username);
    
    // Check if user is a member of the required channel
    if (!(await isUserMember(userId))) {
        return ctx.reply(`❌ You must join ${CHANNEL_USERNAME} to use this bot.`);
    }

    const text = ctx.message.text.trim();
    const videoId = extractTeraboxId(text);

    if (!videoId) {
        return ctx.reply("❌ Invalid TeraBox link. Please send a correct link or ID.");
    }

    console.log("Extracted Video ID:", videoId);
    const processingMsg = await ctx.reply("⏳ Fetching video link...");

    try {
        const response = await axios.get(`${BASE_URL}?id=${videoId}`);
        console.log("API Response:", response.data);

        if (!response.data || response.data.success !== true) {
            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
            return ctx.reply("❌ Failed to fetch video. Please check the link.");
        }

        const downloadUrl = response.data.data.downloadLink;
        const fileName = response.data.data.filename || "video.mp4";
        const fileSize = parseInt(response.data.data.size, 10) || 0;
        const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);

        console.log("Download URL:", downloadUrl);
        console.log("File Size:", fileSizeMB, "MB");

        if (!downloadUrl) {
            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
            return ctx.reply("❌ No download link found.");
        }

        // 50MB limit for Telegram
        if (fileSize > 50000000) {
            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
            return ctx.reply(
                `🚨 File is too large for Telegram (${fileSizeMB} MB)!\n` +
                `Download manually: ${downloadUrl}`
            );
        }

        const progressMessage = await ctx.reply(
            `✅ Video found: ${fileName}\n` +
            `📦 Size: ${fileSizeMB} MB\n` +
            `🔄 Downloading (0%)...`
        );

        const videoResponse = await axios({
            method: "GET",
            url: downloadUrl,
            responseType: "stream",
        });

        const writer = fs.createWriteStream(fileName);
        let downloadedSize = 0;
        const totalSize = fileSize;

        let lastProgress = 0;
        videoResponse.data.on("data", async (chunk) => {
            downloadedSize += chunk.length;
            const progress = Math.floor((downloadedSize / totalSize) * 100);

            if (progress >= lastProgress + 10) {
                lastProgress = progress;
                try {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        progressMessage.message_id,
                        null,
                        `✅ Video found: ${fileName}\n` +
                        `📦 Size: ${fileSizeMB} MB\n` +
                        `🔄 Downloading (${progress}%)...`
                    );
                } catch (error) {
                    console.error("Failed to update message:", error.message);
                }
            }
        });

        videoResponse.data.pipe(writer);

        writer.on("finish", async () => {
            console.log(`✅ Video saved as: ${fileName}`);
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                progressMessage.message_id,
                null,
                "✅ Download complete! Sending video..."
            );
            
            // Caption for the video
            const caption = `<b>File:</b> ${fileName}\n<b>Size:</b> ${fileSizeMB} MB\n<b>Requested by:</b> @${username || "Unknown"}`;
            
            // First send to dump channel if configured
            const dumpMsg = await sendToDumpChannel(fileName, caption, ctx);
            
            // Send to user
            await ctx.replyWithVideo(
                { source: fileName },
                { caption: `✅ Download complete!\n<b>File:</b> ${fileName}\n<b>Size:</b> ${fileSizeMB} MB`, parse_mode: "HTML" }
            );
            
            // Clean up
            fs.unlinkSync(fileName);
            await ctx.telegram.deleteMessage(ctx.chat.id, progressMessage.message_id);
            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
            
            // Update stats
            try {
                await usersCollection.updateOne(
                    { userId },
                    { 
                        $inc: { downloads: 1, totalBytes: fileSize },
                        $set: { lastActivity: new Date() }
                    }
                );
            } catch (error) {
                console.error("Error updating stats:", error.message);
            }
        });

        writer.on("error", async (err) => {
            console.error("Error saving video:", err.message);
            await ctx.telegram.deleteMessage(ctx.chat.id, progressMessage.message_id);
            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
            await ctx.reply("❌ Error downloading video.");
        });
    } catch (error) {
        console.error("Error fetching Terabox video:", error.message);
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
        await ctx.reply("❌ Something went wrong. Try again later.");
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
    ctx.reply("❌ An unexpected error occurred. Please try again later.");
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.launch().then(() => {
    console.log("🚀 TeraBox Video Bot is running...");
}).catch(err => {
    console.error("Failed to start bot:", err);
});

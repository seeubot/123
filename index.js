require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require("fs");
const { MongoClient } = require("mongodb");

const bot = new Telegraf(process.env.BOT_TOKEN);
const BASE_URL = "https://alphaapis.org/terabox";
const CHANNEL_USERNAME = "@terao2";
// Add dump channel ID - this should be the channel's username or ID
const DUMP_CHANNEL_ID = process.env.DUMP_CHANNEL_ID || "@your_dump_channel";
const MONGO_URI = process.env.MONGO_URI;

const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let usersCollection;

(async () => {
    await client.connect();
    usersCollection = client.db("telegramBot").collection("users");
    console.log("📂 Connected to MongoDB");
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

async function saveUser(userId) {
    await usersCollection.updateOne({ userId }, { $set: { userId } }, { upsert: true });
}

function extractTeraboxId(text) {
    const match = text.match(/\/s\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : text.trim();
}

bot.start((ctx) => ctx.reply("Send me a TeraBox link or Video ID, and I'll download it for you!"));

bot.on("text", async (ctx) => {
    const userId = ctx.from.id;
    if (!(await isUserMember(userId))) {
        return ctx.reply(❌ You must join ${CHANNEL_USERNAME} to use this bot.);
    }
    await saveUser(userId);

    const text = ctx.message.text.trim();
    const videoId = extractTeraboxId(text);

    if (!videoId) {
        return ctx.reply("❌ Invalid TeraBox link. Please send a correct link or ID.");
    }

    console.log("Extracted Video ID:", videoId);
    const processingMsg = await ctx.reply("⏳ Fetching video link...");

    try {
        const response = await axios.get(${BASE_URL}?id=${videoId});
        console.log("API Response:", response.data);

        if (!response.data || response.data.success !== true) {
            return ctx.reply("❌ Failed to fetch video. Please check the link.");
        }

        const downloadUrl = response.data.data.downloadLink;
        const fileName = response.data.data.filename || "video.mp4";
        const fileSize = parseInt(response.data.data.size, 10) || 0;

        console.log("Download URL:", downloadUrl);

        if (!downloadUrl) {
            return ctx.reply("❌ No download link found.");
        }

        if (fileSize > 50000000) {
            return ctx.reply(🚨 Video is too large for Telegram! Download manually: ${downloadUrl});
        }

        const progressMessage = await ctx.reply("✅ Video found! 🔄 Downloading (0%)...");

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
                        ✅ Video found! 🔄 Downloading (${progress}%)...
                    );
                } catch (error) {
                    console.error("Failed to update message:", error.message);
                }
            }
        });

        videoResponse.data.pipe(writer);

writer.on("finish", async () => {
            console.log(✅ Video saved as: ${fileName});
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                progressMessage.message_id,
                null,
                "✅ Download complete! Sending video..."
            );
            
            // Send to user
            const sentMessage = await ctx.replyWithVideo({ source: fileName });
            
            // Send to dump channel
            try {
                // Get the original file ID from the sent message
                const fileId = sentMessage.video.file_id;
                
                // Prepare caption with user info
                const caption = File: ${fileName}\nRequested by: @${ctx.from.username || 'Unknown'} (ID: ${userId})\nOriginal link: ${text};
                
                // Send to dump channel using the file_id (more efficient than re-uploading)
                await bot.telegram.sendVideo(DUMP_CHANNEL_ID, fileId, { caption });
                console.log(✅ Video forwarded to dump channel: ${DUMP_CHANNEL_ID});
            } catch (error) {
                console.error("Error forwarding to dump channel:", error.message);
            }
            
            // Clean up
            fs.unlinkSync(fileName);
            await ctx.telegram.deleteMessage(ctx.chat.id, progressMessage.message_id);
            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
        });

        writer.on("error", (err) => {
            console.error("Error saving video:", err.message);
            ctx.reply("❌ Error downloading video.");
        });
    } catch (error) {
        console.error("Error fetching Terabox video:", error.message);
        ctx.reply("❌ Something went wrong. Try again later.");
    }
});

bot.launch();
console.log("🚀 TeraBox Video Bot is running with dump channel functionality...");

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

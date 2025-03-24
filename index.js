require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require("fs");
const { MongoClient } = require("mongodb");

const bot = new Telegraf(process.env.BOT_TOKEN);
const BASE_URL = "https://alphaapis.org/terabox";
const CHANNEL_USERNAME = "@awt_bots";
// Define the bump channel ID/username where files will be transferred
const BUMP_CHANNEL = ""; // Replace with your channel username or ID
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

// Function to forward files to the bump channel
async function forwardToBumpChannel(ctx, fileId, caption, fileType = 'video') {
    try {
        let result;
        
        // Forward different types of files based on fileType parameter
        switch (fileType) {
            case 'video':
                result = await bot.telegram.sendVideo(BUMP_CHANNEL, fileId, {
                    caption: caption || 'Video forwarded by TeraBox Downloader Bot'
                });
                break;
            case 'document':
                result = await bot.telegram.sendDocument(BUMP_CHANNEL, fileId, {
                    caption: caption || 'Document forwarded by TeraBox Downloader Bot'
                });
                break;
            case 'photo':
                result = await bot.telegram.sendPhoto(BUMP_CHANNEL, fileId, {
                    caption: caption || 'Photo forwarded by TeraBox Downloader Bot'
                });
                break;
            default:
                result = await bot.telegram.sendVideo(BUMP_CHANNEL, fileId, {
                    caption: caption || 'File forwarded by TeraBox Downloader Bot'
                });
        }
        
        console.log("✅ File forwarded to bump channel successfully");
        return result;
    } catch (error) {
        console.error("❌ Error forwarding to bump channel:", error.message);
        throw error;
    }
}

bot.start((ctx) => ctx.reply("Send me a TeraBox link or Video ID, and I'll download it for you!"));

// Command to transfer existing files to bump channel
bot.command('transfer', async (ctx) => {
    const userId = ctx.from.id;
    
    // Check if user is admin (you might want to add admin verification)
    const isAdmin = await isUserAdmin(userId);
    
    if (!isAdmin) {
        return ctx.reply("⛔ This command is only available to admins.");
    }
    
    // If this message is a reply to a media message, transfer that file
    if (ctx.message.reply_to_message && (
        ctx.message.reply_to_message.video || 
        ctx.message.reply_to_message.document || 
        ctx.message.reply_to_message.photo
    )) {
        const msg = ctx.message.reply_to_message;
        let fileId, fileType;
        
        if (msg.video) {
            fileId = msg.video.file_id;
            fileType = 'video';
        } else if (msg.document) {
            fileId = msg.document.file_id;
            fileType = 'document';
        } else if (msg.photo && msg.photo.length > 0) {
            fileId = msg.photo[msg.photo.length - 1].file_id; // Get largest photo
            fileType = 'photo';
        }
        
        if (fileId) {
            try {
                const statusMsg = await ctx.reply("🔄 Transferring file to channel...");
                await forwardToBumpChannel(ctx, fileId, msg.caption, fileType);
                await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
                return ctx.reply("✅ File transferred to channel successfully!");
            } catch (error) {
                return ctx.reply("❌ Failed to transfer file to channel: " + error.message);
            }
        }
    } else {
        return ctx.reply("ℹ️ Please reply to a media message with /transfer to forward it to the channel.");
    }
});

// Helper function to check if user is admin
async function isUserAdmin(userId) {
    try {
        // You can implement your admin verification logic here
        // For example, check against a list of admin IDs in your database
        // or check if the user is an admin in your channel
        
        const chatMember = await bot.telegram.getChatMember(CHANNEL_USERNAME, userId);
        return ["administrator", "creator"].includes(chatMember.status);
        
        // Alternative: hardcode admin IDs
        // const adminIds = [12345678, 87654321]; // Replace with actual admin IDs
        // return adminIds.includes(userId);
    } catch (error) {
        console.error("Error checking admin status:", error.message);
        return false;
    }
}

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
    const processingMsg = await ctx.reply("⏳ Fetching video link...");

    try {
        const response = await axios.get(`${BASE_URL}?id=${videoId}`);
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
            return ctx.reply(`🚨 Video is too large for Telegram! Download manually: ${downloadUrl}`);
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
                        `✅ Video found! 🔄 Downloading (${progress}%)...`
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
            
            // Send the video to the user
            const sentVideo = await ctx.replyWithVideo({ source: fileName });
            
            // Forward to bump channel automatically
            try {
                await forwardToBumpChannel(
                    ctx, 
                    sentVideo.video.file_id, 
                    `TeraBox Video: ${fileName}\nDownloaded by: @${ctx.from.username || ctx.from.id}`
                );
                
                // Inform the user that video was forwarded to channel
                await ctx.reply("📤 Video has been shared to our channel automatically!");
            } catch (error) {
                console.error("Error forwarding to channel:", error.message);
                // Don't notify user about channel forwarding failure
            }
            
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

// Add a command to toggle automatic forwarding for admin use
let autoForwarding = true; // Default is enabled

bot.command('toggleforward', async (ctx) => {
    const userId = ctx.from.id;
    
    if (await isUserAdmin(userId)) {
        autoForwarding = !autoForwarding;
        ctx.reply(`🔄 Automatic forwarding to bump channel is now ${autoForwarding ? 'ENABLED' : 'DISABLED'}`);
    } else {
        ctx.reply("⛔ This command is only available to admins.");
    }
});

bot.launch();
console.log("🚀 TeraBox Video Bot is running...");

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

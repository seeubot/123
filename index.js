require("dotenv").config();
const { Telegraf } = require("telegraf");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const express = require("express"); // Add Express

// Check for required environment variables
if (!process.env.BOT_TOKEN) {
  console.error("❌ Missing BOT_TOKEN environment variable");
  process.exit(1);
}

if (!process.env.MONGO_URI) {
  console.error("❌ Missing MONGO_URI environment variable");
  process.exit(1);
}

// Initialize Express server
const app = express();
const PORT = process.env.PORT || 3000;

// Add a simple health check endpoint
app.get("/", (req, res) => {
  res.send("TeraBox Bot is running!");
});

const bot = new Telegraf(process.env.BOT_TOKEN);
const BASE_URL = "https://alphaapis.org/terabox";
const CHANNEL_USERNAME = "@terao2";
// Define the bump channel ID/username where files will be transferred
const BUMP_CHANNEL = "-1002146782406"; // Replace with your channel username or ID
const MONGO_URI = process.env.MONGO_URI;

const client = new MongoClient(MONGO_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
});

let usersCollection;
let dbClient;

// Connect to MongoDB with proper error handling
async function connectToMongo() {
  try {
    dbClient = await client.connect();
    usersCollection = client.db("telegramBot").collection("users");
    console.log("📂 Connected to MongoDB");
    return true;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    return false;
  }
}

// Clean shutdown handling
function setupGracefulShutdown() {
  const shutdown = async () => {
    console.log("🛑 Shutting down...");
    
    // Stop the bot
    bot.stop("Shutdown");
    
    // Close MongoDB connection if open
    if (dbClient) {
      console.log("📂 Closing MongoDB connection...");
      await client.close();
    }
    
    console.log("👋 Goodbye!");
    process.exit(0);
  };

  // Graceful shutdown signals
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

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
  try {
    await usersCollection.updateOne(
      { userId }, 
      { $set: { userId, lastActive: new Date() } }, 
      { upsert: true }
    );
  } catch (error) {
    console.error("❌ Error saving user:", error.message);
  }
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

// Helper function to check if user is admin
async function isUserAdmin(userId) {
  try {
    const chatMember = await bot.telegram.getChatMember(CHANNEL_USERNAME, userId);
    return ["administrator", "creator"].includes(chatMember.status);
  } catch (error) {
    console.error("Error checking admin status:", error.message);
    return false;
  }
}

// Safely delete file with error handling
async function safeDeleteFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
    console.log(`✅ File deleted: ${filePath}`);
  } catch (error) {
    console.error(`❌ Error deleting file ${filePath}:`, error.message);
  }
}

// Safely edit message with error handling
async function safeEditMessage(ctx, messageId, text) {
  try {
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      messageId,
      null,
      text
    );
  } catch (error) {
    console.error("Failed to update message:", error.message);
  }
}

// Safely delete message with error handling
async function safeDeleteMessage(ctx, messageId) {
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
  } catch (error) {
    console.error("Failed to delete message:", error.message);
  }
}

// Add global error handler
bot.catch((err, ctx) => {
  console.error(`❌ Error in bot update ${ctx.updateType}:`, err);
  ctx.reply("❌ An error occurred. Please try again later.").catch(console.error);
});

// Set up bot commands
bot.start((ctx) => ctx.reply("Send me a TeraBox link or Video ID, and I'll download it for you!"));

// Command to transfer existing files to bump channel
bot.command('transfer', async (ctx) => {
  const userId = ctx.from.id;
  
  // Check if user is admin
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
        await safeDeleteMessage(ctx, statusMsg.message_id);
        return ctx.reply("✅ File transferred to channel successfully!");
      } catch (error) {
        return ctx.reply("❌ Failed to transfer file to channel: " + error.message);
      }
    }
  } else {
    return ctx.reply("ℹ️ Please reply to a media message with /transfer to forward it to the channel.");
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

// Handler for text messages (TeraBox links)
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
    // Get video information from the API
    const response = await axios.get(`${BASE_URL}?id=${videoId}`);
    console.log("API Response:", response.data);

    if (!response.data || response.data.success !== true) {
      await safeDeleteMessage(ctx, processingMsg.message_id);
      return ctx.reply("❌ Failed to fetch video. Please check the link.");
    }

    const downloadUrl = response.data.data

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RAPID_API_KEY = process.env.RAPID_API_KEY;
const DUMP_CHANNEL_ID = process.env.DUMP_CHANNEL_ID;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'https://one23-p9z6.onrender.com';
const DEPLOYMENT_MODE = process.env.DEPLOYMENT_MODE || 'polling';

// Ensure downloads directory exists
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

class TeraboxDownloader {
    constructor() {
        // Initialize bot based on deployment mode
        if (DEPLOYMENT_MODE === 'webhook') {
            this.bot = new TelegramBot(BOT_TOKEN, { webHook: { port: PORT } });
            this.bot.setWebHook(`${HOST}/${BOT_TOKEN}`);
        } else {
            this.bot = new TelegramBot(BOT_TOKEN, { polling: true });
        }

        this.setupHandlers();
    }

    setupHandlers() {
        this.bot.onText(/\/start|\/help/, this.sendWelcomeMessage.bind(this));
        this.bot.onText(/\/download (.+)/, this.handleDownload.bind(this));
    }

    sendWelcomeMessage(msg) {
        const chatId = msg.chat.id;
        const welcomeText = 
            "Welcome to Terabox Downloader Bot! 📦\n" +
            "Send /download followed by a Terabox URL to download a file.\n" +
            "Example: /download https://terabox.com/your_file_link\n\n" +
            "Files will be sent to you and optionally to the dump channel.";
        
        this.bot.sendMessage(chatId, welcomeText);
    }

    formatFileSize(sizeBytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = sizeBytes;
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    async handleDownload(msg, match) {
        const chatId = msg.chat.id;
        const url = match[1];

        try {
            // Fetch file details from RapidAPI
            const response = await axios.get('https://terabox-downloader-hyper.p.rapidapi.com/api', {
                params: { 
                    key: 'RapidAPI-1903-fast', 
                    url: url 
                },
                headers: {
                    'x-rapidapi-key': RAPID_API_KEY,
                    'x-rapidapi-host': 'terabox-downloader-hyper.p.rapidapi.com'
                }
            });

            const fileDetails = response.data;

            // Prepare file details message
            const detailsMessage = 
                `📁 File Name: ${fileDetails.file_name}\n` +
                `📊 File Size: ${this.formatFileSize(fileDetails.sizebytes)}`;

            // Prepare download options
            const downloadOptions = {
                reply_markup: {
                    inline_keyboard: [
                        fileDetails.link !== 'N/A' ? [{
                            text: '📥 Direct Download',
                            callback_data: `direct_download_${fileDetails.file_name}`
                        }] : [],
                        fileDetails.fastlink !== 'N/A' ? [{
                            text: '🚀 Fast Download',
                            callback_data: `fast_download_${fileDetails.file_name}`
                        }] : []
                    ].filter(row => row.length > 0)
                }
            };

            // Store file details for callback use
            this.lastFileDetails = {
                ...fileDetails,
                originalUrl: url
            };

            // Send file details with download options
            this.bot.sendMessage(chatId, detailsMessage, downloadOptions);
        } catch (error) {
            console.error('Download error:', error);
            this.bot.sendMessage(chatId, `Download error: ${error.message}`);
        }
    }

    async downloadFile(downloadLink, fileName) {
        try {
            const response = await axios({
                method: 'get',
                url: downloadLink,
                responseType: 'stream'
            });

            // Sanitize filename
            const safeFileName = fileName.replace(/[^a-z0-9.]/gi, '_').replace(/__+/g, '_');
            const filePath = path.join(DOWNLOAD_DIR, safeFileName);

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                writer.on('finish', () => resolve(filePath));
                writer.on('error', reject);
            });
        } catch (error) {
            console.error('File download error:', error);
            throw error;
        }
    }

    // Implement callback query handler
    registerCallbackQueryHandler() {
        this.bot.on('callback_query', async (callbackQuery) => {
            const chatId = callbackQuery.message.chat.id;
            const data = callbackQuery.data;

            try {
                const downloadType = data.split('_')[0];
                const fileDetails = this.lastFileDetails;

                let downloadLink;
                if (downloadType === 'direct' && fileDetails.link !== 'N/A') {
                    downloadLink = fileDetails.link;
                } else if (downloadType === 'fast' && fileDetails.fastlink !== 'N/A') {
                    downloadLink = fileDetails.fastlink;
                } else {
                    throw new Error('No download link available');
                }

                // Download file
                const filePath = await this.downloadFile(downloadLink, fileDetails.file_name);

                // Send file to user
                await this.bot.sendDocument(chatId, filePath);

                // Optional: Send to dump channel
                if (DUMP_CHANNEL_ID) {
                    await this.bot.sendDocument(DUMP_CHANNEL_ID, filePath, {
                        caption: `📁 File Name: ${fileDetails.file_name}\n` +
                                 `📊 File Size: ${this.formatFileSize(fileDetails.sizebytes)}\n` +
                                 `🔗 Original URL: ${fileDetails.originalUrl}`
                    });
                }

                // Answer callback query
                this.bot.answerCallbackQuery(callbackQuery.id, { 
                    text: `${downloadType.charAt(0).toUpperCase() + downloadType.slice(1)} download successful!` 
                });
            } catch (error) {
                console.error('Callback query error:', error);
                this.bot.answerCallbackQuery(callbackQuery.id, { 
                    text: `Download failed: ${error.message}` 
                });
            }
        });
    }

    start() {
        this.registerCallbackQueryHandler();
        console.log(`Bot started in ${DEPLOYMENT_MODE} mode`);
    }
}

// Express server for webhook support
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Terabox Downloader Bot is running');
});

const bot = new TeraboxDownloader();
bot.start();

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

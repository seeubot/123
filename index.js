const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const url = require('url');

// Load environment variables
dotenv.config();

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RAPID_API_KEY = process.env.RAPID_API_KEY;
const DUMP_CHANNEL_ID = process.env.DUMP_CHANNEL_ID;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'https://one23-p9z6.onrender.com';
const DEPLOYMENT_MODE = process.env.DEPLOYMENT_MODE || 'polling';

// Ensure download directory exists
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

// Express server for webhook support
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Terabox Downloader Bot is running');
});

// Log the environment for debugging
console.log(`Starting application with PORT=${PORT}, MODE=${DEPLOYMENT_MODE}`);

// Supported domains - Extended list of TeraBox related domains
const SUPPORTED_DOMAINS = [
    'terabox.com',
    'teraboxapp.com',
    '1drv.ms',
    'nephobox.com',
    '4funbox.com',
    'mirrobox.com',
    'momerybox.com',
    '1024tera.com',
    'terabox.app',
    'gibibox.com',
    'goaibox.com',
    'terasharelink.com',
    'teraboxlink.com',
    'terafileshare.com'
];

class TeraboxDownloader {
    constructor() {
        // Initialize bot based on deployment mode
        if (DEPLOYMENT_MODE === 'webhook') {
            // For webhook mode, we'll use the Express server
            this.bot = new TelegramBot(BOT_TOKEN);
            
            // Set up the webhook route in our Express app
            app.post(`/${BOT_TOKEN}`, (req, res) => {
                this.bot.processUpdate(req.body);
                res.sendStatus(200);
            });
            
            // Set the webhook externally
            this.bot.setWebHook(`${HOST}/${BOT_TOKEN}`);
            console.log(`Webhook set to ${HOST}/${BOT_TOKEN}`);
        } else {
            this.bot = new TelegramBot(BOT_TOKEN, { polling: true });
            console.log('Bot started in polling mode');
        }

        // Store file details by chat ID
        this.fileDetailsMap = new Map();
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
            "Send /download followed by a URL to download a file.\n" +
            "Example: /download https://terabox.com/your_file_link\n\n" +
            "Supported platforms:\n" + 
            SUPPORTED_DOMAINS.map(domain => `• ${domain}`).join('\n') + "\n\n" +
            "Files will be sent to you directly from the best available server.";
        
        this.bot.sendMessage(chatId, welcomeText);
    }

    formatFileSize(sizeBytes) {
        // Fix for the TypeError - Check if sizeBytes is a string
        if (typeof sizeBytes === 'string') {
            if (sizeBytes.includes('MB') || sizeBytes.includes('GB')) {
                return sizeBytes; // Already formatted
            }
        }
        
        // Make sure sizeBytes is a number for calculation
        const size = Number(sizeBytes);
        if (isNaN(size)) {
            return 'Unknown size'; // Handle invalid input
        }
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let convertedSize = size;
        let unitIndex = 0;

        while (convertedSize >= 1024 && unitIndex < units.length - 1) {
            convertedSize /= 1024;
            unitIndex++;
        }

        return `${convertedSize.toFixed(2)} ${units[unitIndex]}`;
    }

    getServiceProvider(url) {
        for (const domain of SUPPORTED_DOMAINS) {
            if (url.includes(domain)) {
                return domain;
            }
        }
        return null;
    }

    extractTeraboxId(teraboxUrl) {
        try {
            // Handle different Terabox URL formats
            let videoId = null;
            
            // Format 1: https://terabox.com/s/1abcdefg
            if (teraboxUrl.includes('/s/1')) {
                videoId = teraboxUrl.split('/s/1')[1].split('/')[0];
                return '1' + videoId;
            }
            
            // Format 2: https://terabox.com/sharing/link?surl=abcdefg
            const urlObj = new URL(teraboxUrl);
            if (urlObj.searchParams.has('surl')) {
                return urlObj.searchParams.get('surl');
            }
            
            // If we couldn't extract the ID, return the whole URL
            return teraboxUrl;
        } catch (error) {
            console.error('Error extracting Terabox ID:', error);
            return teraboxUrl;
        }
    }

    async fetchTeraboxDetailsFromAlphaAPI(teraboxUrl) {
        try {
            const videoId = this.extractTeraboxId(teraboxUrl);
            console.log(`Using AlphaAPIs with ID: ${videoId}`);
            
            const response = await axios.get(`https://alphaapis.org/terabox?id=${videoId}`);
            
            if (response.data.status !== "success" || !response.data.data) {
                throw new Error('Failed to get file details from AlphaAPIs');
            }
            
            // Convert AlphaAPI format to our standard format
            return {
                file_name: response.data.data.file_name,
                sizebytes: response.data.data.file_size,
                file_size: response.data.data.file_size,
                link: response.data.data.download_url,
                fastlink: response.data.data.download_url,
                thumbnail: response.data.data.thumbnail || null,
                duration: response.data.data.duration || null,
                created_at: response.data.data.created_at || null,
                is_hd: response.data.data.is_hd || false,
                file_type: response.data.data.file_type || null
            };
        } catch (error) {
            console.error('AlphaAPI error:', error);
            throw new Error(`AlphaAPI error: ${error.message}`);
        }
    }

    async fetchTeraboxDetailsFromRapidAPI(teraboxUrl) {
        try {
            const response = await axios.get('https://terabox-downloader-hyper.p.rapidapi.com/api', {
                params: { 
                    key: 'RapidAPI-1903-fast', 
                    url: teraboxUrl 
                },
                headers: {
                    'x-rapidapi-key': RAPID_API_KEY,
                    'x-rapidapi-host': 'terabox-downloader-hyper.p.rapidapi.com'
                }
            });
            
            if (!response.data || !response.data.file_name) {
                throw new Error('Invalid response from RapidAPI');
            }
            
            return response.data;
        } catch (error) {
            console.error('RapidAPI error:', error);
            throw new Error(`RapidAPI error: ${error.message}`);
        }
    }

    // Try to fetch from both APIs and return the best result
    async getBestTeraboxDetails(url) {
        let rapidAPIResult = null;
        let alphaAPIResult = null;
        let rapidAPIError = null;
        let alphaAPIError = null;
        
        // Try RapidAPI
        try {
            rapidAPIResult = await this.fetchTeraboxDetailsFromRapidAPI(url);
        } catch (error) {
            rapidAPIError = error;
        }
        
        // Try AlphaAPI
        try {
            alphaAPIResult = await this.fetchTeraboxDetailsFromAlphaAPI(url);
        } catch (error) {
            alphaAPIError = error;
        }
        
        // If both failed, throw error
        if (!rapidAPIResult && !alphaAPIResult) {
            throw new Error(`Both APIs failed. RapidAPI: ${rapidAPIError?.message || 'Unknown error'}, AlphaAPI: ${alphaAPIError?.message || 'Unknown error'}`);
        }
        
        // If only one succeeded, return that one
        if (rapidAPIResult && !alphaAPIResult) {
            return { details: rapidAPIResult, source: 'RapidAPI' };
        }
        
        if (!rapidAPIResult && alphaAPIResult) {
            return { details: alphaAPIResult, source: 'AlphaAPI' };
        }
        
        // If both succeeded, compare and return the best one
        // Prefer the one with fast link
        if (rapidAPIResult.fastlink && rapidAPIResult.fastlink !== 'N/A') {
            return { details: rapidAPIResult, source: 'RapidAPI' };
        }
        
        if (alphaAPIResult.fastlink && alphaAPIResult.fastlink !== 'N/A') {
            return { details: alphaAPIResult, source: 'AlphaAPI' };
        }
        
        // If no fast links, prefer the one with direct link
        if (rapidAPIResult.link && rapidAPIResult.link !== 'N/A') {
            return { details: rapidAPIResult, source: 'RapidAPI' };
        }
        
        // Default to AlphaAPI if both have similar capabilities
        return { details: alphaAPIResult, source: 'AlphaAPI' };
    }

    async handleDownload(msg, match) {
        const chatId = msg.chat.id;
        const url = match[1];
        
        // Send a processing message
        const statusMsg = await this.bot.sendMessage(chatId, "Processing your request...");

        try {
            // Check if URL is from a supported service
            const serviceProvider = this.getServiceProvider(url);
            if (!serviceProvider) {
                throw new Error(`Unsupported URL. Please provide a Terabox link from one of the supported domains:\n${SUPPORTED_DOMAINS.join(', ')}`);
            }

            // Show typing indicator
            this.bot.sendChatAction(chatId, 'typing');

            // Get the best details from available APIs
            const { details: fileDetails, source: apiSource } = await this.getBestTeraboxDetails(url);
            
            // Verify we have valid file details
            if (!fileDetails || !fileDetails.file_name) {
                throw new Error('Invalid response from API. Could not get file details.');
            }

            // Prepare file details message
            const detailsMessage = 
                `📁 File Name: ${fileDetails.file_name}\n` +
                `📊 File Size: ${this.formatFileSize(fileDetails.sizebytes || fileDetails.file_size)}\n` +
                `🔗 Source: ${serviceProvider}\n` +
                `🔌 API: ${apiSource}`;

            // Check if we have valid download links
            const hasDirectLink = fileDetails.link && fileDetails.link !== 'N/A';
            const hasFastLink = fileDetails.fastlink && fileDetails.fastlink !== 'N/A';
            
            if (!hasDirectLink && !hasFastLink) {
                throw new Error('No download links available for this file.');
            }

            // Update the message with file details
            await this.bot.editMessageText(`${detailsMessage}\n\nStarting download...`, {
                chat_id: chatId,
                message_id: statusMsg.message_id
            });

            // Choose the best link
            let downloadLink;
            if (hasFastLink) {
                downloadLink = fileDetails.fastlink;
            } else if (hasDirectLink) {
                downloadLink = fileDetails.link;
            } else {
                throw new Error('No valid download link available for this file.');
            }

            // Show download status
            this.bot.sendChatAction(chatId, 'upload_document');
            
            // Start the download
            await this.bot.editMessageText(`${detailsMessage}\n\n📥 Downloading file...`, {
                chat_id: chatId,
                message_id: statusMsg.message_id
            });
            
            try {
                // For files smaller than 50MB, download and send via bot
                if ((Number(fileDetails.sizebytes) < 50 * 1024 * 1024) || 
                    (fileDetails.file_size && fileDetails.file_size.includes('MB') && 
                     parseFloat(fileDetails.file_size) < 50)) {
                    
                    const filePath = await this.downloadAndSendFile(chatId, downloadLink, fileDetails.file_name, statusMsg.message_id, detailsMessage);
                    
                    // Send to dump channel if configured
                    if (DUMP_CHANNEL_ID) {
                        try {
                            await this.bot.sendDocument(DUMP_CHANNEL_ID, filePath, {
                                caption: `📁 File Name: ${fileDetails.file_name}\n` +
                                         `📊 File Size: ${this.formatFileSize(fs.statSync(filePath).size)}\n` +
                                         `🔗 Original URL: ${url}\n` +
                                         `🌐 Source: ${serviceProvider}\n` +
                                         `🔌 API: ${apiSource}`
                            });
                        } catch (channelError) {
                            console.error('Error sending to dump channel:', channelError);
                        }
                    }
                    
                    // Clean up
                    try {
                        fs.unlinkSync(filePath);
                    } catch (unlinkError) {
                        console.error('Error removing temp file:', unlinkError);
                    }
                    
                } else {
                    // For larger files, send direct link
                    await this.bot.editMessageText(`${detailsMessage}\n\n⚠️ File is larger than 50MB. Use the direct download link:\n\n${downloadLink}`, {
                        chat_id: chatId,
                        message_id: statusMsg.message_id,
                        disable_web_page_preview: false
                    });
                }
            } catch (dlError) {
                throw new Error(`Download failed: ${dlError.message}`);
            }
            
        } catch (error) {
            console.error('Download error:', error);
            
            // Update the status message with error information
            this.bot.editMessageText(`⚠️ Download error: ${error.message}`, {
                chat_id: chatId,
                message_id: statusMsg.message_id
            });
        }
    }

    async downloadAndSendFile(chatId, downloadLink, fileName, statusMsgId, detailsMessage) {
        try {
            console.log(`Downloading from: ${downloadLink}`);
            
            const response = await axios({
                method: 'get',
                url: downloadLink,
                responseType: 'stream',
                timeout: 120000, // 120 second timeout
                maxContentLength: 100 * 1024 * 1024, // 100MB limit
                validateStatus: function (status) {
                    return status >= 200 && status < 300; // only accept 2xx status codes
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Referer': 'https://terabox.com/'
                }
            });

            // Sanitize filename
            const safeFileName = fileName.replace(/[^a-z0-9.]/gi, '_').replace(/__+/g, '_');
            const filePath = path.join(DOWNLOAD_DIR, safeFileName);

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            return new Promise((resolve, reject) => {
                let totalBytes = 0;
                let lastUpdateTime = Date.now();
                
                response.data
                .on('data', (chunk) => {
                    totalBytes += chunk.length;
                    
                    // Update progress every 3 seconds
                    const now = Date.now();
                    if (now - lastUpdateTime > 3000) {
                        this.bot.editMessageText(`${detailsMessage}\n\n📥 Downloading: ${this.formatFileSize(totalBytes)} received...`, {
                            chat_id: chatId,
                            message_id: statusMsgId
                        }).catch(err => console.error('Error updating progress:', err));
                        
                        lastUpdateTime = now;
                    }
                });
                
                writer.on('finish', async () => {
                    await this.bot.editMessageText(`${detailsMessage}\n\n📤 Download complete! Sending file...`, {
                        chat_id: chatId,
                        message_id: statusMsgId
                    });
                    
                    // Send the file
                    await this.bot.sendDocument(chatId, filePath, {
                        caption: `📁 File: ${fileName}`
                    });
                    
                    // Update status message
                    await this.bot.editMessageText(`${detailsMessage}\n\n✅ File sent successfully!`, {
                        chat_id: chatId,
                        message_id: statusMsgId
                    });
                    
                    resolve(filePath);
                });
                
                writer.on('error', reject);
                
                // Add a timeout for large files
                setTimeout(() => {
                    if (fs.existsSync(filePath)) {
                        const stats = fs.statSync(filePath);
                        if (stats.size > 0) {
                            resolve(filePath);
                        } else {
                            reject(new Error('Download timed out or empty file'));
                        }
                    } else {
                        reject(new Error('Download failed - no file created'));
                    }
                }, 300000); // 5 minutes timeout
            });
        } catch (error) {
            console.error('File download error:', error);
            throw error;
        }
    }

    start() {
        console.log(`Bot started in ${DEPLOYMENT_MODE} mode`);
    }
}

// Initialize the bot
const bot = new TeraboxDownloader();
bot.start();

// Start Express server with explicit host binding
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running and listening on port ${PORT}`);
});

// Add proper error handling for the server
server.on('error', (error) => {
    console.error('Server error:', error);
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use`);
    }
});

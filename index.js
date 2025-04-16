const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const { exec } = require('child_process');
const fileType = require('file-type');
const util = require('util');
const execPromise = util.promisify(exec);
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

// Ensure directories exist
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const CONVERTED_DIR = path.join(__dirname, 'converted');

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

if (!fs.existsSync(CONVERTED_DIR)) {
    fs.mkdirSync(CONVERTED_DIR);
}

// Express server for webhook support
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Multi-Platform Downloader Bot with MP4 Conversion is running');
});

// Log the environment for debugging
console.log(`Starting application with PORT=${PORT}, MODE=${DEPLOYMENT_MODE}`);

// Supported domains
const SUPPORTED_DOMAINS = [
    'terabox.com',
    '1drv.ms',
    'mega.nz',
    'mediafire.com',
    'drive.google.com',
    'dropbox.com',
    'onedrive.live.com',
    'sendspace.com',
    'box.com',
    '4shared.com',
    'wetransfer.com',
    'filemail.com',
    'yandex.disk',
    'fshare.vn',
    'solidfiles.com',
    'zippyshare.com',
    'racaty.net',
    'files.fm',
    'file-upload.com',
    'gofile.io'
];

class MultiPlatformDownloader {
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
        this.bot.onText(/\/convert/, this.handleConvertCommand.bind(this));
        this.bot.onText(/\/settings/, this.handleSettingsCommand.bind(this));
    }

    sendWelcomeMessage(msg) {
        const chatId = msg.chat.id;
        const welcomeText = 
            "Welcome to Multi-Platform Downloader Bot! 📦\n" +
            "Send /download followed by a URL to download a file.\n" +
            "Example: /download https://terabox.com/your_file_link\n\n" +
            "Supported platforms:\n" + 
            SUPPORTED_DOMAINS.map(domain => `• ${domain}`).join('\n') + "\n\n" +
            "You can also convert videos to MP4 format during download.\n" +
            "Use /settings to configure your preferences.\n" +
            "Use /convert to learn about video conversion options.\n\n" +
            "Files will be sent to you and optionally to the dump channel.";
        
        this.bot.sendMessage(chatId, welcomeText);
    }

    handleConvertCommand(msg) {
        const chatId = msg.chat.id;
        const helpText = 
            "To convert a file to MP4 format:\n" +
            "1. Use /download [URL] to process your file\n" +
            "2. Select 'Download & Convert to MP4' option\n\n" +
            "⚠️ Note: Conversion works best with video files and may take some time depending on file size.";
        
        this.bot.sendMessage(chatId, helpText);
    }

    handleSettingsCommand(msg) {
        const chatId = msg.chat.id;
        const settingsText = 
            "⚙️ Settings\n\n" +
            "Choose your preferred API for Terabox downloads:";
        
        const settingsKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'RapidAPI (Default)', callback_data: 'settings_api_rapid' },
                        { text: 'AlphaAPIs', callback_data: 'settings_api_alpha' }
                    ],
                    [
                        { text: 'Auto (Try Both)', callback_data: 'settings_api_auto' }
                    ]
                ]
            }
        };
        
        this.bot.sendMessage(chatId, settingsText, settingsKeyboard);
    }

    formatFileSize(sizeBytes) {
        if (typeof sizeBytes === 'string' && sizeBytes.includes('MB') || sizeBytes.includes('GB')) {
            return sizeBytes; // Already formatted
        }
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = Number(sizeBytes);
        let unitIndex = 0;

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }

        return `${size.toFixed(2)} ${units[unitIndex]}`;
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

    async handleDownload(msg, match) {
        const chatId = msg.chat.id;
        const url = match[1];
        
        // Send a processing message
        const statusMsg = await this.bot.sendMessage(chatId, "Processing your request...");

        try {
            // Check if URL is from a supported service
            const serviceProvider = this.getServiceProvider(url);
            if (!serviceProvider) {
                throw new Error(`Unsupported URL. Please provide a link from one of the supported services:\n${SUPPORTED_DOMAINS.join(', ')}`);
            }

            // Show typing indicator
            this.bot.sendChatAction(chatId, 'typing');

            // For now, we only have direct API integration with Terabox
            // For other services, we'll need to implement specific handlers
            let fileDetails;
            let apiSource = '';
            
            if (serviceProvider === 'terabox.com' || serviceProvider === '1drv.ms') {
                // Try different APIs based on preference (default: RapidAPI first, then AlphaAPI)
                // In a real bot, we would save user preferences
                const userPreference = 'auto'; // Could be 'rapid', 'alpha', or 'auto'
                
                if (userPreference === 'rapid' || userPreference === 'auto') {
                    try {
                        fileDetails = await this.fetchTeraboxDetailsFromRapidAPI(url);
                        apiSource = 'RapidAPI';
                    } catch (rapidError) {
                        console.log('RapidAPI failed, trying AlphaAPI:', rapidError.message);
                        if (userPreference === 'auto') {
                            // If auto, try the other API
                            try {
                                fileDetails = await this.fetchTeraboxDetailsFromAlphaAPI(url);
                                apiSource = 'AlphaAPI';
                            } catch (alphaError) {
                                throw new Error(`Both APIs failed. RapidAPI: ${rapidError.message}, AlphaAPI: ${alphaError.message}`);
                            }
                        } else {
                            // If not auto, just throw the error
                            throw rapidError;
                        }
                    }
                } else if (userPreference === 'alpha') {
                    try {
                        fileDetails = await this.fetchTeraboxDetailsFromAlphaAPI(url);
                        apiSource = 'AlphaAPI';
                    } catch (alphaError) {
                        throw alphaError;
                    }
                }
            } else {
                // For other platforms, we'll add implementations later
                // For now, set a placeholder message
                throw new Error(`Direct download from ${serviceProvider} is not yet implemented. Support for additional platforms coming soon!`);
            }
            
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

            // Check if it's likely a video based on extension or file_type
            const fileExt = path.extname(fileDetails.file_name).toLowerCase();
            const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp'];
            const isLikelyVideo = 
                videoExtensions.includes(fileExt) || 
                (fileDetails.file_type && fileDetails.file_type.startsWith('video/'));

            // Prepare download options
            const downloadOptions = {
                reply_markup: {
                    inline_keyboard: [
                        // If fast link is available, prefer it
                        hasFastLink ? [
                            {
                                text: '📥 Download Original',
                                callback_data: `fast_original_${chatId}_${fileDetails.file_name.substring(0, 20)}`
                            }
                        ] : [],
                        // Fall back to direct link if fast link isn't available
                        !hasFastLink && hasDirectLink ? [
                            {
                                text: '📥 Download Original',
                                callback_data: `direct_original_${chatId}_${fileDetails.file_name.substring(0, 20)}`
                            }
                        ] : [],
                        // Add MP4 conversion option only if it's likely a video
                        isLikelyVideo ? [
                            {
                                text: '🎬 Download & Convert to MP4',
                                callback_data: `${hasFastLink ? 'fast' : 'direct'}_mp4_${chatId}_${fileDetails.file_name.substring(0, 20)}`
                            }
                        ] : []
                    ].filter(row => row.length > 0)
                }
            };

            // Store file details for callback use
            this.fileDetailsMap.set(chatId.toString(), {
                ...fileDetails,
                originalUrl: url,
                serviceProvider,
                apiSource
            });

            // Update the status message with file details and download options
            this.bot.editMessageText(detailsMessage, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                reply_markup: downloadOptions.reply_markup
            });
        } catch (error) {
            console.error('Download error:', error);
            
            // Update the status message with error information
            this.bot.editMessageText(`⚠️ Download error: ${error.message}`, {
                chat_id: chatId,
                message_id: statusMsg.message_id
            });
        }
    }

    async downloadFile(downloadLink, fileName) {
        try {
            console.log(`Downloading from: ${downloadLink}`);
            
            const response = await axios({
                method: 'get',
                url: downloadLink,
                responseType: 'stream',
                timeout: 120000, // 120 second timeout
                maxContentLength: 1024 * 1024 * 1024, // 1GB limit
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
                writer.on('finish', () => resolve(filePath));
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
                }, 600000); // 10 minutes timeout for very large files
            });
        } catch (error) {
            console.error('File download error:', error);
            throw error;
        }
    }

    async detectVideoFile(filePath) {
        try {
            // Use file-type to detect the file type
            const type = await fileType.fromFile(filePath);
            
            if (!type) return false;
            
            // Check if it's a video file
            const videoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm', 'video/mpeg'];
            return videoTypes.includes(type.mime);
        } catch (error) {
            console.error('Error detecting file type:', error);
            return false;
        }
    }

    async convertToMp4(filePath, outputFilename) {
        // First check if the file is already a valid video
        const isVideo = await this.detectVideoFile(filePath);
        if (!isVideo) {
            throw new Error('The file does not appear to be a valid video file.');
        }

        // Create output path
        const outputPath = path.join(CONVERTED_DIR, outputFilename);
        
        try {
            // Run ffmpeg to convert the file
            const command = `ffmpeg -i "${filePath}" -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k "${outputPath}"`;
            
            // Send progress status
            console.log(`Running conversion: ${command}`);
            
            // Execute the command
            await execPromise(command);
            
            // Verify the output file exists
            if (!fs.existsSync(outputPath)) {
                throw new Error('Conversion failed: Output file not created');
            }
            
            return outputPath;
        } catch (error) {
            console.error('Conversion error:', error);
            throw new Error(`Failed to convert file to MP4: ${error.message}`);
        }
    }

    // Register handlers for all callbacks
    registerCallbackHandlers() {
        this.bot.on('callback_query', async (callbackQuery) => {
            const data = callbackQuery.data;
            const chatId = callbackQuery.message.chat.id;
            
            // Handle settings callbacks
            if (data.startsWith('settings_')) {
                await this.handleSettingsCallback(callbackQuery);
                return;
            }
            
            // Handle download callbacks
            if (data.includes('_original_') || data.includes('_mp4_')) {
                await this.handleDownloadCallback(callbackQuery);
                return;
            }
        });
    }
    
    async handleSettingsCallback(callbackQuery) {
        const data = callbackQuery.data;
        const chatId = callbackQuery.message.chat.id;
        
        let settingValue = data.split('settings_api_')[1];
        let responseText = '';
        
        switch(settingValue) {
            case 'rapid':
                responseText = '✅ Settings updated: Using RapidAPI for Terabox downloads';
                break;
            case 'alpha':
                responseText = '✅ Settings updated: Using AlphaAPIs for Terabox downloads';
                break;
            case 'auto':
                responseText = '✅ Settings updated: Auto mode - will try both APIs for best results';
                break;
            default:
                responseText = '❌ Invalid setting';
        }
        
        // Acknowledge the callback query
        await this.bot.answerCallbackQuery(callbackQuery.id);
        
        // Update the message
        await this.bot.editMessageText(responseText, {
            chat_id: chatId,
            message_id: callbackQuery.message.message_id
        });
    }

    async handleDownloadCallback(callbackQuery) {
        const data = callbackQuery.data;
        const [downloadType, conversionType, chatIdStr, fileNamePart] = data.split('_');
        const chatId = callbackQuery.message.chat.id;

        try {
            // Acknowledge the callback query immediately
            await this.bot.answerCallbackQuery(callbackQuery.id, { 
                text: 'Processing your download request...' 
            });

            // Send a processing message
            await this.bot.sendMessage(chatId, "⏳ Starting download, please wait...");
            
            // Show download status
            this.bot.sendChatAction(chatId, 'upload_document');

            // Get file details from map
            const fileDetails = this.fileDetailsMap.get(chatIdStr);
            
            if (!fileDetails) {
                throw new Error('File details not found. Please try downloading again.');
            }

            let downloadLink;
            if (downloadType === 'direct' && fileDetails.link && fileDetails.link !== 'N/A') {
                downloadLink = fileDetails.link;
            } else if (downloadType === 'fast' && fileDetails.fastlink && fileDetails.fastlink !== 'N/A') {
                downloadLink = fileDetails.fastlink;
            } else {
                throw new Error('No valid download link available for this file.');
            }

            // Download file
            await this.bot.sendMessage(chatId, "📥 Downloading file...");
            const filePath = await this.downloadFile(downloadLink, fileDetails.file_name);

            let finalFilePath = filePath;
            let fileName = fileDetails.file_name;
            
            // Check if conversion is requested
            if (conversionType === 'mp4') {
                await this.bot.sendMessage(chatId, "🔄 Converting file to MP4 format...");
                
                // Generate MP4 filename
                const fileNameWithoutExt = path.parse(fileDetails.file_name).name;
                const mp4FileName = `${fileNameWithoutExt}.mp4`;
                
                try {
                    // Convert the file
                    finalFilePath = await this.convertToMp4(filePath, mp4FileName);
                    fileName = mp4FileName;
                    
                    await this.bot.sendMessage(chatId, "✅ Conversion completed successfully!");
                } catch (convError) {
                    await this.bot.sendMessage(chatId, `⚠️ Conversion failed: ${convError.message}\nSending original file instead.`);
                    // If conversion fails, use the original file
                    finalFilePath = filePath;
                }
            }

            // Send file to user
            await this.bot.sendMessage(chatId, "📤 Uploading file to Telegram...");
            await this.bot.sendDocument(chatId, finalFilePath, {
                caption: `📁 File: ${fileName}`
            });

            // Optional: Send to dump channel
            if (DUMP_CHANNEL_ID) {
                try {
                    await this.bot.sendDocument(DUMP_CHANNEL_ID, finalFilePath, {
                        caption: `📁 File Name: ${fileName}\n` +
                                 `📊 File Size: ${this.formatFileSize(fs.statSync(finalFilePath).size)}\n` +
                                 `🔗 Original URL: ${fileDetails.originalUrl}\n` +
                                 `🌐 Source: ${fileDetails.serviceProvider}\n` +
                                 `🔌 API: ${fileDetails.apiSource}`
                    });
                } catch (channelError) {
                    console.error('Error sending to dump channel:', channelError);
                    // Don't throw - this is a non-critical error
                }
            }

            // Clean up
            try {
                fs.unlinkSync(filePath);
                if (finalFilePath !== filePath && fs.existsSync(finalFilePath)) {
                    fs.unlinkSync(finalFilePath);
                }
            } catch (unlinkError) {
                console.error('Error removing temp file:', unlinkError);
            }

            // Notify success
            await this.bot.sendMessage(chatId, "✅ Download completed successfully!");
            
        } catch (error) {
            console.error('Callback query error:', error);
            this.bot.sendMessage(chatId, `⚠️ Download failed: ${error.message}`);
        }
    }

    start() {
        this.registerCallbackHandlers();
        console.log(`Bot started in ${DEPLOYMENT_MODE} mode`);
    }
}

// Initialize the bot
const bot = new MultiPlatformDownloader();
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

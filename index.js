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
        } else {
            this.bot = new TelegramBot(BOT_TOKEN, { polling: true });
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
        
        // Send a processing message
        const statusMsg = await this.bot.sendMessage(chatId, "Processing your request...");

        try {
            // Validate URL (basic check)
            if (!url.includes('terabox.com') && !url.includes('1drv.ms')) {
                throw new Error('Invalid Terabox URL. Please provide a valid Terabox link.');
            }

            // Show typing indicator
            this.bot.sendChatAction(chatId, 'typing');

            // Fetch file details from RapidAPI with better error handling
            let response;
            try {
                response = await axios.get('https://terabox-downloader-hyper.p.rapidapi.com/api', {
                    params: { 
                        key: 'RapidAPI-1903-fast', 
                        url: url 
                    },
                    headers: {
                        'x-rapidapi-key': RAPID_API_KEY,
                        'x-rapidapi-host': 'terabox-downloader-hyper.p.rapidapi.com'
                    }
                });
            } catch (apiError) {
                console.error('API Error:', apiError.response ? apiError.response.status : apiError.message);
                
                // Provide more specific error message based on status code
                if (apiError.response) {
                    if (apiError.response.status === 500) {
                        throw new Error('Server error from Terabox API. The link may be invalid or the file may be unavailable.');
                    } else if (apiError.response.status === 429) {
                        throw new Error('Too many requests. Please try again later.');
                    } else {
                        throw new Error(`API error: ${apiError.response.status} - ${apiError.response.statusText}`);
                    }
                }
                throw apiError; // Re-throw if we don't have response details
            }

            const fileDetails = response.data;
            
            // Verify we have valid file details
            if (!fileDetails || !fileDetails.file_name) {
                throw new Error('Invalid response from API. Could not get file details.');
            }

            // Prepare file details message
            const detailsMessage = 
                `📁 File Name: ${fileDetails.file_name}\n` +
                `📊 File Size: ${this.formatFileSize(fileDetails.sizebytes || 0)}`;

            // Check if we have valid download links
            const hasDirectLink = fileDetails.link && fileDetails.link !== 'N/A';
            const hasFastLink = fileDetails.fastlink && fileDetails.fastlink !== 'N/A';
            
            if (!hasDirectLink && !hasFastLink) {
                throw new Error('No download links available for this file.');
            }

            // Prepare download options
            const downloadOptions = {
                reply_markup: {
                    inline_keyboard: [
                        hasDirectLink ? [{
                            text: '📥 Direct Download',
                            callback_data: `direct_${chatId}_${fileDetails.file_name.substring(0, 20)}`
                        }] : [],
                        hasFastLink ? [{
                            text: '🚀 Fast Download',
                            callback_data: `fast_${chatId}_${fileDetails.file_name.substring(0, 20)}`
                        }] : []
                    ].filter(row => row.length > 0)
                }
            };

            // Store file details for callback use
            this.fileDetailsMap.set(chatId.toString(), {
                ...fileDetails,
                originalUrl: url
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
            const response = await axios({
                method: 'get',
                url: downloadLink,
                responseType: 'stream',
                timeout: 30000, // 30 second timeout
                maxContentLength: 100 * 1024 * 1024, // 100MB limit
                validateStatus: function (status) {
                    return status >= 200 && status < 300; // only accept 2xx status codes
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
            });
        } catch (error) {
            console.error('File download error:', error);
            throw error;
        }
    }

    // Improved callback query handler
    registerCallbackQueryHandler() {
        this.bot.on('callback_query', async (callbackQuery) => {
            const data = callbackQuery.data;
            const [downloadType, chatIdStr, fileNamePart] = data.split('_');
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
                const filePath = await this.downloadFile(downloadLink, fileDetails.file_name);

                // Send file to user
                await this.bot.sendDocument(chatId, filePath, {
                    caption: `📁 File: ${fileDetails.file_name}`
                });

                // Optional: Send to dump channel
                if (DUMP_CHANNEL_ID) {
                    try {
                        await this.bot.sendDocument(DUMP_CHANNEL_ID, filePath, {
                            caption: `📁 File Name: ${fileDetails.file_name}\n` +
                                     `📊 File Size: ${this.formatFileSize(fileDetails.sizebytes || 0)}\n` +
                                     `🔗 Original URL: ${fileDetails.originalUrl}`
                        });
                    } catch (channelError) {
                        console.error('Error sending to dump channel:', channelError);
                        // Don't throw - this is a non-critical error
                    }
                }

                // Clean up
                try {
                    fs.unlinkSync(filePath);
                } catch (unlinkError) {
                    console.error('Error removing temp file:', unlinkError);
                }

                // Notify success
                await this.bot.sendMessage(chatId, "✅ Download completed successfully!");
                
            } catch (error) {
                console.error('Callback query error:', error);
                this.bot.sendMessage(chatId, `⚠️ Download failed: ${error.message}`);
            }
        });
    }

    start() {
        this.registerCallbackQueryHandler();
        console.log(`Bot started in ${DEPLOYMENT_MODE} mode`);
    }
}

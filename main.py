import os
import time
import requests
import logging
import sys
import json
from dotenv import load_dotenv
import urllib3

# Import python-telegram-bot
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes

# Use environment variables for configuration
PORT = int(os.getenv('PORT', 5000))
HOST = os.getenv('HOST', 'https://one23-p9z6.onrender.com')

# Disable SSL warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('bot_log.txt'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

class TeraboxDownloader:
    def __init__(self, bot_token, rapid_api_key, dump_channel_id=None):
        try:
            self.bot_token = bot_token
            self.rapid_api_key = rapid_api_key
            self.dump_channel_id = dump_channel_id
            self.download_directory = "downloads"
            
            # Create download directory
            os.makedirs(self.download_directory, exist_ok=True)
            
            # Store last file details
            self.last_file_details = None
        
        except Exception as e:
            logger.error(f"Initialization Error: {e}")
            raise
    
    def format_file_size(self, size_bytes):
        """Convert file size to human-readable format"""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size_bytes < 1024.0:
                return f"{size_bytes:.2f} {unit}"
            size_bytes /= 1024.0
    
    async def send_welcome(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Send welcome message"""
        welcome_text = (
            "Welcome to Terabox Downloader Bot! 📦\n"
            "Send /download followed by a Terabox URL to download a file.\n"
            "Example: /download https://terabox.com/your_file_link\n\n"
            "Files will be sent to you and optionally to the dump channel."
        )
        await update.message.reply_text(welcome_text)
    
    async def handle_download(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle download command"""
        try:
            if len(context.args) < 1:
                await update.message.reply_text("Please provide a Terabox URL")
                return
            
            url = context.args[0]
            await self.download_terabox_file(update, url)
        except Exception as e:
            logger.error(f"Download handler error: {e}")
            await update.message.reply_text(f"Error: {str(e)}")
    
    async def send_to_dump_channel(self, file_path, file_details):
        """Send file to dump channel"""
        if not self.dump_channel_id:
            logger.info("No dump channel configured. Skipping channel upload.")
            return False
        
        try:
            # Prepare caption with file details
            caption = (
                f"📁 File Name: {file_details['file_name']}\n"
                f"📊 File Size: {self.format_file_size(file_details['sizebytes'])}\n"
                f"🔗 Original URL: {file_details.get('original_url', 'N/A')}"
            )
            
            # Open and send file
            with open(file_path, 'rb') as file:
                await self.application.bot.send_document(
                    chat_id=self.dump_channel_id, 
                    document=file, 
                    caption=caption,
                )
            
            logger.info(f"File {file_details['file_name']} sent to dump channel")
            return True
        
        except Exception as e:
            logger.error(f"Error sending file to dump channel: {e}")
            return False
    
    def download_file(self, url, filename, original_url=None):
        """Download file from given URL"""
        try:
            # Download file with SSL verification disabled
            response = requests.get(
                url, 
                stream=True, 
                verify=False,  # Disable SSL verification
                timeout=(30, 60)  # (connect timeout, read timeout)
            )
            response.raise_for_status()
            
            # Sanitize filename to prevent potential security issues
            safe_filename = "".join(c for c in filename if c.isalnum() or c in (' ', '.', '_')).rstrip()
            
            # Ensure unique filename
            file_path = os.path.join(self.download_directory, safe_filename)
            base, ext = os.path.splitext(file_path)
            counter = 1
            while os.path.exists(file_path):
                file_path = f"{base}_{counter}{ext}"
                counter += 1
            
            # Save the file
            with open(file_path, 'wb') as file:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        file.write(chunk)
            
            return file_path
        
        except (requests.RequestException, IOError) as e:
            logger.error(f"File download error: {e}")
            raise
    
    async def download_terabox_file(self, update: Update, url):
        """Download Terabox file and send details"""
        try:
            # Prepare API request
            headers = {
                'x-rapidapi-key': self.rapid_api_key,
                'x-rapidapi-host': "terabox-downloader-hyper.p.rapidapi.com"
            }
            
            api_url = "https://terabox-downloader-hyper.p.rapidapi.com/api"
            params = {
                'key': 'RapidAPI-1903-fast',
                'url': url
            }
            
            # Send request
            response = requests.get(api_url, headers=headers, params=params)
            response.raise_for_status()
            
            # Parse JSON response
            response_data = response.json()
            
            # Extract specific keys
            file_details = {
                'file_name': response_data.get('file_name', 'Unknown File'),
                'sizebytes': response_data.get('sizebytes', 0),
                'link': response_data.get('link', 'N/A'),
                'fastlink': response_data.get('fastlink', 'N/A'),
                'thumb': response_data.get('thumb', 'N/A'),
                'original_url': url  # Store original Terabox URL
            }
            
            # Format file size
            file_size = self.format_file_size(file_details['sizebytes'])
            
            # Prepare file details message
            details_message = (
                f"📁 File Name: {file_details['file_name']}\n"
                f"📊 File Size: {file_size}"
            )
            
            # Create inline keyboard with download buttons
            keyboard = []
            
            # Direct Download Button
            if file_details['link'] != 'N/A':
                keyboard.append([
                    InlineKeyboardButton(
                        "📥 Direct Download", 
                        callback_data=f"direct_download_{file_details['file_name']}"
                    )
                ])
            
            # Fast Download Button
            if file_details['fastlink'] != 'N/A':
                keyboard.append([
                    InlineKeyboardButton(
                        "🚀 Fast Download", 
                        callback_data=f"fast_download_{file_details['file_name']}"
                    )
                ])
            
            # Store file details
            self.last_file_details = file_details
            
            # Send file details with buttons
            reply_markup = InlineKeyboardMarkup(keyboard) if keyboard else None
            await update.message.reply_text(details_message, reply_markup=reply_markup)
        
        except requests.RequestException as e:
            logger.error(f"API request error: {e}")
            await update.message.reply_text(f"Download error: {str(e)}")
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            await update.message.reply_text(f"Unexpected error: {str(e)}")
    
    async def download_file_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle file download callback"""
        try:
            # Add a small delay to prevent quick successive calls
            await asyncio.sleep(1)
            
            query = update.callback_query
            await query.answer()
            
            # Retrieve stored file details
            file_details = self.last_file_details
            
            # Determine download type
            download_type = query.data.split('_', 2)[0]
            
            # Select appropriate download link
            if download_type == 'direct' and file_details['link'] != 'N/A':
                download_link = file_details['link']
            elif download_type == 'fast' and file_details['fastlink'] != 'N/A':
                download_link = file_details['fastlink']
            else:
                await query.edit_message_text("No download link available.")
                return
            
            # Download the file
            file_path = self.download_file(
                download_link, 
                file_details['file_name'], 
                file_details.get('original_url')
            )
            
            # Send file to user
            try:
                with open(file_path, 'rb') as file:
                    sent_message = await context.bot.send_document(
                        chat_id=query.message.chat_id, 
                        document=file
                    )
                
                # Attempt to send to dump channel
                await self.send_to_dump_channel(file_path, file_details)
                
                # Update message
                download_type_name = "Direct" if download_type == 'direct' else "Fast"
                await query.edit_message_text(
                    f"{download_type_name} Download: {file_details['file_name']} sent successfully!"
                )
            
            except Exception as send_error:
                logger.error(f"File send error: {send_error}")
                await query.edit_message_text(f"Failed to send file: {str(send_error)}")
        
        except Exception as e:
            logger.error(f"File download error: {e}")
            await query.edit_message_text(f"Download failed: {str(e)}")
    
    async def start_bot(self, webhook_mode=False):
        """Start the bot"""
        # Create the Application and pass it your bot's token
        self.application = Application.builder().token(self.bot_token).build()
        
        # Register handlers
        self.application.add_handler(CommandHandler("start", self.send_welcome))
        self.application.add_handler(CommandHandler("help", self.send_welcome))
        self.application.add_handler(CommandHandler("download", self.handle_download))
        self.application.add_handler(CallbackQueryHandler(self.download_file_callback))
        
        if webhook_mode:
            # Webhook mode for Render deployment
            logger.info("Starting bot in webhook mode...")
            await self.application.initialize()
            await self.application.start()
            await self.application.updater.start_webhook(
                listen='0.0.0.0',
                port=PORT,
                url_path=self.bot_token,
                webhook_url=f"{HOST}/{self.bot_token}"
            )
        else:
            # Polling mode
            logger.info("Starting bot in polling mode...")
            await self.application.run_polling(
                drop_pending_updates=True
            )

def main():
    # Retrieve bot token and API key from environment variables
    BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
    RAPID_API_KEY = os.getenv('RAPID_API_KEY')
    DUMP_CHANNEL_ID = os.getenv('DUMP_CHANNEL_ID')
    DEPLOYMENT_MODE = os.getenv('DEPLOYMENT_MODE', 'polling').lower()
    
    # Validate environment variables
    if not BOT_TOKEN:
        logger.error("Telegram Bot Token not found in environment variables")
        print("Error: TELEGRAM_BOT_TOKEN must be set in .env file")
        sys.exit(1)
    
    if not RAPID_API_KEY:
        logger.error("RapidAPI Key not found in environment variables")
        print("Error: RAPID_API_KEY must be set in .env file")
        sys.exit(1)
    
    try:
        import asyncio
        
        async def run_bot():
            downloader = TeraboxDownloader(
                BOT_TOKEN, 
                RAPID_API_KEY, 
                dump_channel_id=DUMP_CHANNEL_ID
            )
            
            if DEPLOYMENT_MODE == 'webhook':
                # Webhook mode (for Render)
                await downloader.start_bot(webhook_mode=True)
            else:
                # Polling mode
                await downloader.start_bot()
        
        asyncio.run(run_bot())
    
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        print("Bot initialization failed. Check the log file for details.")

if __name__ == "__main__":
    main()

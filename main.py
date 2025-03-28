import os
import time
import telebot
import requests
import logging
import sys
import json
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
from dotenv import load_dotenv
import urllib3

# Use environment variables for configuration
PORT = int(os.getenv('PORT', 5000))
HOST = os.getenv('HOST', '0.0.0.0')

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
            # Initialize bot with a try-except to handle request_timeout compatibility
            try:
                # First, try initializing with request_timeout
                self.bot = telebot.TeleBot(
                    bot_token, 
                    parse_mode=None,
                    request_timeout=60  # Increased timeout
                )
            except TypeError:
                # If request_timeout is not supported, initialize without it
                self.bot = telebot.TeleBot(
                    bot_token, 
                    parse_mode=None
                )
            
            # Verify bot connection
            bot_info = self.bot.get_me()
            logger.info(f"Bot connected successfully: @{bot_info.username}")
            
            self.rapid_api_key = rapid_api_key
            self.download_directory = "downloads"
            self.dump_channel_id = dump_channel_id
            
            # Create download directory
            os.makedirs(self.download_directory, exist_ok=True)
            
            # Register handlers
            self.register_handlers()
        
        except Exception as e:
            logger.error(f"Initialization Error: {e}")
            raise
    
    def register_handlers(self):
        @self.bot.message_handler(commands=['start', 'help'])
        def send_welcome(message):
            welcome_text = (
                "Welcome to Terabox Downloader Bot! 📦\n"
                "Send /download followed by a Terabox URL to download a file.\n"
                "Example: /download https://terabox.com/your_file_link\n\n"
                "Files will be sent to you and optionally to the dump channel."
            )
            self.bot.reply_to(message, welcome_text)
        
        @self.bot.message_handler(commands=['download'])
        def handle_download(message):
            try:
                if len(message.text.split()) < 2:
                    self.bot.reply_to(message, "Please provide a Terabox URL")
                    return
                
                url = message.text.split(' ', 1)[1]
                self.download_terabox_file(message, url)
            except Exception as e:
                logger.error(f"Download handler error: {e}")
                self.bot.reply_to(message, f"Error: {str(e)}")
    
    def format_file_size(self, size_bytes):
        """Convert file size to human-readable format"""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size_bytes < 1024.0:
                return f"{size_bytes:.2f} {unit}"
            size_bytes /= 1024.0
    
    def send_to_dump_channel(self, file_path, file_details):
        """
        Send file to dump channel with additional metadata
        
        Args:
            file_path (str): Path to the file to be sent
            file_details (dict): Details about the file
        
        Returns:
            bool: True if successful, False otherwise
        """
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
                self.bot.send_document(
                    self.dump_channel_id, 
                    file, 
                    caption=caption,
                    timeout=120  # Increased timeout
                )
            
            logger.info(f"File {file_details['file_name']} sent to dump channel")
            return True
        
        except Exception as e:
            logger.error(f"Error sending file to dump channel: {e}")
            return False
    
    def download_file(self, url, filename, original_url=None):
        """
        Download file from given URL and save to downloads directory
        
        Args:
            url (str): Download URL
            filename (str): Name to save the file as
            original_url (str, optional): Original source URL
        
        Returns:
            str: Full path to downloaded file
        """
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
            file_size = int(response.headers.get('content-length', 0))
            current_size = 0
            
            with open(file_path, 'wb') as file:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        file.write(chunk)
                        current_size += len(chunk)
            
            return file_path
        
        except (requests.RequestException, IOError) as e:
            logger.error(f"File download error: {e}")
            raise
    
    def download_terabox_file(self, message, url):
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
            keyboard = InlineKeyboardMarkup()
            
            # Direct Download Button
            if file_details['link'] != 'N/A':
                download_button = InlineKeyboardButton(
                    "📥 Direct Download", 
                    callback_data=f"direct_download_{file_details['file_name']}"
                )
                keyboard.add(download_button)
            
            # Fast Download Button
            if file_details['fastlink'] != 'N/A':
                fast_download_button = InlineKeyboardButton(
                    "🚀 Fast Download", 
                    callback_data=f"fast_download_{file_details['file_name']}"
                )
                keyboard.add(fast_download_button)
            
            # Send file details with buttons
            self.bot.reply_to(message, details_message, reply_markup=keyboard)
            
            # Store full file details for later use
            self.bot.last_file_details = file_details
        
        except requests.RequestException as e:
            logger.error(f"API request error: {e}")
            self.bot.reply_to(message, f"Download error: {str(e)}")
        except Exception as e:
            logger.error(f"Unexpected error: {e}")
            self.bot.reply_to(message, f"Unexpected error: {str(e)}")
    
    def start_bot(self, webhook_mode=False):
        @self.bot.callback_query_handler(func=lambda call: call.data.startswith(('direct_download_', 'fast_download_')))
        def download_file_callback(call):
            try:
                # Add a small delay to prevent quick successive calls
                time.sleep(1)
                
                # Retrieve stored file details
                file_details = self.bot.last_file_details
                
                # Determine download type
                download_type = call.data.split('_', 2)[0]
                
                # Select appropriate download link
                if download_type == 'direct' and file_details['link'] != 'N/A':
                    download_link = file_details['link']
                elif download_type == 'fast' and file_details['fastlink'] != 'N/A':
                    download_link = file_details['fastlink']
                else:
                    # Safely answer callback query
                    try:
                        self.bot.answer_callback_query(
                            call.id, 
                            "No download link available.", 
                            show_alert=True
                        )
                    except Exception as alert_e:
                        logger.error(f"Callback query answer error: {alert_e}")
                    return
                
                # Download the file
                file_path = self.download_file(
                    download_link, 
                    file_details['file_name'], 
                    file_details.get('original_url')
                )
                
                # Send file to user with additional error handling
                try:
                    with open(file_path, 'rb') as file:
                        # Use send_document with additional parameters
                        sent_message = self.bot.send_document(
                            call.message.chat.id, 
                            file, 
                            timeout=120  # Increased timeout
                        )
                    
                    # Attempt to send to dump channel
                    self.send_to_dump_channel(file_path, file_details)
                    
                    # Answer callback query
                    download_type_name = "Direct" if download_type == 'direct' else "Fast"
                    self.bot.answer_callback_query(
                        call.id, 
                        f"{download_type_name} Download: {file_details['file_name']} sent successfully!"
                    )
                
                except Exception as send_error:
                    logger.error(f"File send error: {send_error}")
                    # Attempt to answer callback query about send error
                    try:
                        self.bot.answer_callback_query(
                            call.id, 
                            f"Failed to send file: {str(send_error)}", 
                            show_alert=True
                        )
                    except Exception as alert_e:
                        logger.error(f"Callback query answer error: {alert_e}")
            
            except Exception as e:
                logger.error(f"File download error: {e}")
                # Last resort error handling
                try:
                    self.bot.answer_callback_query(
                        call.id, 
                        f"Download failed: {str(e)}", 
                        show_alert=True
                    )
                except Exception as alert_e:
                    logger.error(f"Callback query answer error: {alert_e}")
        
        if webhook_mode:
            # Webhook mode for Render deployment
            logger.info("Starting bot in webhook mode...")
            self.bot.remove_webhook()
            import flask
            
            app = flask.Flask(__name__)
            
            @app.route('/' + os.getenv('TELEGRAM_BOT_TOKEN'), methods=['POST'])
            def webhook():
                json_string = flask.request.get_data().decode('utf-8')
                update = telebot.types.Update.de_json(json_string)
                self.bot.process_new_updates([update])
                return "OK"
            
            @app.route('/')
            def home():
                return "Bot is running!"
            
            # Set webhook
            self.bot.set_webhook(url=f"{os.getenv('WEBHOOK_URL')}/{os.getenv('TELEGRAM_BOT_TOKEN')}")
            
            return app
        else:
            # Polling mode
            try:
                logger.info("Starting bot polling...")
                self.bot.polling(
                    none_stop=True, 
                    interval=0, 
                    timeout=30,
                    long_polling_timeout=30
                )
            except Exception as e:
                logger.error(f"Bot polling error: {e}")
                raise

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
        downloader = TeraboxDownloader(
            BOT_TOKEN, 
            RAPID_API_KEY, 
            dump_channel_id=DUMP_CHANNEL_ID
        )
        
        if DEPLOYMENT_MODE == 'webhook':
            # Webhook mode (for Render)
            app = downloader.start_bot(webhook_mode=True)
            import waitress
            waitress.serve(app, host=HOST, port=PORT)
        else:
            # Polling mode
            downloader.start_bot()
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        print("Bot initialization failed. Check the log file for details.")

if __name__ == "__main__":
    main()

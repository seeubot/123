#!/usr/bin/env python3
import sys
import os
import subprocess

# Function to install missing dependencies
def install_dependencies():
    """
    Install required Python packages using pip
    """
    dependencies = [
        'requests', 
        'pyTelegramBotAPI', 
        'python-dotenv'
    ]
    
    for package in dependencies:
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', package])
            print(f"Successfully installed {package}")
        except subprocess.CalledProcessError:
            print(f"Failed to install {package}")
            sys.exit(1)

# Install dependencies before importing
install_dependencies()

import logging
import urllib.parse
import tempfile
import requests
import telebot
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Load environment variables
try:
    load_dotenv()
except Exception as e:
    logger.error(f"Error loading environment variables: {e}")
    sys.exit(1)

# Get credentials from environment with additional error checking
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
RAPIDAPI_KEY = os.getenv('RAPIDAPI_KEY')

# Validate bot token
if not TELEGRAM_BOT_TOKEN:
    logger.error("TELEGRAM_BOT_TOKEN not found in environment variables")
    sys.exit(1)

# Initialize Telegram Bot with comprehensive error handling
try:
    bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)
except Exception as e:
    logger.error(f"Failed to initialize Telegram Bot: {e}")
    sys.exit(1)

# RapidAPI Configuration
RAPIDAPI_HOST = "terabox-downloader-hyper.p.rapidapi.com"
RAPIDAPI_URL = "https://terabox-downloader-hyper.p.rapidapi.com/api"

# Supported Terabox domains
SUPPORTED_DOMAINS = [
    'https://1024terabox.com',
    'https://terabox.com',
    'https://www.terabox.com',
    'https://nd.terabox.com',
    'https://teraboxapp.com',
    'https://www.teraboxapp.com'
]

def is_valid_terabox_url(url):
    """
    Check if the URL is from a supported Terabox domain
    """
    return any(url.startswith(domain) for domain in SUPPORTED_DOMAINS)

def download_and_upload_terabox_file(message):
    """
    Download Terabox file and upload to Telegram with comprehensive error handling
    """
    terabox_url = message.text.strip()
    
    try:
        # Send initial processing message
        processing_msg = bot.reply_to(message, "⏳ Processing your link...")
        logger.info(f"Processing Terabox URL: {terabox_url}")
        
        # URL encode the Terabox URL
        encoded_url = urllib.parse.quote(terabox_url)
        
        # Validate RapidAPI key
        if not RAPIDAPI_KEY:
            error_msg = "❌ RapidAPI Key is missing"
            logger.error(error_msg)
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=error_msg
            )
            return
        
        # RapidAPI request headers
        headers = {
            'x-rapidapi-key': RAPIDAPI_KEY,
            'x-rapidapi-host': RAPIDAPI_HOST
        }
        
        # Make the API request to get download link with timeout
        try:
            response = requests.get(
                f"{RAPIDAPI_URL}?key=RapidAPI-1903-fast&url={encoded_url}", 
                headers=headers,
                timeout=30
            )
        except requests.exceptions.RequestException as req_error:
            error_msg = f"❌ Network Error: {req_error}"
            logger.error(error_msg)
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=error_msg
            )
            return
        
        # Check if request was successful
        if response.status_code != 200:
            error_msg = f"❌ API Error: {response.status_code} - {response.text}"
            logger.error(error_msg)
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=error_msg
            )
            return
        
        # Parse JSON response with error handling
        try:
            data = response.json()
        except ValueError:
            error_msg = "❌ Invalid JSON response from API"
            logger.error(error_msg)
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=error_msg
            )
            return
        
        # Check if download link exists
        if 'downloadLink' not in data:
            error_msg = "❌ No download link found. The file might be private or unavailable."
            logger.warning(error_msg)
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=error_msg
            )
            return
        
        # Get the direct download link
        download_link = data['downloadLink']
        
        # Get filename from API response or generate a temporary one
        filename = data.get('fileName', 'terabox_download')
        
        # Update processing message
        bot.edit_message_text(
            chat_id=message.chat.id, 
            message_id=processing_msg.message_id,
            text="📥 Downloading file..."
        )
        
        # Download the file with error handling and streaming
        try:
            file_response = requests.get(download_link, stream=True, timeout=60)
        except requests.exceptions.RequestException as req_error:
            error_msg = f"❌ File Download Error: {req_error}"
            logger.error(error_msg)
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=error_msg
            )
            return
        
        # Check if file download was successful
        if file_response.status_code != 200:
            error_msg = f"❌ File Download Error: {file_response.status_code}"
            logger.error(error_msg)
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=error_msg
            )
            return
        
        # Create a temporary file to save the download
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1]) as temp_file:
                for chunk in file_response.iter_content(chunk_size=8192):
                    temp_file.write(chunk)
                temp_file_path = temp_file.name
        except Exception as file_error:
            error_msg = f"❌ File Save Error: {file_error}"
            logger.error(error_msg)
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=error_msg
            )
            return
        
        # Update processing message
        bot.edit_message_text(
            chat_id=message.chat.id, 
            message_id=processing_msg.message_id,
            text="📤 Uploading file..."
        )
        
        # Open the file and send it with error handling
        try:
            with open(temp_file_path, 'rb') as file:
                bot.send_document(
                    message.chat.id, 
                    file, 
                    caption=f"📂 {filename}"
                )
        except Exception as upload_error:
            error_msg = f"❌ File Upload Error: {upload_error}"
            logger.error(error_msg)
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=error_msg
            )
            return
        
        # Clean up temporary file
        try:
            os.unlink(temp_file_path)
        except Exception as cleanup_error:
            logger.warning(f"Could not delete temporary file: {cleanup_error}")
        
        # Delete processing message
        bot.delete_message(
            chat_id=message.chat.id, 
            message_id=processing_msg.message_id
        )
        
        logger.info(f"Successfully uploaded file: {filename}")
    
    except Exception as e:
        # Handle any unexpected errors
        error_msg = f"❌ Unexpected Error: {str(e)}"
        logger.error(error_msg, exc_info=True)
        bot.edit_message_text(
            chat_id=message.chat.id, 
            message_id=processing_msg.message_id,
            text=error_msg
        )

@bot.message_handler(commands=['start', 'help'])
def send_welcome(message):
    """
    Handle bot start and help commands
    """
    welcome_text = (
        "🤖 Terabox Downloader Bot 🤖\n\n"
        "Send me a Terabox file link, and I'll download and upload it for you!\n\n"
        "Usage:\n"
        "1. Simply send a Terabox sharing link\n"
        "2. I'll download the file and send it to you\n\n"
        "Supported domains:\n"
        "• 1024terabox.com\n"
        "• terabox.com\n"
        "• teraboxapp.com\n"
        "And their variations with 'www' or subdomains"
    )
    bot.reply_to(message, welcome_text)

@bot.message_handler(func=lambda message: message.text and any(message.text.strip().startswith(domain) for domain in SUPPORTED_DOMAINS))
def handle_terabox_link(message):
    """
    Handle Terabox link messages
    """
    download_and_upload_terabox_file(message)

def main():
    """
    Main bot polling function with comprehensive error handling
    """
    logger.info("Bot is starting...")
    try:
        bot.polling(none_stop=True)
    except Exception as e:
        logger.error(f"Bot polling failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

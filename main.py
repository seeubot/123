import os
import telebot
import requests
import urllib.parse
from dotenv import load_dotenv
import tempfile

# Load environment variables
load_dotenv()

# Get credentials from environment
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
RAPIDAPI_KEY = os.getenv('RAPIDAPI_KEY')

# Validate bot token
if not TELEGRAM_BOT_TOKEN:
    print("Error: TELEGRAM_BOT_TOKEN not found in environment variables")
    exit(1)

# Initialize Telegram Bot
bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

# RapidAPI Configuration
RAPIDAPI_HOST = "terabox-downloader-hyper.p.rapidapi.com"
RAPIDAPI_URL = "https://terabox-downloader-hyper.p.rapidapi.com/api"

def download_and_upload_terabox_file(message, terabox_url):
    """
    Download Terabox file and upload to Telegram
    """
    # URL encode the Terabox URL
    encoded_url = urllib.parse.quote(terabox_url)
    
    # RapidAPI request headers
    headers = {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
    }
    
    try:
        # Send initial processing message
        processing_msg = bot.reply_to(message, "⏳ Processing your link...")
        
        # Make the API request to get download link
        response = requests.get(
            f"{RAPIDAPI_URL}?key=RapidAPI-1903-fast&url={encoded_url}", 
            headers=headers
        )
        
        # Check if request was successful
        if response.status_code != 200:
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=f"❌ API Error: {response.status_code} - {response.text}"
            )
            return
        
        # Parse JSON response
        data = response.json()
        
        # Check if download link exists
        if 'downloadLink' not in data:
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text="❌ No download link found. The file might be private or unavailable."
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
        
        # Download the file
        file_response = requests.get(download_link, stream=True)
        
        # Check if file download was successful
        if file_response.status_code != 200:
            bot.edit_message_text(
                chat_id=message.chat.id, 
                message_id=processing_msg.message_id,
                text=f"❌ File Download Error: {file_response.status_code}"
            )
            return
        
        # Create a temporary file to save the download
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(filename)[1]) as temp_file:
            for chunk in file_response.iter_content(chunk_size=8192):
                temp_file.write(chunk)
            temp_file_path = temp_file.name
        
        # Update processing message
        bot.edit_message_text(
            chat_id=message.chat.id, 
            message_id=processing_msg.message_id,
            text="📤 Uploading file..."
        )
        
        # Open the file and send it
        with open(temp_file_path, 'rb') as file:
            bot.send_document(message.chat.id, file, caption=f"📂 {filename}")
        
        # Clean up temporary file
        os.unlink(temp_file_path)
        
        # Delete processing message
        bot.delete_message(
            chat_id=message.chat.id, 
            message_id=processing_msg.message_id
        )
    
    except Exception as e:
        # Handle any unexpected errors
        bot.edit_message_text(
            chat_id=message.chat.id, 
            message_id=processing_msg.message_id,
            text=f"❌ Error: {str(e)}"
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
        "Supported domains: 1024terabox.com"
    )
    bot.reply_to(message, welcome_text)

@bot.message_handler(func=lambda message: message.text.startswith('https://1024terabox.com'))
def handle_terabox_link(message):
    """
    Handle Terabox link messages
    """
    terabox_url = message.text.strip()
    download_and_upload_terabox_file(message, terabox_url)

def main():
    """
    Main bot polling function
    """
    print("Bot is running...")
    bot.polling(none_stop=True)

if __name__ == "__main__":
    main()

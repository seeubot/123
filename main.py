import os
import telebot
import requests
import urllib.parse

# Replace these with your actual credentials
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'YOUR_TELEGRAM_BOT_TOKEN')
RAPIDAPI_KEY = os.environ.get('RAPIDAPI_KEY', 'YOUR_RAPIDAPI_KEY')

# Initialize Telegram Bot
bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

# RapidAPI Configuration
RAPIDAPI_HOST = "terabox-downloader-hyper.p.rapidapi.com"
RAPIDAPI_URL = "https://terabox-downloader-hyper.p.rapidapi.com/api"

def download_terabox_file(terabox_url):
    """
    Download Terabox file using RapidAPI
    """
    # URL encode the Terabox URL
    encoded_url = urllib.parse.quote(terabox_url)
    
    # RapidAPI request headers
    headers = {
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
    }
    
    try:
        # Make the API request
        response = requests.get(
            f"{RAPIDAPI_URL}?key=RapidAPI-1903-fast&url={encoded_url}", 
            headers=headers
        )
        
        # Check if request was successful
        if response.status_code == 200:
            data = response.json()
            
            # Check if download link exists
            if 'downloadLink' in data:
                return data['downloadLink']
            else:
                return "No download link found. The file might be private or unavailable."
        
        else:
            return f"Error: {response.status_code} - {response.text}"
    
    except Exception as e:
        return f"An error occurred: {str(e)}"

@bot.message_handler(commands=['start', 'help'])
def send_welcome(message):
    """
    Handle bot start and help commands
    """
    welcome_text = (
        "🤖 Terabox Downloader Bot 🤖\n\n"
        "Send me a Terabox file link, and I'll help you download it!\n\n"
        "Usage:\n"
        "1. Simply send a Terabox sharing link\n"
        "2. I'll respond with the direct download link\n\n"
        "Supported domains: 1024terabox.com"
    )
    bot.reply_to(message, welcome_text)

@bot.message_handler(func=lambda message: message.text.startswith('https://1024terabox.com'))
def handle_terabox_link(message):
    """
    Handle Terabox link messages
    """
    terabox_url = message.text.strip()
    
    # Send processing message
    processing_msg = bot.reply_to(message, "⏳ Processing your link...")
    
    try:
        # Get download link
        download_link = download_terabox_file(terabox_url)
        
        # Edit processing message with result
        bot.edit_message_text(
            chat_id=message.chat.id, 
            message_id=processing_msg.message_id,
            text=f"📥 Download Link:\n{download_link}"
        )
    
    except Exception as e:
        bot.edit_message_text(
            chat_id=message.chat.id, 
            message_id=processing_msg.message_id,
            text=f"❌ Error: {str(e)}"
        )

def main():
    """
    Main bot polling function
    """
    print("Bot is running...")
    bot.polling(none_stop=True)

if __name__ == "__main__":
    main()

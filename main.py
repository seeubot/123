#!/usr/bin/env python3
import os
import sys
import venv
import subprocess
import platform

def create_venv_and_install_dependencies():
    """
    Create a virtual environment and install required dependencies
    """
    # Determine the Python executable
    python_executable = sys.executable
    
    # Create virtual environment path
    venv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'venv')
    
    # Create virtual environment if it doesn't exist
    if not os.path.exists(venv_path):
        print("Creating virtual environment...")
        venv.create(venv_path, with_pip=True)
    
    # Determine pip and python paths based on the OS
    if platform.system() == 'Windows':
        pip_path = os.path.join(venv_path, 'Scripts', 'pip')
        python_path = os.path.join(venv_path, 'Scripts', 'python')
    else:
        pip_path = os.path.join(venv_path, 'bin', 'pip')
        python_path = os.path.join(venv_path, 'bin', 'python')
    
    # List of dependencies to install
    dependencies = [
        'requests', 
        'pyTelegramBotAPI', 
        'python-dotenv'
    ]
    
    # Install dependencies in the virtual environment
    for package in dependencies:
        try:
            subprocess.check_call([pip_path, 'install', package])
            print(f"Successfully installed {package}")
        except subprocess.CalledProcessError:
            print(f"Failed to install {package}")
            sys.exit(1)
    
    return python_path

def main():
    # Create virtual environment and install dependencies
    venv_python = create_venv_and_install_dependencies()
    
    # Restart the script using the virtual environment's Python
    if venv_python != sys.executable:
        os.execl(venv_python, venv_python, *sys.argv)
    
    # Rest of your original main script follows...
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
        # [Rest of the original download_and_upload_terabox_file function remains the same]
        # ... (paste the entire original function here)

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

    def bot_polling():
        """
        Main bot polling function with comprehensive error handling
        """
        logger.info("Bot is starting...")
        try:
            bot.polling(none_stop=True)
        except Exception as e:
            logger.error(f"Bot polling failed: {e}")
            sys.exit(1)

    # Start bot polling
    bot_polling()

if __name__ == "__main__":
    main()

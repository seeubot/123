#!/usr/bin/env python3
import os
import sys
import venv
import subprocess
import platform
import logging
import threading
from flask import Flask, request, Response

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
        'python-dotenv',
        'flask',
        'gunicorn'
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
    
    # Rest of the script
    import telebot
    from dotenv import load_dotenv
    from flask import Flask, request, Response

    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    logger = logging.getLogger(__name__)

    # Load environment variables
    load_dotenv()

    # Get bot token and webhook configurations
    TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
    WEBHOOK_HOST = os.getenv('WEBHOOK_HOST', '0.0.0.0')
    WEBHOOK_PORT = int(os.getenv('WEBHOOK_PORT', 5000))
    WEBHOOK_LISTEN = os.getenv('WEBHOOK_LISTEN', '/webhook')

    if not TELEGRAM_BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not found in environment variables")
        sys.exit(1)

    # Initialize bot
    bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN)

    # Create Flask app for webhook
    app = Flask(__name__)

    # Supported Terabox domains
    SUPPORTED_DOMAINS = [
        'https://1024terabox.com',
        'https://terabox.com',
        'https://www.terabox.com',
        'https://nd.terabox.com',
        'https://teraboxapp.com',
        'https://www.teraboxapp.com'
    ]

    def download_and_upload_terabox_file(message):
        """
        Download Terabox file and upload to Telegram with comprehensive error handling
        """
        # [Your existing download_and_upload_terabox_file function here]
        # Placeholder implementation
        bot.reply_to(message, "Terabox download functionality will be implemented here.")

    @app.route('/health', methods=['GET'])
    def health_check():
        """
        Health check endpoint
        """
        return Response("OK", status=200)

    @app.route(WEBHOOK_LISTEN, methods=['POST'])
    def webhook():
        """
        Webhook endpoint to receive Telegram updates
        """
        if request.headers.get('content-type') == 'application/json':
            json_string = request.get_data().decode('utf-8')
            update = telebot.types.Update.de_json(json_string)
            
            try:
                # Process the update
                bot.process_new_updates([update])
                return '', 200
            except Exception as e:
                logger.error(f"Error processing webhook update: {e}")
                return 'Error', 500
        
        return 'Unsupported Media Type', 415

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

    def set_webhook():
        """
        Set webhook for the Telegram bot
        """
        # Construct the full webhook URL
        webhook_url = f"https://{WEBHOOK_HOST}{WEBHOOK_LISTEN}"
        
        try:
            # Remove existing webhook first
            bot.delete_webhook(drop_pending_updates=True)
            
            # Set new webhook
            bot.set_webhook(url=webhook_url)
            logger.info(f"Webhook set successfully to {webhook_url}")
        except Exception as e:
            logger.error(f"Failed to set webhook: {e}")
            sys.exit(1)

    def run_flask_server():
        """
        Run Flask server for webhook
        """
        logger.info(f"Starting webhook server on {WEBHOOK_HOST}:{WEBHOOK_PORT}")
        app.run(
            host=WEBHOOK_HOST, 
            port=WEBHOOK_PORT, 
            debug=False
        )

    # Set webhook before starting server
    set_webhook()

    # Run Flask server
    run_flask_server()

if __name__ == "__main__":
    main()

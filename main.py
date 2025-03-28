#!/usr/bin/env python3
import os
import sys
import subprocess
import platform

def install_dependencies():
    """
    Install required Python packages with comprehensive error handling
    """
    # Ensure pip is up to date
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--upgrade', 'pip'])

    # List of dependencies to install
    dependencies = [
        'requests', 
        'pyTelegramBotAPI', 
        'python-dotenv',
        'flask',
        'gunicorn'
    ]
    
    # Install dependencies
    for package in dependencies:
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install', package])
            print(f"Successfully installed {package}")
        except subprocess.CalledProcessError:
            print(f"Failed to install {package}")
            # Attempt alternative installation method
            try:
                subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--user', package])
                print(f"Successfully installed {package} with --user flag")
            except subprocess.CalledProcessError:
                print(f"Critical: Could not install {package}")
                sys.exit(1)

def main():
    # Install dependencies before importing
    install_dependencies()

    # Now import required modules
    import os
    import logging
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
        Placeholder for Terabox download functionality
        """
        bot.reply_to(message, "Terabox download functionality will be implemented soon.")

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

    # Set webhook before starting server
    set_webhook()

    # Run Flask server
    logger.info(f"Starting webhook server on {WEBHOOK_HOST}:{WEBHOOK_PORT}")
    app.run(
        host=WEBHOOK_HOST, 
        port=WEBHOOK_PORT, 
        debug=False
    )

if __name__ == "__main__":
    main()

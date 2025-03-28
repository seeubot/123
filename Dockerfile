# Use official Python runtime as base image
FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy bot script
COPY bot.py .

# Set environment variables (to be replaced with actual values during deployment)
ENV TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ENV RAPIDAPI_KEY=your_rapidapi_key

# Run the bot
CMD ["python", "bot.py"]

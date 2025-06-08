FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Create a non-root user
RUN useradd -m -s /bin/bash appuser

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create logs directory and set permissions
RUN mkdir -p /app/logs
RUN chown -R appuser:appuser /app/logs  # Ensure appuser owns the logs directory

# Switch to non-root user
USER appuser

# Expose the port
EXPOSE 6010

# Command to run the application using Gunicorn with Eventlet for SocketIO
CMD ["gunicorn", "-k", "eventlet", "-w", "1", "--bind", "0.0.0.0:6010", "app:app"]

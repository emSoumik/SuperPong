FROM python:3.12-slim

# Install system dependencies (ffmpeg, OpenCV, build tools)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libavformat-dev libavcodec-dev libavdevice-dev \
    libavutil-dev libavfilter-dev libswscale-dev libswresample-dev \
    libgl1-mesa-glx libglib2.0-0 \
    build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only dependency files first (for layer caching)
# Note: build context is repo root, Dockerfile is at backend/Dockerfile
COPY backend/pyproject.toml .

# Install Python dependencies into system Python
RUN pip install --no-cache-dir \
    fastapi \
    "uvicorn[standard]" \
    python-dotenv \
    httpx \
    opencv-python-headless \
    numpy

# Copy backend source code
COPY backend/ .

# Expose port (documentation only)
EXPOSE 8080

# Start the server using Render's dynamic $PORT
CMD uvicorn agent:create_app --factory --host 0.0.0.0 --port ${PORT:-8080}

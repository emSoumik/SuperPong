FROM python:3.12-slim

# Install system dependencies (ffmpeg, build tools, etc.)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libavformat-dev libavcodec-dev libavdevice-dev \
    libavutil-dev libavfilter-dev libswscale-dev libswresample-dev \
    libgl1-mesa-glx libglib2.0-0 \
    build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install uv for fast dependency management
RUN pip install --no-cache-dir uv

# Copy only dependency files first for caching
COPY pyproject.toml .
# Install dependencies into system python (cleaner for Docker)
RUN uv pip install --system --index-url https://download.pytorch.org/whl/cpu torch torchvision torchaudio
RUN uv pip install --system --no-cache-dir .

# Copy the rest of the app
COPY . .

# Run the app
CMD ["uvicorn", "agent:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]

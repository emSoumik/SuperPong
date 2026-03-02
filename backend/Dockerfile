FROM python:3.12-slim

# Avoid interactive prompts during APT install
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_LINK_MODE=copy

# Install system dependencies (ffmpeg, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgthread-2.0-0 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install uv for fast dependency management
RUN pip install --no-cache-dir uv

# Copy lock + project metadata first for better Docker layer caching
COPY pyproject.toml uv.lock ./

# Install the exact locked runtime set (including Vision Agents extras)
RUN uv sync --frozen --no-dev --extra full

# Copy backend source
COPY . .

# Use the uv-managed virtual environment at runtime
ENV PATH="/app/.venv/bin:$PATH"

# Expose the internal port (purely for documentation)
EXPOSE 8080

# Use shell form to allow environment variable expansion (for Render's dynamic $PORT)
CMD ["sh", "-c", "uvicorn agent:create_app --factory --host 0.0.0.0 --port ${PORT:-8080}"]

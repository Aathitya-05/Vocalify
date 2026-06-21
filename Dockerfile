FROM python:3.10-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=7860

WORKDIR /code

# Install system dependencies if any are needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install python packages
COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# Copy all application files
COPY . .

# Expose port 7860 (Hugging Face standard)
EXPOSE 7860

# Run decryption and start uvicorn server
CMD ["sh", "-c", "python decrypt_secrets.py && uvicorn main:app --host 0.0.0.0 --port 7860"]

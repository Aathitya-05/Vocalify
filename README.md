---
title: Vocalify
emoji: 🗣️
colorFrom: indigo
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Vocalify AI

Neural Text-to-Speech & Multi-Language Translation Web App.

## Local Development

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Decrypt Firebase credentials:
   ```bash
   python decrypt_secrets.py -p VocalifySecureAccess2026!
   ```
3. Run the FastAPI server:
   ```bash
   python main.py
   ```

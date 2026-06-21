import os
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from deep_translator import GoogleTranslator, MyMemoryTranslator
import time
import random
import edge_tts
import base64
import json
import re
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.backends import default_backend

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("translate-tts-backend")

app = FastAPI(title="Text to Tamil & Multi-language Neural Speech Web App")

# Enable CORS for development flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supported target languages for both translation and voice locale matching
SUPPORTED_LANGUAGES = {
    "ta": {"name": "Tamil (தமிழ்)", "locale": "ta-IN"},
    "en": {"name": "English", "locale": "en-US"},
    "hi": {"name": "Hindi (हिन्दी)", "locale": "hi-IN"},
    "te": {"name": "Telugu (తెలుగు)", "locale": "te-IN"},
    "ml": {"name": "Malayalam (മലയാളം)", "locale": "ml-IN"},
    "kn": {"name": "Kannada (ಕನ್ನಡ)", "locale": "kn-IN"},
    "es": {"name": "Spanish (Español)", "locale": "es-ES"},
    "fr": {"name": "French (Français)", "locale": "fr-FR"},
    "de": {"name": "German (Deutsch)", "locale": "de-DE"},
    "ar": {"name": "Arabic (العربية)", "locale": "ar-SA"},
    "ja": {"name": "Japanese (日本語)", "locale": "ja-JP"},
    "zh": {"name": "Chinese Simplified (简体中文)", "locale": "zh-CN"}
}

def map_to_google_locale(lang_code: str) -> str:
    """Map 2-letter language codes to codes supported by GoogleTranslator."""
    if lang_code == "zh":
        return "zh-CN"
    return lang_code

def map_to_mymemory_locale(lang_code: str) -> str:
    """Map 2-letter language codes to locales supported by MyMemoryTranslator."""
    if lang_code == "auto":
        return "en-US"
    if lang_code in SUPPORTED_LANGUAGES:
        return SUPPORTED_LANGUAGES[lang_code]["locale"]
    return lang_code

# Cryptography config
SECRET_KEY = b"VocalifySharedSecretKey32Bytes!!"

def decrypt_payload(ciphertext_b64: str, iv_hex: str) -> str:
    ciphertext = base64.b64decode(ciphertext_b64)
    iv = bytes.fromhex(iv_hex)
    cipher = Cipher(algorithms.AES(SECRET_KEY), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded_plaintext = decryptor.update(ciphertext) + decryptor.finalize()
    
    unpadder = padding.PKCS7(128).unpadder()
    plaintext = unpadder.update(padded_plaintext) + unpadder.finalize()
    return plaintext.decode('utf-8')

class EncryptedRequest(BaseModel):
    ciphertext: str
    iv: str

def decrypt_request(req: EncryptedRequest) -> dict:
    try:
        decrypted = decrypt_payload(req.ciphertext, req.iv)
        return json.loads(decrypted)
    except Exception as e:
        logger.error(f"Decryption failed: {e}")
        raise HTTPException(status_code=400, detail="Invalid encrypted payload")

def chunk_text(text: str, max_chars: int = 4000) -> list[str]:
    """
    Split text into chunks of at most max_chars, trying to break on paragraph
    or sentence boundaries where possible.
    """
    if len(text) <= max_chars:
        return [text]
        
    paragraphs = text.split("\n")
    chunks = []
    current_chunk = []
    current_length = 0
    
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            if current_chunk:
                chunks.append("\n".join(current_chunk))
                current_chunk = []
                current_length = 0
                
            sentences = re.split(r'(?<=[.!?])\s+', paragraph)
            for sentence in sentences:
                if len(sentence) > max_chars:
                    words = sentence.split(" ")
                    word_chunk = []
                    word_len = 0
                    for word in words:
                        if word_len + len(word) + 1 > max_chars:
                            chunks.append(" ".join(word_chunk))
                            word_chunk = [word]
                            word_len = len(word)
                        else:
                            word_chunk.append(word)
                            word_len += len(word) + 1
                    if word_chunk:
                        chunks.append(" ".join(word_chunk))
                else:
                    if current_length + len(sentence) + 1 > max_chars:
                        chunks.append(" ".join(current_chunk))
                        current_chunk = [sentence]
                        current_length = len(sentence)
                    else:
                        current_chunk.append(sentence)
                        current_length += len(sentence) + 1
        else:
            if current_length + len(paragraph) + 1 > max_chars:
                chunks.append("\n".join(current_chunk))
                current_chunk = [paragraph]
                current_length = len(paragraph)
            else:
                current_chunk.append(paragraph)
                current_length += len(paragraph) + 1
                
    if current_chunk:
        chunks.append("\n".join(current_chunk))
        
    return [c for c in chunks if c.strip()]

def decrypt_get_data(encrypted_data_b64: str) -> dict:
    """Decrypt data sent as a single URL-safe base64 string containing both iv and ciphertext in JSON."""
    decoded_bytes = base64.urlsafe_b64decode(encrypted_data_b64 + '=' * (4 - len(encrypted_data_b64) % 4))
    payload = json.loads(decoded_bytes.decode('utf-8'))
    decrypted_str = decrypt_payload(payload["ciphertext"], payload["iv"])
    return json.loads(decrypted_str)

@app.get("/api/languages")
async def get_languages():
    """Return the list of supported target languages."""
    return SUPPORTED_LANGUAGES

@app.get("/api/voices")
async def get_voices(lang: Optional[str] = "ta"):
    """
    List available neural voices from edge-tts.
    If 'lang' parameter is provided (e.g. 'ta', 'en'), filter voices belonging to that language locale.
    """
    try:
        voices_manager = await edge_tts.VoicesManager.create()
        all_voices = voices_manager.voices
        
        # If filtering by target language, find matching locales
        if lang and lang in SUPPORTED_LANGUAGES:
            prefix = lang + "-"
            # Special check to handle cases where language code doesn't match perfectly, e.g. zh -> zh-CN
            filtered = [
                v for v in all_voices 
                if v["Locale"].lower().startswith(prefix) or v["ShortName"].lower().startswith(prefix)
            ]
            
            # If no voices match, fallback to returning all or checking prefix matches
            if not filtered:
                # Try partial locale matching
                target_locale = SUPPORTED_LANGUAGES[lang]["locale"].lower()[:2]
                filtered = [v for v in all_voices if v["Locale"].lower().startswith(target_locale)]
        else:
            filtered = all_voices

        # Map to a cleaner structure for the frontend
        result = []
        for v in filtered:
            result.append({
                "name": v["Name"],
                "short_name": v["ShortName"],
                "gender": v["Gender"],
                "locale": v["Locale"],
                "friendly_name": f"{v['FriendlyName']} ({v['Gender']})"
            })
            
        # Sort voices so female voices are generally listed first, then male
        result.sort(key=lambda x: (x["gender"] != "Female", x["friendly_name"]))
        return result
    except Exception as e:
        logger.error(f"Error fetching voices: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def translate_text_robust(text: str, source_lang: str, target_lang: str) -> str:
    """
    Translates text with retries, backoff, and fallback options to handle rate-limiting.
    """
    if not text or not text.strip():
        return ""
        
    if source_lang == target_lang:
        return text

    # Map language codes to supported values
    google_source = map_to_google_locale(source_lang)
    google_target = map_to_google_locale(target_lang)

    logger.info(f"Starting robust translation of {len(text)} chars from '{source_lang}' (mapped: '{google_source}') to '{target_lang}' (mapped: '{google_target}')")

    # Try GoogleTranslator with retries and exponential backoff
    try:
        chunks = chunk_text(text, max_chars=1000)
        translated_chunks = []
        for chunk in chunks:
            translated_chunk = None
            for attempt in range(3):
                try:
                    if attempt > 0:
                        # Backoff delay: 1.5s, 3.0s
                        time.sleep(1.5 * attempt + random.random())
                    
                    translator = GoogleTranslator(source=google_source, target=google_target)
                    translated_chunk = translator.translate(chunk)
                    if translated_chunk:
                        break
                except Exception as ex:
                    logger.warning(f"GoogleTranslator attempt {attempt+1} failed: {ex}", exc_info=True)
                    if attempt == 2:
                        raise ex
            if translated_chunk:
                translated_chunks.append(translated_chunk)
            else:
                raise Exception("Google translation returned empty result.")
                
        return "\n".join(translated_chunks)
        
    except Exception as google_err:
        logger.error(f"GoogleTranslator failed: {google_err}. Trying MyMemoryTranslator fallback...")
        
        # Fallback to MyMemoryTranslator (uses smaller chunks to fit character limit of MyMemory)
        try:
            fallback_chunks = chunk_text(text, max_chars=400)
            translated_chunks = []
            
            mymem_source = map_to_mymemory_locale(source_lang)
            mymem_target = map_to_mymemory_locale(target_lang)
            
            logger.info(f"Fallback to MyMemoryTranslator: source='{mymem_source}', target='{mymem_target}', chunks={len(fallback_chunks)}")
            
            for chunk in fallback_chunks:
                translated_chunk = None
                try:
                    translator = MyMemoryTranslator(source=mymem_source, target=mymem_target)
                    translated_chunk = translator.translate(chunk)
                except Exception as mymem_err:
                    logger.warning(f"MyMemoryTranslator with source '{mymem_source}' to '{mymem_target}' failed: {mymem_err}", exc_info=True)
                    if source_lang == "auto" and mymem_source != "en-US":
                        # Retry fallback with English as source if we haven't already
                        logger.info("Retrying MyMemoryTranslator with source 'en-US'")
                        translator = MyMemoryTranslator(source="en-US", target=mymem_target)
                        translated_chunk = translator.translate(chunk)
                    else:
                        raise mymem_err
                
                if translated_chunk:
                    translated_chunks.append(translated_chunk)
                else:
                    raise Exception("MyMemory translation returned empty result.")
                    
            return "\n".join(translated_chunks)
        except Exception as fallback_err:
            logger.error(f"MyMemoryTranslator fallback also failed: {fallback_err}")
            # Raise the original Google error to report the primary issue
            raise google_err

def translate_google(text: str, source_lang: str, target_lang: str) -> str:
    """Helper to translate text using GoogleTranslator only with retries."""
    google_source = map_to_google_locale(source_lang)
    google_target = map_to_google_locale(target_lang)
    chunks = chunk_text(text, max_chars=1000)
    translated_chunks = []
    for chunk in chunks:
        translated_chunk = None
        for attempt in range(3):
            try:
                if attempt > 0:
                    time.sleep(1.0 * attempt + random.random())
                translator = GoogleTranslator(source=google_source, target=google_target)
                translated_chunk = translator.translate(chunk)
                if translated_chunk:
                    break
            except Exception as ex:
                logger.warning(f"Google translate attempt {attempt+1} failed: {ex}")
        if translated_chunk:
            translated_chunks.append(translated_chunk)
        else:
            raise Exception("Google translation failed.")
    return "\n".join(translated_chunks)

def translate_mymemory(text: str, source_lang: str, target_lang: str) -> str:
    """Helper to translate text using MyMemoryTranslator only."""
    mymem_source = map_to_mymemory_locale(source_lang)
    mymem_target = map_to_mymemory_locale(target_lang)
    chunks = chunk_text(text, max_chars=400)
    translated_chunks = []
    for chunk in chunks:
        translated_chunk = None
        for attempt in range(2):
            try:
                if attempt > 0:
                    time.sleep(1.0)
                translator = MyMemoryTranslator(source=mymem_source, target=mymem_target)
                translated_chunk = translator.translate(chunk)
                if translated_chunk:
                    break
            except Exception as ex:
                logger.warning(f"MyMemory translate attempt {attempt+1} failed: {ex}")
        if translated_chunk:
            translated_chunks.append(translated_chunk)
        else:
            raise Exception("MyMemory translation failed.")
    return "\n".join(translated_chunks)

@app.post("/api/translate")
async def translate(request: EncryptedRequest):
    """
    Translate text from source_lang to target_lang.
    Returns translations from both Google and MyMemory, plus a back-translation check.
    """
    data = decrypt_request(request)
    text = data.get("text", "")
    source_lang = data.get("source_lang", "auto")
    target_lang = data.get("target_lang", "ta")
    
    if not text or not text.strip():
        return {
            "google_translation": "",
            "mymemory_translation": "",
            "back_translation": "",
            "source_lang": source_lang,
            "target_lang": target_lang
        }
    
    # 1. Google Translation (Primary)
    google_translation = ""
    try:
        google_translation = translate_google(text, source_lang, target_lang)
    except Exception as e:
        logger.error(f"Google translation failed: {e}")
        google_translation = ""
        
    # 2. MyMemory Translation (Alternate)
    mymemory_translation = ""
    try:
        mymemory_translation = translate_mymemory(text, source_lang, target_lang)
    except Exception as e:
        logger.error(f"MyMemory translation failed: {e}")
        mymemory_translation = ""
        
    # Triage failures
    if not google_translation and mymemory_translation:
        google_translation = mymemory_translation
    elif google_translation and not mymemory_translation:
        mymemory_translation = google_translation
    elif not google_translation and not mymemory_translation:
        raise HTTPException(status_code=500, detail="Both Google and MyMemory translation engines failed.")

    # 3. Back-Translation Check
    back_source = target_lang
    back_target = source_lang if source_lang != "auto" else "en"
    
    back_translation = ""
    try:
        back_translation = translate_google(google_translation, back_source, back_target)
    except Exception as e:
        logger.warning(f"Back-translation failed: {e}")
        try:
            back_translation = translate_mymemory(google_translation, back_source, back_target)
        except Exception as ex:
            logger.warning(f"Back-translation fallback failed: {ex}")
            back_translation = "Verification translation unavailable."
            
    return {
        "translated_text": google_translation,
        "google_translation": google_translation,
        "mymemory_translation": mymemory_translation,
        "back_translation": back_translation,
        "source_lang": source_lang,
        "target_lang": target_lang
    }

@app.post("/api/tts")
async def text_to_speech(request: EncryptedRequest):
    """
    Generate neural speech from text using edge-tts after decrypting payload.
    Streams the resulting MP3 audio back to the client, handling chunked text.
    """
    data = decrypt_request(request)
    text = data.get("text", "")
    voice = data.get("voice", "")
    rate = data.get("rate", "+0%")
    pitch = data.get("pitch", "+0%")
    volume = data.get("volume", "+0%")
    if pitch.endswith("%"):
        pitch = pitch.replace("%", "Hz")
    
    logger.info(f"TTS request parameters: voice='{voice}', rate='{rate}', pitch='{pitch}', volume='{volume}', text_len={len(text)}, text_preview='{text[:60]}'")
    
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Text parameter cannot be empty")
    if not voice:
        raise HTTPException(status_code=400, detail="Voice parameter cannot be empty")
        
    try:
        # Create audio stream generator with chunking for large text
        async def audio_stream_generator():
            chunks = chunk_text(text, max_chars=1500)
            for c_text in chunks:
                communicate = edge_tts.Communicate(
                    text=c_text,
                    voice=voice,
                    rate=rate,
                    pitch=pitch,
                    volume=volume
                )
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        yield chunk["data"]

        return StreamingResponse(audio_stream_generator(), media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"TTS generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"TTS generation failed: {str(e)}")

@app.get("/api/download")
async def download_speech(data: str):
    """
    Decrypts search query params and streams output directly as a file.
    Supports download of extremely large text as a single MP3 file.
    """
    try:
        req_data = decrypt_get_data(data)
        text = req_data.get("text", "")
        voice = req_data.get("voice", "")
        rate = req_data.get("rate", "+0%")
        pitch = req_data.get("pitch", "+0%")
        volume = req_data.get("volume", "+0%")
        if pitch.endswith("%"):
            pitch = pitch.replace("%", "Hz")
        
        logger.info(f"Download request parameters: voice='{voice}', rate='{rate}', pitch='{pitch}', volume='{volume}', text_len={len(text)}, text_preview='{text[:60]}'")
        
        if not text or not text.strip():
            raise HTTPException(status_code=400, detail="Text cannot be empty")
        if not voice:
            raise HTTPException(status_code=400, detail="Voice must be selected")
            
        async def audio_stream_generator():
            chunks = chunk_text(text, max_chars=1500)
            for c_text in chunks:
                communicate = edge_tts.Communicate(
                    text=c_text,
                    voice=voice,
                    rate=rate,
                    pitch=pitch,
                    volume=volume
                )
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        yield chunk["data"]

        import time
        timestamp = int(time.time())
        headers = {
            "Content-Disposition": f'attachment; filename="Vocalify_Speech_{timestamp}.mp3"',
            "Content-Type": "audio/mpeg"
        }
        return StreamingResponse(audio_stream_generator(), media_type="audio/mpeg", headers=headers)
    except Exception as e:
        logger.error(f"Download failed: {e}")
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")

# Mount the static directory for the web app UI at root /
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Start server on port 8000
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)

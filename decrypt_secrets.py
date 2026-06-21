import os
import sys
import getpass
import json
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

def get_passphrase():
    # Try env var
    passphrase = os.environ.get("VOCALIFY_PASSPHRASE")
    if passphrase:
        return passphrase
    
    # Try CLI args
    if len(sys.argv) > 1:
        for i in range(1, len(sys.argv)):
            if sys.argv[i] in ("-p", "--password") and i + 1 < len(sys.argv):
                return sys.argv[i+1]
                
    # If not interactive (e.g. Docker/Render/CI), fail with a clean error message
    if not sys.stdin.isatty():
        print("Error: VOCALIFY_PASSPHRASE environment variable is not set and the terminal is non-interactive.")
        print("Please configure the VOCALIFY_PASSPHRASE environment variable in your Render settings.")
        sys.exit(1)
        
    # Otherwise prompt interactively
    try:
        return getpass.getpass("Enter passphrase to decrypt secrets: ")
    except Exception as e:
        print(f"Error prompting for password: {e}")
        sys.exit(1)

def main():
    input_file = "static/firebase-config.js.enc"
    output_file = "static/firebase-config.js"
    
    if not os.path.exists(input_file):
        print(f"Error: Encrypted file {input_file} not found. Cannot decrypt.")
        sys.exit(1)
        
    passphrase_str = get_passphrase()
    if not passphrase_str:
        print("Error: Passphrase cannot be empty.")
        sys.exit(1)
        
    passphrase = passphrase_str.encode('utf-8')
    
    # Load encrypted payload
    try:
        with open(input_file, 'r') as f:
            payload = json.load(f)
    except Exception as e:
        print(f"Error reading encrypted file: {e}")
        sys.exit(1)
        
    try:
        salt = base64.b64decode(payload["salt"])
        nonce = base64.b64decode(payload["nonce"])
        ciphertext = base64.b64decode(payload["ciphertext"])
    except KeyError as e:
        print(f"Error: Invalid encrypted file format. Missing key: {e}")
        sys.exit(1)
        
    # Derive key using same salt and iterations
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = kdf.derive(passphrase)
    
    # Decrypt using AES-GCM
    try:
        aesgcm = AESGCM(key)
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    except Exception as e:
        print("Error: Decryption failed. Incorrect passphrase or corrupted data.")
        sys.exit(1)
        
    # Write decrypted file
    with open(output_file, 'wb') as f:
        f.write(plaintext)
        
    print(f"Successfully decrypted {input_file} -> {output_file}")

if __name__ == "__main__":
    main()

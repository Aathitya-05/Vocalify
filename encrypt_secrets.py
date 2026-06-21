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
                
    # Otherwise prompt interactively
    try:
        p1 = getpass.getpass("Enter passphrase to encrypt secrets: ")
        p2 = getpass.getpass("Confirm passphrase: ")
        if p1 != p2:
            print("Error: Passphrases do not match.")
            sys.exit(1)
        return p1
    except Exception as e:
        print(f"Error prompting for password: {e}")
        sys.exit(1)

def main():
    input_file = "static/firebase-config.js"
    output_file = "static/firebase-config.js.enc"
    
    if not os.path.exists(input_file):
        print(f"Error: {input_file} not found.")
        sys.exit(1)
        
    passphrase_str = get_passphrase()
    if not passphrase_str or len(passphrase_str) < 4:
        print("Error: Passphrase must be at least 4 characters long.")
        sys.exit(1)
        
    passphrase = passphrase_str.encode('utf-8')
    
    # Generate salt and derive key
    salt = os.urandom(16)
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = kdf.derive(passphrase)
    
    # Read plaintext
    with open(input_file, 'rb') as f:
        data = f.read()
        
    # Encrypt using AES-GCM
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, data, None)
    
    # Prepare payload
    payload = {
        "salt": base64.b64encode(salt).decode('utf-8'),
        "nonce": base64.b64encode(nonce).decode('utf-8'),
        "ciphertext": base64.b64encode(ciphertext).decode('utf-8')
    }
    
    # Save encrypted secrets
    with open(output_file, 'w') as f:
        json.dump(payload, f, indent=2)
        
    print(f"Successfully encrypted {input_file} -> {output_file}")

if __name__ == "__main__":
    main()

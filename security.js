const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const KEY_FILE = path.join(DATA_DIR, '.encryption_key');

// Get or generate 32-byte AES-256 master key
function getMasterKey() {
    if (process.env.SCHEDULE_MASTER_KEY && process.env.SCHEDULE_MASTER_KEY.length === 64) {
        return Buffer.from(process.env.SCHEDULE_MASTER_KEY, 'hex');
    }
    if (fs.existsSync(KEY_FILE)) {
        try {
            const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
            if (hex.length === 64) return Buffer.from(hex, 'hex');
        } catch (e) {}
    }
    const newKey = crypto.randomBytes(32);
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, newKey.toString('hex'), { mode: 0o600, encoding: 'utf8' });
    return newKey;
}

const MASTER_KEY = getMasterKey();

/**
 * Encrypt plaintext using AES-256-GCM.
 * Output format: "iv_hex:authTag_hex:ciphertext_hex"
 */
function encrypt(plaintext) {
    if (!plaintext) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt ciphertext encrypted with AES-256-GCM.
 */
function decrypt(encryptedString) {
    if (!encryptedString) return '';
    try {
        const parts = encryptedString.split(':');
        if (parts.length !== 3) return '';
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const ciphertext = parts[2];
        const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('[Decryption Error]', e.message);
        return '';
    }
}

/**
 * Generate a cryptographically secure random session token.
 */
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a safe user folder name from username.
 */
function sanitizeUsername(username) {
    return (username || 'student').trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
}

module.exports = {
    encrypt,
    decrypt,
    generateSessionToken,
    sanitizeUsername
};

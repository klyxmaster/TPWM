(() => {
    "use strict";

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    function bytesToBase64(bytes) {
        let binary = "";
        const chunkSize = 0x8000;

        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            const chunk = bytes.subarray(offset, offset + chunkSize);
            binary += String.fromCharCode(...chunk);
        }

        return btoa(binary);
    }

    function base64ToBytes(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);

        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }

        return bytes;
    }

    function randomBytes(length) {
        const bytes = new Uint8Array(length);
        crypto.getRandomValues(bytes);
        return bytes;
    }

    async function deriveKey(password, salt, iterations) {
        const passwordMaterial = await crypto.subtle.importKey(
            "raw",
            encoder.encode(password),
            "PBKDF2",
            false,
            ["deriveKey"]
        );

        return crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt,
                iterations,
                hash: "SHA-256"
            },
            passwordMaterial,
            {
                name: "AES-GCM",
                length: 256
            },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async function encryptJson(value, key) {
        const iv = randomBytes(12);
        const plaintext = encoder.encode(JSON.stringify(value));
        const ciphertext = await crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv
            },
            key,
            plaintext
        );

        return {
            iv: bytesToBase64(iv),
            ciphertext: bytesToBase64(new Uint8Array(ciphertext))
        };
    }

    async function decryptJson(encrypted, key) {
        const plaintext = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: base64ToBytes(encrypted.iv)
            },
            key,
            base64ToBytes(encrypted.ciphertext)
        );

        return JSON.parse(decoder.decode(plaintext));
    }

    window.TPWMCrypto = {
        DEFAULT_ITERATIONS: 600000,
        randomBytes,
        bytesToBase64,
        base64ToBytes,
        deriveKey,
        encryptJson,
        decryptJson
    };
})();

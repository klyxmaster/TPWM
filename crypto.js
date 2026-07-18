"use strict";

const TPWMCrypto = (() => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    function base64ToBytes(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    async function deriveKey(password, salt, iterations) {
        const keyMaterial = await crypto.subtle.importKey(
            "raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]
        );

        return crypto.subtle.deriveKey(
            { name: "PBKDF2", hash: "SHA-256", salt, iterations: Number(iterations) },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"]
        );
    }

    async function decryptJson(payload, key) {
        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
            key,
            base64ToBytes(payload.ciphertext)
        );
        return JSON.parse(decoder.decode(decrypted));
    }

    function validatePackage(packageData) {
        if (!packageData || packageData.packageType !== "TPWM_ENCRYPTED_VAULT") {
            throw new Error("This is not a compatible TPWM encrypted-vault file.");
        }
        if (Number(packageData.packageVersion) !== 1) {
            throw new Error(`Unsupported TPWM package version: ${packageData.packageVersion}`);
        }

        const vault = packageData.vault;
        if (!vault || !vault.accountId || !vault.kdf?.salt || !vault.kdf?.iterations ||
            !vault.payload?.iv || !vault.payload?.ciphertext) {
            throw new Error("The TPWM package is incomplete or damaged.");
        }
        return vault;
    }

    async function decryptPackage(packageData, password) {
        const vault = validatePackage(packageData);
        try {
            const key = await deriveKey(password, base64ToBytes(vault.kdf.salt), vault.kdf.iterations);
            const data = await decryptJson(vault.payload, key);
            if (!data?.records?.websites) throw new Error("Website records were not found.");
            return data;
        } catch {
            throw new Error("Incorrect master password or damaged TPWM file.");
        }
    }

    return { validatePackage, decryptPackage };
})();

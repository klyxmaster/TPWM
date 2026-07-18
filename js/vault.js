(() => {
    "use strict";

    const FORMAT_VERSION = 1;

    let sessionKey = null;
    let vaultData = null;
    let vaultMetadata = null;

    function createInitialVaultData(accountId, idleTimeoutMinutes) {
        const now = new Date().toISOString();

        return {
            formatVersion: FORMAT_VERSION,
            account: {
                id: accountId,
                createdAt: now
            },
            settings: {
                idleTimeoutMinutes,
                clipboardClearSeconds: 30,
                autoHideSeconds: 30,
                defaultCategory: "websites",
                compactView: true,
                pageSize: 50
            },
            records: {
                websites: [
                    {
                        id: crypto.randomUUID(),
                        recordType: "website",
                        siteName: "Proton Mail",
                        url: "https://proton.me",
                        loginId: "sample@example.com",
                        password: "Sample encrypted password",
                        emailUsed: "sample@example.com",
                        supports2FA: "yes",
                        twoFAEnabled: "yes",
                        twoFAType: "authenticator",
                        totpSecret: "",
                        twoFAEmail: "",
                        twoFAPhone: "",
                        recoveryCodes: "",
                        securityKeyName: "",
                        notes: "This starter website record is stored inside the encrypted vault.",
                        tags: "email, privacy",
                        createdAt: now,
                        modifiedAt: now
                    }
                ],
                cards: [],
                banking: [],
                notes: [
                    {
                        id: crypto.randomUUID(),
                        title: "Welcome to TPWM",
                        subtitle: "Encrypted local vault",
                        meta: "Starter note",
                        details: {
                            "Category": "TPWM",
                            "Contents": "Your vault is now encrypted and stored locally in IndexedDB.",
                            "Tags": "welcome, encrypted"
                        },
                        createdAt: now,
                        modifiedAt: now
                    }
                ]
            }
        };
    }

    function requireUnlocked() {
        if (!sessionKey || !vaultData || !vaultMetadata) {
            throw new Error("The vault is locked.");
        }
    }

    async function exists() {
        return Boolean(await window.TPWMDatabase.getVault());
    }

    async function create(accountId, password, idleTimeoutMinutes) {
        const normalizedId = accountId.trim();

        if (!normalizedId) {
            throw new Error("Account ID is required.");
        }

        if (password.length < 10) {
            throw new Error("The master password must contain at least 10 characters.");
        }

        if (await exists()) {
            throw new Error("A local vault already exists. Unlock it instead of creating another one.");
        }

        const salt = window.TPWMCrypto.randomBytes(16);
        const iterations = window.TPWMCrypto.DEFAULT_ITERATIONS;
        const key = await window.TPWMCrypto.deriveKey(password, salt, iterations);
        const data = createInitialVaultData(normalizedId, idleTimeoutMinutes);
        const encrypted = await window.TPWMCrypto.encryptJson(data, key);

        const record = {
            formatVersion: FORMAT_VERSION,
            accountId: normalizedId,
            kdf: {
                name: "PBKDF2",
                hash: "SHA-256",
                iterations,
                salt: window.TPWMCrypto.bytesToBase64(salt)
            },
            encryption: {
                name: "AES-GCM",
                keyLength: 256
            },
            payload: encrypted,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
        };

        await window.TPWMDatabase.saveVault(record);

        sessionKey = key;
        vaultData = data;
        vaultMetadata = record;

        return structuredClone(vaultData);
    }

    async function unlock(accountId, password) {
        const record = await window.TPWMDatabase.getVault();

        if (!record) {
            throw new Error("No local vault exists. Use First-Time Setup.");
        }

        if (record.accountId.toLowerCase() !== accountId.trim().toLowerCase()) {
            throw new Error("Account ID or master password is incorrect.");
        }

        try {
            const salt = window.TPWMCrypto.base64ToBytes(record.kdf.salt);
            const key = await window.TPWMCrypto.deriveKey(password, salt, record.kdf.iterations);
            const data = await window.TPWMCrypto.decryptJson(record.payload, key);

            if (!data || data.formatVersion !== FORMAT_VERSION || data.account?.id !== record.accountId) {
                throw new Error("Invalid vault contents.");
            }

            sessionKey = key;
            vaultData = data;
            vaultMetadata = record;

            return structuredClone(vaultData);
        } catch (error) {
            sessionKey = null;
            vaultData = null;
            vaultMetadata = null;
            throw new Error("Account ID or master password is incorrect.");
        }
    }

    function getData() {
        requireUnlocked();
        return structuredClone(vaultData);
    }

    function getSettings() {
        requireUnlocked();
        return structuredClone(vaultData.settings);
    }

    async function saveData(nextData) {
        requireUnlocked();

        vaultData = structuredClone(nextData);
        vaultMetadata.payload = await window.TPWMCrypto.encryptJson(vaultData, sessionKey);
        vaultMetadata.modifiedAt = new Date().toISOString();

        await window.TPWMDatabase.saveVault(vaultMetadata);
    }

    async function changeCredentials(currentPassword, newAccountId, newPassword) {
        requireUnlocked();

        const normalizedId = String(newAccountId || "").trim();

        if (!normalizedId) {
            throw new Error("Account ID is required.");
        }

        if (newPassword && newPassword.length < 10) {
            throw new Error("The new master password must contain at least 10 characters.");
        }

        try {
            const oldSalt = window.TPWMCrypto.base64ToBytes(vaultMetadata.kdf.salt);
            const verificationKey = await window.TPWMCrypto.deriveKey(
                currentPassword,
                oldSalt,
                vaultMetadata.kdf.iterations
            );

            await window.TPWMCrypto.decryptJson(vaultMetadata.payload, verificationKey);
        } catch {
            throw new Error("The current master password is incorrect.");
        }

        const passwordToUse = newPassword || currentPassword;
        const newSalt = window.TPWMCrypto.randomBytes(16);
        const newKey = await window.TPWMCrypto.deriveKey(
            passwordToUse,
            newSalt,
            window.TPWMCrypto.DEFAULT_ITERATIONS
        );

        vaultData.account.id = normalizedId;
        vaultData.account.modifiedAt = new Date().toISOString();

        vaultMetadata.accountId = normalizedId;
        vaultMetadata.kdf = {
            name: "PBKDF2",
            hash: "SHA-256",
            iterations: window.TPWMCrypto.DEFAULT_ITERATIONS,
            salt: window.TPWMCrypto.bytesToBase64(newSalt)
        };
        vaultMetadata.payload = await window.TPWMCrypto.encryptJson(vaultData, newKey);
        vaultMetadata.modifiedAt = new Date().toISOString();

        await window.TPWMDatabase.saveVault(vaultMetadata);
        sessionKey = newKey;

        return structuredClone(vaultData);
    }

    function validatePackage(packageData) {
        if (!packageData || typeof packageData !== "object") {
            throw new Error("The selected file is not a valid TPWM package.");
        }

        if (packageData.packageType !== "TPWM_ENCRYPTED_VAULT") {
            throw new Error("This is not a TPWM encrypted-vault file.");
        }

        if (Number(packageData.packageVersion) !== 1) {
            throw new Error(`Unsupported TPWM package version: ${packageData.packageVersion}`);
        }

        const record = packageData.vault;

        if (
            !record ||
            Number(record.formatVersion) !== 1 ||
            !record.accountId ||
            !record.kdf?.salt ||
            !record.kdf?.iterations ||
            !record.payload?.iv ||
            !record.payload?.ciphertext
        ) {
            throw new Error("The TPWM package is incomplete or damaged.");
        }

        return record;
    }

    async function decryptImportedPackage(packageData, password) {
        const record = validatePackage(packageData);

        try {
            const salt = window.TPWMCrypto.base64ToBytes(record.kdf.salt);
            const key = await window.TPWMCrypto.deriveKey(password, salt, record.kdf.iterations);
            const data = await window.TPWMCrypto.decryptJson(record.payload, key);

            if (!data || Number(data.formatVersion) !== 1 || data.account?.id !== record.accountId) {
                throw new Error("Invalid decrypted package.");
            }

            return {
                record: structuredClone(record),
                key,
                data
            };
        } catch {
            throw new Error("The import password is incorrect, or the TPWM file is damaged.");
        }
    }

    async function exportPackage() {
        const record = await window.TPWMDatabase.getVault();

        if (!record) {
            throw new Error("No local vault exists to export.");
        }

        return {
            packageType: "TPWM_ENCRYPTED_VAULT",
            packageVersion: 1,
            exportedAt: new Date().toISOString(),
            source: {
                application: "TPWM Web",
                platform: "web",
                dataFormat: "encrypted-json"
            },
            vault: structuredClone(record)
        };
    }

    async function inspectPackage(packageData) {
        const record = validatePackage(packageData);

        return {
            accountId: record.accountId,
            createdAt: record.createdAt || "",
            modifiedAt: record.modifiedAt || "",
            formatVersion: record.formatVersion,
            iterations: record.kdf.iterations,
            encryption: record.encryption?.name || "AES-GCM"
        };
    }

    async function replaceFromPackage(packageData, password) {
        const imported = await decryptImportedPackage(packageData, password);

        await window.TPWMDatabase.saveVault(imported.record);

        sessionKey = imported.key;
        vaultData = imported.data;
        vaultMetadata = imported.record;

        return structuredClone(vaultData);
    }

    function stableRecordSignature(record) {
        const copy = structuredClone(record);
        delete copy.id;
        delete copy.createdAt;
        delete copy.modifiedAt;
        return JSON.stringify(copy);
    }

    async function mergeFromPackage(packageData, password) {
        requireUnlocked();

        const imported = await decryptImportedPackage(packageData, password);
        const categories = ["websites", "cards", "banking", "notes"];
        const summary = {
            added: 0,
            skipped: 0,
            reassignedIds: 0,
            byCategory: {}
        };

        categories.forEach(category => {
            const destination = vaultData.records[category] || [];
            const incoming = imported.data.records?.[category] || [];
            const existingIds = new Set(destination.map(record => record.id));
            const existingSignatures = new Set(destination.map(stableRecordSignature));

            summary.byCategory[category] = {
                added: 0,
                skipped: 0
            };

            incoming.forEach(sourceRecord => {
                const signature = stableRecordSignature(sourceRecord);

                if (existingSignatures.has(signature)) {
                    summary.skipped += 1;
                    summary.byCategory[category].skipped += 1;
                    return;
                }

                const record = structuredClone(sourceRecord);

                if (!record.id || existingIds.has(record.id)) {
                    record.id = crypto.randomUUID();
                    summary.reassignedIds += 1;
                }

                const now = new Date().toISOString();
                record.createdAt = record.createdAt || now;
                record.modifiedAt = now;

                destination.push(record);
                existingIds.add(record.id);
                existingSignatures.add(signature);
                summary.added += 1;
                summary.byCategory[category].added += 1;
            });

            vaultData.records[category] = destination;
        });

        vaultMetadata.payload = await window.TPWMCrypto.encryptJson(vaultData, sessionKey);
        vaultMetadata.modifiedAt = new Date().toISOString();
        await window.TPWMDatabase.saveVault(vaultMetadata);

        return {
            data: structuredClone(vaultData),
            summary
        };
    }

    function lock() {
        sessionKey = null;
        vaultData = null;
        vaultMetadata = null;
    }

    function isUnlocked() {
        return Boolean(sessionKey && vaultData && vaultMetadata);
    }

    window.TPWMVault = {
        exists,
        create,
        unlock,
        getData,
        getSettings,
        saveData,
        changeCredentials,
        exportPackage,
        inspectPackage,
        replaceFromPackage,
        mergeFromPackage,
        lock,
        isUnlocked
    };
})();

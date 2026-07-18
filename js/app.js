(() => {
    "use strict";

    const categoryNames = {
        websites: "Websites",
        cards: "Credit Cards",
        banking: "Banking",
        notes: "Secure Notes"
    };

    const twoFATypeNames = {
        authenticator: "Authenticator",
        email: "Email",
        sms: "SMS",
        securityKey: "Security Key",
        passkey: "Passkey",
        backupCodes: "Backup Codes",
        other: "Other",
        none: "Not specified"
    };

    let currentCategory = "websites";
    let currentView = "compact";
    let vaultData = null;
    let lastFocusedElement = null;
    let idleTimer = null;
    let idleCountdownTimer = null;
    let idleDeadline = 0;
    let hiddenLockTimer = null;
    let busy = false;
    let activeRecordId = null;
    let currentPage = 1;
    let pageSize = 50;
    let currentTotalPages = 1;
    let pendingImportPackage = null;
    let pendingImportSource = "auth";
    let totpRefreshTimer = null;
    let pendingQrTarget = null;
    let pendingCsvData = null;

    const elements = {
        authScreen: document.getElementById("authScreen"),
        mainScreen: document.getElementById("mainScreen"),
        loginTab: document.getElementById("loginTab"),
        signupTab: document.getElementById("signupTab"),
        loginForm: document.getElementById("loginForm"),
        signupForm: document.getElementById("signupForm"),
        loginMessage: document.getElementById("loginMessage"),
        signupMessage: document.getElementById("signupMessage"),
        sidebar: document.getElementById("sidebar"),
        mobileMenuButton: document.getElementById("mobileMenuButton"),
        searchInput: document.getElementById("searchInput"),
        clearSearchButton: document.getElementById("clearSearchButton"),
        globalSearchToggle: document.getElementById("globalSearchToggle"),
        categoryTitle: document.getElementById("categoryTitle"),
        recordList: document.getElementById("recordList"),
        emptyState: document.getElementById("emptyState"),
        addRecordButton: document.getElementById("addRecordButton"),
        emptyAddButton: document.getElementById("emptyAddButton"),
        paginationBar: document.getElementById("paginationBar"),
        paginationRange: document.getElementById("paginationRange"),
        paginationPageText: document.getElementById("paginationPageText"),
        firstPageButton: document.getElementById("firstPageButton"),
        previousPageButton: document.getElementById("previousPageButton"),
        nextPageButton: document.getElementById("nextPageButton"),
        lastPageButton: document.getElementById("lastPageButton"),
        pageSizeSelect: document.getElementById("pageSizeSelect"),
        pwGenButton: document.getElementById("pwGenButton"),
        adminButton: document.getElementById("adminButton"),
        lockButton: document.getElementById("lockButton"),
        compactViewButton: document.getElementById("compactViewButton"),
        comfortableViewButton: document.getElementById("comfortableViewButton"),
        statusText: document.getElementById("statusText"),
        clockText: document.getElementById("clockText"),
        modalOverlay: document.getElementById("modalOverlay"),
        modalPanel: document.getElementById("modalPanel"),
        modalEyebrow: document.getElementById("modalEyebrow"),
        modalTitle: document.getElementById("modalTitle"),
        modalBody: document.getElementById("modalBody"),
        modalFooter: document.getElementById("modalFooter"),
        modalCloseButton: document.getElementById("modalCloseButton"),
        importVaultAuthButton: document.getElementById("importVaultAuthButton"),
        vaultFileInput: document.getElementById("vaultFileInput"),
        totpQrFileInput: document.getElementById("totpQrFileInput"),
        csvFileInput: document.getElementById("csvFileInput")
    };

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function safeUrl(value) {
        const url = String(value || "").trim();

        if (!url) {
            return "";
        }

        if (/^https?:\/\//i.test(url)) {
            return url;
        }

        return `https://${url}`;
    }

    function formatDate(value) {
        if (!value) {
            return "";
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        return date.toLocaleDateString([], {
            year: "numeric",
            month: "short",
            day: "numeric"
        });
    }

    function titleForRecord(category, record) {
        if (category === "websites") return record.siteName || "Untitled Website";
        if (category === "cards") return record.cardNickname || "Untitled Card";
        if (category === "banking") return record.accountNickname || record.bankName || "Untitled Account";
        return record.title || "Untitled Note";
    }

    function subtitleForRecord(category, record) {
        if (category === "websites") return record.loginId || record.emailUsed || record.url || "No login ID";
        if (category === "cards") return record.issuingBank || record.cardholderName || "No issuing bank";
        if (category === "banking") return record.bankName || record.accountType || "Bank account";
        return record.category || "Secure Note";
    }

    function categoryIcon(category) {
        return {
            websites: "W",
            cards: "C",
            banking: "B",
            notes: "N"
        }[category] || "?";
    }

    function categoryLabel(category) {
        return categoryNames[category] || category;
    }

    async function copyText(value, button = null) {
        const text = String(value || "");
        if (!text) return;

        try {
            await navigator.clipboard.writeText(text);

            if (button) {
                const original = button.textContent;
                button.textContent = "Copied";
                button.classList.add("copy-success");
                setTimeout(() => {
                    button.textContent = original;
                    button.classList.remove("copy-success");
                }, 1200);
            }

            const seconds = Number(vaultData?.settings?.clipboardClearSeconds) || 30;
            elements.statusText.textContent = `Copied to clipboard · clears in ${seconds} seconds`;

            if (seconds > 0) {
                setTimeout(async () => {
                    try {
                        const current = await navigator.clipboard.readText();
                        if (current === text) {
                            await navigator.clipboard.writeText("");
                            elements.statusText.textContent = "Clipboard cleared";
                        }
                    } catch {
                        // Clipboard read/clear may be blocked by the browser.
                    }
                }, seconds * 1000);
            }
        } catch {
            window.alert("The browser blocked clipboard access.");
        }
    }

    function getAllSearchResults(query) {
        const results = [];
        const normalized = query.toLowerCase();

        Object.keys(categoryNames).forEach((category) => {
            const records = vaultData.records?.[category] || [];

            records.forEach((record) => {
                const previousCategory = currentCategory;
                currentCategory = category;
                const matches = recordSearchText(record).includes(normalized);
                currentCategory = previousCategory;

                if (matches) {
                    results.push({ category, record });
                }
            });
        });

        return results;
    }

    function normalizeWebsite(record) {
        if (record.recordType === "website" || record.siteName) {
            return {
                id: record.id || crypto.randomUUID(),
                recordType: "website",
                siteName: record.siteName || record.title || "",
                url: record.url || record.details?.["Website URL"] || "",
                loginId: record.loginId || record.details?.["Login ID"] || record.subtitle || "",
                password: record.password || record.details?.["Password"] || "",
                emailUsed: record.emailUsed || record.details?.["Email Used"] || "",
                supports2FA: record.supports2FA || "unknown",
                twoFAEnabled: record.twoFAEnabled || (String(record.meta || "").toLowerCase().includes("2fa enabled") ? "yes" : "unknown"),
                twoFAType: record.twoFAType || "none",
                totpSecret: record.totpSecret || "",
                totpIssuer: record.totpIssuer || record.siteName || record.title || "",
                totpAccount: record.totpAccount || record.loginId || record.emailUsed || "",
                totpDigits: Number(record.totpDigits) || 6,
                totpPeriod: Number(record.totpPeriod) || 30,
                totpAlgorithm: String(record.totpAlgorithm || "SHA1").toUpperCase(),
                twoFAEmail: record.twoFAEmail || "",
                twoFAPhone: record.twoFAPhone || "",
                recoveryCodes: record.recoveryCodes || "",
                securityKeyName: record.securityKeyName || "",
                notes: record.notes || record.details?.["Notes"] || "",
                tags: record.tags || "",
                createdAt: record.createdAt || new Date().toISOString(),
                modifiedAt: record.modifiedAt || new Date().toISOString()
            };
        }

        return record;
    }

    function normalizeCard(record) {
        if (record.recordType === "card" || record.cardNickname) {
            return {
                id: record.id || crypto.randomUUID(),
                recordType: "card",
                cardNickname: record.cardNickname || record.title || "",
                cardholderName: record.cardholderName || record.details?.["Cardholder"] || "",
                cardNumber: record.cardNumber || record.details?.["Card Number"] || "",
                expMonth: record.expMonth || "",
                expYear: record.expYear || "",
                cvv: record.cvv || "",
                billingZip: record.billingZip || "",
                issuingBank: record.issuingBank || record.details?.["Issuing Bank"] || record.subtitle || "",
                loginWebsite: record.loginWebsite || "",
                loginId: record.loginId || "",
                password: record.password || "",
                customerService: record.customerService || "",
                creditLimit: record.creditLimit || record.details?.["Credit Limit"] || "",
                notes: record.notes || record.details?.["Notes"] || "",
                tags: record.tags || "",
                createdAt: record.createdAt || new Date().toISOString(),
                modifiedAt: record.modifiedAt || new Date().toISOString()
            };
        }

        return record;
    }

    function normalizeBank(record) {
        if (record.recordType === "bank" || record.bankName) {
            return {
                id: record.id || crypto.randomUUID(),
                recordType: "bank",
                bankName: record.bankName || record.details?.["Bank Name"] || record.title || "",
                accountNickname: record.accountNickname || record.title || "",
                accountType: record.accountType || record.details?.["Account Type"] || record.meta || "",
                routingNumber: record.routingNumber || record.details?.["Routing Number"] || "",
                accountNumber: record.accountNumber || record.details?.["Account Number"] || "",
                website: record.website || "",
                loginId: record.loginId || record.details?.["Login ID"] || "",
                password: record.password || "",
                emailUsed: record.emailUsed || "",
                twoFAEnabled: record.twoFAEnabled || "unknown",
                twoFAType: record.twoFAType || "none",
                phoneNumber: record.phoneNumber || "",
                customerService: record.customerService || "",
                notes: record.notes || "",
                tags: record.tags || "",
                createdAt: record.createdAt || new Date().toISOString(),
                modifiedAt: record.modifiedAt || new Date().toISOString()
            };
        }

        return record;
    }

    function normalizeNote(record) {
        if (record.recordType === "note" || record.contents) {
            return {
                id: record.id || crypto.randomUUID(),
                recordType: "note",
                title: record.title || "",
                category: record.category || record.details?.["Category"] || record.subtitle || "",
                contents: record.contents || record.details?.["Contents"] || "",
                tags: record.tags || record.details?.["Tags"] || "",
                createdAt: record.createdAt || new Date().toISOString(),
                modifiedAt: record.modifiedAt || new Date().toISOString()
            };
        }

        return record;
    }

    function normalizeVaultRecords() {
        if (!vaultData?.records) {
            return;
        }

        vaultData.records.websites = (vaultData.records.websites || []).map(normalizeWebsite);
        vaultData.records.cards = (vaultData.records.cards || []).map(normalizeCard);
        vaultData.records.banking = (vaultData.records.banking || []).map(normalizeBank);
        vaultData.records.notes = (vaultData.records.notes || []).map(normalizeNote);

        vaultData.settings = {
            idleTimeoutMinutes: 10,
            clipboardClearSeconds: 30,
            autoHideSeconds: 30,
            lockWhenHidden: false,
            hiddenLockSeconds: 60,
            confirmManualLock: false,
            defaultCategory: "websites",
            compactView: true,
            pageSize: 50,
            ...vaultData.settings
        };
    }

    function setAuthMessage(target, message, isError = false) {
        target.textContent = message;
        target.style.color = isError ? "var(--danger)" : "";
    }

    function setFormBusy(form, isBusy, text) {
        const submit = form.querySelector('button[type="submit"]');

        if (!submit) {
            return;
        }

        if (isBusy) {
            submit.dataset.originalText = submit.textContent;
            submit.textContent = text;
            submit.disabled = true;
        } else {
            submit.textContent = submit.dataset.originalText || submit.textContent;
            submit.disabled = false;
        }
    }

    function switchAuthTab(mode) {
        const isLogin = mode === "login";

        elements.loginTab.classList.toggle("active", isLogin);
        elements.signupTab.classList.toggle("active", !isLogin);
        elements.loginTab.setAttribute("aria-selected", String(isLogin));
        elements.signupTab.setAttribute("aria-selected", String(!isLogin));
        elements.loginForm.classList.toggle("hidden", !isLogin);
        elements.signupForm.classList.toggle("hidden", isLogin);
    }

    function updateCategoryCounts() {
        Object.keys(categoryNames).forEach((category) => {
            const counter = document.querySelector(`[data-count="${category}"]`);
            if (counter) {
                counter.textContent = String(vaultData?.records?.[category]?.length || 0);
            }
        });
    }

    function openDashboard(message) {
        normalizeVaultRecords();

        elements.authScreen.classList.add("hidden");
        elements.mainScreen.classList.remove("hidden");

        const settings = vaultData.settings || {};
        currentCategory = settings.defaultCategory || "websites";
        currentView = settings.compactView === false ? "comfortable" : "compact";
        pageSize = [25, 50, 100, 200].includes(Number(settings.pageSize))
            ? Number(settings.pageSize)
            : 50;
        elements.pageSizeSelect.value = String(pageSize);
        currentPage = 1;

        const radio = document.querySelector(`input[name="category"][value="${currentCategory}"]`);
        if (radio) {
            radio.checked = true;
        }

        elements.compactViewButton.classList.toggle("active", currentView === "compact");
        elements.comfortableViewButton.classList.toggle("active", currentView === "comfortable");
        elements.statusText.textContent = `${message || "Encrypted vault unlocked"} · Ctrl+F search · Ctrl+N add`;
        updateCategoryCounts();
        setCategory(currentCategory);
        updateClock();
        resetIdleTimer();
        elements.searchInput.focus();
    }

    function clearIdleTimers() {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }

        if (idleCountdownTimer) {
            clearInterval(idleCountdownTimer);
            idleCountdownTimer = null;
        }

        if (hiddenLockTimer) {
            clearTimeout(hiddenLockTimer);
            hiddenLockTimer = null;
        }

        idleDeadline = 0;
    }

    function clearSensitiveSession() {
        clearIdleTimers();
        vaultData = null;
        window.TPWMVault.lock();
    }

    function lockVault(reason = "Vault locked", force = false) {
        if (
            !force &&
            vaultData?.settings?.confirmManualLock &&
            reason === "Vault locked manually." &&
            !window.confirm("Lock the vault now?")
        ) {
            resetIdleTimer();
            return;
        }

        closeModal();
        clearSensitiveSession();
        elements.mainScreen.classList.add("hidden");
        elements.authScreen.classList.remove("hidden");
        elements.searchInput.value = "";
        elements.clearSearchButton.classList.add("hidden");
        elements.sidebar.classList.remove("open");
        switchAuthTab("login");
        document.getElementById("loginPassword").value = "";
        setAuthMessage(elements.loginMessage, reason);
        document.getElementById("loginId").focus();
    }

    function updateIdleCountdown() {
        if (!vaultData || !idleDeadline) {
            return;
        }

        const remainingSeconds = Math.max(0, Math.ceil((idleDeadline - Date.now()) / 1000));
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        const countdown = `${minutes}:${String(seconds).padStart(2, "0")}`;

        if (remainingSeconds <= 60) {
            elements.statusText.textContent = `Auto-lock in ${countdown}`;
            elements.statusText.classList.add("idle-warning");
        } else {
            elements.statusText.classList.remove("idle-warning");
        }
    }

    function resetIdleTimer() {
        if (!window.TPWMVault.isUnlocked() || !vaultData) {
            return;
        }

        if (idleTimer) clearTimeout(idleTimer);
        if (idleCountdownTimer) clearInterval(idleCountdownTimer);

        const minutes = Number(vaultData.settings?.idleTimeoutMinutes) || 10;
        idleDeadline = Date.now() + (minutes * 60 * 1000);

        idleTimer = setTimeout(() => {
            lockVault(`Vault locked automatically after ${minutes} minutes of inactivity.`, true);
        }, minutes * 60 * 1000);

        idleCountdownTimer = setInterval(updateIdleCountdown, 1000);
        elements.statusText.classList.remove("idle-warning");
    }

    function scheduleHiddenLock() {
        if (!vaultData?.settings?.lockWhenHidden || document.visibilityState !== "hidden") {
            return;
        }

        if (hiddenLockTimer) clearTimeout(hiddenLockTimer);

        const seconds = Math.max(5, Number(vaultData.settings.hiddenLockSeconds) || 60);
        hiddenLockTimer = setTimeout(() => {
            lockVault(`Vault locked after being hidden for ${seconds} seconds.`, true);
        }, seconds * 1000);
    }

    function setCategory(category) {
        currentCategory = category;
        currentPage = 1;
        elements.categoryTitle.textContent = categoryNames[category];

        document.querySelectorAll(".category-option").forEach((option) => {
            const radio = option.querySelector("input");
            option.classList.toggle("active", radio.value === category);
        });

        elements.sidebar.classList.remove("open");
        renderRecords();
    }

    function normalizeBase32(value) {
        return String(value || "")
            .toUpperCase()
            .replace(/\s+/g, "")
            .replace(/-/g, "")
            .replace(/=+$/g, "");
    }

    function base32ToBytes(value) {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        const normalized = normalizeBase32(value);

        if (!normalized) {
            throw new Error("The authenticator secret is empty.");
        }

        let bits = "";

        for (const character of normalized) {
            const index = alphabet.indexOf(character);
            if (index < 0) {
                throw new Error(`Invalid Base32 character: ${character}`);
            }
            bits += index.toString(2).padStart(5, "0");
        }

        const bytes = [];

        for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
            bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
        }

        return new Uint8Array(bytes);
    }

    function counterBytes(counter) {
        const bytes = new Uint8Array(8);
        let value = BigInt(counter);

        for (let index = 7; index >= 0; index -= 1) {
            bytes[index] = Number(value & 255n);
            value >>= 8n;
        }

        return bytes;
    }

    async function generateTotp(secret, options = {}) {
        const period = Number(options.period) || 30;
        const digits = Number(options.digits) || 6;
        const algorithm = String(options.algorithm || "SHA1").toUpperCase();
        const supported = {
            SHA1: "SHA-1",
            SHA256: "SHA-256",
            SHA512: "SHA-512"
        };

        if (!supported[algorithm]) {
            throw new Error(`Unsupported TOTP algorithm: ${algorithm}`);
        }

        const timestamp = Number(options.timestamp) || Date.now();
        const counter = Math.floor(timestamp / 1000 / period);
        const key = await crypto.subtle.importKey(
            "raw",
            base32ToBytes(secret),
            {
                name: "HMAC",
                hash: supported[algorithm]
            },
            false,
            ["sign"]
        );

        const signature = new Uint8Array(
            await crypto.subtle.sign("HMAC", key, counterBytes(counter))
        );

        const offset = signature[signature.length - 1] & 0x0f;
        const binary = (
            ((signature[offset] & 0x7f) << 24) |
            ((signature[offset + 1] & 0xff) << 16) |
            ((signature[offset + 2] & 0xff) << 8) |
            (signature[offset + 3] & 0xff)
        );

        const code = String(binary % (10 ** digits)).padStart(digits, "0");
        const elapsed = Math.floor(timestamp / 1000) % period;
        const remaining = period - elapsed;

        return { code, remaining, period };
    }

    function formatTotpCode(code) {
        if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
        if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
        return code;
    }

    function parseOtpAuthUri(uri) {
        const value = String(uri || "").trim();

        if (!value.toLowerCase().startsWith("otpauth://totp/")) {
            throw new Error("Only otpauth://totp/ authenticator links are supported.");
        }

        const parsed = new URL(value);
        const label = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
        const labelParts = label.split(":");
        const issuerFromLabel = labelParts.length > 1 ? labelParts.shift() : "";
        const account = labelParts.join(":") || label;
        const secret = normalizeBase32(parsed.searchParams.get("secret"));
        const issuer = parsed.searchParams.get("issuer") || issuerFromLabel;
        const algorithm = String(parsed.searchParams.get("algorithm") || "SHA1").toUpperCase();
        const digits = Number(parsed.searchParams.get("digits") || 6);
        const period = Number(parsed.searchParams.get("period") || 30);

        if (!secret) {
            throw new Error("The authenticator link does not contain a secret.");
        }

        if (![6, 8].includes(digits)) {
            throw new Error("TPWM supports 6-digit and 8-digit TOTP codes.");
        }

        if (![15, 30, 60].includes(period)) {
            throw new Error("TPWM supports 15, 30, and 60 second TOTP periods.");
        }

        if (!["SHA1", "SHA256", "SHA512"].includes(algorithm)) {
            throw new Error("Unsupported authenticator algorithm.");
        }

        return { secret, issuer, account, algorithm, digits, period };
    }

    function stopTotpRefresh() {
        if (totpRefreshTimer) {
            clearInterval(totpRefreshTimer);
            totpRefreshTimer = null;
        }
    }

    async function updateTotpWidget(record) {
        const codeElement = document.getElementById("totpCurrentCode");
        const timeElement = document.getElementById("totpRemaining");
        const barElement = document.getElementById("totpCountdownBar");

        if (!codeElement || !timeElement || !barElement || !record.totpSecret) {
            return;
        }

        try {
            const result = await generateTotp(record.totpSecret, {
                period: record.totpPeriod,
                digits: record.totpDigits,
                algorithm: record.totpAlgorithm
            });

            codeElement.textContent = formatTotpCode(result.code);
            codeElement.dataset.rawCode = result.code;
            timeElement.textContent = `${result.remaining}s`;
            barElement.style.width = `${(result.remaining / result.period) * 100}%`;
            barElement.classList.toggle("totp-expiring", result.remaining <= 7);
        } catch (error) {
            codeElement.textContent = "Invalid secret";
            codeElement.dataset.rawCode = "";
            timeElement.textContent = "";
            barElement.style.width = "0";
        }
    }

    function startTotpRefresh(record) {
        stopTotpRefresh();
        updateTotpWidget(record);
        totpRefreshTimer = setInterval(() => updateTotpWidget(record), 1000);
    }

    function getWebsiteStatus(record) {
        if (record.twoFAEnabled === "yes") {
            const type = record.twoFAType || "none";

            if (type === "authenticator" && record.totpSecret) {
                return {
                    className: "status-good",
                    label: "2FA: Authenticator"
                };
            }

            if (type === "authenticator" && !record.totpSecret) {
                return {
                    className: "status-warning",
                    label: "Authenticator · Secret missing"
                };
            }

            if (type !== "none") {
                return {
                    className: type === "sms" ? "status-warning" : "status-good",
                    label: `2FA: ${twoFATypeNames[type] || "Enabled"}`
                };
            }

            return {
                className: "status-unknown",
                label: "2FA enabled · Method unknown"
            };
        }

        if (record.supports2FA === "yes" && record.twoFAEnabled === "no") {
            return {
                className: "status-warning",
                label: "Supports 2FA · Not enabled"
            };
        }

        if (record.supports2FA === "no") {
            return {
                className: "status-muted",
                label: "2FA not supported"
            };
        }

        return {
            className: "status-unknown",
            label: "2FA status unknown"
        };
    }

    function recordSearchText(record) {
        if (currentCategory === "websites") {
            return [
                record.siteName,
                record.url,
                record.loginId,
                record.emailUsed,
                record.notes,
                record.tags,
                record.twoFAType,
                record.twoFAEnabled,
                record.supports2FA
            ].join(" ").toLowerCase();
        }

        if (currentCategory === "cards") {
            return [
                record.cardNickname,
                record.cardholderName,
                record.cardNumber,
                record.issuingBank,
                record.loginWebsite,
                record.loginId,
                record.notes,
                record.tags
            ].join(" ").toLowerCase();
        }

        if (currentCategory === "banking") {
            return [
                record.bankName,
                record.accountNickname,
                record.accountType,
                record.website,
                record.loginId,
                record.emailUsed,
                record.notes,
                record.tags
            ].join(" ").toLowerCase();
        }

        return [
            record.title,
            record.category,
            record.contents,
            record.tags
        ].join(" ").toLowerCase();
    }

    function renderWebsiteRecord(record) {
        const status = getWebsiteStatus(record);

        return `
            <button class="record-item website-record" type="button" data-record-id="${escapeHtml(record.id)}">
                <span class="record-title">${escapeHtml(record.siteName || "Untitled Website")}</span>
                <span class="record-subtitle">${escapeHtml(record.loginId || record.emailUsed || record.url || "No login ID")}</span>
                <span class="record-meta ${status.className}">${escapeHtml(status.label)}</span>
                <span class="record-arrow" aria-hidden="true">›</span>
            </button>
        `;
    }

    function lastFour(value) {
        const digits = String(value || "").replace(/\D/g, "");
        return digits ? digits.slice(-4) : "";
    }

    function renderGenericRecord(record) {
        let title = "";
        let subtitle = "";
        let meta = "";

        if (currentCategory === "cards") {
            title = record.cardNickname || "Untitled Card";
            subtitle = record.issuingBank || record.cardholderName || "No issuing bank";
            meta = lastFour(record.cardNumber) ? `•••• ${lastFour(record.cardNumber)}` : "No card number";
        } else if (currentCategory === "banking") {
            title = record.accountNickname || record.bankName || "Untitled Account";
            subtitle = record.bankName || "No bank name";
            meta = record.accountType || "Account";
        } else {
            title = record.title || "Untitled Note";
            subtitle = record.category || "Secure Note";
            meta = record.modifiedAt ? `Updated ${formatDate(record.modifiedAt)}` : "";
        }

        return `
            <button class="record-item" type="button" data-record-id="${escapeHtml(record.id)}">
                <span class="record-title">${escapeHtml(title)}</span>
                <span class="record-subtitle">${escapeHtml(subtitle)}</span>
                <span class="record-meta">${escapeHtml(meta)}</span>
                <span class="record-arrow" aria-hidden="true">›</span>
            </button>
        `;
    }

    function paginateItems(items) {
        const totalItems = items.length;
        currentTotalPages = Math.max(1, Math.ceil(totalItems / pageSize));

        if (currentPage > currentTotalPages) {
            currentPage = currentTotalPages;
        }

        if (currentPage < 1) {
            currentPage = 1;
        }

        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = Math.min(startIndex + pageSize, totalItems);

        return {
            items: items.slice(startIndex, endIndex),
            totalItems,
            startIndex,
            endIndex
        };
    }

    function updatePagination(totalItems, startIndex, endIndex) {
        const showPagination = totalItems > 0;

        elements.paginationBar.classList.toggle("hidden", !showPagination);

        if (!showPagination) {
            return;
        }

        elements.paginationRange.textContent =
            `${(startIndex + 1).toLocaleString()}–${endIndex.toLocaleString()} of ${totalItems.toLocaleString()}`;

        elements.paginationPageText.textContent =
            `Page ${currentPage.toLocaleString()} of ${currentTotalPages.toLocaleString()}`;

        elements.firstPageButton.disabled = currentPage <= 1;
        elements.previousPageButton.disabled = currentPage <= 1;
        elements.nextPageButton.disabled = currentPage >= currentTotalPages;
        elements.lastPageButton.disabled = currentPage >= currentTotalPages;
    }

    function goToPage(page) {
        currentPage = Math.max(1, Math.min(Number(page) || 1, currentTotalPages));
        renderRecords();

        const panelTop = elements.recordList.getBoundingClientRect().top + window.scrollY - 100;
        window.scrollTo({ top: Math.max(0, panelTop), behavior: "smooth" });
    }

    function renderRecords() {
        if (!vaultData) {
            return;
        }

        const query = elements.searchInput.value.trim().toLowerCase();
        const globalSearch = elements.globalSearchToggle.checked && query.length > 0;

        if (globalSearch) {
            const allResults = getAllSearchResults(query);
            const page = paginateItems(allResults);
            const results = page.items;

            elements.categoryTitle.textContent =
                `Search Results (${allResults.length.toLocaleString()})`;

            elements.recordList.classList.toggle("comfortable", currentView === "comfortable");
            elements.recordList.innerHTML = results.map(({ category, record }) => `
                <button class="record-item global-search-record" type="button"
                        data-record-id="${escapeHtml(record.id)}"
                        data-record-category="${escapeHtml(category)}">
                    <span class="record-category-tile">${categoryIcon(category)}</span>
                    <span class="record-title">${escapeHtml(titleForRecord(category, record))}</span>
                    <span class="record-subtitle">${escapeHtml(subtitleForRecord(category, record))}</span>
                    <span class="record-meta">${escapeHtml(categoryLabel(category))}</span>
                    <span class="record-arrow" aria-hidden="true">›</span>
                </button>
            `).join("");

            elements.recordList.classList.toggle("hidden", allResults.length === 0);
            elements.emptyState.classList.toggle("hidden", allResults.length !== 0);
            updatePagination(page.totalItems, page.startIndex, page.endIndex);

            elements.recordList.querySelectorAll(".record-item").forEach((button) => {
                button.addEventListener("click", () => {
                    const category = button.dataset.recordCategory;
                    const record = vaultData.records[category].find(item => item.id === button.dataset.recordId);
                    if (!record) return;

                    currentCategory = category;
                    const radio = document.querySelector(`input[name="category"][value="${category}"]`);
                    if (radio) radio.checked = true;

                    document.querySelectorAll(".category-option").forEach(option => {
                        const optionRadio = option.querySelector("input");
                        option.classList.toggle("active", optionRadio.value === category);
                    });

                    if (category === "websites") showWebsiteRecord(record);
                    else if (category === "cards") showCardRecord(record);
                    else if (category === "banking") showBankRecord(record);
                    else showNoteRecord(record);
                });
            });

            return;
        }

        elements.categoryTitle.textContent = categoryNames[currentCategory];

        const sourceRecords = vaultData.records?.[currentCategory] || [];
        const filteredRecords = sourceRecords.filter(record =>
            recordSearchText(record).includes(query)
        );
        const page = paginateItems(filteredRecords);
        const records = page.items;

        elements.recordList.classList.toggle("comfortable", currentView === "comfortable");
        elements.recordList.innerHTML = records.map(record =>
            currentCategory === "websites"
                ? renderWebsiteRecord(record)
                : renderGenericRecord(record)
        ).join("");

        elements.recordList.classList.toggle("hidden", filteredRecords.length === 0);
        elements.emptyState.classList.toggle("hidden", filteredRecords.length !== 0);
        updatePagination(page.totalItems, page.startIndex, page.endIndex);

        elements.recordList.querySelectorAll(".record-item").forEach(button => {
            button.addEventListener("click", () => {
                const record = sourceRecords.find(item => item.id === button.dataset.recordId);

                if (!record) {
                    return;
                }

                if (currentCategory === "websites") {
                    showWebsiteRecord(record);
                } else if (currentCategory === "cards") {
                    showCardRecord(record);
                } else if (currentCategory === "banking") {
                    showBankRecord(record);
                } else {
                    showNoteRecord(record);
                }
            });
        });
    }

    function sensitiveRow(label, value, id, extraClass = "") {
        const hasValue = String(value || "").length > 0;

        return `
            <div class="detail-card ${extraClass}">
                <div class="detail-label">${escapeHtml(label)}</div>
                <div class="sensitive-detail-row">
                    <div id="${escapeHtml(id)}" class="detail-value ${hasValue ? "masked-value" : ""}" data-real-value="${escapeHtml(value)}">${hasValue ? "••••••••••••" : "Not entered"}</div>
                    ${hasValue ? `
                        <button class="inline-button reveal-detail" type="button" data-target="${escapeHtml(id)}">Show</button>
                        <button class="inline-button copy-detail" type="button" data-copy-value="${escapeHtml(value)}">Copy</button>
                    ` : ""}
                </div>
            </div>
        `;
    }

    function showWebsiteRecord(record) {
        activeRecordId = record.id;
        const status = getWebsiteStatus(record);

        const body = `
            <div class="website-detail-status ${status.className}">
                ${escapeHtml(status.label)}
            </div>

            <div class="detail-grid">
                <div class="detail-card">
                    <div class="detail-label">Website URL</div>
                    <div class="detail-value">
                        ${record.url ? `<a class="tpwm-link" href="${escapeHtml(safeUrl(record.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.url)}</a>` : "Not entered"}
                    </div>
                </div>

                <div class="detail-card">
                    <div class="detail-label">Login ID</div>
                    <div class="copy-value-row">
                        <div class="detail-value">${escapeHtml(record.loginId || "Not entered")}</div>
                        ${record.loginId ? `<button class="inline-button copy-detail" type="button" data-copy-value="${escapeHtml(record.loginId)}">Copy</button>` : ""}
                    </div>
                </div>

                ${sensitiveRow("Password", record.password || "", "websitePasswordDetail")}

                <div class="detail-card">
                    <div class="detail-label">Email Used</div>
                    <div class="copy-value-row">
                        <div class="detail-value">${escapeHtml(record.emailUsed || "Not entered")}</div>
                        ${record.emailUsed ? `<button class="inline-button copy-detail" type="button" data-copy-value="${escapeHtml(record.emailUsed)}">Copy</button>` : ""}
                    </div>
                </div>

                <div class="detail-card">
                    <div class="detail-label">Website Supports 2FA</div>
                    <div class="detail-value">${escapeHtml(record.supports2FA === "yes" ? "Yes" : record.supports2FA === "no" ? "No" : "Unknown")}</div>
                </div>

                <div class="detail-card">
                    <div class="detail-label">2FA Enabled on This Account</div>
                    <div class="detail-value">${escapeHtml(record.twoFAEnabled === "yes" ? "Yes" : record.twoFAEnabled === "no" ? "No" : "Unknown")}</div>
                </div>

                <div class="detail-card">
                    <div class="detail-label">2FA Type</div>
                    <div class="detail-value">${escapeHtml(twoFATypeNames[record.twoFAType] || "Not specified")}</div>
                </div>

                ${record.twoFAType === "authenticator" && record.totpSecret ? `
                    <div class="totp-display-card full">
                        <div class="totp-display-header">
                            <div>
                                <span class="detail-label">Current Authenticator Code</span>
                                <strong>${escapeHtml(record.totpIssuer || record.siteName || "")}</strong>
                                <small>${escapeHtml(record.totpAccount || record.loginId || "")}</small>
                            </div>
                            <span id="totpRemaining" class="totp-remaining"></span>
                        </div>

                        <button id="totpCurrentCode" class="totp-code-button" type="button" title="Copy current code">
                            Loading…
                        </button>

                        <div class="totp-countdown-track">
                            <div id="totpCountdownBar" class="totp-countdown-bar"></div>
                        </div>

                        <div class="totp-display-actions">
                            <span>${escapeHtml(record.totpDigits || 6)} digits · ${escapeHtml(record.totpPeriod || 30)} seconds · ${escapeHtml(record.totpAlgorithm || "SHA1")}</span>
                            <button id="copyTotpCodeButton" class="secondary-button" type="button">Copy Code</button>
                        </div>
                    </div>
                ` : ""}

                <div class="detail-card">
                    <div class="detail-label">2FA Email</div>
                    <div class="detail-value">${escapeHtml(record.twoFAEmail || "Not entered")}</div>
                </div>

                <div class="detail-card">
                    <div class="detail-label">2FA Phone</div>
                    <div class="detail-value">${escapeHtml(record.twoFAPhone || "Not entered")}</div>
                </div>

                <div class="detail-card">
                    <div class="detail-label">Security Key Name</div>
                    <div class="detail-value">${escapeHtml(record.securityKeyName || "Not entered")}</div>
                </div>

                ${record.totpSecret ? sensitiveRow("TOTP Secret", record.totpSecret, "websiteTotpDetail", "full") : ""}

                ${record.recoveryCodes ? sensitiveRow("Recovery Codes", record.recoveryCodes, "websiteRecoveryDetail", "full") : ""}

                <div class="detail-card full">
                    <div class="detail-label">Notes</div>
                    <div class="detail-value preserve-lines">${escapeHtml(record.notes || "No notes")}</div>
                </div>

                <div class="detail-card full">
                    <div class="detail-label">Tags</div>
                    <div class="detail-value">${escapeHtml(record.tags || "No tags")}</div>
                </div>

                <div class="detail-card">
                    <div class="detail-label">Created</div>
                    <div class="detail-value">${escapeHtml(formatDate(record.createdAt))}</div>
                </div>

                <div class="detail-card">
                    <div class="detail-label">Last Modified</div>
                    <div class="detail-value">${escapeHtml(formatDate(record.modifiedAt))}</div>
                </div>
            </div>
        `;

        openModal({
            eyebrow: "Website Record · Encrypted",
            title: record.siteName || "Website",
            body,
            footer: `
                <button class="secondary-button danger-text" type="button" data-modal-action="delete-website">Delete</button>
                <button class="secondary-button" type="button" data-modal-action="edit-website">Edit</button>
                <button class="primary-button" type="button" data-modal-action="close">Done</button>
            `
        });

        attachDetailActions();

        if (record.twoFAType === "authenticator" && record.totpSecret) {
            startTotpRefresh(record);

            const copyButton = document.getElementById("copyTotpCodeButton");
            const codeButton = document.getElementById("totpCurrentCode");

            const copyCurrentCode = async event => {
                const rawCode = document.getElementById("totpCurrentCode")?.dataset.rawCode || "";
                if (rawCode) await copyText(rawCode, event.currentTarget);
            };

            copyButton?.addEventListener("click", copyCurrentCode);
            codeButton?.addEventListener("click", copyCurrentCode);
        }
    }

    function detailValue(label, value, extraClass = "") {
        return `
            <div class="detail-card ${extraClass}">
                <div class="detail-label">${escapeHtml(label)}</div>
                <div class="detail-value">${escapeHtml(value || "Not entered")}</div>
            </div>
        `;
    }

    function copyValue(label, value, extraClass = "") {
        return `
            <div class="detail-card ${extraClass}">
                <div class="detail-label">${escapeHtml(label)}</div>
                <div class="copy-value-row">
                    <div class="detail-value">${escapeHtml(value || "Not entered")}</div>
                    ${value ? `<button class="inline-button copy-detail" type="button" data-copy-value="${escapeHtml(value)}">Copy</button>` : ""}
                </div>
            </div>
        `;
    }

    function showCardRecord(record) {
        activeRecordId = record.id;
        const expiration = [record.expMonth, record.expYear].filter(Boolean).join("/") || "Not entered";

        openModal({
            eyebrow: "Credit Card · Encrypted",
            title: record.cardNickname || "Credit Card",
            body: `
                <div class="detail-grid">
                    ${detailValue("Cardholder Name", record.cardholderName)}
                    ${detailValue("Issuing Bank", record.issuingBank)}
                    ${sensitiveRow("Card Number", record.cardNumber, "cardNumberDetail", "full")}
                    ${detailValue("Expiration", expiration)}
                    ${sensitiveRow("CVV", record.cvv, "cardCvvDetail")}
                    ${copyValue("Billing ZIP", record.billingZip)}
                    ${detailValue("Credit Limit", record.creditLimit)}
                    ${record.loginWebsite ? `
                        <div class="detail-card">
                            <div class="detail-label">Login Website</div>
                            <div class="detail-value"><a class="tpwm-link" href="${escapeHtml(safeUrl(record.loginWebsite))}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.loginWebsite)}</a></div>
                        </div>` : detailValue("Login Website", "")}
                    ${copyValue("Login ID", record.loginId)}
                    ${sensitiveRow("Login Password", record.password, "cardPasswordDetail")}
                    ${copyValue("Customer Service", record.customerService)}
                    ${detailValue("Notes", record.notes, "full preserve-lines")}
                    ${detailValue("Tags", record.tags, "full")}
                    ${detailValue("Created", formatDate(record.createdAt))}
                    ${detailValue("Last Modified", formatDate(record.modifiedAt))}
                </div>
            `,
            footer: `
                <button class="secondary-button danger-text" type="button" data-modal-action="delete-card">Delete</button>
                <button class="secondary-button" type="button" data-modal-action="edit-card">Edit</button>
                <button class="primary-button" type="button" data-modal-action="close">Done</button>
            `
        });

        attachDetailActions();
    }

    function showBankRecord(record) {
        activeRecordId = record.id;
        const status = record.twoFAEnabled === "yes"
            ? `2FA: ${twoFATypeNames[record.twoFAType] || "Enabled"}`
            : record.twoFAEnabled === "no" ? "2FA not enabled" : "2FA status unknown";

        openModal({
            eyebrow: "Bank Account · Encrypted",
            title: record.accountNickname || record.bankName || "Bank Account",
            body: `
                <div class="website-detail-status ${record.twoFAEnabled === "yes" ? "status-good" : record.twoFAEnabled === "no" ? "status-warning" : "status-unknown"}">
                    ${escapeHtml(status)}
                </div>
                <div class="detail-grid">
                    ${detailValue("Bank Name", record.bankName)}
                    ${detailValue("Account Nickname", record.accountNickname)}
                    ${detailValue("Account Type", record.accountType)}
                    ${sensitiveRow("Routing Number", record.routingNumber, "bankRoutingDetail")}
                    ${sensitiveRow("Account Number", record.accountNumber, "bankAccountDetail")}
                    ${record.website ? `
                        <div class="detail-card">
                            <div class="detail-label">Website</div>
                            <div class="detail-value"><a class="tpwm-link" href="${escapeHtml(safeUrl(record.website))}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.website)}</a></div>
                        </div>` : detailValue("Website", "")}
                    ${copyValue("Login ID", record.loginId)}
                    ${sensitiveRow("Password", record.password, "bankPasswordDetail")}
                    ${copyValue("Email Used", record.emailUsed)}
                    ${detailValue("2FA Enabled", record.twoFAEnabled === "yes" ? "Yes" : record.twoFAEnabled === "no" ? "No" : "Unknown")}
                    ${detailValue("2FA Type", twoFATypeNames[record.twoFAType] || "Not specified")}
                    ${copyValue("Phone Number", record.phoneNumber)}
                    ${copyValue("Customer Service", record.customerService)}
                    ${detailValue("Notes", record.notes, "full preserve-lines")}
                    ${detailValue("Tags", record.tags, "full")}
                    ${detailValue("Created", formatDate(record.createdAt))}
                    ${detailValue("Last Modified", formatDate(record.modifiedAt))}
                </div>
            `,
            footer: `
                <button class="secondary-button danger-text" type="button" data-modal-action="delete-bank">Delete</button>
                <button class="secondary-button" type="button" data-modal-action="edit-bank">Edit</button>
                <button class="primary-button" type="button" data-modal-action="close">Done</button>
            `
        });

        attachDetailActions();
    }

    function showNoteRecord(record) {
        activeRecordId = record.id;

        openModal({
            eyebrow: "Secure Note · Encrypted",
            title: record.title || "Secure Note",
            body: `
                <div class="detail-grid">
                    ${detailValue("Category", record.category)}
                    ${detailValue("Tags", record.tags)}
                    <div class="detail-card full">
                        <div class="detail-label">Contents</div>
                        <div class="detail-value preserve-lines">${escapeHtml(record.contents || "Empty note")}</div>
                    </div>
                    ${detailValue("Created", formatDate(record.createdAt))}
                    ${detailValue("Last Modified", formatDate(record.modifiedAt))}
                </div>
            `,
            footer: `
                <button class="secondary-button danger-text" type="button" data-modal-action="delete-note">Delete</button>
                <button class="secondary-button" type="button" data-modal-action="edit-note">Edit</button>
                <button class="primary-button" type="button" data-modal-action="close">Done</button>
            `
        });
    }

    function formValue(record, field, fallback = "") {
        return escapeHtml(record?.[field] ?? fallback);
    }

    function cardFormHtml(record = null) {
        return `
            <form id="cardRecordForm" class="record-form">
                <div class="form-section-heading">Card Information</div>
                <div class="form-two-column">
                    <label>Card Nickname *<input id="cardNickname" type="text" required value="${formValue(record, "cardNickname")}" placeholder="Example: Everyday Card"></label>
                    <label>Cardholder Name<input id="cardholderName" type="text" value="${formValue(record, "cardholderName")}"></label>
                </div>
                <label>Card Number<div class="input-action-row"><input id="cardNumber" type="password" inputmode="numeric" value="${formValue(record, "cardNumber")}"><button class="inline-button toggle-password" type="button" data-target="cardNumber">Show</button></div></label>
                <div class="form-three-column">
                    <label>Expiration Month<input id="cardExpMonth" type="text" inputmode="numeric" maxlength="2" value="${formValue(record, "expMonth")}" placeholder="MM"></label>
                    <label>Expiration Year<input id="cardExpYear" type="text" inputmode="numeric" maxlength="4" value="${formValue(record, "expYear")}" placeholder="YYYY"></label>
                    <label>CVV<div class="input-action-row"><input id="cardCvv" type="password" inputmode="numeric" maxlength="4" value="${formValue(record, "cvv")}"><button class="inline-button toggle-password" type="button" data-target="cardCvv">Show</button></div></label>
                </div>
                <div class="form-two-column">
                    <label>Billing ZIP<input id="cardBillingZip" type="text" value="${formValue(record, "billingZip")}"></label>
                    <label>Issuing Bank<input id="cardIssuingBank" type="text" value="${formValue(record, "issuingBank")}"></label>
                </div>
                <div class="form-section-heading">Online Account</div>
                <label>Login Website<input id="cardLoginWebsite" type="url" value="${formValue(record, "loginWebsite")}" placeholder="https://example.com"></label>
                <div class="form-two-column">
                    <label>Login ID<input id="cardLoginId" type="text" value="${formValue(record, "loginId")}"></label>
                    <label>Password<div class="input-action-row"><input id="cardLoginPassword" type="password" value="${formValue(record, "password")}"><button class="inline-button toggle-password" type="button" data-target="cardLoginPassword">Show</button></div></label>
                </div>
                <div class="form-two-column">
                    <label>Customer Service<input id="cardCustomerService" type="text" value="${formValue(record, "customerService")}"></label>
                    <label>Credit Limit<input id="cardCreditLimit" type="text" value="${formValue(record, "creditLimit")}" placeholder="Optional"></label>
                </div>
                <label>Notes<textarea id="cardNotes">${formValue(record, "notes")}</textarea></label>
                <label>Tags<input id="cardTags" type="text" value="${formValue(record, "tags")}"></label>
                <p id="cardFormMessage" class="form-note">The complete credit-card record is encrypted before being saved.</p>
            </form>
        `;
    }

    function bankFormHtml(record = null) {
        return `
            <form id="bankRecordForm" class="record-form">
                <div class="form-section-heading">Account Information</div>
                <div class="form-two-column">
                    <label>Bank Name *<input id="bankName" type="text" required value="${formValue(record, "bankName")}"></label>
                    <label>Account Nickname<input id="bankNickname" type="text" value="${formValue(record, "accountNickname")}" placeholder="Example: Primary Checking"></label>
                </div>
                <label>Account Type<select id="bankAccountType">
                    ${["Checking","Savings","Money Market","Certificate of Deposit","Loan","Investment","Other"].map(v => `<option value="${v}" ${record?.accountType === v ? "selected" : ""}>${v}</option>`).join("")}
                </select></label>
                <div class="form-two-column">
                    <label>Routing Number<div class="input-action-row"><input id="bankRouting" type="password" inputmode="numeric" value="${formValue(record, "routingNumber")}"><button class="inline-button toggle-password" type="button" data-target="bankRouting">Show</button></div></label>
                    <label>Account Number<div class="input-action-row"><input id="bankAccountNumber" type="password" value="${formValue(record, "accountNumber")}"><button class="inline-button toggle-password" type="button" data-target="bankAccountNumber">Show</button></div></label>
                </div>
                <div class="form-section-heading">Online Banking</div>
                <label>Website<input id="bankWebsite" type="url" value="${formValue(record, "website")}" placeholder="https://example.com"></label>
                <div class="form-two-column">
                    <label>Login ID<input id="bankLoginId" type="text" value="${formValue(record, "loginId")}"></label>
                    <label>Password<div class="input-action-row"><input id="bankPassword" type="password" value="${formValue(record, "password")}"><button class="inline-button toggle-password" type="button" data-target="bankPassword">Show</button></div></label>
                </div>
                <div class="form-two-column">
                    <label>Email Used<input id="bankEmail" type="email" value="${formValue(record, "emailUsed")}"></label>
                    <label>Phone Number<input id="bankPhone" type="text" value="${formValue(record, "phoneNumber")}"></label>
                </div>
                <div class="form-two-column">
                    <label>2FA Enabled<select id="bank2FAEnabled">
                        <option value="unknown" ${!record || record.twoFAEnabled === "unknown" ? "selected" : ""}>Unknown</option>
                        <option value="yes" ${record?.twoFAEnabled === "yes" ? "selected" : ""}>Yes</option>
                        <option value="no" ${record?.twoFAEnabled === "no" ? "selected" : ""}>No</option>
                    </select></label>
                    <label>2FA Type<select id="bank2FAType">
                        ${Object.entries(twoFATypeNames).map(([key, name]) => `<option value="${key}" ${record?.twoFAType === key || (!record && key === "none") ? "selected" : ""}>${name}</option>`).join("")}
                    </select></label>
                </div>
                <label>Customer Service<input id="bankCustomerService" type="text" value="${formValue(record, "customerService")}"></label>
                <label>Notes<textarea id="bankNotes">${formValue(record, "notes")}</textarea></label>
                <label>Tags<input id="bankTags" type="text" value="${formValue(record, "tags")}"></label>
                <p id="bankFormMessage" class="form-note">Routing, account, login, and other information is encrypted before saving.</p>
            </form>
        `;
    }

    function noteFormHtml(record = null) {
        return `
            <form id="noteRecordForm" class="record-form">
                <div class="form-two-column">
                    <label>Title *<input id="noteTitle" type="text" required value="${formValue(record, "title")}"></label>
                    <label>Category<input id="noteCategory" type="text" value="${formValue(record, "category")}" placeholder="Example: Recovery"></label>
                </div>
                <label>Contents<textarea id="noteContents" class="large-note-area" placeholder="Enter the secure note contents">${formValue(record, "contents")}</textarea></label>
                <label>Tags<input id="noteTags" type="text" value="${formValue(record, "tags")}"></label>
                <p id="noteFormMessage" class="form-note">The title, category, contents, and tags are stored inside the encrypted vault.</p>
            </form>
        `;
    }

    function showCardForm(record = null) {
        activeRecordId = record?.id || null;
        openModal({
            eyebrow: record ? "Edit Encrypted Card" : "New Encrypted Card",
            title: record?.cardNickname || "Add Credit Card",
            body: cardFormHtml(record),
            footer: `<button class="secondary-button" type="button" data-modal-action="close">Cancel</button><button class="primary-button" type="button" data-modal-action="save-card">${record ? "Save Changes" : "Add Card"}</button>`
        });
        attachPasswordToggles(elements.modalBody);
        document.getElementById("cardNickname").focus();
    }

    function showBankForm(record = null) {
        activeRecordId = record?.id || null;
        openModal({
            eyebrow: record ? "Edit Encrypted Bank Account" : "New Encrypted Bank Account",
            title: record?.accountNickname || record?.bankName || "Add Bank Account",
            body: bankFormHtml(record),
            footer: `<button class="secondary-button" type="button" data-modal-action="close">Cancel</button><button class="primary-button" type="button" data-modal-action="save-bank">${record ? "Save Changes" : "Add Account"}</button>`
        });
        attachPasswordToggles(elements.modalBody);
        document.getElementById("bankName").focus();
    }

    function showNoteForm(record = null) {
        activeRecordId = record?.id || null;
        openModal({
            eyebrow: record ? "Edit Encrypted Note" : "New Encrypted Note",
            title: record?.title || "Add Secure Note",
            body: noteFormHtml(record),
            footer: `<button class="secondary-button" type="button" data-modal-action="close">Cancel</button><button class="primary-button" type="button" data-modal-action="save-note">${record ? "Save Changes" : "Add Note"}</button>`
        });
        document.getElementById("noteTitle").focus();
    }

    function collectCardForm() {
        const name = document.getElementById("cardNickname").value.trim();
        if (!name) {
            const message = document.getElementById("cardFormMessage");
            message.textContent = "Card Nickname is required.";
            message.style.color = "var(--danger)";
            document.getElementById("cardNickname").focus();
            return null;
        }
        const existing = activeRecordId ? vaultData.records.cards.find(item => item.id === activeRecordId) : null;
        const now = new Date().toISOString();
        return {
            id: existing?.id || crypto.randomUUID(), recordType: "card", cardNickname: name,
            cardholderName: document.getElementById("cardholderName").value.trim(),
            cardNumber: document.getElementById("cardNumber").value.trim(),
            expMonth: document.getElementById("cardExpMonth").value.trim(),
            expYear: document.getElementById("cardExpYear").value.trim(),
            cvv: document.getElementById("cardCvv").value.trim(),
            billingZip: document.getElementById("cardBillingZip").value.trim(),
            issuingBank: document.getElementById("cardIssuingBank").value.trim(),
            loginWebsite: document.getElementById("cardLoginWebsite").value.trim(),
            loginId: document.getElementById("cardLoginId").value.trim(),
            password: document.getElementById("cardLoginPassword").value,
            customerService: document.getElementById("cardCustomerService").value.trim(),
            creditLimit: document.getElementById("cardCreditLimit").value.trim(),
            notes: document.getElementById("cardNotes").value.trim(),
            tags: document.getElementById("cardTags").value.trim(),
            createdAt: existing?.createdAt || now, modifiedAt: now
        };
    }

    function collectBankForm() {
        const name = document.getElementById("bankName").value.trim();
        if (!name) {
            const message = document.getElementById("bankFormMessage");
            message.textContent = "Bank Name is required.";
            message.style.color = "var(--danger)";
            document.getElementById("bankName").focus();
            return null;
        }
        const existing = activeRecordId ? vaultData.records.banking.find(item => item.id === activeRecordId) : null;
        const now = new Date().toISOString();
        return {
            id: existing?.id || crypto.randomUUID(), recordType: "bank", bankName: name,
            accountNickname: document.getElementById("bankNickname").value.trim(),
            accountType: document.getElementById("bankAccountType").value,
            routingNumber: document.getElementById("bankRouting").value.trim(),
            accountNumber: document.getElementById("bankAccountNumber").value.trim(),
            website: document.getElementById("bankWebsite").value.trim(),
            loginId: document.getElementById("bankLoginId").value.trim(),
            password: document.getElementById("bankPassword").value,
            emailUsed: document.getElementById("bankEmail").value.trim(),
            twoFAEnabled: document.getElementById("bank2FAEnabled").value,
            twoFAType: document.getElementById("bank2FAType").value,
            phoneNumber: document.getElementById("bankPhone").value.trim(),
            customerService: document.getElementById("bankCustomerService").value.trim(),
            notes: document.getElementById("bankNotes").value.trim(),
            tags: document.getElementById("bankTags").value.trim(),
            createdAt: existing?.createdAt || now, modifiedAt: now
        };
    }

    function collectNoteForm() {
        const title = document.getElementById("noteTitle").value.trim();
        if (!title) {
            const message = document.getElementById("noteFormMessage");
            message.textContent = "Title is required.";
            message.style.color = "var(--danger)";
            document.getElementById("noteTitle").focus();
            return null;
        }
        const existing = activeRecordId ? vaultData.records.notes.find(item => item.id === activeRecordId) : null;
        const now = new Date().toISOString();
        return {
            id: existing?.id || crypto.randomUUID(), recordType: "note", title,
            category: document.getElementById("noteCategory").value.trim(),
            contents: document.getElementById("noteContents").value,
            tags: document.getElementById("noteTags").value.trim(),
            createdAt: existing?.createdAt || now, modifiedAt: now
        };
    }

    async function saveTypedRecord(type, record, messageId, buttonAction, singular) {
        if (!record) return;
        const collection = type === "card" ? "cards" : type === "bank" ? "banking" : "notes";
        const button = elements.modalFooter.querySelector(`[data-modal-action="${buttonAction}"]`);
        const records = vaultData.records[collection];
        const index = records.findIndex(item => item.id === record.id);
        const previous = index >= 0 ? records[index] : null;
        button.disabled = true;
        button.textContent = "Encrypting...";
        if (index >= 0) records[index] = record; else records.unshift(record);
        try {
            await window.TPWMVault.saveData(vaultData);
            updateCategoryCounts();
            renderRecords();
            elements.statusText.textContent = `${singular} ${index >= 0 ? "updated" : "added"} and encrypted`;
            closeModal();
        } catch (error) {
            if (index >= 0) records[index] = previous; else records.shift();
            const message = document.getElementById(messageId);
            message.textContent = `Unable to save: ${error.message}`;
            message.style.color = "var(--danger)";
            button.disabled = false;
            button.textContent = index >= 0 ? "Save Changes" : `Add ${singular}`;
        }
    }

    async function deleteTypedRecord(collection, singular) {
        const record = vaultData.records[collection].find(item => item.id === activeRecordId);
        if (!record) return;
        const title = record.cardNickname || record.accountNickname || record.bankName || record.title || singular;
        if (!window.confirm(`Delete "${title}"?\n\nThis removes it from the encrypted vault.`)) return;
        const previous = [...vaultData.records[collection]];
        vaultData.records[collection] = previous.filter(item => item.id !== activeRecordId);
        try {
            await window.TPWMVault.saveData(vaultData);
            updateCategoryCounts();
            renderRecords();
            elements.statusText.textContent = `${singular} deleted`;
            closeModal();
        } catch (error) {
            vaultData.records[collection] = previous;
            window.alert(`Unable to delete: ${error.message}`);
        }
    }

    function websiteFormHtml(record = null) {
        const value = (field, fallback = "") => escapeHtml(record?.[field] ?? fallback);

        return `
            <form id="websiteRecordForm" class="record-form website-form">
                <div class="form-section-heading">Website Login</div>

                <div class="form-two-column">
                    <label>
                        Site Name *
                        <input id="siteName" type="text" required value="${value("siteName")}" placeholder="Example: Proton Mail">
                    </label>

                    <label>
                        Website URL
                        <input id="siteUrl" type="url" value="${value("url")}" placeholder="https://example.com">
                    </label>
                </div>

                <div class="form-two-column">
                    <label>
                        Login ID / Username
                        <input id="siteLoginId" type="text" value="${value("loginId")}" placeholder="Username or account ID">
                    </label>

                    <label>
                        Email Used
                        <input id="siteEmailUsed" type="email" value="${value("emailUsed")}" placeholder="Email associated with account">
                    </label>
                </div>

                <label>
                    Password
                    <div class="input-action-row">
                        <input id="sitePassword" type="password" value="${value("password")}" placeholder="Enter password">
                        <button class="inline-button toggle-password" type="button" data-target="sitePassword">Show</button>
                    </div>
                </label>

                <div class="form-section-heading">Two-Factor Authentication</div>

                <div class="form-two-column">
                    <label>
                        Does This Website Support 2FA?
                        <select id="siteSupports2FA">
                            <option value="unknown" ${record?.supports2FA === "unknown" || !record ? "selected" : ""}>Unknown</option>
                            <option value="yes" ${record?.supports2FA === "yes" ? "selected" : ""}>Yes</option>
                            <option value="no" ${record?.supports2FA === "no" ? "selected" : ""}>No</option>
                        </select>
                    </label>

                    <label>
                        Is 2FA Enabled on This Account?
                        <select id="site2FAEnabled">
                            <option value="unknown" ${record?.twoFAEnabled === "unknown" || !record ? "selected" : ""}>Unknown</option>
                            <option value="yes" ${record?.twoFAEnabled === "yes" ? "selected" : ""}>Yes</option>
                            <option value="no" ${record?.twoFAEnabled === "no" ? "selected" : ""}>No</option>
                        </select>
                    </label>
                </div>

                <label>
                    2FA Type
                    <select id="site2FAType">
                        <option value="none" ${record?.twoFAType === "none" || !record ? "selected" : ""}>Not specified</option>
                        <option value="authenticator" ${record?.twoFAType === "authenticator" ? "selected" : ""}>Authenticator App</option>
                        <option value="email" ${record?.twoFAType === "email" ? "selected" : ""}>Email</option>
                        <option value="sms" ${record?.twoFAType === "sms" ? "selected" : ""}>SMS</option>
                        <option value="securityKey" ${record?.twoFAType === "securityKey" ? "selected" : ""}>Security Key</option>
                        <option value="passkey" ${record?.twoFAType === "passkey" ? "selected" : ""}>Passkey</option>
                        <option value="backupCodes" ${record?.twoFAType === "backupCodes" ? "selected" : ""}>Backup Codes</option>
                        <option value="other" ${record?.twoFAType === "other" ? "selected" : ""}>Other</option>
                    </select>
                </label>

                <div id="totpSettingsPanel" class="totp-settings-panel">
                    <div class="totp-settings-heading">
                        <div>
                            <strong>Authenticator Setup</strong>
                            <small>Paste an otpauth link, scan a QR image, or enter the secret manually.</small>
                        </div>
                        <span class="totp-mini-badge">TOTP</span>
                    </div>

                    <label>
                        otpauth:// Link
                        <div class="input-action-row">
                            <input id="siteOtpAuthUri" type="text" placeholder="otpauth://totp/...">
                            <button id="applyOtpAuthButton" class="inline-button" type="button">Apply</button>
                        </div>
                    </label>

                    <button id="readQrImageButton" class="secondary-button" type="button">
                        Read QR Code Image
                    </button>

                    <div class="form-two-column">
                        <label>
                            Issuer
                            <input id="siteTotpIssuer" type="text" value="${value("totpIssuer")}" placeholder="Example: Facebook">
                        </label>
                        <label>
                            Account
                            <input id="siteTotpAccount" type="text" value="${value("totpAccount")}" placeholder="Email or username">
                        </label>
                    </div>

                    <div class="form-three-column">
                        <label>
                            Digits
                            <select id="siteTotpDigits">
                                <option value="6" ${Number(record?.totpDigits || 6) === 6 ? "selected" : ""}>6 digits</option>
                                <option value="8" ${Number(record?.totpDigits) === 8 ? "selected" : ""}>8 digits</option>
                            </select>
                        </label>
                        <label>
                            Period
                            <select id="siteTotpPeriod">
                                <option value="15" ${Number(record?.totpPeriod) === 15 ? "selected" : ""}>15 seconds</option>
                                <option value="30" ${Number(record?.totpPeriod || 30) === 30 ? "selected" : ""}>30 seconds</option>
                                <option value="60" ${Number(record?.totpPeriod) === 60 ? "selected" : ""}>60 seconds</option>
                            </select>
                        </label>
                        <label>
                            Algorithm
                            <select id="siteTotpAlgorithm">
                                <option value="SHA1" ${(record?.totpAlgorithm || "SHA1") === "SHA1" ? "selected" : ""}>SHA-1</option>
                                <option value="SHA256" ${record?.totpAlgorithm === "SHA256" ? "selected" : ""}>SHA-256</option>
                                <option value="SHA512" ${record?.totpAlgorithm === "SHA512" ? "selected" : ""}>SHA-512</option>
                            </select>
                        </label>
                    </div>

                    <div id="totpPreviewCard" class="totp-preview-card">
                        <span>Preview</span>
                        <strong id="totpPreviewCode">Enter a secret</strong>
                        <small id="totpPreviewStatus">The code will update automatically.</small>
                    </div>
                </div>

                <div class="form-two-column">
                    <label>
                        TOTP Secret
                        <div class="input-action-row">
                            <input id="siteTotpSecret" type="password" value="${value("totpSecret")}" placeholder="Optional authenticator secret">
                            <button class="inline-button toggle-password" type="button" data-target="siteTotpSecret">Show</button>
                        </div>
                    </label>

                    <label>
                        Security Key Name
                        <input id="siteSecurityKeyName" type="text" value="${value("securityKeyName")}" placeholder="Example: YubiKey 5">
                    </label>
                </div>

                <div class="form-two-column">
                    <label>
                        2FA Email
                        <input id="site2FAEmail" type="email" value="${value("twoFAEmail")}" placeholder="Email receiving codes">
                    </label>

                    <label>
                        2FA Phone
                        <input id="site2FAPhone" type="text" value="${value("twoFAPhone")}" placeholder="Phone receiving codes">
                    </label>
                </div>

                <label>
                    Recovery Codes
                    <textarea id="siteRecoveryCodes" placeholder="One recovery code per line">${value("recoveryCodes")}</textarea>
                </label>

                <div class="form-section-heading">Additional Information</div>

                <label>
                    Notes
                    <textarea id="siteNotes" placeholder="Optional notes">${value("notes")}</textarea>
                </label>

                <label>
                    Tags
                    <input id="siteTags" type="text" value="${value("tags")}" placeholder="Example: email, personal, work">
                </label>

                <p id="websiteFormMessage" class="form-note">
                    All fields in this website record are encrypted before the vault is saved to IndexedDB.
                </p>
            </form>
        `;
    }

    function showWebsiteForm(record = null) {
        activeRecordId = record?.id || null;

        openModal({
            eyebrow: record ? "Edit Encrypted Website" : "New Encrypted Website",
            title: record ? record.siteName : "Add Website",
            body: websiteFormHtml(record),
            footer: `
                <button class="secondary-button" type="button" data-modal-action="close">Cancel</button>
                <button class="primary-button" type="button" data-modal-action="save-website">${record ? "Save Changes" : "Add Website"}</button>
            `
        });

        attachPasswordToggles(elements.modalBody);

        const typeSelect = document.getElementById("site2FAType");
        const enabledSelect = document.getElementById("site2FAEnabled");
        const supportsSelect = document.getElementById("siteSupports2FA");
        const panel = document.getElementById("totpSettingsPanel");
        const secretInput = document.getElementById("siteTotpSecret");

        const updatePanelVisibility = () => {
            const authenticator = typeSelect.value === "authenticator";
            panel.classList.toggle("hidden", !authenticator);

            if (authenticator) {
                supportsSelect.value = "yes";
                enabledSelect.value = "yes";
            }
        };

        const updatePreview = async () => {
            const code = document.getElementById("totpPreviewCode");
            const status = document.getElementById("totpPreviewStatus");
            const secret = secretInput.value;

            if (!secret) {
                code.textContent = "Enter a secret";
                status.textContent = "The code will update automatically.";
                return;
            }

            try {
                const result = await generateTotp(secret, {
                    digits: Number(document.getElementById("siteTotpDigits").value),
                    period: Number(document.getElementById("siteTotpPeriod").value),
                    algorithm: document.getElementById("siteTotpAlgorithm").value
                });
                code.textContent = formatTotpCode(result.code);
                status.textContent = `${result.remaining} seconds remaining`;
            } catch (error) {
                code.textContent = "Invalid secret";
                status.textContent = error.message;
            }
        };

        const applyOtpUri = () => {
            const message = document.getElementById("websiteFormMessage");

            try {
                const parsed = parseOtpAuthUri(document.getElementById("siteOtpAuthUri").value);
                secretInput.value = parsed.secret;
                document.getElementById("siteTotpIssuer").value = parsed.issuer;
                document.getElementById("siteTotpAccount").value = parsed.account;
                document.getElementById("siteTotpDigits").value = String(parsed.digits);
                document.getElementById("siteTotpPeriod").value = String(parsed.period);
                document.getElementById("siteTotpAlgorithm").value = parsed.algorithm;
                typeSelect.value = "authenticator";
                supportsSelect.value = "yes";
                enabledSelect.value = "yes";
                updatePanelVisibility();
                updatePreview();
                message.textContent = "Authenticator information imported successfully.";
                message.style.color = "var(--accent)";
            } catch (error) {
                message.textContent = error.message;
                message.style.color = "var(--danger)";
            }
        };

        typeSelect.addEventListener("change", updatePanelVisibility);
        document.getElementById("applyOtpAuthButton").addEventListener("click", applyOtpUri);
        document.getElementById("readQrImageButton").addEventListener("click", () => {
            pendingQrTarget = "website";
            elements.totpQrFileInput.click();
        });

        [
            secretInput,
            document.getElementById("siteTotpDigits"),
            document.getElementById("siteTotpPeriod"),
            document.getElementById("siteTotpAlgorithm")
        ].forEach(control => control.addEventListener("input", updatePreview));

        updatePanelVisibility();
        updatePreview();

        if (totpRefreshTimer) clearInterval(totpRefreshTimer);
        totpRefreshTimer = setInterval(updatePreview, 1000);

        document.getElementById("siteName").focus();
    }

    function showAddRecord() {
        if (currentCategory === "websites") {
            showWebsiteForm();
        } else if (currentCategory === "cards") {
            showCardForm();
        } else if (currentCategory === "banking") {
            showBankForm();
        } else {
            showNoteForm();
        }
    }

    function collectWebsiteForm() {
        const formMessage = document.getElementById("websiteFormMessage");
        const siteName = document.getElementById("siteName").value.trim();

        if (!siteName) {
            formMessage.textContent = "Site Name is required.";
            formMessage.style.color = "var(--danger)";
            document.getElementById("siteName").focus();
            return null;
        }

        const now = new Date().toISOString();
        const existing = activeRecordId
            ? vaultData.records.websites.find((record) => record.id === activeRecordId)
            : null;

        return {
            id: existing?.id || crypto.randomUUID(),
            recordType: "website",
            siteName,
            url: document.getElementById("siteUrl").value.trim(),
            loginId: document.getElementById("siteLoginId").value.trim(),
            password: document.getElementById("sitePassword").value,
            emailUsed: document.getElementById("siteEmailUsed").value.trim(),
            supports2FA: document.getElementById("siteSupports2FA").value,
            twoFAEnabled: document.getElementById("site2FAEnabled").value,
            twoFAType: document.getElementById("site2FAType").value,
            totpSecret: normalizeBase32(document.getElementById("siteTotpSecret").value),
            totpIssuer: document.getElementById("siteTotpIssuer").value.trim(),
            totpAccount: document.getElementById("siteTotpAccount").value.trim(),
            totpDigits: Number(document.getElementById("siteTotpDigits").value) || 6,
            totpPeriod: Number(document.getElementById("siteTotpPeriod").value) || 30,
            totpAlgorithm: document.getElementById("siteTotpAlgorithm").value,
            twoFAEmail: document.getElementById("site2FAEmail").value.trim(),
            twoFAPhone: document.getElementById("site2FAPhone").value.trim(),
            recoveryCodes: document.getElementById("siteRecoveryCodes").value.trim(),
            securityKeyName: document.getElementById("siteSecurityKeyName").value.trim(),
            notes: document.getElementById("siteNotes").value.trim(),
            tags: document.getElementById("siteTags").value.trim(),
            createdAt: existing?.createdAt || now,
            modifiedAt: now
        };
    }

    async function saveWebsite() {
        const record = collectWebsiteForm();

        if (!record) {
            return;
        }

        const saveButton = elements.modalFooter.querySelector('[data-modal-action="save-website"]');
        saveButton.disabled = true;
        saveButton.textContent = "Encrypting...";

        const index = vaultData.records.websites.findIndex((item) => item.id === record.id);

        if (index >= 0) {
            vaultData.records.websites[index] = record;
        } else {
            vaultData.records.websites.unshift(record);
        }

        try {
            await window.TPWMVault.saveData(vaultData);
            updateCategoryCounts();
            renderRecords();
            elements.statusText.textContent = index >= 0
                ? `Website updated and encrypted: ${record.siteName}`
                : `Website added and encrypted: ${record.siteName}`;
            closeModal();
        } catch (error) {
            const formMessage = document.getElementById("websiteFormMessage");
            formMessage.textContent = `Unable to save: ${error.message}`;
            formMessage.style.color = "var(--danger)";
            saveButton.disabled = false;
            saveButton.textContent = index >= 0 ? "Save Changes" : "Add Website";
        }
    }

    async function deleteWebsite() {
        const record = vaultData.records.websites.find((item) => item.id === activeRecordId);

        if (!record) {
            return;
        }

        const confirmed = window.confirm(`Delete "${record.siteName}"?\n\nThis removes the record from the encrypted vault.`);

        if (!confirmed) {
            return;
        }

        const originalRecords = [...vaultData.records.websites];
        vaultData.records.websites = vaultData.records.websites.filter((item) => item.id !== activeRecordId);

        try {
            await window.TPWMVault.saveData(vaultData);
            updateCategoryCounts();
            renderRecords();
            elements.statusText.textContent = `Website deleted: ${record.siteName}`;
            closeModal();
        } catch (error) {
            vaultData.records.websites = originalRecords;
            window.alert(`Unable to delete the website: ${error.message}`);
        }
    }

    function secureRandomInt(maxExclusive) {
        const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
        const values = new Uint32Array(1);
        let value;

        do {
            crypto.getRandomValues(values);
            value = values[0];
        } while (value >= limit);

        return value % maxExclusive;
    }

    function shuffleSecure(characters) {
        const result = [...characters];

        for (let index = result.length - 1; index > 0; index -= 1) {
            const swapIndex = secureRandomInt(index + 1);
            [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
        }

        return result;
    }

    function generatorOptions() {
        return {
            length: Math.max(4, Math.min(128, Number(document.getElementById("generatorLength").value) || 20)),
            lowercase: document.getElementById("generatorLower").checked,
            uppercase: document.getElementById("generatorUpper").checked,
            numbers: document.getElementById("generatorNumbers").checked,
            symbols: document.getElementById("generatorSymbols").checked,
            excludeAmbiguous: document.getElementById("generatorAmbiguous").checked
        };
    }

    function generatorSets(options) {
        let lowercase = "abcdefghijklmnopqrstuvwxyz";
        let uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let numbers = "0123456789";
        let symbols = "!@#$%^&*()-_=+[]{};:,.?";

        if (options.excludeAmbiguous) {
            const ambiguous = new Set(["I", "l", "1", "O", "0", "o", "|", "`", "'", "\""]);
            const clean = text => [...text].filter(character => !ambiguous.has(character)).join("");
            lowercase = clean(lowercase);
            uppercase = clean(uppercase);
            numbers = clean(numbers);
            symbols = clean(symbols);
        }

        const sets = [];
        if (options.lowercase) sets.push(lowercase);
        if (options.uppercase) sets.push(uppercase);
        if (options.numbers) sets.push(numbers);
        if (options.symbols) sets.push(symbols);
        return sets;
    }

    function generateSecurePassword() {
        const options = generatorOptions();
        const sets = generatorSets(options);

        if (sets.length === 0) {
            throw new Error("Select at least one character type.");
        }

        if (options.length < sets.length) {
            throw new Error(`Length must be at least ${sets.length}.`);
        }

        const pool = sets.join("");
        const characters = sets.map(set => set[secureRandomInt(set.length)]);

        while (characters.length < options.length) {
            characters.push(pool[secureRandomInt(pool.length)]);
        }

        return shuffleSecure(characters).join("");
    }

    function generatorEntropy() {
        const options = generatorOptions();
        const poolSize = generatorSets(options).reduce((total, set) => total + set.length, 0);
        return poolSize ? Math.round(options.length * Math.log2(poolSize)) : 0;
    }

    function updateGeneratorDisplay(password) {
        const entropy = generatorEntropy();
        const output = document.getElementById("generatedPassword");
        const bar = document.getElementById("generatorStrengthBar");
        const label = document.getElementById("generatorStrengthLabel");
        const entropyText = document.getElementById("generatorEntropy");
        const lengthBadge = document.getElementById("generatorLengthBadge");

        let strength = "Weak";
        let className = "strength-weak";
        let width = 22;

        if (entropy >= 100) {
            strength = "Excellent";
            className = "strength-excellent";
            width = 100;
        } else if (entropy >= 75) {
            strength = "Strong";
            className = "strength-strong";
            width = 78;
        } else if (entropy >= 50) {
            strength = "Good";
            className = "strength-good";
            width = 56;
        }

        output.value = password;
        bar.className = `generator-strength-bar ${className}`;
        bar.style.width = `${width}%`;
        label.className = `generator-strength-label ${className}`;
        label.textContent = strength;
        entropyText.textContent = `${entropy} bits`;
        lengthBadge.textContent = `${generatorOptions().length} characters`;

        const card = document.querySelector(".generator-output-card");
        card.classList.remove("generator-flash");
        void card.offsetWidth;
        card.classList.add("generator-flash");
    }

    function runPasswordGenerator() {
        const message = document.getElementById("generatorMessage");

        try {
            const password = generateSecurePassword();
            updateGeneratorDisplay(password);
            message.textContent = "Generated locally with crypto.getRandomValues.";
            message.style.color = "";
            return password;
        } catch (error) {
            message.textContent = error.message;
            message.style.color = "var(--danger)";
            return "";
        }
    }

    function findOpenPasswordInput() {
        return document.querySelector("#sitePassword, #cardLoginPassword, #bankPassword");
    }

    function showPasswordGenerator() {
        const targetInput = findOpenPasswordInput();

        openModal({
            eyebrow: "Secure Generator",
            title: "Password Generator",
            body: `
                <div class="generator-shell">
                    <div class="generator-hero">
                        <div class="generator-lock-mark">◆</div>
                        <div>
                            <div class="generator-hero-title">Create a strong password</div>
                            <div class="generator-hero-subtitle">Generated locally with the browser cryptography API</div>
                        </div>
                    </div>

                    <div class="generator-output-card">
                        <div class="generator-output-topline">
                            <span id="generatorLengthBadge" class="generator-badge">20 characters</span>
                            <span id="generatorEntropy" class="generator-entropy">0 bits</span>
                        </div>

                        <div class="generated-output generator-main-output">
                            <input id="generatedPassword" type="text" readonly spellcheck="false">
                            <button id="copyGeneratedButton" class="secondary-button generator-copy-button" type="button">Copy</button>
                        </div>

                        <div class="generator-strength-track">
                            <div id="generatorStrengthBar" class="generator-strength-bar"></div>
                        </div>

                        <div class="generator-strength-row">
                            <span>Strength</span>
                            <strong id="generatorStrengthLabel" class="generator-strength-label">Weak</strong>
                        </div>
                    </div>

                    <div class="generator-control-card">
                        <div class="generator-control-header">
                            <span>Password Length</span>
                            <input id="generatorLength" class="generator-number-input" type="number" min="4" max="128" value="20">
                        </div>
                        <input id="generatorLengthSlider" class="generator-slider" type="range" min="4" max="64" value="20">
                        <div class="generator-length-scale"><span>4</span><span>32</span><span>64</span></div>
                    </div>

                    <div class="generator-options-grid">
                        <label class="generator-option active">
                            <input id="generatorLower" type="checkbox" checked>
                            <span class="generator-option-icon">a</span>
                            <span><strong>Lowercase</strong><small>a–z</small></span>
                        </label>
                        <label class="generator-option active">
                            <input id="generatorUpper" type="checkbox" checked>
                            <span class="generator-option-icon">A</span>
                            <span><strong>Uppercase</strong><small>A–Z</small></span>
                        </label>
                        <label class="generator-option active">
                            <input id="generatorNumbers" type="checkbox" checked>
                            <span class="generator-option-icon">7</span>
                            <span><strong>Numbers</strong><small>0–9</small></span>
                        </label>
                        <label class="generator-option">
                            <input id="generatorSymbols" type="checkbox">
                            <span class="generator-option-icon">#</span>
                            <span><strong>Symbols</strong><small>! @ # $</small></span>
                        </label>
                    </div>

                    <label class="generator-ambiguous-option">
                        <input id="generatorAmbiguous" type="checkbox" checked>
                        <span><strong>Exclude confusing characters</strong><small>Removes I, l, 1, O, and 0</small></span>
                    </label>

                    <p id="generatorMessage" class="form-note">Passwords never leave this device.</p>
                </div>
            `,
            footer: `
                <button class="secondary-button" type="button" data-modal-action="close">Close</button>
                ${targetInput ? `<button class="secondary-button" type="button" data-modal-action="use-generated">Use in Record</button>` : ""}
                <button class="primary-button generator-generate-button" type="button" data-modal-action="generate-password">Generate Password</button>
            `
        });

        const lengthInput = document.getElementById("generatorLength");
        const slider = document.getElementById("generatorLengthSlider");

        lengthInput.addEventListener("input", () => {
            const value = Math.max(4, Math.min(128, Number(lengthInput.value) || 20));
            lengthInput.value = value;
            slider.value = Math.min(64, value);
            runPasswordGenerator();
        });

        slider.addEventListener("input", () => {
            lengthInput.value = slider.value;
            runPasswordGenerator();
        });

        elements.modalBody.querySelectorAll('.generator-option input, #generatorAmbiguous').forEach(input => {
            input.addEventListener("change", () => {
                const option = input.closest(".generator-option");
                if (option) {
                    option.classList.toggle("active", input.checked);
                }
                runPasswordGenerator();
            });
        });

        document.getElementById("copyGeneratedButton").addEventListener("click", async event => {
            await copyText(document.getElementById("generatedPassword").value, event.currentTarget);
        });

        runPasswordGenerator();
    }


    function parseCsvText(text) {
        const rows = [];
        let row = [];
        let field = "";
        let quoted = false;

        for (let index = 0; index < text.length; index += 1) {
            const character = text[index];

            if (quoted) {
                if (character === '"') {
                    if (text[index + 1] === '"') {
                        field += '"';
                        index += 1;
                    } else {
                        quoted = false;
                    }
                } else {
                    field += character;
                }
            } else if (character === '"') {
                quoted = true;
            } else if (character === ",") {
                row.push(field);
                field = "";
            } else if (character === "\n") {
                row.push(field.replace(/\r$/, ""));
                rows.push(row);
                row = [];
                field = "";
            } else {
                field += character;
            }
        }

        row.push(field.replace(/\r$/, ""));
        if (row.some(value => value.length > 0)) rows.push(row);
        if (!rows.length) throw new Error("The CSV file is empty.");

        const headers = rows[0].map((header, index) =>
            String(header || "").replace(/^\uFEFF/, "").trim() || `Column ${index + 1}`
        );

        const dataRows = rows.slice(1)
            .filter(values => values.some(value => String(value).trim() !== ""))
            .map(values => {
                const item = {};
                headers.forEach((header, index) => item[header] = values[index] ?? "");
                return item;
            });

        return { headers, rows: dataRows };
    }

    function detectCsvMapping(headers) {
        const normalized = new Map(headers.map(header => [
            String(header).toLowerCase().replace(/[^a-z0-9]/g, ""),
            header
        ]));

        const find = aliases => aliases.find(alias => normalized.has(alias))
            ? normalized.get(aliases.find(alias => normalized.has(alias)))
            : "";

        return {
            name: find(["name", "title", "sitename", "website", "hostname"]),
            url: find(["url", "origin", "websiteurl", "loginuri", "uri"]),
            username: find(["username", "loginusername", "userid", "loginid", "user"]),
            password: find(["password", "loginpassword", "pass"]),
            notes: find(["notes", "note", "comment", "comments", "extra"]),
            otp: find(["otp", "totp", "otpauth", "totpsecret"])
        };
    }

    function csvColumnOptions(headers, selected) {
        return `<option value="">— Not mapped —</option>` +
            headers.map(header =>
                `<option value="${escapeHtml(header)}" ${header === selected ? "selected" : ""}>${escapeHtml(header)}</option>`
            ).join("");
    }

    function csvValue(row, column) {
        return column ? String(row[column] ?? "").trim() : "";
    }

    function siteNameFromUrl(url) {
        try {
            return new URL(safeUrl(url)).hostname.replace(/^www\./i, "") || url;
        } catch {
            return url || "Imported Website";
        }
    }

    function csvSignature(record) {
        return [
            String(record.url || "").trim().toLowerCase(),
            String(record.loginId || "").trim().toLowerCase(),
            String(record.password || "")
        ].join("|");
    }

    function buildCsvPreview() {
        if (!pendingCsvData) return;

        const mapping = {
            name: document.getElementById("csvMapName").value,
            url: document.getElementById("csvMapUrl").value,
            username: document.getElementById("csvMapUsername").value,
            password: document.getElementById("csvMapPassword").value
        };

        const importable = pendingCsvData.rows.filter(row =>
            csvValue(row, mapping.url) ||
            csvValue(row, mapping.name) ||
            csvValue(row, mapping.username)
        ).length;

        document.getElementById("csvImportableCount").textContent =
            `${importable.toLocaleString()} importable record${importable === 1 ? "" : "s"}`;

        document.getElementById("csvPreviewBody").innerHTML =
            pendingCsvData.rows.slice(0, 5).map(row => {
                const url = csvValue(row, mapping.url);
                const name = csvValue(row, mapping.name) || siteNameFromUrl(url);
                const username = csvValue(row, mapping.username);
                const password = csvValue(row, mapping.password);

                return `<tr>
                    <td>${escapeHtml(name)}</td>
                    <td>${escapeHtml(username || "—")}</td>
                    <td>${password ? "••••••••" : "—"}</td>
                </tr>`;
            }).join("");
    }

    function showCsvPasteDialog() {
        pendingCsvData = null;

        openModal({
            eyebrow: "Browser Password Transfer",
            title: "Paste Browser Password CSV",
            body: `
                <div class="csv-import-shell">
                    <div class="csv-security-warning">
                        Browser password exports are plaintext. Paste the CSV contents below, import them, then clear the clipboard and securely delete any exported CSV file.
                    </div>

                    <label>
                        Paste CSV Data
                        <textarea id="csvPasteText" class="csv-paste-area" spellcheck="false"
                            placeholder="Example:&#10;url,username,password&#10;https://example.com,user@example.com,MyPassword"></textarea>
                    </label>

                    <div class="csv-paste-actions">
                        <button id="readClipboardCsvButton" class="secondary-button" type="button">
                            Paste from Clipboard
                        </button>
                        <button id="analyzeCsvTextButton" class="primary-button" type="button">
                            Analyze CSV
                        </button>
                    </div>

                    <p id="csvPasteMessage" class="form-note">
                        TPWM will detect Firefox, Chrome, Edge, Brave, and similar CSV columns automatically.
                    </p>
                </div>
            `,
            footer: `
                <button class="secondary-button" type="button" data-modal-action="close">Cancel</button>
            `
        });

        const textArea = document.getElementById("csvPasteText");
        const message = document.getElementById("csvPasteMessage");

        document.getElementById("readClipboardCsvButton").addEventListener("click", async () => {
            try {
                textArea.value = await navigator.clipboard.readText();
                message.textContent = "Clipboard contents pasted. Select Analyze CSV.";
                message.style.color = "var(--accent)";
            } catch {
                message.textContent = "The browser blocked clipboard reading. Paste manually with Ctrl+V.";
                message.style.color = "var(--danger)";
                textArea.focus();
            }
        });

        document.getElementById("analyzeCsvTextButton").addEventListener("click", () => {
            const text = textArea.value.trim();

            if (!text) {
                message.textContent = "Paste CSV data before analyzing it.";
                message.style.color = "var(--danger)";
                textArea.focus();
                return;
            }

            try {
                const parsed = parseCsvText(text);
                showCsvImportDialog("Pasted browser passwords", parsed);
            } catch (error) {
                message.textContent = error.message;
                message.style.color = "var(--danger)";
            }
        });

        textArea.focus();
    }

    function showCsvImportDialog(filename, parsed) {
        const detected = detectCsvMapping(parsed.headers);
        pendingCsvData = { filename, headers: parsed.headers, rows: parsed.rows };

        openModal({
            eyebrow: "Browser Password Transfer",
            title: "Import Passwords from CSV",
            body: `
                <div class="csv-import-shell">
                    <div class="import-file-summary">
                        <div class="import-file-mark csv-mark">CSV</div>
                        <div>
                            <strong>${escapeHtml(filename)}</strong>
                            <span>${parsed.rows.length.toLocaleString()} data rows detected</span>
                        </div>
                    </div>

                    <div class="csv-security-warning">
                        Browser CSV exports contain unencrypted plaintext passwords. Delete the CSV securely after verifying the import.
                    </div>

                    <section class="admin-section">
                        <div class="admin-section-heading">
                            <div><span>01</span><strong>Map CSV Columns</strong></div>
                            <small>Firefox, Chrome, Edge, Brave, and similar formats are detected automatically.</small>
                        </div>

                        <div class="form-two-column">
                            <label>Website Name<select id="csvMapName">${csvColumnOptions(parsed.headers, detected.name)}</select></label>
                            <label>Website URL<select id="csvMapUrl">${csvColumnOptions(parsed.headers, detected.url)}</select></label>
                            <label>Username / Login ID<select id="csvMapUsername">${csvColumnOptions(parsed.headers, detected.username)}</select></label>
                            <label>Password<select id="csvMapPassword">${csvColumnOptions(parsed.headers, detected.password)}</select></label>
                            <label>Notes<select id="csvMapNotes">${csvColumnOptions(parsed.headers, detected.notes)}</select></label>
                            <label>TOTP / OTP<select id="csvMapOtp">${csvColumnOptions(parsed.headers, detected.otp)}</select></label>
                        </div>
                    </section>

                    <section class="admin-section">
                        <div class="admin-section-heading">
                            <div><span>02</span><strong>Import Options</strong></div>
                            <small>Imported rows become encrypted Website records.</small>
                        </div>

                        <label class="admin-toggle-row">
                            <input id="csvSkipDuplicates" type="checkbox" checked>
                            <span><strong>Skip exact duplicates</strong><small>Compares URL, username, and password.</small></span>
                        </label>
                    </section>

                    <section class="admin-section">
                        <div class="admin-section-heading">
                            <div><span>03</span><strong>Preview</strong></div>
                            <small id="csvImportableCount"></small>
                        </div>
                        <div class="csv-preview-wrap">
                            <table class="csv-preview-table">
                                <thead><tr><th>Website</th><th>Username</th><th>Password</th></tr></thead>
                                <tbody id="csvPreviewBody"></tbody>
                            </table>
                        </div>
                    </section>

                    <p id="csvImportMessage" class="form-note">
                        Nothing is saved until Import Passwords is selected.
                    </p>
                </div>
            `,
            footer: `
                <button class="secondary-button" type="button" data-modal-action="cancel-csv-import">Cancel</button>
                <button class="primary-button" type="button" data-modal-action="run-csv-import">Import Passwords</button>
            `
        });

        ["csvMapName","csvMapUrl","csvMapUsername","csvMapPassword","csvMapNotes","csvMapOtp"]
            .forEach(id => document.getElementById(id).addEventListener("change", buildCsvPreview));

        buildCsvPreview();
    }

    async function importCsvPasswords() {
        if (!pendingCsvData) throw new Error("The CSV data is no longer available.");

        const mapping = {
            name: document.getElementById("csvMapName").value,
            url: document.getElementById("csvMapUrl").value,
            username: document.getElementById("csvMapUsername").value,
            password: document.getElementById("csvMapPassword").value,
            notes: document.getElementById("csvMapNotes").value,
            otp: document.getElementById("csvMapOtp").value
        };

        if (!mapping.url && !mapping.name) {
            throw new Error("Map at least Website Name or Website URL.");
        }

        const existing = new Set(vaultData.records.websites.map(csvSignature));
        const skipDuplicates = document.getElementById("csvSkipDuplicates").checked;
        const now = new Date().toISOString();
        let added = 0, skipped = 0, invalid = 0, otpImported = 0;

        for (const row of pendingCsvData.rows) {
            const url = csvValue(row, mapping.url);
            const name = csvValue(row, mapping.name) || siteNameFromUrl(url);
            const loginId = csvValue(row, mapping.username);
            const password = csvValue(row, mapping.password);
            const notes = csvValue(row, mapping.notes);
            const otp = csvValue(row, mapping.otp);

            if (!url && !name && !loginId) {
                invalid += 1;
                continue;
            }

            const record = {
                id: crypto.randomUUID(),
                recordType: "website",
                siteName: name || "Imported Website",
                url,
                loginId,
                password,
                emailUsed: loginId.includes("@") ? loginId : "",
                supports2FA: "unknown",
                twoFAEnabled: "unknown",
                twoFAType: "none",
                totpSecret: "",
                totpIssuer: name || siteNameFromUrl(url),
                totpAccount: loginId,
                totpDigits: 6,
                totpPeriod: 30,
                totpAlgorithm: "SHA1",
                twoFAEmail: "",
                twoFAPhone: "",
                recoveryCodes: "",
                securityKeyName: "",
                notes,
                tags: "csv-import",
                createdAt: now,
                modifiedAt: now
            };

            if (otp) {
                try {
                    if (otp.toLowerCase().startsWith("otpauth://")) {
                        const parsedOtp = parseOtpAuthUri(otp);
                        Object.assign(record, {
                            totpSecret: parsedOtp.secret,
                            totpIssuer: parsedOtp.issuer || record.siteName,
                            totpAccount: parsedOtp.account || loginId,
                            totpDigits: parsedOtp.digits,
                            totpPeriod: parsedOtp.period,
                            totpAlgorithm: parsedOtp.algorithm
                        });
                    } else {
                        record.totpSecret = normalizeBase32(otp);
                    }

                    if (record.totpSecret) {
                        record.supports2FA = "yes";
                        record.twoFAEnabled = "yes";
                        record.twoFAType = "authenticator";
                        otpImported += 1;
                    }
                } catch {
                    record.notes = [record.notes, `Unrecognized OTP value: ${otp}`]
                        .filter(Boolean).join("\n");
                }
            }

            const signature = csvSignature(record);
            if (skipDuplicates && existing.has(signature)) {
                skipped += 1;
                continue;
            }

            vaultData.records.websites.push(record);
            existing.add(signature);
            added += 1;
        }

        await window.TPWMVault.saveData(vaultData);
        return { added, skipped, invalid, otpImported };
    }

    function showCsvImportResult(result) {
        openModal({
            eyebrow: "CSV Import Complete",
            title: "Browser Passwords Imported",
            body: `
                <div class="import-result-hero">
                    <div class="import-result-number">${result.added}</div>
                    <div><strong>website records added</strong><span>${result.skipped} duplicates skipped · ${result.invalid} rows ignored</span></div>
                </div>
                <div class="admin-summary-grid">
                    <div class="admin-summary-card"><span class="admin-summary-icon">W</span><div><small>Websites</small><strong>${result.added}</strong></div></div>
                    <div class="admin-summary-card"><span class="admin-summary-icon orange">=</span><div><small>Skipped</small><strong>${result.skipped}</strong></div></div>
                    <div class="admin-summary-card"><span class="admin-summary-icon yellow">2</span><div><small>TOTP</small><strong>${result.otpImported}</strong></div></div>
                </div>
                <div class="csv-security-warning">Delete the plaintext source CSV securely after confirming the import.</div>
            `,
            footer: `<button class="primary-button" type="button" data-modal-action="close">Done</button>`
        });
    }

    function downloadTextFile(filename, text, mimeType = "application/json") {
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function safeFilenamePart(value) {
        return String(value || "vault")
            .trim()
            .replace(/[^a-z0-9_-]+/gi, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 50) || "vault";
    }

    async function exportEncryptedVault() {
        const packageData = await window.TPWMVault.exportPackage();
        const account = safeFilenamePart(packageData.vault.accountId);
        const date = new Date().toISOString().slice(0, 10);
        const filename = `TPWM_${account}_${date}.tpwm`;

        downloadTextFile(filename, JSON.stringify(packageData, null, 2));
        elements.statusText.textContent = `Encrypted vault exported: ${filename}`;
    }

    async function readImportFile(file) {
        if (file.size > 100 * 1024 * 1024) {
            throw new Error("The selected TPWM file is larger than 100 MB.");
        }

        let packageData;

        try {
            packageData = JSON.parse(await file.text());
        } catch {
            throw new Error("The selected file is not valid JSON.");
        }

        const info = await window.TPWMVault.inspectPackage(packageData);
        pendingImportPackage = packageData;
        return info;
    }

    function showImportDialog(info, filename, source) {
        pendingImportSource = source;
        const unlocked = window.TPWMVault.isUnlocked();

        openModal({
            eyebrow: "Encrypted Vault Transfer",
            title: "Import TPWM Vault",
            body: `
                <div class="import-dialog">
                    <div class="import-file-summary">
                        <div class="import-file-mark">T</div>
                        <div>
                            <strong>${escapeHtml(filename)}</strong>
                            <span>Encrypted TPWM package</span>
                        </div>
                    </div>

                    <div class="detail-grid">
                        ${detailValue("Account ID", info.accountId)}
                        ${detailValue("Encryption", info.encryption)}
                        ${detailValue("PBKDF2 Iterations", Number(info.iterations).toLocaleString())}
                        ${detailValue("Modified", formatDate(info.modifiedAt))}
                    </div>

                    <label>
                        Password for Imported Vault
                        <div class="input-action-row">
                            <input id="importVaultPassword" type="password" autocomplete="current-password">
                            <button class="inline-button toggle-password" type="button" data-target="importVaultPassword">Show</button>
                        </div>
                    </label>

                    ${unlocked ? `
                        <div class="import-mode-grid">
                            <label class="import-mode-option active">
                                <input type="radio" name="importMode" value="merge" checked>
                                <span class="import-mode-icon">+</span>
                                <span>
                                    <strong>Merge Records</strong>
                                    <small>Add new records, skip exact duplicates, and keep this vault's account and settings.</small>
                                </span>
                            </label>

                            <label class="import-mode-option">
                                <input type="radio" name="importMode" value="replace">
                                <span class="import-mode-icon">↺</span>
                                <span>
                                    <strong>Replace Vault</strong>
                                    <small>Replace the complete local vault, account, settings, and records.</small>
                                </span>
                            </label>
                        </div>
                    ` : `
                        <div class="import-warning-card">
                            Importing from the login screen restores the complete imported vault.
                        </div>
                    `}

                    <p id="importFormMessage" class="form-note">
                        The file stays encrypted until its password is verified locally.
                    </p>
                </div>
            `,
            footer: `
                <button class="secondary-button" type="button" data-modal-action="cancel-import">Cancel</button>
                <button class="primary-button" type="button" data-modal-action="run-import">Import Vault</button>
            `
        });

        attachPasswordToggles(elements.modalBody);

        elements.modalBody.querySelectorAll('input[name="importMode"]').forEach(input => {
            input.addEventListener("change", () => {
                elements.modalBody.querySelectorAll(".import-mode-option").forEach(option => {
                    option.classList.toggle("active", option.querySelector("input").checked);
                });
            });
        });

        document.getElementById("importVaultPassword").focus();
    }

    function showMergeResult(summary) {
        openModal({
            eyebrow: "Import Complete",
            title: "Vault Merge Finished",
            body: `
                <div class="import-result-hero">
                    <div class="import-result-number">${summary.added}</div>
                    <div>
                        <strong>records added</strong>
                        <span>${summary.skipped} exact duplicates skipped</span>
                    </div>
                </div>

                <div class="admin-summary-grid">
                    ${Object.entries(summary.byCategory).map(([category, values]) => `
                        <div class="admin-summary-card">
                            <span class="admin-summary-icon">${categoryIcon(category)}</span>
                            <div>
                                <small>${escapeHtml(categoryLabel(category))}</small>
                                <strong>+${values.added} · ${values.skipped} skipped</strong>
                            </div>
                        </div>
                    `).join("")}
                </div>

                ${summary.reassignedIds ? `
                    <div class="import-warning-card">
                        ${summary.reassignedIds} conflicting record ID${summary.reassignedIds === 1 ? "" : "s"} were safely reassigned.
                    </div>
                ` : ""}
            `,
            footer: `<button class="primary-button" type="button" data-modal-action="close">Done</button>`
        });
    }

    function showAdmin() {
        const settings = vaultData.settings;

        openModal({
            eyebrow: "Encrypted Vault Control Center",
            title: "Admin",
            body: `
                <div class="admin-dashboard">
                    <div class="admin-summary-grid">
                        <div class="admin-summary-card">
                            <span class="admin-summary-icon">◆</span>
                            <div><small>Encryption</small><strong>AES-256-GCM</strong></div>
                        </div>
                        <div class="admin-summary-card">
                            <span class="admin-summary-icon orange">⌁</span>
                            <div><small>Storage</small><strong>IndexedDB</strong></div>
                        </div>
                        <div class="admin-summary-card">
                            <span class="admin-summary-icon yellow">#</span>
                            <div><small>Records</small><strong>${Object.values(vaultData.records).reduce((total, list) => total + list.length, 0)}</strong></div>
                        </div>
                    </div>

                    <section class="admin-section">
                        <div class="admin-section-heading">
                            <div><span>01</span><strong>Account and Master Password</strong></div>
                            <small>Current master password is required to change either value.</small>
                        </div>

                        <div class="form-two-column">
                            <label>
                                Account ID
                                <input id="adminAccountId" type="text" value="${escapeHtml(vaultData.account.id)}">
                            </label>
                            <label>
                                Current Master Password
                                <div class="input-action-row">
                                    <input id="adminCurrentPassword" type="password" autocomplete="current-password">
                                    <button class="inline-button toggle-password" type="button" data-target="adminCurrentPassword">Show</button>
                                </div>
                            </label>
                        </div>

                        <div class="form-two-column">
                            <label>
                                New Master Password
                                <div class="input-action-row">
                                    <input id="adminNewPassword" type="password" autocomplete="new-password" placeholder="Leave blank to keep current password">
                                    <button class="inline-button toggle-password" type="button" data-target="adminNewPassword">Show</button>
                                </div>
                            </label>
                            <label>
                                Confirm New Password
                                <div class="input-action-row">
                                    <input id="adminConfirmPassword" type="password" autocomplete="new-password">
                                    <button class="inline-button toggle-password" type="button" data-target="adminConfirmPassword">Show</button>
                                </div>
                            </label>
                        </div>
                    </section>

                    <section class="admin-section">
                        <div class="admin-section-heading">
                            <div><span>02</span><strong>Automatic Locking</strong></div>
                            <small>Controls when the decrypted key is removed from memory.</small>
                        </div>

                        <div class="form-two-column">
                            <label>
                                Idle Timeout
                                <select id="adminIdleTimeout">
                                    ${[1, 2, 5, 10, 15, 30, 60].map(minutes =>
                                        `<option value="${minutes}" ${Number(settings.idleTimeoutMinutes) === minutes ? "selected" : ""}>${minutes === 60 ? "1 hour" : `${minutes} minute${minutes === 1 ? "" : "s"}`}</option>`
                                    ).join("")}
                                </select>
                            </label>

                            <label>
                                Auto-Hide Revealed Values
                                <select id="adminAutoHide">
                                    ${[10, 20, 30, 60, 0].map(seconds =>
                                        `<option value="${seconds}" ${Number(settings.autoHideSeconds) === seconds ? "selected" : ""}>${seconds === 0 ? "Never" : `${seconds} seconds`}</option>`
                                    ).join("")}
                                </select>
                            </label>
                        </div>

                        <label class="admin-toggle-row">
                            <input id="adminLockHidden" type="checkbox" ${settings.lockWhenHidden ? "checked" : ""}>
                            <span>
                                <strong>Lock when the browser is hidden</strong>
                                <small>Locks after switching applications or minimizing the browser.</small>
                            </span>
                        </label>

                        <label>
                            Hidden-Window Lock Delay
                            <select id="adminHiddenDelay">
                                ${[15, 30, 60, 120, 300].map(seconds =>
                                    `<option value="${seconds}" ${Number(settings.hiddenLockSeconds) === seconds ? "selected" : ""}>${seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minute${seconds === 60 ? "" : "s"}`}</option>`
                                ).join("")}
                            </select>
                        </label>

                        <label class="admin-toggle-row">
                            <input id="adminConfirmLock" type="checkbox" ${settings.confirmManualLock ? "checked" : ""}>
                            <span>
                                <strong>Confirm manual locking</strong>
                                <small>Ask before the toolbar Lock button closes the vault.</small>
                            </span>
                        </label>
                    </section>

                    <section class="admin-section">
                        <div class="admin-section-heading">
                            <div><span>03</span><strong>Clipboard and Display</strong></div>
                            <small>Reduces how long copied secrets remain exposed.</small>
                        </div>

                        <div class="form-two-column">
                            <label>
                                Clipboard Clear Delay
                                <select id="adminClipboardDelay">
                                    ${[15, 30, 60, 120, 0].map(seconds =>
                                        `<option value="${seconds}" ${Number(settings.clipboardClearSeconds) === seconds ? "selected" : ""}>${seconds === 0 ? "Never" : `${seconds} seconds`}</option>`
                                    ).join("")}
                                </select>
                            </label>

                            <label>
                                Default Category
                                <select id="adminDefaultCategory">
                                    ${Object.entries(categoryNames).map(([key, name]) =>
                                        `<option value="${key}" ${settings.defaultCategory === key ? "selected" : ""}>${name}</option>`
                                    ).join("")}
                                </select>
                            </label>

                            <label>
                                Records Per Page
                                <select id="adminPageSize">
                                    ${[25, 50, 100, 200].map(size =>
                                        `<option value="${size}" ${Number(settings.pageSize || 50) === size ? "selected" : ""}>${size} records</option>`
                                    ).join("")}
                                </select>
                            </label>
                        </div>

                        <label class="admin-toggle-row">
                            <input id="adminCompactView" type="checkbox" ${settings.compactView !== false ? "checked" : ""}>
                            <span>
                                <strong>Use compact record lists</strong>
                                <small>Shows more vault records on screen.</small>
                            </span>
                        </label>
                    </section>

                    <section class="admin-section admin-danger-section">
                        <div class="admin-section-heading">
                            <div><span>04</span><strong>Vault Operations</strong></div>
                            <small>Create portable encrypted backups or merge another TPWM vault.</small>
                        </div>

                        <div class="admin-operation-grid">
                            <button class="secondary-button" type="button" data-modal-action="paste-csv">Paste Browser Password CSV</button>
                            <button class="secondary-button" type="button" data-modal-action="import">Import Encrypted Vault</button>
                            <button class="secondary-button" type="button" data-modal-action="export-vault">Export Encrypted Vault</button>
                            <button class="secondary-button danger-text" type="button" data-modal-action="delete-placeholder">Delete Local Vault</button>
                        </div>
                    </section>

                    <p id="adminFormMessage" class="form-note">
                        Security settings and account changes are encrypted before being saved.
                    </p>
                </div>
            `,
            footer: `
                <button class="secondary-button" type="button" data-modal-action="lock-now">Lock Now</button>
                <button class="secondary-button" type="button" data-modal-action="close">Cancel</button>
                <button class="primary-button" type="button" data-modal-action="save-admin">Save Admin Settings</button>
            `
        });

        attachPasswordToggles(elements.modalBody);
    }

    function openModal({ eyebrow, title, body, footer }) {
        lastFocusedElement = document.activeElement;
        elements.modalEyebrow.textContent = eyebrow;
        elements.modalTitle.textContent = title;
        elements.modalBody.innerHTML = body;
        elements.modalFooter.innerHTML = footer;
        elements.modalOverlay.classList.remove("hidden");
        document.body.style.overflow = "hidden";
        elements.modalCloseButton.focus();
    }

    function closeModal() {
        stopTotpRefresh();

        if (elements.modalOverlay.classList.contains("hidden")) {
            return;
        }

        activeRecordId = null;
        elements.modalOverlay.classList.add("hidden");
        elements.modalBody.innerHTML = "";
        elements.modalFooter.innerHTML = "";
        document.body.style.overflow = "";

        if (lastFocusedElement instanceof HTMLElement) {
            lastFocusedElement.focus();
        }
    }

    function attachPasswordToggles(container = document) {
        container.querySelectorAll(".toggle-password").forEach((button) => {
            if (button.dataset.bound === "true") {
                return;
            }

            button.dataset.bound = "true";
            button.addEventListener("click", () => {
                const input = document.getElementById(button.dataset.target);
                if (!input) {
                    return;
                }

                const show = input.type === "password";
                input.type = show ? "text" : "password";
                button.textContent = show ? "Hide" : "Show";
            });
        });
    }

    function attachDetailActions() {
        elements.modalBody.querySelectorAll(".reveal-detail").forEach((button) => {
            button.addEventListener("click", () => {
                const target = document.getElementById(button.dataset.target);
                const currentlyMasked = target.classList.contains("masked-value");

                if (currentlyMasked) {
                    target.textContent = target.dataset.realValue || "";
                    target.classList.remove("masked-value");
                    button.textContent = "Hide";

                    const seconds = Number(vaultData?.settings?.autoHideSeconds) || 0;
                    if (seconds > 0) {
                        setTimeout(() => {
                            if (target && !target.classList.contains("masked-value")) {
                                target.textContent = "••••••••••••";
                                target.classList.add("masked-value");
                                button.textContent = "Show";
                            }
                        }, seconds * 1000);
                    }
                } else {
                    target.textContent = "••••••••••••";
                    target.classList.add("masked-value");
                    button.textContent = "Show";
                }
            });
        });

        elements.modalBody.querySelectorAll(".copy-detail").forEach((button) => {
            button.addEventListener("click", async () => {
                await copyText(button.dataset.copyValue || "", button);
            });
        });
    }

    function updateClock() {
        elements.clockText.textContent = new Date().toLocaleString([], {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    async function initializeAuthState() {
        try {
            const hasVault = await window.TPWMVault.exists();

            if (hasVault) {
                switchAuthTab("login");
                setAuthMessage(elements.loginMessage, "Encrypted local vault found. Enter your account ID and master password.");
            } else {
                switchAuthTab("signup");
                setAuthMessage(elements.signupMessage, "No local vault exists yet. Create the first encrypted vault.");
            }
        } catch (error) {
            setAuthMessage(elements.loginMessage, `Storage error: ${error.message}`, true);
            setAuthMessage(elements.signupMessage, `Storage error: ${error.message}`, true);
        }
    }

    elements.loginTab.addEventListener("click", () => switchAuthTab("login"));
    elements.signupTab.addEventListener("click", () => switchAuthTab("signup"));

    elements.loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (busy) {
            return;
        }

        const accountId = document.getElementById("loginId").value;
        const passwordInput = document.getElementById("loginPassword");
        const password = passwordInput.value;

        if (!accountId.trim() || !password) {
            setAuthMessage(elements.loginMessage, "Enter both the account ID and master password.", true);
            return;
        }

        busy = true;
        setFormBusy(elements.loginForm, true, "Decrypting...");
        setAuthMessage(elements.loginMessage, "Deriving the encryption key and opening the local vault...");

        try {
            vaultData = await window.TPWMVault.unlock(accountId, password);
            passwordInput.value = "";
            openDashboard("Encrypted IndexedDB vault unlocked");
        } catch (error) {
            passwordInput.value = "";
            setAuthMessage(elements.loginMessage, error.message, true);
            passwordInput.focus();
        } finally {
            busy = false;
            setFormBusy(elements.loginForm, false);
        }
    });

    elements.signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (busy) {
            return;
        }

        const accountId = document.getElementById("signupId").value;
        const passwordInput = document.getElementById("signupPassword");
        const confirmInput = document.getElementById("signupPasswordConfirm");
        const password = passwordInput.value;
        const confirmation = confirmInput.value;
        const idleTimeout = Number(document.getElementById("signupTimeout").value) || 10;

        if (!accountId.trim()) {
            setAuthMessage(elements.signupMessage, "Create an account ID.", true);
            return;
        }

        if (password !== confirmation) {
            setAuthMessage(elements.signupMessage, "The two master-password entries do not match.", true);
            confirmInput.focus();
            return;
        }

        busy = true;
        setFormBusy(elements.signupForm, true, "Encrypting...");
        setAuthMessage(elements.signupMessage, "Creating the AES-256 encrypted IndexedDB vault...");

        try {
            vaultData = await window.TPWMVault.create(accountId, password, idleTimeout);
            passwordInput.value = "";
            confirmInput.value = "";
            openDashboard("Encrypted local vault created");
        } catch (error) {
            setAuthMessage(elements.signupMessage, error.message, true);
        } finally {
            busy = false;
            setFormBusy(elements.signupForm, false);
        }
    });

    document.querySelectorAll('input[name="category"]').forEach((radio) => {
        radio.addEventListener("change", () => setCategory(radio.value));
    });

    elements.searchInput.addEventListener("input", () => {
        currentPage = 1;
        elements.clearSearchButton.classList.toggle("hidden", elements.searchInput.value.length === 0);
        renderRecords();
    });

    elements.clearSearchButton.addEventListener("click", () => {
        currentPage = 1;
        elements.searchInput.value = "";
        elements.clearSearchButton.classList.add("hidden");
        renderRecords();
        elements.searchInput.focus();
    });

    elements.globalSearchToggle.addEventListener("change", () => {
        currentPage = 1;
        renderRecords();
        elements.searchInput.focus();
    });

    elements.firstPageButton.addEventListener("click", () => goToPage(1));
    elements.previousPageButton.addEventListener("click", () => goToPage(currentPage - 1));
    elements.nextPageButton.addEventListener("click", () => goToPage(currentPage + 1));
    elements.lastPageButton.addEventListener("click", () => goToPage(currentTotalPages));

    elements.pageSizeSelect.addEventListener("change", async () => {
        pageSize = Number(elements.pageSizeSelect.value) || 50;
        currentPage = 1;

        if (vaultData?.settings) {
            vaultData.settings.pageSize = pageSize;

            try {
                await window.TPWMVault.saveData(vaultData);
                elements.statusText.textContent = `Records per page saved: ${pageSize}`;
            } catch (error) {
                elements.statusText.textContent = `Unable to save page size: ${error.message}`;
            }
        }

        renderRecords();
    });

    elements.mobileMenuButton.addEventListener("click", () => elements.sidebar.classList.toggle("open"));
    elements.addRecordButton.addEventListener("click", showAddRecord);
    elements.emptyAddButton.addEventListener("click", showAddRecord);
    elements.pwGenButton.addEventListener("click", showPasswordGenerator);
    elements.adminButton.addEventListener("click", showAdmin);
    elements.lockButton.addEventListener("click", () => lockVault("Vault locked manually."));

    elements.compactViewButton.addEventListener("click", () => {
        currentView = "compact";
        elements.compactViewButton.classList.add("active");
        elements.comfortableViewButton.classList.remove("active");
        renderRecords();
    });

    elements.comfortableViewButton.addEventListener("click", () => {
        currentView = "comfortable";
        elements.comfortableViewButton.classList.add("active");
        elements.compactViewButton.classList.remove("active");
        renderRecords();
    });

    elements.modalCloseButton.addEventListener("click", closeModal);

    elements.modalOverlay.addEventListener("click", (event) => {
        if (event.target === elements.modalOverlay) {
            closeModal();
        }
    });

    elements.modalPanel.addEventListener("click", async (event) => {
        const actionButton = event.target.closest("[data-modal-action]");
        if (!actionButton) {
            return;
        }

        const action = actionButton.dataset.modalAction;

        if (action === "close") {
            closeModal();
        } else if (action === "save-website") {
            await saveWebsite();
        } else if (action === "edit-website") {
            const record = vaultData.records.websites.find((item) => item.id === activeRecordId);
            if (record) {
                showWebsiteForm(record);
            }
        } else if (action === "delete-website") {
            await deleteWebsite();
        } else if (action === "save-card") {
            await saveTypedRecord("card", collectCardForm(), "cardFormMessage", "save-card", "Card");
        } else if (action === "edit-card") {
            const record = vaultData.records.cards.find(item => item.id === activeRecordId);
            if (record) showCardForm(record);
        } else if (action === "delete-card") {
            await deleteTypedRecord("cards", "Card");
        } else if (action === "save-bank") {
            await saveTypedRecord("bank", collectBankForm(), "bankFormMessage", "save-bank", "Bank account");
        } else if (action === "edit-bank") {
            const record = vaultData.records.banking.find(item => item.id === activeRecordId);
            if (record) showBankForm(record);
        } else if (action === "delete-bank") {
            await deleteTypedRecord("banking", "Bank account");
        } else if (action === "save-note") {
            await saveTypedRecord("note", collectNoteForm(), "noteFormMessage", "save-note", "Secure note");
        } else if (action === "edit-note") {
            const record = vaultData.records.notes.find(item => item.id === activeRecordId);
            if (record) showNoteForm(record);
        } else if (action === "delete-note") {
            await deleteTypedRecord("notes", "Secure note");
        } else if (action === "paste-csv") {
            showCsvPasteDialog();
        } else if (action === "import-csv") {
            elements.csvFileInput.click();
        } else if (action === "cancel-csv-import") {
            pendingCsvData = null;
            closeModal();
        } else if (action === "run-csv-import") {
            const message = document.getElementById("csvImportMessage");

            actionButton.disabled = true;
            actionButton.textContent = "Encrypting Imported Records...";

            try {
                const result = await importCsvPasswords();

                pendingCsvData = null;
                normalizeVaultRecords();
                updateCategoryCounts();
                renderRecords();

                elements.statusText.textContent =
                    `${result.added} browser passwords imported and encrypted`;

                showCsvImportResult(result);
            } catch (error) {
                message.textContent = error.message;
                message.style.color = "var(--danger)";
                actionButton.disabled = false;
                actionButton.textContent = "Import Passwords";
            }
        } else if (action === "import") {
            pendingImportSource = "admin";
            elements.vaultFileInput.click();
        } else if (action === "lock-now") {
            lockVault("Vault locked from Admin.", true);
        } else if (action === "export-vault") {
            actionButton.disabled = true;
            actionButton.textContent = "Preparing...";

            try {
                await exportEncryptedVault();
                actionButton.textContent = "Exported";
                setTimeout(() => {
                    actionButton.disabled = false;
                    actionButton.textContent = "Export Encrypted Vault";
                }, 1200);
            } catch (error) {
                actionButton.disabled = false;
                actionButton.textContent = "Export Encrypted Vault";
                window.alert(`Unable to export the vault:\n\n${error.message}`);
            }
        } else if (action === "cancel-import") {
            pendingImportPackage = null;
            closeModal();
        } else if (action === "run-import") {
            const message = document.getElementById("importFormMessage");
            const password = document.getElementById("importVaultPassword").value;
            const modeInput = document.querySelector('input[name="importMode"]:checked');
            const mode = modeInput?.value || "replace";

            if (!password) {
                message.textContent = "Enter the master password for the imported vault.";
                message.style.color = "var(--danger)";
                return;
            }

            if (!pendingImportPackage) {
                message.textContent = "The selected import package is no longer available.";
                message.style.color = "var(--danger)";
                return;
            }

            if (
                mode === "replace" &&
                !window.confirm("Replace the complete local vault with the imported vault?\n\nExport a backup first if you may need the current vault later.")
            ) {
                return;
            }

            actionButton.disabled = true;
            actionButton.textContent = mode === "merge"
                ? "Decrypting and Merging..."
                : "Decrypting and Replacing...";

            try {
                if (mode === "merge" && window.TPWMVault.isUnlocked()) {
                    const result = await window.TPWMVault.mergeFromPackage(pendingImportPackage, password);
                    vaultData = result.data;
                    pendingImportPackage = null;
                    updateCategoryCounts();
                    renderRecords();
                    elements.statusText.textContent = `${result.summary.added} imported records added`;
                    showMergeResult(result.summary);
                } else {
                    vaultData = await window.TPWMVault.replaceFromPackage(pendingImportPackage, password);
                    pendingImportPackage = null;
                    openDashboard("Imported encrypted vault unlocked");
                }
            } catch (error) {
                message.textContent = error.message;
                message.style.color = "var(--danger)";
                actionButton.disabled = false;
                actionButton.textContent = "Import Vault";
                document.getElementById("importVaultPassword").value = "";
                document.getElementById("importVaultPassword").focus();
            }
        } else if (action === "save-admin") {
            const message = document.getElementById("adminFormMessage");
            const accountId = document.getElementById("adminAccountId").value.trim();
            const currentPassword = document.getElementById("adminCurrentPassword").value;
            const newPassword = document.getElementById("adminNewPassword").value;
            const confirmPassword = document.getElementById("adminConfirmPassword").value;
            const credentialsChanged = accountId !== vaultData.account.id || newPassword.length > 0;

            if (newPassword !== confirmPassword) {
                message.textContent = "The new master-password entries do not match.";
                message.style.color = "var(--danger)";
                return;
            }

            if (credentialsChanged && !currentPassword) {
                message.textContent = "Enter the current master password to change the account ID or master password.";
                message.style.color = "var(--danger)";
                document.getElementById("adminCurrentPassword").focus();
                return;
            }

            vaultData.settings.idleTimeoutMinutes = Number(document.getElementById("adminIdleTimeout").value) || 10;
            vaultData.settings.clipboardClearSeconds = Number(document.getElementById("adminClipboardDelay").value);
            vaultData.settings.autoHideSeconds = Number(document.getElementById("adminAutoHide").value);
            vaultData.settings.lockWhenHidden = document.getElementById("adminLockHidden").checked;
            vaultData.settings.hiddenLockSeconds = Number(document.getElementById("adminHiddenDelay").value) || 60;
            vaultData.settings.confirmManualLock = document.getElementById("adminConfirmLock").checked;
            vaultData.settings.defaultCategory = document.getElementById("adminDefaultCategory").value;
            vaultData.settings.compactView = document.getElementById("adminCompactView").checked;
            vaultData.settings.pageSize = Number(document.getElementById("adminPageSize").value) || 50;

            actionButton.disabled = true;
            actionButton.textContent = credentialsChanged ? "Re-encrypting Vault..." : "Encrypting Settings...";

            try {
                if (credentialsChanged) {
                    vaultData = await window.TPWMVault.changeCredentials(
                        currentPassword,
                        accountId,
                        newPassword
                    );
                }

                await window.TPWMVault.saveData(vaultData);

                currentView = vaultData.settings.compactView ? "compact" : "comfortable";
                pageSize = Number(vaultData.settings.pageSize) || 50;
                currentPage = 1;
                elements.pageSizeSelect.value = String(pageSize);
                elements.compactViewButton.classList.toggle("active", currentView === "compact");
                elements.comfortableViewButton.classList.toggle("active", currentView === "comfortable");
                renderRecords();
                resetIdleTimer();

                const changedText = credentialsChanged
                    ? "Account credentials changed and vault re-encrypted"
                    : "Admin settings encrypted and saved";

                closeModal();
                elements.statusText.textContent = changedText;
            } catch (error) {
                message.textContent = error.message;
                message.style.color = "var(--danger)";
                actionButton.disabled = false;
                actionButton.textContent = "Save Admin Settings";
            }
        } else if (action === "generate-password") {
            runPasswordGenerator();
        } else if (action === "use-generated") {
            const targetInput = findOpenPasswordInput();
            const generated = document.getElementById("generatedPassword")?.value || "";

            if (targetInput && generated) {
                targetInput.value = generated;
                targetInput.dispatchEvent(new Event("input", { bubbles: true }));
                elements.statusText.textContent = "Generated password inserted into the open record";
                closeModal();
                targetInput.focus();
            }
        } else {
            window.alert("This control belongs to a later development stage.");
        }
    });

    elements.csvFileInput.addEventListener("change", async () => {
        const file = elements.csvFileInput.files[0];
        elements.csvFileInput.value = "";

        if (!file) return;
        if (file.size > 100 * 1024 * 1024) {
            window.alert("The CSV file is larger than 100 MB.");
            return;
        }

        try {
            showCsvImportDialog(file.name, parseCsvText(await file.text()));
        } catch (error) {
            pendingCsvData = null;
            window.alert(`Unable to read the CSV file:\n\n${error.message}`);
        }
    });

    elements.totpQrFileInput.addEventListener("change", async () => {
        const file = elements.totpQrFileInput.files[0];
        elements.totpQrFileInput.value = "";

        if (!file || pendingQrTarget !== "website") {
            return;
        }

        const message = document.getElementById("websiteFormMessage");

        if (!("BarcodeDetector" in window)) {
            message.textContent = "This browser cannot read QR images directly. Paste the otpauth:// link instead.";
            message.style.color = "var(--danger)";
            return;
        }

        try {
            const detector = new BarcodeDetector({ formats: ["qr_code"] });
            const bitmap = await createImageBitmap(file);
            const results = await detector.detect(bitmap);

            if (!results.length) {
                throw new Error("No QR code was found in the selected image.");
            }

            const rawValue = results[0].rawValue || "";
            document.getElementById("siteOtpAuthUri").value = rawValue;
            document.getElementById("applyOtpAuthButton").click();
        } catch (error) {
            message.textContent = `Unable to read QR image: ${error.message}`;
            message.style.color = "var(--danger)";
        }
    });

    elements.importVaultAuthButton.addEventListener("click", () => {
        pendingImportSource = "auth";
        elements.vaultFileInput.click();
    });

    elements.vaultFileInput.addEventListener("change", async () => {
        const file = elements.vaultFileInput.files[0];
        elements.vaultFileInput.value = "";

        if (!file) {
            return;
        }

        try {
            const info = await readImportFile(file);
            showImportDialog(info, file.name, pendingImportSource);
        } catch (error) {
            pendingImportPackage = null;
            window.alert(`Unable to open the TPWM file:\n\n${error.message}`);
        }
    });

    document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
            event.preventDefault();
            if (!elements.mainScreen.classList.contains("hidden")) {
                elements.searchInput.focus();
                elements.searchInput.select();
            }
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
            event.preventDefault();
            if (!elements.mainScreen.classList.contains("hidden") && elements.modalOverlay.classList.contains("hidden")) {
                showAddRecord();
            }
            return;
        }

        if (
            !elements.mainScreen.classList.contains("hidden") &&
            elements.modalOverlay.classList.contains("hidden") &&
            event.key === "PageDown"
        ) {
            event.preventDefault();
            goToPage(currentPage + 1);
            return;
        }

        if (
            !elements.mainScreen.classList.contains("hidden") &&
            elements.modalOverlay.classList.contains("hidden") &&
            event.key === "PageUp"
        ) {
            event.preventDefault();
            goToPage(currentPage - 1);
            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
            event.preventDefault();
            if (!elements.mainScreen.classList.contains("hidden")) {
                elements.globalSearchToggle.checked = !elements.globalSearchToggle.checked;
                renderRecords();
                elements.searchInput.focus();
            }
            return;
        }

        if (event.key === "Escape") {
            if (!elements.modalOverlay.classList.contains("hidden")) {
                closeModal();
                return;
            }

            elements.sidebar.classList.remove("open");
        }
    });

    document.addEventListener("click", (event) => {
        if (
            window.innerWidth <= 760 &&
            elements.sidebar.classList.contains("open") &&
            !elements.sidebar.contains(event.target) &&
            !elements.mobileMenuButton.contains(event.target)
        ) {
            elements.sidebar.classList.remove("open");
        }
    });

    ["pointerdown", "keydown", "touchstart", "scroll"].forEach((eventName) => {
        document.addEventListener(eventName, resetIdleTimer, { passive: true });
    });

    document.addEventListener("visibilitychange", () => {
        if (!vaultData) return;

        if (document.visibilityState === "hidden") {
            scheduleHiddenLock();
        } else {
            if (hiddenLockTimer) {
                clearTimeout(hiddenLockTimer);
                hiddenLockTimer = null;
            }
            resetIdleTimer();
        }
    });

    window.addEventListener("beforeunload", clearSensitiveSession);

    attachPasswordToggles();
    updateClock();
    window.setInterval(updateClock, 30000);
    initializeAuthState();
})();

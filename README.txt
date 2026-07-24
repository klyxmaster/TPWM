TPWM FIREFOX EXTENSION 1.1.1
Shared Vault Manager + Click-to-Fill

WHAT CHANGED
- The Firefox extension now owns the primary encrypted TPWM database.
- The full TPWM manager opens in an extension tab.
- Website, credit-card, banking, secure-note, password-generator, admin,
  import, export, TOTP, search, and pagination features use extension storage.
- The toolbar click-to-fill popup reads the exact same current vault.
- No repeated export/import is needed between the manager and autofill.
- Export/import remains available for backup and moving to another device.

TEST INSTALL
1. Extract the ZIP.
2. Open about:debugging#/runtime/this-firefox
3. Remove the older TPWM extension.
4. Select Load Temporary Add-on.
5. Choose manifest.json.
6. Click the TPWM toolbar icon.
7. Select Open TPWM Vault Manager.
8. Create a new vault or import your existing .tpwm backup once.
9. Add or edit a website in the manager.
10. Visit that website, click TPWM in the toolbar, unlock, and select Fill.

STORAGE
- Encrypted vault record: Firefox extension storage.local
- Decrypted click-to-fill session: extension session storage / memory
- Export files: encrypted .tpwm backups selected by the user

SECURITY
- No cloud service
- No analytics
- No telemetry
- No external data transmission
- Click-to-fill requires a user action

FIX 1.1.1
- Restored the Open TPWM Vault Manager button in the toolbar popup.
- Added the missing popup JavaScript element reference.

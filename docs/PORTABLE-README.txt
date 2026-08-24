Serein Portable
=================

Run Serein.exe directly. Formal installation is not required.

Serein never stores application preferences beside this executable. Preferences
use the current Windows user's application-data directory under the permanent
io.serein.desktop identity, so the portable executable remains safe in a
read-only folder. Vault-local indexes, recovery history, and Trash stay inside
the selected synthetic/test vault under .serein/. They are never stored in the
portable application folder.

The installed and portable builds use the same vault format and safe-write rules.
Do not open the same vault concurrently from two Serein processes.

This Phase 1 test build intentionally accepts generated synthetic vaults only.
Arbitrary personal folders remain unavailable until copied-vault acceptance is
approved.

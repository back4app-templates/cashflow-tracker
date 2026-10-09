# Installing a template update

Your app is a **fork** of `templates-back4app/firmbook`, so GitHub can bring new releases into it from the web page.

1. **Back up first.** *Settings → Download backup.* Keep the file.
2. On GitHub open your fork → the bar says *This branch is N commits behind* → **Sync fork → Update branch**.
3. Back4app deploys the new commit automatically (about a minute). Open the app; *Settings → About* shows the new release.

**If the page says "Temporarily unavailable"** after the update: the release's database migration failed and **nothing was
applied** (every migration of a release runs in one transaction). In the Back4app dashboard open *Runtime logs* to read the
reason, then click **Instant Rollback** on the app's overview — the previous code runs again in a few seconds and the
database is untouched. Tell the maintainer (open an issue on the template) and wait for a corrected release.

**If the update applied but the app will not start** (rare): the previous code refuses to run on the newer schema and
says so in the runtime log. Install the release again when the maintainer publishes a fix, or — last resort — deploy a fresh
app and restore the backup from step 1 (anything entered after that backup is lost; that is why the backup comes first).

**Conflicts.** Changes inside `custom/` (logo, theme, labels) never conflict: a release never touches that folder. If you
edited any other file, GitHub may say the branches conflict and offer to *discard your commits* or *open a pull request*;
GitHub's web editor can resolve simple conflicts, anything else is a job for a developer. Releases and what changed:
`CHANGELOG.md` and the GitHub *Releases* page of the template.

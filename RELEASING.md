# Release για Windows (.exe)

Τα Windows builds γίνονται αυτόματα στο GitHub Actions από το
[`.github/workflows/release-windows.yml`](.github/workflows/release-windows.yml), σε `windows-latest` runner.
Βγαίνουν:

| Αρχείο | Τι είναι |
|---|---|
| `Grafi Setup x.y.z.exe` | Installer NSIS (x64 + arm64), με επιλογή φακέλου και συντόμευση στην επιφάνεια εργασίας |
| `Grafi x.y.z.exe` | Portable (x64), τρέχει χωρίς εγκατάσταση |
| `*.blockmap`, `latest.yml` | Μεταδεδομένα του electron-builder (για μελλοντικό auto-update) |

## Νέα έκδοση — βήμα προς βήμα

```bash
git checkout main && git pull
npm version 1.0.1          # ενημερώνει package.json + package-lock, κάνει commit και tag v1.0.1
git push --follow-tags     # σπρώχνει το commit και το tag
```

1. Το push του tag `v1.0.1` ξεκινά το workflow **Release Windows (.exe)** (tab *Actions* στο GitHub).
2. Σε ~10 λεπτά εμφανίζεται στο *Releases* το **Grafi v1.0.1** με τα `.exe` και αυτόματες release notes.
3. Αν θες, κάνε *Edit* στο release για να γράψεις σημειώσεις με το χέρι.

Χρησιμοποίησε `npm version patch | minor | major` αν δεν θες να γράψεις τον αριθμό.
Το workflow αποτυγχάνει επίτηδες αν το tag δεν ταιριάζει με το `version` του `package.json`.

## Δοκιμαστικό build χωρίς release

*Actions → Release Windows (.exe) → Run workflow*. Τα `.exe` βγαίνουν ως artifact **grafi-windows**
στη σελίδα του run (δεν δημιουργείται release).

## Τοπικά

```bash
npm ci
npm run dist:win           # τα αρχεία βγαίνουν στο release/
```

Σε macOS δουλεύει για x64/arm64 (το NSIS τρέχει μέσω του electron-builder). Το `release/` είναι στο `.gitignore`,
οπότε τα `.exe` δεν μπαίνουν ποτέ στο git — ανεβαίνουν μόνο ως συνημμένα στο GitHub Release.

## Υπογραφή κώδικα (προαιρετικό)

Χωρίς πιστοποιητικό το `.exe` είναι ανυπόγραφο και τα Windows δείχνουν
*«Τα Windows προστάτευσαν τον υπολογιστή σας»* → *Περισσότερες πληροφορίες → Εκτέλεση οπωσδήποτε*.
Για υπογραφή, πρόσθεσε στο *Settings → Secrets and variables → Actions* του repo:

- `WIN_CSC_LINK` — το `.pfx` σε base64 (`base64 -i cert.pfx | pbcopy`)
- `WIN_CSC_KEY_PASSWORD` — ο κωδικός του `.pfx`

Το workflow τα διαβάζει αυτόματα· δεν χρειάζεται άλλη αλλαγή.

## Αν κάτι πάει στραβά

- **Λάθος tag:** `git tag -d v1.0.1 && git push origin :refs/tags/v1.0.1`, διόρθωσε, και ξανά `npm version`.
- **Απέτυχε το build:** δες τα logs στο *Actions*· μετά τη διόρθωση σβήσε και ξαναφτιάξε το tag όπως πάνω
  (ή βγάλε νέο patch version).

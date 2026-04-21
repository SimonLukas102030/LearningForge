# LearningForge — Projektdokumentation für KI-Assistenten

Dieses Dokument erklärt die komplette Architektur, den Code-Stil und alle Abläufe so,
dass eine neue KI-Instanz ohne weitere Erklärung weiterarbeiten kann.

---

## Was ist LearningForge?

Eine statische Lernplattform auf GitHub Pages für Schüler. Kein Backend-Server.
Features: Login (Firebase), Noten-Tracking (Firestore), Themen-Tests mit KI-Auswertung (Gemini),
Dark/Light Mode, Statistiken, anpassbare Fächerfarben.

**Live-URL:** `https://learning-forge.simonsstudios.de`
**Repo:** `https://github.com/SimonLukas102030/LearningForge`
**Branch:** `master` (nicht `main`!)

---

## Technologie-Stack

| Was | Womit |
|-----|-------|
| Hosting | GitHub Pages (statisch) |
| Auth + DB | Firebase (Compat SDK v10, über CDN) |
| KI-Auswertung | Google Gemini 1.5 Flash (optional) |
| Routing | Hash-basiert (`#/fach/...`) |
| Styling | Reines CSS (keine Frameworks) |
| JS | ES Modules (`type="module"`), kein Build-Step |
| Struktur-Scan | GitHub Trees API (1 Call für den ganzen Baum) |

---

## Dateistruktur

```
LearningForge/
├── index.html                        # App-Shell (alles wird per JS gerendert)
├── CLAUDE.md                         # Diese Datei
├── ADDING_TOPICS.md                  # Kurzanleitung für neue Inhalte
├── assets/
│   ├── css/
│   │   └── main.css                  # Alle Styles (kein externes CSS)
│   └── js/
│       ├── config.js                 # GitHub + Firebase + Gemini Config
│       ├── main.js                   # Einstiegspunkt (init + start)
│       ├── auth.js                   # Firebase Auth + Firestore
│       ├── scanner.js                # GitHub Trees API → Struktur
│       ├── app.js                    # Router + alle Seiten-Renderer
│       └── test-engine.js            # Test-Logik, Bewertung, Noten
└── Fächer/
    ├── subjects-config.json          # Farben + Icons pro Fach
    └── [Fach]/
        └── [Klasse]/
            └── [Thema]/
                ├── meta.json         # Lerninhalt (HTML)
                └── questions.json    # Testfragen
```

---

## Routing

Hash-basiert, alle Routen in `app.js → route()`:

| Hash | Seite |
|------|-------|
| `#/` | Dashboard |
| `#/fach/Mathematik` | Fach-Übersicht (Jahresauswahl) |
| `#/fach/Mathematik/Klasse-9` | Klassen-Übersicht (Themenliste) |
| `#/fach/Mathematik/Klasse-9/Potenzgleichungen` | Thema (Inhalt + Test) |
| `#/statistiken` | Statistik-Seite |
| `#/profil` | Profil |
| `#/einstellungen` | Einstellungen (Fächerfarben, Theme) |

---

## Struktur-Scanner (`scanner.js`)

Lädt die Ordnerstruktur aus GitHub in **einem einzigen API-Call**:

```
GET https://api.github.com/repos/SimonLukas102030/LearningForge/git/trees/master?recursive=1
```

Gibt einen Baum aller Dateien zurück. Der Scanner filtert nach `Fächer/`-Pfaden
und baut daraus das `structure`-Objekt:

```js
structure = {
  Mathematik: {
    id: 'Mathematik', name: 'Mathematik', color: '#3b82f6', icon: '📐',
    years: {
      'Klasse-9': {
        id: 'Klasse-9', name: 'Klasse 9',
        topics: {
          'Potenzgleichungen': { id: 'Potenzgleichungen', name: 'Potenzgleichungen' }
        }
      }
    }
  }
}
```

**Wichtig:** Der Ordner heißt `Fächer` (mit ä). Der Scanner fängt verschiedene
Encodings ab (`ä`, `\u00e4`, `%C3%A4`). Raw-GitHub-URLs nutzen `F%C3%A4cher/`.

**Cache:** Ergebnis wird in `sessionStorage` gecacht. Invalidierung per Commit-SHA.

---

## Datenbankschema (Firestore)

```
users/
  {uid}/
    name: string
    email: string
    createdAt: timestamp
    grades:
      {subjectId}__{yearId}__{topicId}:
        grade: number (1-6)
        points: number
        maxPoints: number
        date: timestamp
    settings:
      subjectColors:
        {subjectId}: string (hex color)
```

Sicherheitsregel: Nutzer kann nur eigene Daten lesen/schreiben.

---

## Neue Inhalte hinzufügen

### Neues Thema (einfachster Fall)

1. Ordner erstellen: `Fächer/Mathematik/Klasse-9/Lineares-Gleichungssystem/`
2. `meta.json` erstellen (Lerninhalt):
```json
{
  "name": "Lineares Gleichungssystem",
  "description": "Kurze Beschreibung",
  "content": "<h3>Titel</h3><p>HTML-Inhalt hier...</p>"
}
```
3. `questions.json` erstellen (Testfragen):
```json
{
  "questions": [
    {
      "id": "q1",
      "type": "multiple_choice",
      "difficulty": "easy",
      "question": "Fragetext?",
      "options": ["A", "B", "C", "D"],
      "correct": 0,
      "points": 2
    },
    {
      "id": "q2",
      "type": "free_text",
      "difficulty": "medium",
      "question": "Erkläre...",
      "maxPoints": 4,
      "keywords": ["schlüssel1", "schlüssel2"],
      "sampleAnswer": "Musterantwort für KI."
    }
  ]
}
```
4. Commit + Push → fertig. Die Seite erkennt das neue Thema automatisch.

### Neues Schuljahr

Nur Ordner `Fächer/Mathematik/Klasse-10/` anlegen.
Keine weitere Konfiguration nötig.

### Neues Fach

1. Ordner anlegen: `Fächer/NeuesFach/`
2. In `Fächer/subjects-config.json` eintragen:
```json
"NeuesFach": {
  "name": "Anzeigename",
  "color": "#farbe",
  "icon": "emoji"
}
```
Ohne Eintrag: automatische Farbe + Standard-Icon `📚`.

### Ordner-Benennung

- Leerzeichen → Bindestrich: `Klasse 9` → `Klasse-9`
- Ordnername wird als Anzeigename genutzt (Bindestrich → Leerzeichen)
- Überschreiben mit `"name"` in `meta.json` möglich

---

## Fragen-Format

### Multiple Choice
```json
{
  "id": "eindeutige-id",
  "type": "multiple_choice",
  "difficulty": "easy" | "medium" | "hard",
  "question": "Fragetext",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correct": 0,        // Index der richtigen Antwort (0-3)
  "points": 2
}
```
Optionen werden beim Test automatisch gemischt.

### Freitext
```json
{
  "id": "eindeutige-id",
  "type": "free_text",
  "difficulty": "easy" | "medium" | "hard",
  "question": "Erkläre...",
  "maxPoints": 4,
  "keywords": ["begriff1", "begriff2"],   // Für Keyword-Fallback
  "sampleAnswer": "Musterantwort."        // Für Gemini-Auswertung
}
```

### Schwierigkeiten & Testzeiten

| difficulty | erscheint bei |
|---|---|
| `easy` | 5, 10, 15, 30, 90 min |
| `medium` | 10, 15, 30, 90 min |
| `hard` | 30, 90 min |

Bei 90 min: KI-Prompt erwartet ausführliche Antworten mit Beispielen.

---

## KI-Auswertung

**Gemini 1.5 Flash** (kostenloser Tier: 15 req/min, 1500/Tag).
API-Key in `assets/js/config.js` bei `gemini.apiKey`.

Fallback ohne Key: Keyword-Matching (zählt `keywords`-Treffer in der Antwort).

Copy-Button generiert formatierten Text mit Fragen, Antworten, Punkten und Zeit
— zum manuellen Einfügen in ChatGPT/Gemini für besseres Feedback.

---

## Design-System (`main.css`)

### CSS-Variablen (Tokens)

```css
--bg            /* Seitenhintergrund */
--bg-card       /* Karten-Hintergrund */
--bg-nav        /* Navbar (blur) */
--bg-input      /* Input-Felder */
--text          /* Haupttext */
--text-muted    /* Sekundärtext */
--border        /* Rahmen */
--accent        /* Hauptakzent (#6366f1 Indigo) */
--radius        /* 14px */
--radius-sm     /* 8px */
--transition    /* 0.2s ease */
```

Dark Mode: `[data-theme="dark"]` überschreibt alle Variablen.
Theme wird in Cookie `lf_theme` gespeichert und sofort in `index.html` angewendet
(verhindert Flackern beim Laden).

### Keine Emojis

Im gesamten Code, in HTML-Templates und in JSON-Dateien (außer `subjects-config.json`
für Fach-Icons und `meta.json` für Lerninhalte) werden **keine Emojis** verwendet.
Buttons, Labels, Überschriften und Fehlermeldungen im JS bleiben emoji-frei.

### Klassen-Konventionen

| Klasse | Verwendung |
|--------|-----------|
| `.page` | Seitencontainer (max-width 1100px, padding) |
| `.card` | Generische Karte mit Hover-Schatten |
| `.btn .btn-primary` | Hauptbutton (Indigo) |
| `.btn .btn-secondary` | Sekundärbutton |
| `.btn .btn-ghost` | Transparenter Button |
| `.btn-lg` | Großer Button |
| `.btn-sm` | Kleiner Button |
| `.form-input` | Texteingabe mit Focus-Ring |
| `.section-title` | Uppercase-Überschrift |
| `.empty-state` | Zentrierter Leer-Zustand |
| `.toast` | Kurze Benachrichtigung (unten rechts) |

### Subject-Color

Jede Fach-Komponente nutzt `--subject-color` als CSS-Variable:
```html
<div style="--subject-color: #3b82f6">...</div>
```
In CSS: `border-color: var(--subject-color, var(--accent));`

### Noten-Farben

```
Note 1 → #10b981 (Grün)
Note 2 → #22d3ee (Cyan)
Note 3 → #f59e0b (Gelb)
Note 4 → #f97316 (Orange)
Note 5 → #ef4444 (Rot)
Note 6 → #7f1d1d (Dunkelrot)
```

Funktion: `gradeColor(grade)` in `app.js`

---

## Wichtige Funktionen

### app.js

| Funktion | Beschreibung |
|----------|-------------|
| `startApp()` | Auth-Listener starten, Routing initialisieren |
| `route()` | Hash → richtige Render-Funktion |
| `renderDashboard()` | Hauptseite mit Fächern, Streak, Aufmerksamkeit |
| `renderStatistics()` | Statistikseite mit Charts |
| `renderSettings()` | Fächerfarben anpassen |
| `calcStreak()` | Lern-Streak aus Firestore-Daten berechnen |
| `getNeedsAttention()` | Themen mit Note ≥ 4 |
| `getRecentTests()` | Letzte 5 Tests |
| `getSubjectProgress()` | % getestete Themen + Ø Note pro Fach |
| `showToast(msg, type)` | Toast-Benachrichtigung zeigen |

### test-engine.js

| Funktion | Beschreibung |
|----------|-------------|
| `selectQuestions(questions, minutes)` | Fragen filtern + mischen |
| `evaluateAnswers(questions, answers, minutes)` | Alle Antworten auswerten |
| `calcGrade(points, maxPoints)` | Note + Label + Farbe |
| `generateCopyText(...)` | Formatierten Ergebnistext erzeugen |

### scanner.js

| Funktion | Beschreibung |
|----------|-------------|
| `getStructure(forceRefresh?)` | Ordnerstruktur von GitHub laden |
| `getTopicMeta(subject, year, topic)` | meta.json eines Themas laden |
| `getTopicQuestions(subject, year, topic)` | questions.json laden |

---

## Git-Workflow

```bash
# Änderungen immer erst pullen (User bearbeitet config.js oft im Browser)
git pull --rebase origin master

# Dann committen
git add .
git commit -m "Beschreibung"
git push
```

**Branch ist `master`**, nicht `main`.

Nach einem Push braucht GitHub Pages 1-2 Minuten.
Browser-Cache leeren mit **Strg+Shift+R**.

---

## Bekannte Eigenheiten

1. **Fächer-Umlaut:** Der Ordner heißt `Fächer` (ä). Raw-GitHub-URLs brauchen `F%C3%A4cher/`.
   Der Scanner fängt alle Varianten ab.

2. **Firebase Compat SDK:** Nicht die modulare v9-API, sondern `firebase.auth()` / `firebase.firestore()`
   via CDN-Script. Kein Build-Step nötig.

3. **Passwort-Hashing:** Passwörter werden vor Firebase mit SHA-256 gehasht.
   Das bedeutet: Passwörter können nicht zurückgesetzt werden (noch nicht implementiert).

4. **GitHub API Rate Limit:** 60 Requests/Stunde ohne Auth. Durch sessionStorage-Cache
   wird pro Session nur 1-2 Calls gemacht.

5. **`window.LF`:** Alle Event-Handler aus HTML-Templates nutzen `window.LF.*`.
   Das Objekt wird in `app.js` am Ende definiert.

6. **Rangliste (Firestore-Regeln):** Die `leaderboard`-Collection braucht eigene Regeln.
   Ohne diese erscheint ein Hinweis auf der Rangliste-Seite:
   ```
   match /leaderboard/{uid} {
     allow read: if request.auth != null;
     allow write: if request.auth != null && request.auth.uid == uid;
   }
   ```

7. **Tab-Wechsel-Erkennung:** Während eines Tests registriert `document.visibilitychange` jeden Tab-Wechsel.
   Das Ergebnis wird sofort als Note 6 gewertet und im Leaderboard gespeichert.

8. **Keine Emojis** im JS-Code, HTML-Templates oder JSON (außer `subjects-config.json`-Icons und `meta.json`-Inhalte).

---

## Lerninhalt-Format (meta.json) — Visuelles Lernen

Der `content`-Key enthält HTML-String. Für visuell ansprechendes Lernen
gibt es spezielle CSS-Klassen. **Kein langer Fließtext** — stattdessen
Boxen, Formeln, Schritte und Hervorhebungen nutzen.

### Callout-Boxen

```html
<div class="lf-box lf-info">💡 Hinweis oder interessante Information</div>
<div class="lf-box lf-tip">✅ Tipp oder Merkhilfe</div>
<div class="lf-box lf-warn">⚠️ Wichtiger Hinweis oder häufiger Fehler</div>
<div class="lf-box lf-danger">🚨 Typischer Denkfehler</div>
<div class="lf-box lf-formula">v = s / t</div>
```

### Schlüsselkonzept-Karte

```html
<div class="lf-key">
  <div class="lf-key-title">Kernaussage</div>
  <div class="lf-key-body">Das Superpositionsprinzip: Mehrere Bewegungen laufen
  <span class="lf-hl">unabhängig voneinander</span> ab und überlagern sich.</div>
</div>
```

### Definition

```html
<dl class="lf-def">
  <dt>Beschleunigung</dt>
  <dd>Änderung der Geschwindigkeit pro Zeit: a = Δv / Δt (Einheit: m/s²)</dd>
  <dt>Gleichförmige Bewegung</dt>
  <dd>Konstante Geschwindigkeit, keine Beschleunigung.</dd>
</dl>
```

### Schritte-Liste (nummeriert, visuell)

```html
<ol class="lf-steps">
  <li>Gegeben: v₀ = 20 m/s, g = 10 m/s²</li>
  <li>Gesucht: Steigzeit t</li>
  <li>Formel: t = v₀ / g</li>
  <li>Einsetzen: t = 20 / 10 = <span class="lf-hl">2 s</span></li>
</ol>
```

### Zwei-Spalten-Layout

```html
<div class="lf-two-col">
  <div>
    <strong>Waagerechter Wurf</strong>
    <p>Horizontal: gleichförmig (keine Beschleunigung)</p>
  </div>
  <div>
    <strong>Freier Fall</strong>
    <p>Vertikal: gleichmäßig beschleunigt (g = 9,81 m/s²)</p>
  </div>
</div>
```

### Tabelle

```html
<table class="lf-table">
  <thead><tr><th>Note</th><th>Sekundarstufe-Punkte</th><th>Bedeutung</th></tr></thead>
  <tbody>
    <tr><td>1</td><td>15</td><td>Sehr gut</td></tr>
    <tr><td>6</td><td>0</td><td>Ungenügend</td></tr>
  </tbody>
</table>
```

### Bild mit Beschriftung

```html
<img class="lf-img" src="https://..." alt="Parabelwurf">
<p class="lf-img-caption">Abb.: Überlagerung von horizontaler und vertikaler Bewegung</p>
```

### Inline-Hervorhebung

```html
Die Fallzeit hängt <span class="lf-hl">nicht</span> von der Horizontalgeschwindigkeit ab.
```

### Vollständiges Beispiel meta.json

```json
{
  "name": "Superpositionsprinzip",
  "description": "Überlagerung unabhängiger Bewegungen",
  "content": "<div class='lf-key'><div class='lf-key-title'>Kernaussage</div><div class='lf-key-body'>Mehrere Bewegungen laufen <span class='lf-hl'>unabhängig voneinander</span> ab und überlagern sich.</div></div><div class='lf-box lf-formula'>sₓ = vₓ · t &nbsp;|&nbsp; s_y = ½ · g · t²</div><ol class='lf-steps'><li>Horizontal: gleichförmig — keine Beschleunigung</li><li>Vertikal: freier Fall — g = 9,81 m/s²</li><li>Zeit t ist für beide Richtungen identisch</li></ol><div class='lf-box lf-tip'>💡 Ein senkrecht fallen gelassenes und ein waagerecht abgeschossenes Objekt landen gleichzeitig!</div>"
}
```

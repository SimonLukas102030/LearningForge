# LearningForge — Inhalte hinzufügen

Die Seite scannt das Repository automatisch. Du musst **keine** Konfigurationsdatei anpassen — einfach Ordner anlegen, Dateien rein, pushen.

---

## Neues Thema hinzufügen

```
Fächer/
  MeinFach/
    MeineKlasse/
      MeinThema/          ← neuer Ordner
        meta.json         ← Lerninhalt
        questions.json    ← Testfragen
```

### meta.json

```json
{
  "name":        "Thema-Anzeigename",
  "description": "Kurze Beschreibung (optional)",
  "content":     "<p>Lerninhalt als HTML.</p><ul><li>Punkt 1</li></ul>"
}
```

Das `content`-Feld unterstützt HTML: `<h3>`, `<p>`, `<ul>`, `<strong>`, `<blockquote>` usw.

### questions.json

```json
{
  "questions": [
    {
      "id": "q1",
      "type": "multiple_choice",
      "difficulty": "easy",
      "question": "Wie lautet die Frage?",
      "options": ["Antwort A", "Antwort B", "Antwort C", "Antwort D"],
      "correct": 1,
      "points": 2
    },
    {
      "id": "q2",
      "type": "free_text",
      "difficulty": "medium",
      "question": "Erkläre in eigenen Worten...",
      "maxPoints": 4,
      "keywords": ["schlüsselwort1", "schlüsselwort2"],
      "sampleAnswer": "Musterlösung für KI-Auswertung."
    }
  ]
}
```

#### Frage-Typen

| Typ | Beschreibung |
|-----|-------------|
| `multiple_choice` | 4 Optionen, eine richtig. `correct` = Index (0-3). Optionen werden automatisch gemischt. |
| `free_text` | Freitext-Antwort. Wird per KI oder Keyword-Matching ausgewertet. |

#### Schwierigkeiten & Testzeiten

| `difficulty` | Erscheint bei |
|---|---|
| `easy` | 5, 10, 15, 30, 90 min |
| `medium` | 10, 15, 30, 90 min |
| `hard` | 30, 90 min (bei 90 min: ausführliche Antworten nötig) |

---

## Neues Schuljahr hinzufügen

Einfach einen neuen Ordner innerhalb des Fach-Ordners anlegen:

```
Fächer/Mathematik/Klasse-6/
  NeuesThema/
    meta.json
    questions.json
```

Kein weiterer Schritt nötig.

---

## Neues Fach hinzufügen

1. Ordner anlegen: `Fächer/NeuesFach/`
2. In `Fächer/subjects-config.json` eine Zeile hinzufügen:

```json
"NeuesFach": {
  "name":  "Anzeigename",
  "color": "#farbe",
  "icon":  "emoji"
}
```

Ohne Eintrag in `subjects-config.json` erscheint das Fach trotzdem — aber mit automatischer Farbe und Standard-Icon `📚`.

---

## Ordner-Namensregeln

- Leerzeichen → Bindestrich: `Zahlen und Mengen` → `Zahlen-und-Mengen`
- Umlaute sind erlaubt: `Körper-und-Flächen`
- Der Anzeigename wird automatisch aus dem Ordnernamen generiert (Bindestriche → Leerzeichen)
- Du kannst den Anzeigenamen in `meta.json` überschreiben

---

## Einmaliges Setup

### 1. Firebase einrichten

1. [Firebase Console](https://console.firebase.google.com) → Neues Projekt
2. Authentication → E-Mail/Passwort + Google aktivieren
3. Firestore Database → Erstellen (Produktionsmodus)
4. Projekt-Einstellungen → Web-App registrieren → Config kopieren
5. In `assets/js/config.js` eintragen

### 2. Gemini KI (optional, kostenlos)

1. [Google AI Studio](https://aistudio.google.com/app/apikey) → API-Key erstellen
2. In `assets/js/config.js` bei `gemini.apiKey` eintragen
3. Ohne Key: automatische Keyword-Auswertung + Copy-Button für manuelle KI-Auswertung

### 3. GitHub-Username eintragen

In `assets/js/config.js`:
```js
github: {
  owner: 'DeinGitHubUsername',
  repo:  'LearningForge',
  branch: 'main'
}
```

### 4. GitHub Pages aktivieren

Repository → Settings → Pages → Source: `main` branch → `/ (root)`

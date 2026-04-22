# LearningForge — Master Roadmap

> Alle Features in der Projektideen_Zukunft.md gelten als **erledigt** (Gruppen, Custom Content, Admin, Vokabeltrainer, Visual Builder, Score-Multiplikatoren, Leaderboard).
> Diese Roadmap plant ausschließlich neue Features — geordnet nach Abhängigkeiten, von Fundament bis Skalierung.

## Stand — April 2026

| Phase | Status |
|-------|--------|
| Phase 0 — Quick Wins | ✅ Fertig |
| Phase 1 — PWA & Offline | ✅ Fertig (F-11, F-12, F-13; F-14 Push-Notifs offen) |
| Phase 2 — Lernerlebnis | ✅ Fertig |
| Phase 3 — Gamification | ✅ Fertig |
| Phase 4 — Soziale Features | ✅ Fertig (F-30, F-31, F-34, F-35; F-32 Duell & F-33 Live-Session offen) |
| Phase 5 — KI-Integration | ✅ Fertig (F-36, F-37, F-38, F-40; F-39 Adaptiv & F-41 Qualitätsprüfung offen) |
| Phase 6 — Lehrer & Analytics | ✅ Fertig (F-42, F-43, F-44, F-46; F-45 Lehrplan-Mapping offen) |
| Phase 7 — Skalierung | 🔲 Offen |

**Zusätzlich fertig (außerhalb Roadmap):**
- Groq als primärer KI-Provider (llama-3.3-70b-versatile) — Gemini als Fallback
- Profil-Bild hochladen (PNG ≤ 512×512) + Emoji-Picker
- Profil-Name bearbeiten

---

## Legende

| Symbol | Bedeutung |
|--------|-----------|
| S | Klein (1–2 Tage) |
| M | Mittel (3–5 Tage) |
| L | Groß (1–2 Wochen) |
| XL | Sehr groß (mehrere Wochen) |
| → | Benötigt als Voraussetzung |

---

## Phase 0 — Quick Wins
*Keine Voraussetzungen. Sofort umsetzbar. Hohe Wirkung für wenig Aufwand.*

---

### F-01 — Passwort-Reset via E-Mail
**Aufwand:** S  
**Voraussetzung:** —  
SHA-256-Hashing macht Firebase-eigene Resets unmöglich. Lösung: Eigenes Reset-Token in Firestore speichern, E-Mail via Firebase Extensions (Trigger Email) versenden. Nutzer klickt Link → kann neues Passwort setzen. Alternativ: SHA-256 abschaffen und direkt Firebase-Auth-Reset nutzen (einfacher, empfohlen).

---

### F-02 — Chemie-Tafelwerk Widget
**Aufwand:** M  
**Voraussetzung:** —  
Floating Widget analog zum Taschenrechner (Mathematik), nur für `subjectId === 'Chemie'`. Inhalt: Periodensystem, Konstanten (Avogadro, Faraday, R, …), Formeln, Einheiten. Daten in `Fächer/Chemie/tafelwerk.json`. Suchfeld filtert live. CSS-Klasse `.tafelwerk-widget` (Section 33 in `main.css`). Aufklappbar per Button, persistent offen während Lernseite aktiv.

---

### F-03 — Erweiterte Fehler-Analyse nach dem Test
**Aufwand:** S  
**Voraussetzung:** —  
Nach Testabschluss: Zusätzliche Sektion "Was war falsch?" — zeigt jede falsch beantwortete Frage nochmal, die richtige Antwort, und bei Freitext die KI-Begründung. Speichert welche Fragen-IDs regelmäßig falsch beantwortet werden (`users/{uid}/weakQuestions/{questionId}: count`).

---

### F-04 — Retry-Modus (Nur Fehler wiederholen)
**Aufwand:** S  
**Voraussetzung:** F-03  
Nach dem Test: Button "Nur falsche Fragen nochmal üben". Startet einen neuen Test im Üben-Modus (keine Note, keine Leaderboard-Eintragung) ausschließlich mit den falsch beantworteten Fragen des letzten Durchlaufs.

---

### F-05 — Lückentext-Fragen (Fill-in-the-Blank)
**Aufwand:** M  
**Voraussetzung:** —  
Neuer Fragetyp `"type": "fill_blank"` in `questions.json`. Text mit `{{Lücke}}`-Platzhaltern, Nutzer tippt die fehlenden Wörter. Auswertung: case-insensitiv, Tippfehler-Toleranz. Erscheint nur bei 10+ min Tests (nicht bei 5-min-Schnelltests). Gemini-Auswertung optional als Fallback.

---

### F-06 — Zuordnungs-Fragen (Matching)
**Aufwand:** M  
**Voraussetzung:** —  
Neuer Fragetyp `"type": "matching"`. Zwei Spalten (Begriffe ↔ Definitionen), per Drag-and-Drop zuordnen oder Dropdown-Auswahl (mobil-freundlich). Punkte anteilig (1 Pkt. pro korrektem Paar). Ideal für Sprachen, Geschichte, Biologie.

---

### F-07 — Sortier-Fragen (Timeline / Reihenfolge)
**Aufwand:** M  
**Voraussetzung:** —  
Neuer Fragetyp `"type": "sort"`. Liste von Elementen, die in die richtige Reihenfolge gezogen werden müssen. Perfekt für Geschichte (Ereignisse), Chemie (Reaktionsschritte), Biologie (Prozesse). Punkte: 1 Pkt. je korrekt platziertem Element.

---

### F-08 — Keyboard-Navigation & Shortcuts
**Aufwand:** S  
**Voraussetzung:** —  
Global: `Alt+H` → Dashboard, `Alt+S` → Statistiken, `Alt+P` → Profil, `Alt+E` → Einstellungen. Während Test: `1–4` für MC-Antworten, `Enter` zum Bestätigen, `→` nächste Frage. Hilfe-Dialog via `?`. Shortcuts werden bei erster Nutzung kurz eingeblendet.

---

### F-09 — Skeleton-Loading-Animationen
**Aufwand:** S  
**Voraussetzung:** —  
Statt weißem Flash oder "Laden…"-Text: Pulsende Platzhalter-Karten (grauer Balken-Shimmer) während Firestore und GitHub-Tree laden. CSS-only Implementierung. Verbessert den ersten Eindruck deutlich.

---

### F-10 — Inhalts-Bewertung (Nützlich / Nicht nützlich)
**Aufwand:** S  
**Voraussetzung:** —  
Daumen-rauf / Daumen-runter Button am Ende jedes Lernthemas. Speichert in `feedback/{subjectId}/{topicId}/ratings: {up: n, down: n}`. Admin sieht diese Werte im Admin-Panel. Hilft schwache Inhalte zu identifizieren. Pro Nutzer nur 1 Stimme (in `users/{uid}/ratings`).

---

## Phase 1 — PWA & Offline
*Voraussetzung: Phase 0 abgeschlossen. Fundament für alle mobilen Features.*

---

### F-11 — Service Worker & Offline-Modus
**Aufwand:** L  
**Voraussetzung:** —  
Service Worker mit Cache-First für statische Assets (JS, CSS, HTML). Network-First für meta.json und questions.json mit Fallback auf gecachte Version. Zeigt Offline-Banner wenn kein Netz, lässt aber bereits geladene Inhalte lesen. `manifest.json` anpassen für bessere Install-Erfahrung. Grundlage für alle Offline-Features.

---

### F-12 — Offline-Testergebnisse synchronisieren
**Aufwand:** M  
**Voraussetzung:** F-11  
Test komplett offline abschließen, Ergebnis in `indexedDB` zwischenspeichern (`lf_pending_grades`). Beim nächsten Online-Gang automatisch zu Firestore synchronisieren und Leaderboard aktualisieren. Toast-Meldung: "3 Ergebnisse werden synchronisiert…"

---

### F-13 — App-Installations-Prompt
**Aufwand:** S  
**Voraussetzung:** F-11  
`beforeinstallprompt` abfangen, eigene Install-Card im Dashboard anzeigen ("App installieren für Offline-Nutzung"). Einmal weggeklickt → nie wieder zeigen (localStorage-Flag). Nur wenn noch nicht installiert und Service Worker aktiv.

---

### F-14 — Push-Benachrichtigungen
**Aufwand:** L  
**Voraussetzung:** F-11  
Firebase Cloud Messaging (FCM) über den Service Worker. Nutzer kann in Einstellungen aktivieren: "Tägl. Lern-Erinnerung um 18:00 Uhr", "Jemand hat meine Gruppe betreten", "Neuer Custom Content in meiner Gruppe". FCM-Token in `users/{uid}/fcmTokens[]` speichern. Noch kein Backend → Firebase Extensions "Send Messages" nutzen.

---

## Phase 2 — Lernerlebnis
*Neue Lernmodi die über den Timed-Test hinausgehen.*

---

### F-15 — Lernkarten-Modus (Flashcards)
**Aufwand:** M  
**Voraussetzung:** —  
Neuer Tab auf der Themen-Seite: "Karteikarten". Zeigt Vorderseite (Frage/Begriff), Klick dreht Karte und zeigt Rückseite (Antwort). Navigation: Tastatur-Pfeile oder Buttons. Kein Timer, keine Note. Nutzer markiert selbst: "Wusste ich" / "Wusste ich nicht". Funktioniert auch mit Vocab-Typ Fragen.

---

### F-16 — Spaced-Repetition-System (SRS)
**Aufwand:** L  
**Voraussetzung:** F-15, F-03  
SM-2-Algorithmus (wie Anki). Jede Fragen-ID bekommt einen `nextReview`-Timestamp und `interval`-Tage in `users/{uid}/srs/{questionId}`. Dashboard zeigt: "Du hast heute 12 Karten zu wiederholen." Tägliche Review-Session aus allen Fächern gemischt. Keine Noten, keine Leaderboard-Einträge — reine Gedächtnisstärkung.

---

### F-17 — Pomodoro-Lerntimer
**Aufwand:** S  
**Voraussetzung:** —  
Floating Timer-Widget auf der Lerninhalt-Seite. Standard: 25 min Lernen / 5 min Pause. Konfigurierbar in Einstellungen. Tickt im Hintergrund (auch bei Tab-Wechsel). Pause: zeigt Motivationsnachricht. Speichert Lernzeit-Statistik (`users/{uid}/studyTime/{date}: minutes`). Grundlage für F-38 (Lernanalysen).

---

### F-18 — Notizen-Funktion
**Aufwand:** M  
**Voraussetzung:** —  
Auf jeder Lerninhalt-Seite: ausklappbare Notizen-Leiste (rechts oder unten). Markdown-fähig, Auto-Save nach 2s Inaktivität in `users/{uid}/notes/{subjectId}__{yearId}__{topicId}`. Notizen in Profil-Seite als Liste exportierbar (Copy-Text-Format). Privatnotizen, nicht geteilt.

---

### F-19 — Lesezeichen-System
**Aufwand:** S  
**Voraussetzung:** —  
Lesezeichen-Icon auf jeder Themen-Karte und im Themen-Header. Toggle in `users/{uid}/bookmarks[]` (Array mit `subjectId__yearId__topicId`). Eigene Seite `#/lesezeichen` listet alle gespeicherten Themen. Sortierbar nach Fach oder Datum hinzugefügt.

---

### F-20 — Wissens-Check (Quick-Quiz nach dem Lesen)
**Aufwand:** M  
**Voraussetzung:** —  
Am Ende des Lerninhalts (nach dem HTML-Content): 2–3 automatisch ausgewählte "easy"-Fragen als kompakter Inline-Quiz — ohne Timer, ohne Note. Zeigt sofort richtig/falsch. Ziel: Retention-Check bevor der Nutzer in den Test geht. KI kann bei leerer questions.json auch Fragen generieren.

---

### F-21 — LaTeX / MathJax-Support
**Aufwand:** M  
**Voraussetzung:** —  
MathJax 3 via CDN einbinden (nur wenn das Fach Mathematik oder Physik aktiv ist). Renderer wird nur geladen wenn `meta.json` den String `$$` enthält (lazy load). Erlaubt Formeln wie `$$f(x) = \frac{d}{dx}$$` in Lerninhalten. Kein Build-Step nötig.

---

### F-22 — Code-Highlighting (Informatik-Support)
**Aufwand:** S  
**Voraussetzung:** —  
Prism.js via CDN einbinden (nur für Fach Informatik). `<pre class="lf-code" data-lang="python">...</pre>` als neue CSS-Klasse in Design-System. Syntax-Highlighting + Copy-Button. Im Visual Builder als neuer Block-Typ verfügbar.

---

### F-23 — Lernpfade
**Aufwand:** L  
**Voraussetzung:** —  
Optionaler `"prerequisites"` Key in `meta.json`: `["Potenzgesetze", "Lineare-Gleichungen"]`. Dashboard zeigt Warnung wenn Nutzer ein Thema aufruft ohne die Vorgänger abgeschlossen zu haben. Separate Seite `#/lernpfad/Mathematik/Klasse-9` zeigt gerichteten Graph der Themen (CSS-only, kein Library). Durchstrichene Themen = abgeschlossen.

---

## Phase 3 — Gamification 3.0
*Setzt gute Statistik-Datenbasis voraus (F-03, F-17).*

---

### F-24 — Achievement-System (Badges)
**Aufwand:** L  
**Voraussetzung:** F-03, F-17  
30+ Achievements in einer statischen Config-JSON. Beispiele: "Erste 1", "7-Tage-Streak", "100 Fragen beantwortet", "Alle Themen eines Fachs getestet", "Nachts nach 23 Uhr gelernt", "5 Tests in einem Tag". Achievements in `users/{uid}/achievements[]` gespeichert. Profil zeigt Badge-Grid. Neue Badges lösen Toast + Animation aus.

---

### F-25 — XP & Level-System
**Aufwand:** M  
**Voraussetzung:** F-24  
Parallel zu Noten: Erfahrungspunkte (XP) für jede Aktion. Test abschließen: +XP (skaliert mit Note und Multiplikator), Achievement: +Bonus-XP, SRS-Review: +XP, Custom Content erstellt: +XP. Level 1–100 mit Titel (Anfänger → Meisterschüler → Gelehrter). XP-Bar in Navbar sichtbar. Leaderboard kann nach XP oder Noten gefiltert werden.

---

### F-26 — Daily Challenge
**Aufwand:** M  
**Voraussetzung:** F-25  
Jeden Tag eine neue zufällige Herausforderung aus allen verfügbaren Fragen (Cross-Fach). 5 Minuten, 6 Fragen, Ergebnis öffentlich auf eigener `#/daily-challenge`-Seite. Rangliste für heutige Challenge. Bonus-XP für Teilnahme, extra Bonus für Note 1. Seed basiert auf Datum (alle sehen dieselben Fragen).

---

### F-27 — Streak-Kalender
**Aufwand:** M  
**Voraussetzung:** F-17  
GitHub-Contribution-Graph-Style auf der Profil-Seite. Jede Zelle = ein Tag, Farbe = Lernintensität (Anzahl Tests × Minuten). Hover: Tooltip mit Detail. Aktueller Streak + längster Streak prominent angezeigt. Freeze-Schutz: Ein "Streak-Freeze" pro Woche als Bonus bei langer Streak (z.B. ab 14 Tagen).

---

### F-28 — Fach-Ranglisten
**Aufwand:** S  
**Voraussetzung:** —  
Leaderboard aufteilen: Global + je Fach (Mathematik-Rangliste, Englisch-Rangliste, …). Filter-Dropdown auf Leaderboard-Seite. Speicherung: `leaderboard/{uid}/subjects/{subjectId}: {points, avgGrade}`. Wird bei jedem Test-Abschluss aktualisiert.

---

### F-29 — Wöchentliche Zusammenfassung
**Aufwand:** M  
**Voraussetzung:** F-24, F-25, F-27  
Montags um 08:00 Uhr (via FCM aus F-14) oder beim ersten App-Öffnen: Modal mit Wochenrückblick. Zeigt: Gelernte Minuten, absolvierte Tests, verdiente XP, neue Achievements, Streak-Verlauf, stärkste und schwächste Fächer. Motivierender Abschluss-Satz (aus Array von 20 Templates).

---

## Phase 4 — Soziale Features
*Baut auf Gruppen-System auf. Gruppen selbst sind bereits implementiert.*

---

### F-30 — Freunde-System ✅
**Aufwand:** M  
**Voraussetzung:** F-25  
Nutzer per Nutzername suchen und als Freund hinzufügen. Anfrage → Akzeptieren/Ablehnen. `users/{uid}/friends[]` + `users/{uid}/friendRequests[]`. Freunde-Tab auf Leaderboard-Seite (eigene Rangliste nur Freunde). Freundes-Profil öffentlich einsehbar (Streak, Badges, Level).

---

### F-31 — Aktivitäts-Feed ✅
**Aufwand:** M  
**Voraussetzung:** F-30  
Eigene Seite `#/feed`. Zeigt Aktivitäten von Freunden und Gruppenmitgliedern: "Jonas hat Mathe: Potenzgleichungen mit Note 2 abgeschlossen", "Lea hat Badge ‚7-Tage-Streak' verdient", "Mia hat neuen Inhalt für Geschichte hochgeladen". Feed-Einträge in `feed/{uid}/{timestamp}`, werden beim nächsten Login der Freunde angezeigt.

---

### F-32 — 1v1 Herausforderung (Duel-Modus)
**Aufwand:** L  
**Voraussetzung:** F-30  
Freund zu einem Topic-Duell herausfordern. Beide sehen dieselben Fragen (gleicher Seed), gleiche Zeit. Ergebnisse werden erst nach Abschluss beider Parteien verglichen. Sieger bekommt Bonus-XP. Herausforderung läuft 24h (danach verfallen). Firestore-Dokument: `duels/{duelId}`.

---

### F-33 — Gruppen-Live-Session
**Aufwand:** XL  
**Voraussetzung:** F-30, F-32  
Gruppen-Admin startet eine Live-Session: alle Mitglieder sehen denselben Test zur selben Zeit (Countdown-Start). Echtzeit-Anzeige wer schon fertig ist (keine Antworten, nur Fortschritt). Am Ende: gemeinsame Ergebnis-Seite mit allen Ranglisten. Technisch: Firestore `sessions/{sessionId}` mit Realtime-Listener.

---

### F-34 — Kommentare & Fragen pro Thema ✅
**Aufwand:** M  
**Voraussetzung:** F-30  
Unterhalb des Lerninhalts: Kommentar-Sektion (nur für eingeloggte Nutzer). Kommentare in `comments/{subjectId}__{topicId}/{commentId}`. Reaktionen (Daumen hoch). Admin kann löschen. Kein Antwort-Threading (flat). Kommentare erscheinen auf Thema-Seite unter einem "Kommentare"-Tab — nicht sichtbar während Test.

---

### F-35 — Peer-Review für Custom Content ✅
**Aufwand:** M  
**Voraussetzung:** F-34  
Custom Content der `pending` ist, kann von anderen Nutzern (nicht nur Admin) bewertet werden. 3 positive Bewertungen → automatisch auf `public` setzen. Reviewer bekommen XP. Flagging-System: genug Flags → zurück auf `pending`. Admin-Queue zeigt geflaggerte Items priorisiert.

---

## Phase 5 — KI-Integration
*Baut auf Fehler-Analyse (F-03) und Lernzeit-Daten (F-17) auf.*

---

### F-36 — Personalisierte Lernempfehlungen ✅
**Aufwand:** M  
**Voraussetzung:** F-03, F-16  
Dashboard-Widget "Heute empfohlen". Algorithmus: Themen mit schlechtester Note + längste Zeit nicht wiederholt + SRS-fällige Karten. Sortierung nach kombiniertem Score. Zeigt 3 Empfehlungen mit Begründung ("Note 4 vor 14 Tagen"). Kein Gemini nötig — reines Daten-basiertes Ranking.

---

### F-37 — KI-Lernzusammenfassung ✅
**Aufwand:** M  
**Voraussetzung:** —  
Button "Zusammenfassung erstellen" auf Themen-Seite. Gemini generiert aus dem `content` der meta.json eine kompakte Stichpunkt-Zusammenfassung (5–8 Kernpunkte). Gecacht in sessionStorage (nicht nochmal generieren wenn dieselbe Seite nochmal aufgerufen wird). Nutzer kann Zusammenfassung kopieren.

---

### F-38 — KI-Tutor Chat ✅
**Aufwand:** L  
**Voraussetzung:** F-37  
Floating Chat-Button auf Lerninhalt-Seiten. Öffnet Chat-Panel (rechts). Gemini bekommt `content` der meta.json als Kontext + Nutzer-Frage. Antwortet themenspezifisch. Gesprächsverlauf in sessionStorage. Rateimit-Schutz (max 10 Nachrichten pro Sitzung). Klar markiert als "KI-Tutor" — kein Ersatz für Lehrer.

---

### F-39 — Adaptiver Test-Modus
**Aufwand:** L  
**Voraussetzung:** F-03, F-16  
Neuer Test-Typ "Adaptiv" (ohne feste Zeitwahl). Start mit mittlerer Schwierigkeit. Bei richtiger Antwort → nächste Frage schwerer. Bei falscher → leichter. Endet nach 15 Fragen oder wenn das System das Niveau ermittelt hat. Gibt präziseres Bild des Wissenstands als Timed-Tests. Note basiert auf zuletzt stabilem Niveau.

---

### F-40 — KI-Lernplan (Klassenarbeit-Vorbereitung) ✅
**Aufwand:** L  
**Voraussetzung:** F-36, F-39  
Nutzer gibt ein: "Ich schreibe in 5 Tagen eine Mathe-Klassenarbeit über Potenzgleichungen und Funktionen." KI (Gemini) erstellt Tagesplan: Tag 1: Theorie lesen + Wissens-Check, Tag 2: 15-min Test, Tag 3: Retry-Modus Fehler, usw. Plan als Liste auf `#/lernplan`-Seite gespeichert. Nutzer kann Tage abhaken.

---

### F-41 — Automatische Content-Qualitätsprüfung
**Aufwand:** M  
**Voraussetzung:** F-35  
Beim Upload von Custom Content: Gemini prüft automatisch Qualität (Verständlichkeit, Korrektheit, Vollständigkeit) — Ergebnis als Score + Feedback-Nachricht für den Ersteller. Blockt Upload nicht, informiert nur. Admin sieht Quality-Score in der Moderation-Queue.

---

## Phase 6 — Lehrer & Analytics
*Für Schulen und offizielle Nutzung. Baut auf Gruppen-System auf.*

---

### F-42 — Detaillierte Lernanalysen ✅
**Aufwand:** M  
**Voraussetzung:** F-17, F-27  
Neue Statistik-Sektion "Detailanalyse" (unter bestehenden Statistiken). Zeigt: Durchschnittliche Lernzeit pro Wochentag, Zeit-per-Fach-Pie-Chart, Fragen-Typen-Performance (MC vs. Freitext), Tageszeit-Verteilung der Lernaktivität. Daten aus `users/{uid}/studyTime` + Grades-History.

---

### F-43 — Gruppen-Admin-Dashboard (Lehrer-Ansicht) ✅
**Aufwand:** L  
**Voraussetzung:** F-42  
Spezielle Ansicht für Gruppen-Admins: Tabelle aller Mitglieder mit Ø-Note pro Fach, Lernzeit letzte 7 Tage, letzter Aktivitäts-Tag, abgeschlossene Themen. Sortierbar. Exportierbar als CSV (Noten-Tabelle). Kein separater "Lehrer"-Account — jeder Gruppen-Admin bekommt diese Ansicht für seine Gruppe.

---

### F-44 — Noten-Export (PDF & CSV) ✅ (CSV fertig)
**Aufwand:** M  
**Voraussetzung:** —  
Auf der Statistik-Seite: "Noten exportieren"-Button. CSV-Download aller Testergebnisse (Datum, Fach, Thema, Note, Punkte). PDF-Version: formatierter Bericht mit Kopfzeile (Name, Zeitraum), Tabelle + Balkendiagramm. `window.print()`-basiert mit eigenem Print-CSS. Kein Server nötig.

---

### F-45 — Lehrplan-Mapping
**Aufwand:** M  
**Voraussetzung:** —  
Optionaler Key in `meta.json`: `"curriculum": {"state": "NRW", "grade": 9, "code": "L-9.2.3"}`. Filter auf Übersichtsseite: "Zeige nur NRW-Lehrplan Klasse 9". Hilfreich wenn mehrere Bundesländer unterschiedliche Inhalte benötigen. Themen ohne Curriculum-Code erscheinen trotzdem (ungefiltert).

---

### F-46 — Eltern-Zugang (Read-only-Link) ✅
**Aufwand:** M  
**Voraussetzung:** F-44  
Nutzer kann in Einstellungen einen einmaligen Share-Link generieren (`#/bericht/{token}`). Token in Firestore mit `uid` verknüpft. Die Bericht-Seite zeigt ohne Login: Noten-Verlauf, Streak, Fächer-Übersicht, letzte 10 Tests. Kein Name sichtbar (Datenschutz), nur Statistiken. Token kann jederzeit widerrufen werden.

---

## Phase 7 — Platform & Skalierung
*Letzte Phase — für wenn LearningForge wirklich groß wird.*

---

### F-47 — Mehrere Themes (Design-System Erweiterung)
**Aufwand:** M  
**Voraussetzung:** —  
Neben Dark/Light: 3–4 Farbthemes wählbar (z.B. "Ozean" — Blautöne, "Wald" — Grüntöne, "Sonnenuntergang" — Orange/Rosa, "Monochrom" — Graustufen). Jedes Theme überschreibt nur `--accent` und 2–3 Sekundärfarben. Gespeichert in Cookie neben `lf_theme`. Vorschau in Einstellungen ohne Reload.

---

### F-48 — Text-to-Speech (Barrierefreiheit)
**Aufwand:** S  
**Voraussetzung:** —  
"Vorlesen"-Button auf Lerninhalt-Seite. Nutzt `window.speechSynthesis` API (kein Server, kein CDN). Liest `innerText` des Content-Bereichs vor (HTML-Tags gefiltert). Pause/Stop-Button. Sprache: Deutsch (`lang: 'de-DE'`). Besonders hilfreich für längere Inhalte und Nutzer mit Leseschwäche.

---

### F-49 — Multi-Schul-Support
**Aufwand:** L  
**Voraussetzung:** F-45  
Schulen können sich registrieren und einen eigenen Namespace bekommen (`/schule/gymnasium-koeln`). Inhalte können als "Schul-spezifisch" markiert werden und erscheinen nur für Mitglieder dieser Schule. Schul-Admin-Account mit erweiterten Rechten. Gemeinsame öffentliche Inhalte bleiben verfügbar. Firestore: neue Collection `schools/{schoolId}`.

---

### F-50 — Anki-Export
**Aufwand:** S  
**Voraussetzung:** F-15  
Auf der Vokabeltrainer-/Flashcard-Seite: "Als Anki-Deck exportieren"-Button. Generiert `.apkg`-kompatibles CSV-Format (TSV mit Vorderseite/Rückseite), das Anki direkt importieren kann. Kein Anki-Format-Parsing nötig, nur TSV-Download. Für Schüler die Anki parallel nutzen.

---

### F-51 — Fremdsprachen-Unterstützung (i18n)
**Aufwand:** XL  
**Voraussetzung:** F-49  
Alle UI-Strings in eine `i18n/de.json` auslagern. Struktur: `{ "dashboard.title": "Meine Fächer", ... }`. Ersetze Strings im JS mit `t('dashboard.title')`. Erste Zielsprache: Englisch (`en.json`). Sprachauswahl in Einstellungen. Öffnet LearningForge für internationale Schulen. Inhalte bleiben vorerst sprachspezifisch.

---

### F-52 — Fester Release-Keystore (TWA-Fix)
**Aufwand:** S  
**Voraussetzung:** —  
Keystore als GitHub Secret (`KEYSTORE_BASE64`, `KEY_ALIAS`, `KEY_PASSWORD`) hinterlegen. Workflow auf `assembleRelease` umstellen + `signingConfigs` in `app/build.gradle` konfigurieren. `assetlinks.json` mit festem SHA-256-Fingerabdruck befüllen. Resultat: Kein Adressbalken mehr in der Android-App.

---

### F-53 — API für externe Integrationen
**Aufwand:** XL  
**Voraussetzung:** F-49  
Öffentliche REST-API (Firebase Functions) für verifizierte Partner: `GET /api/v1/users/{uid}/grades` (mit API-Key). Ermöglicht: Schulsoftware kann Noten automatisch importieren, Elternbriefprogramme können Berichte abrufen, Notenverwaltung integriert sich. Rate-Limiting via Firebase Functions. Dokumentation als OpenAPI-YAML.

---

## Abhängigkeiten-Übersicht

```
Phase 0 (Quick Wins)
  F-01 Passwort-Reset
  F-02 Chemie-Tafelwerk
  F-03 Fehler-Analyse ──────────────────────┐
  F-04 Retry-Modus    → F-03               │
  F-05 Lückentext                           │
  F-06 Zuordnungs-Fragen                    │
  F-07 Sortier-Fragen                       │
  F-08 Keyboard-Navigation                  │
  F-09 Skeleton-Loading                     │
  F-10 Inhalts-Bewertung                    │
                                            │
Phase 1 (PWA)                               │
  F-11 Service Worker ──────────────────┐   │
  F-12 Offline-Sync   → F-11           │   │
  F-13 Install-Prompt → F-11           │   │
  F-14 Push-Notifs    → F-11           │   │
                                       │   │
Phase 2 (Lernerlebnis)                 │   │
  F-15 Flashcards ───────────────────┐ │   │
  F-16 SRS           → F-15, F-03 ──┼─┼───┤
  F-17 Pomodoro-Timer ───────────────┼─┼───┤
  F-18 Notizen                       │ │   │
  F-19 Lesezeichen                   │ │   │
  F-20 Wissens-Check                 │ │   │
  F-21 LaTeX-Support                 │ │   │
  F-22 Code-Highlighting             │ │   │
  F-23 Lernpfade                     │ │   │
                                     │ │   │
Phase 3 (Gamification)                │ │   │
  F-24 Achievements → F-03, F-17 ────┘ │   │
  F-25 XP & Levels  → F-24             │   │
  F-26 Daily Chall  → F-25             │   │
  F-27 Streak-Kal   → F-17             │   │
  F-28 Fach-Ranking                    │   │
  F-29 Wochenrückbl → F-24,F-25,F-27   │   │
                                       │   │
Phase 4 (Sozial)                       │   │
  F-30 Freunde       → F-25            │   │
  F-31 Aktivitäts-Feed → F-30          │   │
  F-32 Duell-Modus   → F-30            │   │
  F-33 Live-Session  → F-30, F-32      │   │
  F-34 Kommentare    → F-30            │   │
  F-35 Peer-Review   → F-34            │   │
                                       │   │
Phase 5 (KI)                           │   │
  F-36 Empfehlungen  → F-03, F-16 ────┘───┘
  F-37 KI-Zusammenf
  F-38 KI-Tutor      → F-37
  F-39 Adaptiv-Test  → F-03, F-16
  F-40 Lernplan      → F-36, F-39
  F-41 Content-QA

Phase 6 (Analytics/Lehrer)
  F-42 Lernanalysen  → F-17, F-27
  F-43 Gruppen-Admin → F-42
  F-44 Noten-Export
  F-45 Lehrplan-Map
  F-46 Eltern-Link   → F-44

Phase 7 (Skalierung)
  F-47 Themes
  F-48 Text-to-Speech
  F-49 Multi-Schul   → F-45
  F-50 Anki-Export   → F-15
  F-51 i18n          → F-49
  F-52 Keystore-Fix
  F-53 API           → F-49
```

---

## Empfohlene Reihenfolge (Top-15 nach Impact/Aufwand-Ratio)

| # | Feature | Phase | Aufwand | Warum jetzt |
|---|---------|-------|---------|-------------|
| 1 | F-09 Skeleton-Loading | 0 | S | Sofort sichtbare UX-Verbesserung |
| 2 | F-01 Passwort-Reset | 0 | S | Grundlegendes Nutzer-Problem lösen |
| 3 | F-08 Keyboard-Navigation | 0 | S | Kein Aufwand, riesige Qualitätsverbesserung |
| 4 | F-03 Fehler-Analyse | 0 | S | Schaltet F-04, F-16, F-24, F-36 frei |
| 5 | F-04 Retry-Modus | 0 | S | Direkt nach F-03 |
| 6 | F-02 Chemie-Tafelwerk | 0 | M | Steht in CLAUDE.md, long overdue |
| 7 | F-11 Service Worker | 1 | L | Fundament für Offline + Push |
| 8 | F-19 Lesezeichen | 2 | S | Schnell, sofort nützlich |
| 9 | F-17 Pomodoro-Timer | 2 | S | Schaltet F-24, F-27, F-42 frei |
| 10 | F-15 Flashcards | 2 | M | Schaltet SRS frei, komplett neue Lernmethode |
| 11 | F-05 Lückentext | 0 | M | Neuer Fragetyp, sofort einsetzbar |
| 12 | F-24 Achievements | 3 | L | Starker Motivations-Boost |
| 13 | F-21 LaTeX-Support | 2 | M | Unentbehrlich für Mathe/Physik-Inhalte |
| 14 | F-44 Noten-Export | 6 | M | Für Eltern + Lehrer direkt nützlich |
| 15 | F-52 Keystore-Fix | 7 | S | Android-App professioneller machen |

---

*Letzte Aktualisierung: 2026-04-22 — 53 Features, 8 Phasen*

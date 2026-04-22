# FUTURE_FEATURES.md

Dieses Dokument beschreibt die geplanten funktionalen Erweiterungen für LearningForge. Die Umsetzung muss kompatibel zum bestehenden Tech-Stack (Firestore, Firebase Auth, GitHub Trees API) erfolgen.

---

## 1. User-Content & Community-Integration
Ziel: Dynamische Erweiterung der Lerninhalte durch Nutzer ohne direkte Repository-Eingriffe.

* **Datenhaltung (Firestore):** Neue Top-Level Collection `user_content`.
* **Struktur:** Dokumente enthalten `subjectId`, `yearId`, `topicId` sowie die JSON-Objekte für `meta` und `questions`.
* **Sichtbarkeit:** Einführung eines Status-Felds (`status: "private" | "pending" | "public"`).
* **Integration:** Erweiterung von `scanner.js`, um Firestore-Inhalte mit dem GitHub-Tree zu mergen.

## 2. Administrations-System (Moderation)
Ein geschützter Bereich für den Admin-Account `simonkoper27@gmail.com`.

* **Moderations-Queue:** Interface zur Prüfung von `pending` Inhalten (Approve/Reject).
* **User-Management:** Funktion zum Sperren von UIDs über ein `isBanned`-Flag im Firestore-Userprofil.
* **Content-Control:** Berechtigung zum Entfernen von Einträgen aus dem globalen Leaderboard.

## 3. Visual Content Builder
Grafischer No-Code Editor zur Erstellung von Lerninhalten in `app.js`.

* **UI-Fokus:** Erstellung von Inhalten mittels Auswahlmenüs für `lf-box`, `lf-steps` und andere vordefinierte CSS-Klassen.
* **Live-Vorschau:** Sofortige Anzeige des gerenderten HTML-Strings während der Erstellung.
* **Hybrid-Modus:** Toggle-Option für direkten HTML/JSON-Zugriff für fortgeschrittene Nutzer.

## 4. Gamification & Score-Logik 2.0
Umstellung von Durchschnittswerten auf ein kumulatives Punktesystem mit Zeit-Gewichtung.

### 4.1 Zeit-Multiplikatoren
Die erreichten Punkte eines Tests werden basierend auf der gewählten Dauer multipliziert:

| Test-Dauer | Multiplikator |
| :--- | :--- |
| 5 Min | x 1.0 |
| 10 Min | x 1.5 |
| 15 Min | x 2.0 |
| 30 Min | x 2.5 |
| 90 Min | x 4.0 |

* **Technische Umsetzung:** Anpassung der `evaluateAnswers`-Logik in `test-engine.js`.
* **Visualisierung:** Primäre Anzeige der Gesamtpunktzahl in Profil und Statistiken.

## 5. Personalisierung (Custom Icons)
Nutzer können die Standard-Icons der Fächer individuell für ihren Account überschreiben.

* **Speicherung:** Ablage der gewählten Emojis/Icons im Pfad `users/{uid}/settings/customIcons`.
* **Priorität:** `renderDashboard()` prüft zuerst auf personalisierte Icons, bevor die `subjects-config.json` genutzt wird.

## 6. Klassen-System (Gruppen)
Geschlossene Bereiche für gemeinsames Lernen und interne Ranglisten.

* **Rollen:** Der Ersteller einer Gruppe wird Gruppen-Admin.
* **Limits:** Standard-Nutzer können maximal 2 Gruppen erstellen.
* **Features:** Exklusive Themen-Bereiche und Gruppen-interne Leaderboards basierend auf Mitglieder-UIDs.

## 7. Vokabeltrainer-Modul
Spezialisierter Modus für Sprachen, integriert in die bestehende Test-Logik.

* **Konfiguration:** Aktivierung über ein Flag in der `subjects-config.json`.
* **Validierung:** Fokus auf Freitext-Eingabe (kein Multiple Choice).
* **Sprachlogik:** Unterstützung für kombinierte Abfragen (z. B. Latein: Vokabel + Grammatik).
* **Export:** Optimierter PDF-Druck von Vokabel-Testbögen vor Testbeginn.

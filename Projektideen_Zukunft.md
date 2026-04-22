# Technical Roadmap: Plattform-Erweiterungen

Dieses Dokument beschreibt die funktionalen und technischen Spezifikationen für die kommenden Entwicklungsphasen.

---

## 1. User Content & Moderation (Firestore/Backend)
Ziel: Umstellung von statischen Inhalten auf ein hybrides System (Global + User-generated).

### 1.1 User-Uploads
* **Scoped Access:** Inhalte (Fächer/Themen) erhalten ein `ownerID`-Feld.
* **Visibility-Status:** Einführung eines Enums `visibility: ["private", "pending", "public"]`. Standard ist `private`.
* **Request-Workflow:** User löst Trigger aus, der `visibility` auf `pending` setzt. Der Admin erhält eine Benachrichtigung über die Anfrage.

### 1.2 Admin-Panel
* **Permissions:** Zugriff exklusiv für `simonkoper27@gmail.com`.
* **Funktionen:**
    * **Content-Review:** Liste aller `pending` Dokumente mit Approve/Reject-Logik.
    * **User-Management:** Möglichkeit, UIDs komplett zu sperren (Blacklist).
    * **Leaderboard-Moderation:** Manuelles Entfernen von unangebrachtem Content oder Fake-Scores.

---

## 2. Gamification & Score-Logik
Ziel: Umstellung von Durchschnittsberechnung auf kumulative Punkte mit zeitbasierten Multiplikatoren.

### 2.1 Kumulative Punkteberechnung
Die Gesamtpunktzahl ist die Summe aller erreichten Punkte ($\sum$). Die Testdauer dient als Gewichtungsfaktor.

| Test-Dauer | Multiplikator | Basis-Punkte (Beispiel) |
| :--- | :--- | :--- |
| 5 Min | x 1.0 | 1 - 15 p |
| 10 Min | x 1.5 | 1.5 - 22.5 p |
| 15 Min | x 2.0 | 2 - 30 p |
| 30 Min | x 2.5 | 2.5 - 37.5 p |
| 90 Min | x 4.0 | 4 - 60 p |

* **Implementierung:** Die `Test-Config` erhält ein Feld `durationCategory`. Das Backend berechnet beim Submit: `finalScore = basePoints * multiplier`.
* **UI:** Im Profil und in der Statistik-Komponente wird primär der `totalScore` angezeigt.

---

## 3. Visual Content Builder
Ein intuitives Tool zur Erstellung von Lerninhalten ohne Code-Eingabe.

* **UI-Komponenten:**
    * **Container-System:** Auswahlboxen für Layout-Elemente (z. B. farbige Kästen).
    * **Styling-Tools:** Farbwähler für Boxen, einfache Trennlinien-Generatoren.
* **Hybrid-Ansatz:** Ein Toggle-Switch ermöglicht den Wechsel zwischen der visuellen Oberfläche und direktem HTML-Code-Zugriff für fortgeschrittene User.

---

## 4. Personalisierung & Gruppen (Klassen)
### 4.1 Custom Icons
* **Local Override:** User können Icons pro Fach (z. B. Flaggen) individuell anpassen.
* **Persistenz:** Speicherung der gewählten Icon-ID/URL in der `user_settings` Collection der Google Database. Die Änderung ist nur für die jeweilige UID sichtbar.

### 4.2 Klassen-System (Groups)
* **Rollen:** Jeder Ersteller einer Gruppe ist automatisch Gruppen-Admin.
* **Limitierung:** * Standard-User: Max. 2 Gruppen.
    * System-Admin: Unbegrenzt.
* **Funktionen:**
    * Eigener Reiter (Tab) pro Gruppe in der Sidebar/Main-UI.
    * **Kollaboration:** Jedes Mitglied kann Content hinzufügen (Visibility: Group-only).
    * **Group-Leaderboard:** Ranking ausschließlich innerhalb der Gruppen-Mitglieder.

---

## 5. Vokabeltrainer-Modul
Spezialisiertes Modul für Fremdsprachen, gesteuert über `subjects-config.json`.

### 5.1 Datenstruktur & Abfrage
Jede Lektion basiert auf einer JSON-Struktur, die Begriffe, Grammatik-Attribute und Beispielsätze enthält.

* **Input-Methode:** 100% Freitext (kein Multiple-Choice).
* **Fachspezifische Validierung:**
    * **Englisch:** Prüfung auf `translation`.
    * **Latein:** Kombinierte Prüfung von `translation` + `grammar` (z. B. Genitiv, Genus, Kasus).

### 5.2 Export & Druck
* **PDF-Generierung:** Funktion zum Drucken von Tests.
* **Optionen:**
    1. **Blanko-Blatt:** Exportiert den Test zum physischen Ausfüllen.
    2. **Ergebnis-Blatt:** Exportiert den bearbeiteten Test inklusive Note und Korrektur.

---

### Umsetzungshinweise für den Developer
1. **Database:** Erstellung einer `groups` Collection und Erweiterung der `users` Collection um `custom_icons`.
2. **Logic:** Implementierung der Multiplikator-Tabelle in der `ScoreService`-Klasse.
3. **UI:** Integration des Visual Builders als neues Admin/User-Tool mit Preview-Modus.

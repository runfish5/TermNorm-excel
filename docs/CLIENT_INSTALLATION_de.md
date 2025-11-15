# TermNorm Excel Add-in - Installationsanleitung für Ihren Server

## ⚠️ WICHTIGE HINWEISE

> **Bitte lesen Sie diese Hinweise vor der Nutzung**

**Produktstatus:** Experimentelle Software in aktiver Entwicklung
- ✅ Kernfunktionalität implementiert und getestet
- ⚠️ Nicht für kritische Produktionsdaten ohne umfangreiche Tests

**Haftungsausschluss:** Software wird "wie besehen" ohne Garantien bereitgestellt
- 📋 **Erstellen Sie IMMER Backups vor der Nutzung**
- 🔍 **Überprüfen Sie alle KI-Vorschläge manuell**
- ⚖️ **Verantwortung für Datenqualität liegt beim Nutzer**

**Datenschutz:** LLM-Anfragen werden an externe Provider (Groq/OpenAI) gesendet
- Stellen Sie sicher, dass dies Ihren Datenschutzrichtlinien entspricht
- Verwenden Sie keine sensiblen Daten ohne Genehmigung

**Support:** Open Source Projekt - Support nach bestem Bemühen, keine Garantie
- Kontakt: uniqued4ve@gmail.com

---

## Versionskontrolle und Sicherheit

WICHTIG - Verwenden Sie nur offizielle Releases:

Sie erhalten eine Email-Benachrichtigung mit einem spezifischen Release-Link (z.B. v1.0.0) für jede neue Version. Laden Sie Dateien ausschließlich von diesem angegebenen Release herunter: https://github.com/runfish5/TermNorm-excel/releases

Verwenden Sie NICHT den master Branch oder andere Branches - diese sind für Entwicklung und nicht getestet. Release-Branches (release/v1.x.x) sind unveränderlich (immutable) und stabil. Dies schützt vor unbemerkten Code-Änderungen und gewährleistet Nachvollziehbarkeit.

Aktualisieren Sie nur wenn Sie eine Email-Benachrichtigung erhalten haben. Geben Sie bei Support-Anfragen immer Ihre Versionsnummer an (siehe <Version> in manifest.xml).

---

## Überblick

Diese Anleitung führt Sie durch die Installation des TermNorm Excel Add-ins auf Ihrem Server. Das Add-in besteht aus zwei Komponenten:

1. **Python Backend** - FastAPI-Server für KI-gestützte Terminologie-Zuordnung
2. **Excel Add-in** - Task Pane Integration für Excel (Desktop oder Microsoft 365)

Die Installation sollte mit dieser detaillierten Anleitung auch eigenständig durchführbar sein. Bei Fragen oder Unklarheiten stehe ich Ihnen selbstverständlich zur Verfügung.

---

## Systemvoraussetzungen

### Erforderlich
- **Python** (Version 3.9 oder höher) - [Download hier](https://www.python.org/downloads/)
- **Microsoft Excel** (Desktop-Version oder Microsoft 365 Subscription)
- **Windows-Server** oder **lokaler Windows-Rechner** für Backend
- **Internet-Verbindung** für LLM-API-Zugriffe (Groq oder OpenAI)

### Optional
- **Git** für Repository-Management - [Download hier](https://git-scm.com/downloads)

---

## Teil 1: Python Backend Installation

### Schritt 1: Repository herunterladen

**Option A: Mit Git**
```bash
git clone https://github.com/runfish5/TermNorm-excel.git
cd TermNorm-excel
```

**Option B: ZIP-Download**
1. Besuchen Sie: https://github.com/runfish5/TermNorm-excel
2. Klicken Sie auf "Code" → "Download ZIP"
3. Entpacken Sie das ZIP-Archiv an gewünschtem Ort
4. Öffnen Sie die Kommandozeile (Windows-Taste → "cmd" → Enter)

### Schritt 2: Backend-Server starten (EMPFOHLEN)

Doppelklicken Sie einfach auf die Datei `start-server-py-LLMs.bat` im TermNorm-excel Verzeichnis.

<details>
<summary>Was macht das Skript?</summary>

Das Skript übernimmt automatisch:
- ✅ Virtual Environment einrichten
- ✅ Alle Abhängigkeiten installieren
- ✅ Deployment-Typ wählen (Lokal oder Netzwerk)
- ✅ Diagnose durchführen und Server starten
</details>

<details>
<summary>Manuelle Installation (für Fortgeschrittene oder Problembehandlung)</summary>

Navigieren Sie zum Backend-Verzeichnis:
```bash
cd C:\<PFAD_ZUM_PROJEKT>\TermNorm-excel\backend-api
```

Erstellen und aktivieren Sie das Virtual Environment:
```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Server starten:
- Lokal: `python -m uvicorn main:app --reload`
- Netzwerk: `python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload`
</details>

**Server-Status prüfen:**
Öffnen Sie im Browser: `http://127.0.0.1:8000/health`
Sie sollten sehen: `{"status": "healthy"}`

### Schritt 3: Authentifizierung und API-Keys konfigurieren (Einmalig)

**Benutzer hinzufügen** (für Multi-User-Zugriff):
Bearbeiten Sie `backend-api\config\users.json`:
```json
{
  "users": {
    "admin": {
      "email": "ihre.email@firma.com",
      "allowed_ips": ["127.0.0.1", "192.168.1.100"]
    }
  }
}
```

**LLM API Key setzen** (erforderlich):
```bash
setx GROQ_API_KEY "ihr_groq_api_key_hier"
```

**Web-Suche konfigurieren (Optional):**
Für zuverlässige Web-Recherche, konfigurieren Sie Brave Search API (2.000 kostenlose Anfragen/Monat):
1. Registrieren: https://api-dashboard.search.brave.com/register
2. Key in `backend-api\.env` hinzufügen:
   ```
   BRAVE_SEARCH_API_KEY=ihr_brave_api_key_hier
   ```
3. **Server neu starten** nach Konfigurationsänderungen

Falls nicht konfiguriert: System verwendet SearXNG → DuckDuckGo → Bing.

**Hinweis:** Nach `setx` Kommandozeile neu öffnen oder Server neu starten.

---

## Teil 2: Excel Add-in Installation

### Schritt 1: Manifest-Datei vorbereiten

Das Add-in unterstützt zwei Deployment-Optionen:

**Option A: Microsoft 365 Cloud (empfohlen)**
- Verwenden Sie: `manifest-cloud.xml`
- Funktioniert mit Excel im Browser und Desktop

**Option B: Lokales Excel Desktop**
- Verwenden Sie: `manifest.xml`
- Nur für lokale Excel-Installation

### Schritt 2: Add-in in Excel laden

**Für Microsoft 365:**
1. Öffnen Sie Excel (Desktop oder Browser)
2. Gehen Sie zu: **Home** → **Add-ins** → **Weitere Add-ins**
3. Klicken Sie auf **Meine Add-ins** (linke Spalte)
4. Wählen Sie **Mein Add-in hochladen**
5. Navigieren Sie zu `manifest-cloud.xml` und wählen Sie die Datei
6. Klicken Sie **Hochladen**

**Für Excel Desktop (lokal):**

> **⚠️ WICHTIGER HINWEIS - Sideloading nur für Excel Desktop**
>
> Die "Upload my Add-in" Option funktioniert **nur in Excel für das Web**, nicht in der Desktop-Version. Für die Desktop-Version müssen Sie die **Sideloading-Methode** über Netzwerkfreigabe verwenden.

#### Methode 1: Sideloading über Netzwerkfreigabe (empfohlen für Desktop)

**Schritt 1: Netzwerkfreigabe erstellen (einmalig)**
1. Einen Ordner auf dem Computer erstellen (z.B. `C:\OfficeAddIns`)
2. Rechtsklick auf den Ordner → **Eigenschaften** → **Freigabe-Tab** → **Freigeben**
3. Sich selbst hinzufügen und **Freigeben** klicken
4. Den vollständigen Netzwerkpfad notieren (z.B. `\\COMPUTERNAME\OfficeAddIns`)

**Schritt 2: Vertrauenswürdigen Katalog einrichten (einmalig)**
1. Excel öffnen
2. **Datei** → **Optionen** → **Trust Center** → **Einstellungen für das Trust Center**
3. **Vertrauenswürdige Add-In-Kataloge** auswählen
4. Den vollständigen Netzwerkpfad einfügen (z.B. `\\COMPUTERNAME\OfficeAddIns`)
5. **Katalog hinzufügen** klicken
6. Das Häkchen bei **Im Menü anzeigen** setzen
7. **OK** klicken und Excel neu starten

**Schritt 3: Manifest-Datei herunterladen**
1. Laden Sie die `manifest.xml` von GitHub herunter:
   - **Direkt-Link**: https://github.com/runfish5/TermNorm-excel/blob/master/manifest.xml
   - Klicken Sie auf **Raw** → Rechtsklick → **Speichern unter**
   - Oder klonen Sie das gesamte Repository (siehe Teil 1, Schritt 1)

**Schritt 4: Add-In installieren**
1. Die heruntergeladene `manifest.xml` Datei in den freigegebenen Ordner kopieren (z.B. `C:\OfficeAddIns\`)
2. Excel öffnen
3. **Start** → **Add-Ins** → **Erweitert** (oder **Weitere Add-Ins**)
4. **FREIGEGEBENER ORDNER** oben im Dialog auswählen
5. Das Add-in auswählen und auf **Hinzufügen** klicken

#### Methode 2: Alternative für Mac (nur macOS)
Auf Mac können Sie die `manifest.xml` direkt in folgenden Ordner kopieren:
```
/Users/<username>/Library/Containers/com.Microsoft.Excel/Data/Documents/Wef
```

### Schritt 3: Add-in öffnen

1. Öffnen Sie eine Excel-Arbeitsmappe
2. Klicken Sie auf **Home** → **Add-ins** → **TermNorm**
3. Das Task Pane sollte auf der rechten Seite erscheinen

---

## Teil 3: Projekt-Konfiguration

### Schritt 1: Konfigurationsdatei erstellen

Erstellen Sie eine Datei `app.config.json` mit folgendem Inhalt:

```json
{
  "excel-projects": {
    "IhreArbeitsmappe.xlsx": {
      "column_map": {
        "Freie_Namen": "Standardbegriffe",
        "Material_Input": "Material_Standardisiert"
      },
      "default_std_suffix": "standardized",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Pfad\\zu\\ReferenzDatei.xlsx",
          "worksheet": "Tabelle1",
          "source_column": "",
          "target_column": "Standardbegriff"
        }
      ]
    }
  }
}
```

**Wichtig:**
- `"IhreArbeitsmappe.xlsx"` - Name Ihrer Excel-Datei
- `"column_map"` - Zuordnung: Input-Spalte → Output-Spalte
- `"mapping_reference"` - Absoluter Pfad zu Referenz-Excel-Dateien
- `"target_column"` - Spalte in Referenz-Datei mit Standardbegriffen
- Windows-Pfade benötigen doppelte Backslashes: `\\`

### Schritt 2: Konfiguration laden

**Für Microsoft 365:**
1. Öffnen Sie das TermNorm Task Pane
2. Ziehen Sie `app.config.json` in das Drag & Drop Feld
3. Die Konfiguration wird automatisch geladen

**Für Excel Desktop:**
1. Speichern Sie `app.config.json` im Projekt-Ordner: `\TermNorm-excel\config\`
2. Klicken Sie im Task Pane auf **Load Config**

### Schritt 3: Server-URL konfigurieren

1. Öffnen Sie im Task Pane den Tab **Settings**
2. Tragen Sie die Server-URL ein:
   - Lokal: `http://127.0.0.1:8000`
   - Netzwerk: `http://192.168.1.100:8000` (Ihre Server-IP)
   - Produktion: `https://api.ihre-firma.com`
3. Keine Speicherung nötig - Updates automatisch

### Schritt 4: Mapping-Tabellen laden

1. Klicken Sie bei jeder Referenz-Datei auf **Browse**
2. Wählen Sie die entsprechende Excel-Datei
3. Klicken Sie **Load Mapping Table**
4. Wiederholen Sie für alle Referenz-Dateien

### Schritt 5: Tracking aktivieren

1. Navigieren Sie zu **Load Configuration**
2. Klicken Sie auf **Activate Tracking**
3. Das System überwacht nun Ihre definierten Spalten

---

## Teil 4: Erste Test-Schritte

### Test 1: Einfache Zuordnung

1. Öffnen Sie Ihre konfigurierte Excel-Arbeitsmappe
2. Wählen Sie eine Zelle in Ihrer Input-Spalte (z.B. "Freie_Namen")
3. Geben Sie einen Begriff ein: z.B. "Stahl"
4. Drücken Sie **Enter**
5. Das System führt automatisch aus:
   - Quick Lookup (gecachte Mappings)
   - Fuzzy Matching (ähnliche Begriffe)
   - LLM-gestützte Recherche (bei Bedarf)

### Test 2: Ergebnisse prüfen

1. Wechseln Sie im Task Pane zu **Tracking Results**
2. Sie sehen eine Tabelle mit Kandidaten:
   - **Candidate** - Vorgeschlagener Standardbegriff
   - **Score** - Übereinstimmungs-Bewertung (0-100%)
   - **Source** - Quelle (exact/fuzzy/llm)
3. Die beste Übereinstimmung wird automatisch in Output-Spalte geschrieben

### Test 3: Manuelle Auswahl

Falls die automatische Zuordnung nicht passt:
1. Wählen Sie einen anderen Kandidaten aus der Liste
2. Klicken Sie **Apply First**
3. Der ausgewählte Begriff wird übernommen

### Test 4: Historie prüfen

1. Wechseln Sie zu **History** im Task Pane
2. Alle Verarbeitungsschritte sind hier protokolliert
3. Log-Datei: `backend-api\logs\activity.jsonl`

---

## Troubleshooting

### Server startet nicht

**Problem:** `ModuleNotFoundError` oder ähnliche Python-Fehler

**Lösung:**
```bash
# Virtual Environment erneut aktivieren
cd backend-api
.\.venv\Scripts\activate

# Dependencies neu installieren
pip install --upgrade -r requirements.txt
```

### Excel Add-in wird nicht angezeigt

**Problem:** Add-in erscheint nicht in Excel

**Lösung:**
1. Schließen Sie alle Excel-Instanzen
2. Starten Sie Excel neu
3. Prüfen Sie: **Home** → **Add-ins** → **Meine Add-ins**
4. Falls nicht sichtbar: Manifest erneut hochladen

### Server-Verbindung fehlgeschlagen

**Problem:** Rote LED-Anzeige im Task Pane

**Lösung:**
1. Prüfen Sie Server-Status: `http://127.0.0.1:8000/health`
2. Prüfen Sie Server-URL in Settings
3. Prüfen Sie IP-Berechtigung in `backend-api\config\users.json`
4. Prüfen Sie Firewall-Einstellungen

### LLM-Anfragen schlagen fehl

**Problem:** Keine KI-Vorschläge, Timeout-Fehler

**Lösung:**
1. Prüfen Sie API-Key:
   ```bash
   echo %GROQ_API_KEY%
   ```
2. Stellen Sie sicher, dass Umgebungsvariable gesetzt ist
3. Starten Sie Server neu nach Setzen der Variable
4. Prüfen Sie Internet-Verbindung
5. Prüfen Sie API-Guthaben beim Provider

### Konfiguration wird nicht geladen

**Problem:** "Configuration not found" Fehler

**Lösung:**
1. Prüfen Sie JSON-Syntax: https://jsonlint.com
2. Prüfen Sie Arbeitsmappe-Namen (exakt wie in Excel)
3. Prüfen Sie Pfade zu Referenz-Dateien (doppelte Backslashes)
4. Laden Sie Konfiguration erneut

### Mapping-Tabellen nicht gefunden

**Problem:** "File not found" Fehler bei Referenz-Dateien

**Lösung:**
1. Prüfen Sie absolute Pfade in `app.config.json`
2. Verwenden Sie doppelte Backslashes: `C:\\Users\\...`
3. Stellen Sie sicher, dass Excel-Dateien existieren
4. Prüfen Sie Worksheet-Namen (exakt wie in Excel)

---

## Wichtige Hinweise zu Version 1

### Funktionalität

✅ **Implementiert gemäß Proposal:**
- Regelbasierte Zuordnung mit Zuordnungstabellen
- KI-gestützte Vorschläge bei fehlenden Übereinstimmungen
- Konfigurierbare Ziellisten (lokal/Azure)
- Vertrauensindikatoren (Farben/Scores)
- Änderungsverfolgung mit Historie
- Multi-User-Unterstützung (IP-basierte Authentifizierung)

### Performance-Optimierungen in Arbeit

Die Hauptfunktionalität ist vollständig implementiert und testbar. Ich arbeite aktuell an Performance-Verbesserungen:
- Optimierung der LLM-Anfragen
- Cache-Strategien für häufige Zuordnungen
- Backend-Response-Zeiten

Diese Optimierungen sind **minimalinvasive Code-Änderungen** und beeinflussen nicht die Funktionalität.

### Wichtigkeit des Testings

Ihr Feedback ist entscheidend:
- **Testen Sie verschiedene Terminologie-Szenarien**
- **Dokumentieren Sie unerwartetes Verhalten**
- **Bewerten Sie die Genauigkeit der KI-Vorschläge**
- **Prüfen Sie die Benutzerfreundlichkeit**

Ihre Rückmeldungen helfen mir, die Evaluation zu fokussieren und gezielte Verbesserungen vorzunehmen, bevor weitere Änderungen erfolgen.

---

## Produktions-Deployment (Optional)

Für dauerhafte Server-Installation:

### Als Windows-Dienst einrichten

1. Installieren Sie NSSM: https://nssm.cc/download
2. Erstellen Sie den Dienst:
```bash
nssm install TermNormBackend "C:\<PFAD>\venv\Scripts\python.exe" "-m uvicorn main:app --host 0.0.0.0 --port 8000"
nssm set TermNormBackend AppDirectory "C:\<PFAD>\backend-api"
nssm start TermNormBackend
```

### HTTPS einrichten (Empfohlen für Produktion)

Für sichere Verbindungen:
1. Erhalten Sie SSL-Zertifikat (Let's Encrypt, Firmenzertifikat)
2. Verwenden Sie Reverse Proxy (nginx, IIS)
3. Konfigurieren Sie HTTPS-Weiterleitung

Details auf Anfrage.

---

## Support & Kontakt

Bei Fragen oder Problemen während der Installation:

**David Streuli**
Runfish-data
Email: uniqued4ve@gmail.com
Mobil: 077 218 12 45

**GitHub Repository:**
https://github.com/runfish5/TermNorm-excel

Ich stehe Ihnen gerne zur Verfügung und freue mich auf Ihr Feedback zu Version 1.

---

## Nächste Schritte

1. ✅ Backend-Server installiert und läuft
2. ✅ Excel Add-in geladen und sichtbar
3. ✅ Projekt-Konfiguration erstellt und geladen
4. ✅ Mapping-Tabellen geladen
5. ✅ Tracking aktiviert
6. ✅ Erste erfolgreiche Zuordnung getestet

**Bereit für produktive Tests!**

---

*Copyright (c) 2025 Runfish-data. Alle Rechte vorbehalten.*

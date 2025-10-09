# TermNorm Excel Add-in - Installationsanleitung für Ihren Server

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

### Schritt 2: Python Virtual Environment erstellen

Navigieren Sie zum Backend-Verzeichnis:
```bash
cd C:\<PFAD_ZUM_PROJEKT>\TermNorm-excel\backend-api
```

Erstellen Sie das Virtual Environment:
```bash
python -m venv venv
```

Aktivieren Sie das Virtual Environment:
```bash
.\venv\Scripts\activate
```

Sie sollten nun `(venv)` am Anfang Ihrer Kommandozeile sehen.

### Schritt 3: Python-Abhängigkeiten installieren

```bash
pip install -r requirements.txt
```

### Schritt 4: Benutzer-Konfiguration einrichten

Bearbeiten Sie die Datei `backend-api\config\users.json`:

```json
{
  "users": {
    "admin": {
      "email": "ihre.email@firma.com",
      "allowed_ips": ["127.0.0.1"]
    },
    "jungbluth": {
      "email": "jungbluth@firma.com",
      "allowed_ips": ["192.168.1.100", "192.168.1.101"]
    }
  }
}
```

**Wichtig:**
- Ersetzen Sie IP-Adressen mit den tatsächlichen IPs Ihrer Benutzer
- Für lokale Tests verwenden Sie `127.0.0.1`
- Für Netzwerk-Zugriff finden Sie Ihre IP mit: `ipconfig` (Windows-Kommandozeile)

**Hot-Reload:** Änderungen an `users.json` werden automatisch übernommen - kein Server-Neustart erforderlich.

### Schritt 5: LLM-Provider konfigurieren

Das System unterstützt **Groq** (empfohlen, schnell & günstig) oder **OpenAI**.

**Groq API Key einrichten:**
1. Registrieren Sie sich bei: https://console.groq.com
2. Erstellen Sie einen API Key
3. Setzen Sie die Umgebungsvariable (Windows):

```bash
setx GROQ_API_KEY "ihr_groq_api_key_hier"
```

**OpenAI API Key einrichten (Alternative):**
```bash
setx OPENAI_API_KEY "ihr_openai_api_key_hier"
```

**Wichtig:** Nach Setzen der Umgebungsvariablen müssen Sie die Kommandozeile neu öffnen.

### Schritt 6: Backend-Server starten

**Für lokale Entwicklung:**
```bash
python -m uvicorn main:app --reload
```
Server läuft auf: `http://127.0.0.1:8000`

**Für Netzwerk-Zugriff (empfohlen für Team):**
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Server läuft auf: `http://<SERVER_IP>:8000`

**Server-Status prüfen:**
Öffnen Sie im Browser: `http://127.0.0.1:8000/health`

Sie sollten sehen: `{"status": "healthy"}`

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
1. Öffnen Sie Excel
2. Gehen Sie zu: **Datei** → **Optionen** → **Trust Center** → **Trust Center-Einstellungen**
3. Wählen Sie **Vertrauenswürdige Add-in-Kataloge**
4. Fügen Sie den Pfad zum Manifest-Ordner hinzu
5. Setzen Sie Häkchen bei "Im Menü anzeigen"
6. Klicken Sie OK und starten Sie Excel neu

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
.\venv\Scripts\activate

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

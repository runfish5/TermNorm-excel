# TermNorm - AI-Powered Terminology Normalization for Excel

![TermNorm Excel Add-in Screenshot](assets/termnorm-screenshot.png)

An Excel add-in that automatically standardizes terminology in real-time using configurable mappings and AI-powered matching. Monitor cells as you work, apply intelligent standardization rules, and track processing with an intuitive interface.

**Use Cases:** Assign free-form names to standardized terms, entity linking, classification, and data normalization workflows.

## ✨ Key Features

- **Real-time Cell Monitoring** - Automatically detects and processes cell changes
- **AI-Powered Research & Matching** - Web research + LLM ranking + fuzzy matching pipeline
- **Intelligent Candidate Ranking** - Multi-source matching with confidence scoring
- **Simple Configuration** - Single JSON file with drag & drop support
- **Activity Tracking** - In-Excel view of processing history and ranked candidates
- **Persistent Logging** - Comprehensive audit trail of all mapping decisions
- **Flexible Mapping System** - Multiple reference files with hot-reload capability
- **Color-Coded Results** - Visual feedback for normalization status and confidence
- **Multi-User Support** - IP-based authentication with stateless architecture

## 💡 How It Works

```
User Input (Excel Cell)
    ↓
1. Quick Lookup (cached exact matches)
    ↓
2. Fuzzy Matching (similarity algorithms)
    ↓
3. LLM Research (web + entity profiling)
    ↓
Ranked Candidates with Confidence Scores
    ↓
Auto-apply or Manual Selection
    ↓
Logging & State Update
```

### Processing Pipeline

1. **Exact Match**: Instant lookup from cached mappings
2. **Fuzzy Match**: Token-based similarity with configurable thresholds
3. **LLM Research**: Web search → entity profiling → candidate ranking
4. **Ranking**: Multi-factor scoring (semantic similarity, token overlap, web context)

### Stateless Backend Architecture

- Each `/research-and-match` request receives `{query, terms}` payload
- Creates `TokenLookupMatcher` on-the-fly, uses it, discards it
- No session management = no TTL = no expiration issues
- Pure function architecture: `(query, terms) → ranked_candidates`

## 🚀 Quick Start

### Prerequisites

- Microsoft Excel (Desktop or Microsoft 365)
- Python 3.9+
- LLM API key (Groq recommended, OpenAI supported)

### Installation

**1. Clone the repository**
```bash
git clone https://github.com/runfish5/TermNorm-excel.git
cd TermNorm-excel
```

**2. Start backend server**

Simply run the automated setup script:
```bash
start-server-py-LLMs.bat
```

The script will:
- ✅ Set up virtual environment automatically
- ✅ Install all dependencies
- ✅ Configure API keys interactively
- ✅ Choose deployment type (Local or Network)
- ✅ Run diagnostics and start server

<details>
<summary>Manual setup (alternative)</summary>

```bash
cd backend-api
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt

# Set API key
setx GROQ_API_KEY "your_api_key_here"

# Start server
python -m uvicorn main:app --reload                              # Local
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload  # Network
```
</details>

**3. Install Excel add-in**
- **Microsoft 365**: Upload `manifest-cloud.xml` via *Home → Add-ins → Upload My Add-in*
- **Desktop Excel**: Sideload `manifest.xml` via Trust Center settings

📖 **[Full Installation Guide](docs/INSTALLATION.md)** | **[Client Setup Guide](CLIENT_INSTALLATION.md)**

## ⚙️ Configuration

TermNorm uses a single JSON configuration file that defines column mappings and reference data sources.

### Example `app.config.json`

```json
{
  "excel-projects": {
    "MyWorkbook.xlsx": {
      "column_map": {
        "FreeText_Column": "Standardized_Column",
        "Material_Input": "Material_ISO"
      },
      "default_std_suffix": "standardized",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Reference\\Materials.xlsx",
          "worksheet": "StandardTerms",
          "source_column": "",
          "target_column": "ISO_Standard"
        },
        {
          "mapping_reference": "C:\\Reference\\Processes.xlsx",
          "worksheet": "ProcessList",
          "source_column": "",
          "target_column": "BFO_Term"
        }
      ]
    }
  }
}
```

### Loading Configuration

**Microsoft 365**: Drag & drop `app.config.json` into the TermNorm task pane

**Desktop Excel**: Save config to `config/app.config.json` and click **Load Config**

### Multi-User Setup

Edit `backend-api/config/users.json` to add users:

```json
{
  "users": {
    "admin": {
      "email": "admin@company.com",
      "allowed_ips": ["127.0.0.1", "192.168.1.100"]
    },
    "user2": {
      "email": "user2@company.com",
      "allowed_ips": ["192.168.1.101"]
    }
  }
}
```

**Hot-reload enabled** - No server restart required when adding users.

## 📚 Documentation

- **[Installation Guide](docs/INSTALLATION.md)** - Complete setup instructions
- **[Usage Guide](docs/USAGE.md)** - How to use the add-in
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues & solutions
- **[Code Exploration](docs/CODE_EXPLORATION.md)** - Architecture & customization
- **[Client Installation](CLIENT_INSTALLATION.md)** - Standalone deployment guide

## 🛠️ Technology Stack

**Frontend**
- Office JavaScript API (Excel integration)
- Webpack (bundling & dev server)
- Service-based architecture with state management

**Backend**
- Python FastAPI (high-performance async API)
- LLM Integration (Groq/OpenAI with runtime switching)
- Stateless request architecture (no session management)
- IP-based authentication with hot-reload

**Processing Pipeline**
- Exact matching (cached lookups)
- Fuzzy matching (similarity algorithms)
- LLM-powered research (web + entity profiling)

## 🏗️ Architecture

### Frontend Structure

```
src/
├── taskpane/              # Application orchestrator
├── services/              # Business logic layer
│   ├── live.tracker.js    # Multi-workbook cell monitoring
│   ├── normalizer.functions.js  # Normalization pipeline
│   └── normalizer.fuzzy.js      # Fuzzy matching
├── ui-components/         # UI component functions
├── utils/                 # Helper utilities
│   ├── api-fetch.js       # Centralized API communication
│   ├── error-display.js   # Message display system
│   └── server-utilities.js     # Server connection management
└── shared-services/       # State management
    └── state-machine.manager.js
```

### Backend Structure

```
backend-api/
├── main.py                # FastAPI app + routers
├── config/                # Configuration & middleware
│   ├── users.json         # IP-based authentication
│   └── middleware.py      # Auth middleware
├── api/                   # API endpoints
│   ├── system.py          # Health & logging
│   └── research_pipeline.py    # Research & match endpoint
├── core/                  # Core functionality
│   ├── llm_providers.py   # LLM configuration
│   └── user_manager.py    # Authentication
└── research_and_rank/     # Matching algorithms
```

## 🔧 Development

### Running Tests

```bash
# Backend tests
cd backend-api
pytest

# Frontend development server
npm run dev-server
```

### Key Development Commands

```bash
# Backend
cd backend-api
.\venv\Scripts\activate
python -m uvicorn main:app --reload

# Frontend (webpack dev server runs automatically)
npm start
```

## 🤝 Contributing

Contributions welcome! This project uses a pragmatic, service-based architecture with minimal abstraction.

**Code Quality Standards:**
- Prioritize working solutions over architectural purity
- Direct function calls preferred over object wrappers
- Add abstraction only when multiple implementations exist
- See [CLAUDE.md](CLAUDE.md) for architecture principles

## 📋 Use Cases

- **Entity Linking**: Match free-text entities to standardized knowledge bases
- **Data Normalization**: Standardize product names, material codes, process terms
- **Classification**: Assign categories to unstructured text
- **Terminology Management**: Maintain consistent terminology across documents
- **Data Quality**: Clean and standardize data entry in real-time

## 🚨 Troubleshooting

### Server Not Connecting

1. Check server status: `http://127.0.0.1:8000/health`
2. Verify Server URL in Settings tab
3. Check IP permissions in `backend-api/config/users.json`
4. Restart backend server

### LLM Requests Failing

1. Verify API key is set: `echo %GROQ_API_KEY%`
2. Check internet connection
3. Verify API quota/credits
4. Check backend logs for detailed errors

### Configuration Not Loading

1. Validate JSON syntax: https://jsonlint.com
2. Check workbook name matches Excel filename exactly
3. Verify file paths use double backslashes: `C:\\Path\\File.xlsx`
4. Reload configuration

📖 **[Full Troubleshooting Guide](docs/TROUBLESHOOTING.md)**

## 🎯 Known Limitations

- **Single Excel Instance Per Project**: Each file runs isolated add-in instance
- **LLM Request Payload**: Sends full terms array (~50KB for 1000 terms)
  - Trade-off: Larger payloads for zero state management complexity

## 📄 License

Copyright (c) 2025 Runfish-data. All rights reserved.

For more information or commercial licensing, contact:
- Email: uniqued4ve@gmail.com
- Phone: +41 77 218 12 45

## 🌟 Acknowledgments

Built with Office JavaScript API, FastAPI, and modern LLM providers (Groq/OpenAI).

---

**Made with ❤️ by Runfish-data** | [GitHub](https://github.com/runfish5/TermNorm-excel) | [Issues](https://github.com/runfish5/TermNorm-excel/issues)

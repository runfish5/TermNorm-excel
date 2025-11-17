# TermNorm - AI-Powered Terminology Normalization for Excel

This project demonstrates a reusable architecture for building Excel add-ins with Python backend servers. This implementation specifically tackles **database identifier assignment**: Matching free-form text entries to standardized terminology using web research, LLM reasoning, and intelligent ranking algorithms.

<p align="center">
  <img src="assets/llm-research-ranking-workflow-overview.png" alt="LLM Research & Ranking Workflow" width="480">
</p>

The workflow diagram above shows the Python/FastAPI backend pipeline that powers real-time terminology normalization directly within Excel.

## 📚 Documentation

**For Users:**
- **[Installation Guide](docs/INSTALLATION.md)** - Complete setup instructions
- **[Usage Guide](docs/USAGE.md)** - How to use the add-in
- **[Configuration Guide](docs/CONFIGURATION.md)** - Config file examples and multi-user setup
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues & solutions

**For Developers:**
- **[Developer Guide](docs/DEVELOPER.md)** - Full development setup, VS Code Office Add-ins Kit, modifying UI/backend
- **[CLAUDE.md](CLAUDE.md)** - Architecture principles and internal documentation


## 📋 Use Cases

- **Database Identifier Assignment**: Assign free-form names to standardized database identifiers
- **Classification & Terminology Management**: Assign categories to unstructured text and maintain consistent terminology across documents
- **Data Normalization & Entity Linking**: Standardize product names, material codes, process terms, and match free-text entities to standardized knowledge bases

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

### Interface Preview

<p align="center">
  <img src="assets/termnorm-screenshot.png" alt="TermNorm Excel Add-in Interface" width="600">
</p>

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

## 🚀 Quick Start

### Prerequisites

- Microsoft Excel (Desktop or Microsoft 365)
- **Python 3.9+** (for backend server)
- LLM API key (Groq recommended, OpenAI supported)

### Installation

**1. Download the latest release**

Visit the releases page and download `dist.zip` from the latest version:

**👉 [Download from GitHub Releases](https://github.com/runfish5/TermNorm-excel/releases)**

Extract the zip file to your desired location (e.g., `C:\TermNorm-excel\`)

**2. Start backend server**

Run `start-server-py-LLMs.bat` in the project directory.

**Note:** Changes to `backend-api/config/users.json` are hot-reloaded automatically (no server restart needed).

<details>
<summary>What does the script do?</summary>

The script automatically:
- ✅ Sets up virtual environment
- ✅ Installs all dependencies
- ✅ Chooses deployment type (Local or Network)
- ✅ Runs diagnostics and starts server
</details>

<details>
<summary>Manual setup (alternative)</summary>

```bash
cd backend-api
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt

# Set API key
setx GROQ_API_KEY "your_api_key_here"

# Start server
python -m uvicorn main:app --reload                              # Local
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload  # Network
```
</details>

**3. Install Excel add-in**

- **Microsoft 365** (Simple): Upload `manifest-cloud.xml` (from extracted folder) via *Home → Add-ins → Upload My Add-in*
- **Desktop Excel** (Complex): Requires network deployment. See [Desktop Excel Deployment](#desktop-excel-deployment-network-sideloading) below for full setup.

📖 **[Full Installation Guide](docs/INSTALLATION.md)** | **[Client Setup Guide (German)](docs/CLIENT_INSTALLATION_de.md)**

---

## 🖥️ Desktop Excel Deployment (Network Sideloading)

Desktop Excel cannot use the simple cloud upload method. Instead, it requires hosting the add-in on an internal web server (IIS) and distributing the manifest via network shared folder. Users then configure their Trust Center to access the shared catalog.

**This process involves:**
- Extracting the release package (`dist.zip`)
- Deploying to IIS (Windows Server)
- Setting up network share for manifest distribution
- Configuring Trust Center on each user's Excel

📖 **[Complete deployment guide with step-by-step instructions](docs/INSTALLATION.md#windows-server-deployment)**

> **Note for developers:** When building from source, use `npm run build:iis` to ensure the UI displays correct server paths. See [Developer Guide](docs/DEVELOPER.md) for build options.

---

## 👨‍💻 For Developers

**Want to modify this codebase?** Check out the comprehensive developer guide:

### 📘 [Developer Guide](docs/DEVELOPER.md)

**Covers:**
- ✅ **VS Code Office Add-ins Developer Kit** setup
- ✅ Full installation from source (git clone or download)
- ✅ Frontend development (UI customization)
- ✅ Backend development (Python server)
- ✅ Building and deployment
- ✅ Debugging tips and best practices

**Learn Excel Add-ins:**
- [Office Add-ins Overview](https://learn.microsoft.com/en-us/office/dev/add-ins/overview/office-add-ins)
- [Excel JavaScript API Reference](https://learn.microsoft.com/en-us/javascript/api/excel)
- [Sideloading from network share](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)

### Quick Start for Developers

```bash
git clone https://github.com/runfish5/TermNorm-excel.git
cd TermNorm-excel
npm install
npm run dev-server    # Frontend dev server
# Open another terminal
cd backend-api
python -m venv .venv && .\.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --reload    # Backend server
```

Press `F5` in VS Code with Office Add-ins Developer Kit to start debugging in Excel!

---

**Made with ❤️ by Runfish-data** | [GitHub](https://github.com/runfish5/TermNorm-excel) | [Issues](https://github.com/runfish5/TermNorm-excel/issues)

# FastAPI-LLM-Entity-Mapper

<p align="center">
  <img src="https://img.shields.io/badge/Office%20Add--in-Excel-217346?logo=microsoft-excel" alt="Office Add-in">
  <img src="https://img.shields.io/badge/Office.js-1.1-217346" alt="Office.js">
</p>

### An AI-Driven Unitary Mapping System for Data Normalization

<p align="center">
  <em>Rerank existing tables with LLMs, custom workflow chains, and
  continuous optimization campaigns</em>
</p>

<p align="center">
  <img src="assets/termnorm-demo.gif" alt="TermNorm Demo - AI matching Bourbon Pointu FC medium to coffee_bourbon_washed" width="510">
</p>

**Keywords:** Python, FastAPI, LLM, Entity Resolution, Excel Automation, Vector Mapping, Database Normalization.

This project demonstrates a reusable architecture for building Excel add-ins with Python backend servers. This implementation specifically tackles **database identifier assignment**: Matching free-form text entries to standardized terminology using web research, LLM reasoning, and intelligent ranking algorithms.

<p align="center">
  <img src="assets/llm-research-ranking-workflow-overview.png" alt="LLM Research & Ranking Workflow" width="480">
</p>

The workflow diagram above shows the Python/FastAPI backend pipeline that powers real-time terminology normalization directly within Excel.

<p align="center">
  <img src="assets/FastAPI-LLM-Entity-Mapper.png" alt="System Architecture" width="560">
</p>

## 📚 Documentation

**For Users:**
- **[Installation Guide](docs/INSTALLATION.md)** - Complete setup instructions
- **[Setup Guide](docs/SETUP-GUIDE.md)** - How to use the add-in
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

- **Seamless Excel Integration:** - Allows for direct integration with legacy workflows and user-facing spreadsheets.
- **Instant AI-Powered Matching** - Type in Excel, get standardized results automatically—web research and LLM reasoning happen in real-time
- **Three-Tier Intelligence** - Exact cache for speed → Fuzzy matching for variants → AI research for unknowns
- **Transparent Decision Making** - See ranked candidates with confidence scores, entity profiles, and web sources—understand why each match was suggested
- **Zero Database Setup** - Session-based architecture stores everything in memory—no database installation, no migration scripts
- **Complete Audit Trail** - Every match logged with timestamps and metadata—perfect for compliance and training data collection
- **Drag-and-Drop Configuration** - Single JSON file defines everything—share configs via email or network drive
- **Visual Confidence Feedback** - Color-coded cells show match quality at a glance—green for high confidence, yellow for uncertain
- **Multi-User Ready** - IP-based authentication with hot-reload—add users without server restart

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

### Installation for End Users

**For users who just want to deploy and use the add-in**:

**1. Download the deployment package**

Visit the releases page and download `termnorm-deploy-vX.X.X.zip`:

**👉 [Download from GitHub Releases](https://github.com/runfish5/TermNorm-excel/releases)**

This package contains only the pre-built files needed for deployment:
- ✅ Pre-built frontend (`dist/`)
- ✅ Python backend (`backend-api/`)
- ✅ Manifest files
- ✅ Configuration templates

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
- Extracting the release package (`termnorm-deploy-v1.xx.xx.zip`)
- Deploying to IIS (Windows Server)
- Setting up network share for manifest distribution
- Configuring Trust Center on each user's Excel

📖 **[Complete deployment guide with step-by-step instructions](docs/INSTALLATION.md#3-desktop-excel-deployment-network-sideloading)**

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

**For developers who want to modify the code:**

```bash
git clone https://github.com/runfish5/TermNorm-excel.git
cd TermNorm-excel
npm install              # Downloads ~900MB to node_modules/ (required for development)
npm run dev-server       # Frontend dev server
# Open another terminal
cd backend-api
python -m venv .venv && .\.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --reload    # Backend server
```

Press `F5` in VS Code with Office Add-ins Developer Kit to start debugging in Excel!

**Note:** The ~1GB local directory size (mostly `node_modules/`) is normal for development. End users who download the deployment package don't need any of this.

---

**Made with ❤️ by Runfish-data** | [GitHub](https://github.com/runfish5/TermNorm-excel) | [Issues](https://github.com/runfish5/TermNorm-excel/issues)

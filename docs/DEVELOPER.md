# Developer Guide

This guide is for developers who want to **modify and extend** the TermNorm Excel Add-in codebase. Whether you're customizing the UI, enhancing the Python backend, or building new features, this document will get you set up.

---

## 📚 Learning Resources

### Office Add-ins Development

**New to Excel Add-ins?** Start here:

- **[Office Add-ins Overview](https://learn.microsoft.com/en-us/office/dev/add-ins/overview/office-add-ins)** - What are Office Add-ins and how they work
- **[Excel JavaScript API](https://learn.microsoft.com/en-us/javascript/api/excel)** - Complete API reference
- **[Build your first Excel add-in](https://learn.microsoft.com/en-us/office/dev/add-ins/quickstarts/excel-quickstart-jquery)** - Official tutorial

### Deployment & Distribution

- **[Sideloading Office Add-ins from network share](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)** - Network deployment (recommended for enterprise)
- **[Microsoft 365 Store submission guide](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/add-in-submission-guide)** - Publishing to AppSource
- **[Open Office account in Partner Center](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/open-a-developer-account)** - Required for store submission
- **[Make solutions available in AppSource](https://learn.microsoft.com/en-us/partner-center/marketplace-offers/submit-to-appsource-via-partner-center)** - Complete publishing process

---

## 🚀 Getting Started

### Prerequisites

Install these tools before starting:

- **[Node.js 16+](https://nodejs.org/)** - JavaScript runtime for building frontend
- **[Git](https://git-scm.com/downloads)** - Version control
- **[Visual Studio Code](https://code.visualstudio.com/)** - Recommended IDE
- **[Office Add-ins Developer Kit (VS Code extension)](https://marketplace.visualstudio.com/items?itemName=msoffice.microsoft-office-add-in-debugger)** - Essential for development
- **[Python 3.9+](https://www.python.org/downloads/)** - For backend server
- **Microsoft Excel** (Desktop or Microsoft 365)

### Set Up VS Code

**1. Install VS Code Extensions:**

Open VS Code and install these extensions:
- **Office Add-ins Developer Kit** (msoffice.microsoft-office-add-in-debugger)
- **ESLint** (for code linting)
- **Prettier** (optional, for code formatting)

**2. Configure the Developer Kit:**

The Office Add-ins Developer Kit provides:
- ✅ One-click debugging in Excel
- ✅ Manifest validation
- ✅ Built-in webpack dev server
- ✅ Automatic sideloading

---

## 📥 Download the Source Code

### Option 1: Clone with Git (Recommended)

```bash
git clone https://github.com/runfish5/TermNorm-excel.git
cd TermNorm-excel
```

### Option 2: Download ZIP

1. Visit: https://github.com/runfish5/TermNorm-excel
2. Click **Code** → **Download ZIP**
3. Extract to your desired location
4. Open terminal in the extracted folder

---

## 🔧 Frontend Development Setup

### Initial Setup

**1. Install dependencies:**

```bash
npm install
```

This installs all required packages (webpack, babel, office-addin-* tools, etc.)

**2. Verify installation:**

```bash
npm run validate
```

This checks your `manifest.xml` for errors.

### Development Workflow

**Option A: Using VS Code Office Add-ins Developer Kit (Recommended)**

1. Open the project in VS Code
2. Press `F5` or click **Run → Start Debugging**
3. The Developer Kit will:
   - Start the webpack dev server (https://localhost:3000)
   - Validate the manifest
   - Sideload the add-in in Excel
   - Open Excel with your add-in loaded

**Option B: Using Command Line**

Start the dev server:
```bash
npm run dev-server
```

Then sideload manually:
```bash
npm run start              # Sideload in Excel Desktop
npm run start:web          # Sideload in Excel Online
```

### Building for Production

**Standard build (GitHub Pages):**
```bash
npm run build
```

**Build for HTTP deployment (IIS/network):**
```bash
scripts\deployment\build-http.bat
```

**Build with custom URL:**
```bash
set DEPLOYMENT_URL=http://your-server:8080/
npm run build
```

The built files will be in the `dist/` folder.

---

## 🐍 Backend Development Setup

### Initial Setup

**1. Navigate to backend directory:**

```bash
cd backend-api
```

**2. Create virtual environment:**

```bash
python -m venv .venv
```

**3. Activate virtual environment:**

**Windows:**
```bash
.\.venv\Scripts\activate
```

**Mac/Linux:**
```bash
source .venv/bin/activate
```

**4. Install dependencies:**

```bash
pip install -r requirements.txt
```

**5. Set environment variables:**

Create a `.env` file in `backend-api/`:

```env
GROQ_API_KEY=your_groq_api_key_here
BRAVE_SEARCH_API_KEY=your_brave_api_key_here  # Optional
```

Or set system environment variables:
```bash
setx GROQ_API_KEY "your_groq_api_key_here"
```

### Development Workflow

**Start the backend server:**

**Local development:**
```bash
python -m uvicorn main:app --reload
```
Server runs at: `http://127.0.0.1:8000`

**Network access (for testing on other devices):**
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
Server accessible at: `http://your-ip:8000`

**Quick start (automated setup):**
```bash
# From project root
start-server-py-LLMs.bat
```

### Testing the Backend

**Health check:**
```bash
curl http://127.0.0.1:8000/health
```

**Test connection from frontend:**
- Open TermNorm task pane in Excel
- Go to **Settings** tab
- Server URL should show green status indicator

---

## 🎨 Modifying the UI

### File Structure

UI components are in `src/ui-components/`:
```
src/ui-components/
├── ActivityFeedUI.js           # Processing history display
├── CandidateRankingUI.js       # Ranked results UI
├── mapping-config-functions.js # Configuration UI
├── file-handling.js            # Drag-drop config loading
└── view-manager.js             # Tab navigation
```

### Making UI Changes

**1. Edit component file** (e.g., `CandidateRankingUI.js`)

**2. The dev server auto-reloads:**
```bash
npm run dev-server
```

**3. Refresh Excel task pane** to see changes (or it auto-reloads)

**4. Build for production** when ready:
```bash
npm run build
```

### UI Styling

- Styles are defined inline or in component files
- Office UI Fabric classes can be used
- Color scheme follows Excel theme

---

## 🔌 Modifying the Backend

### File Structure

Backend logic is in `backend-api/`:
```
backend-api/
├── main.py                      # FastAPI app + routers
├── api/
│   ├── system.py               # Health & logging endpoints
│   └── research_pipeline.py    # Core matching logic
├── core/
│   ├── llm_providers.py        # LLM configuration
│   ├── user_manager.py         # IP-based auth
│   └── logging.py              # Logging setup
├── research_and_rank/          # Matching algorithms
└── config/
    ├── users.json              # User IP allowlist
    └── settings.py             # App settings
```

### Making Backend Changes

**1. Edit Python files** (e.g., `research_pipeline.py`)

**2. Server auto-reloads** (if using `--reload` flag)

**3. Test changes** via API calls or Excel add-in

**4. Check logs:**
```bash
tail -f backend-api/logs/app.log
```

### Adding New Endpoints

**Example: Add a new endpoint**

Edit `backend-api/api/system.py`:

```python
@router.get("/my-endpoint")
async def my_endpoint(request: Request):
    return {"message": "Hello from new endpoint"}
```

**Call from frontend** (`src/utils/api-fetch.js`):

```javascript
const response = await fetch(`${serverUrl}/my-endpoint`);
const data = await response.json();
```

---

## 🧪 Testing Your Changes

### Frontend Testing

**1. Lint your code:**
```bash
npm run lint
npm run lint:fix  # Auto-fix issues
```

**2. Validate manifest:**
```bash
npm run validate
```

**3. Test in Excel:**
```bash
npm run dev-server
npm run start
```

### Backend Testing

**1. Run server locally:**
```bash
cd backend-api
python -m uvicorn main:app --reload
```

**2. Test endpoints:**
```bash
# Health check
curl http://127.0.0.1:8000/health

# Test connection
curl http://127.0.0.1:8000/test-connection
```

**3. Check logs:**
```bash
# View real-time logs
tail -f logs/app.log

# View activity log
tail -f logs/activity.jsonl
```

---

## 📦 Deployment

### Frontend Deployment

**1. Build production files:**
```bash
npm run build
```

**2. Deploy to IIS (Windows Server):**
```bash
scripts\deployment\setup-iis.bat
```

**3. Or deploy to any static host** (GitHub Pages, Netlify, etc.):
- Upload `dist/` folder contents
- Update manifest URLs to match your host

### Backend Deployment

**1. Set up as Windows service** (production):

Install [NSSM](https://nssm.cc/):
```bash
nssm install TermNormBackend "C:\path\to\.venv\Scripts\python.exe" "-m uvicorn main:app --host 0.0.0.0 --port 8000"
nssm set TermNormBackend AppDirectory "C:\path\to\backend-api"
nssm start TermNormBackend
```

**2. Or use Docker:**

Create `Dockerfile` in `backend-api/`:
```dockerfile
FROM python:3.9
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Build and run:
```bash
docker build -t termnorm-backend .
docker run -p 8000:8000 termnorm-backend
```

---

## 🔍 Debugging

### Frontend Debugging

**Using VS Code:**
1. Set breakpoints in `.js` files
2. Press `F5` to start debugging
3. Excel opens with DevTools attached

**Using Browser DevTools:**
1. Open Excel with add-in
2. Press `F12` to open DevTools
3. View Console, Network, Sources tabs

**Common issues:**
- Clear Office cache: `rd /s /q "%LOCALAPPDATA%\Microsoft\Office\16.0\Wef"`
- Check webpack dev server is running: https://localhost:3000
- Verify manifest URLs match server

### Backend Debugging

**Using Python debugger:**

Add breakpoints in your IDE and run:
```bash
python -m debugpy --listen 5678 --wait-for-client -m uvicorn main:app --reload
```

**Using logs:**
```python
# Add to any file
import logging
logger = logging.getLogger(__name__)
logger.info("Debug message here")
```

View logs:
```bash
tail -f backend-api/logs/app.log
```

---

## 📖 Architecture Overview

### Design Philosophy

- **Session-based architecture**: Frontend caches mappings, backend stores terms in sessions
- **Service-based organization**: Pure functions, minimal OOP
- **Lightweight requests**: Large initial payload, then lightweight matching requests

### Communication Flow

```
Config load → Frontend caches mappings → POST /session/init-terms
Cell change → Cached check → Fuzzy match → POST /research-and-match
→ LLM processing → Display candidates → Write to cell
```

For detailed architecture, see **[CLAUDE.md](../CLAUDE.md)**.

---

## 🤝 Contributing

### Code Style

- **Frontend**: Use ESLint config (run `npm run lint:fix`)
- **Backend**: Follow PEP 8 (use `black` for formatting)
- **Comments**: Explain *why*, not *what*
- **Commits**: Use conventional commits format

### Pull Request Process

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes and test thoroughly
4. Commit with clear messages
5. Push and create pull request

---

## 🆘 Getting Help

### Resources

- **Project Documentation**: See [CLAUDE.md](../CLAUDE.md) for internal architecture
- **Configuration Guide**: See [CONFIGURATION.md](CONFIGURATION.md)
- **Installation Guide**: See [INSTALLATION.md](INSTALLATION.md)
- **Microsoft Docs**: https://learn.microsoft.com/office/dev/add-ins/

### Support

- **GitHub Issues**: https://github.com/runfish5/TermNorm-excel/issues
- **Email**: uniqued4ve@gmail.com

---

**Happy Coding! 🚀**

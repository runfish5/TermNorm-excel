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

The build command you use determines what the UI displays to users. Choose based on your deployment scenario:

**Standard build (GitHub Pages / Development):**
```bash
npm run build
```
Shows development paths and assumes GitHub Pages deployment.

**IIS Server deployment:**
```bash
# Set the deployment path to match your IIS server location
set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
npm run build:iis
```
- UI displays "IIS Server" deployment type
- Shows server filesystem paths for admin access
- Includes note about drag-and-drop for regular users

**Microsoft 365 deployment:**
```bash
npm run build:m365
```
- UI displays "Microsoft 365" deployment type
- Hides all filesystem paths
- Shows drag-and-drop instructions only

**Custom deployment with full control:**
```bash
set DEPLOYMENT_URL=http://your-server:8080/
set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
set DEPLOYMENT_TYPE=iis
npm run build
```

**Available environment variables:**
- `DEPLOYMENT_URL` - Base URL for manifest (default: GitHub Pages)
- `DEPLOYMENT_TYPE` - UI behavior: `development`, `iis`, or `m365` (default: `development`)
- `DEPLOYMENT_PATH` - Filesystem path shown in UI (default: build directory)

The built files will be in the `dist/` folder.

**Legacy deployment script (deprecated):**
```bash
scripts\deployment\build-http.bat  # Use npm run build:iis instead
```

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

## 📦 Deployment

### Frontend Deployment

**1. Build production files for your deployment type:**

For IIS Server:
```bash
set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
npm run build:iis
```

For Microsoft 365:
```bash
npm run build:m365
```

For GitHub Pages or custom hosting:
```bash
set DEPLOYMENT_URL=https://your-domain.com/path/
npm run build
```

**2. Deploy to IIS (Windows Server):**
```bash
scripts\deployment\setup-iis.bat
```

**3. Or deploy to any static host** (GitHub Pages, Netlify, etc.):
- Upload `dist/` folder contents
- Update manifest URLs to match your host

**Important:** The build command determines what users see in the UI. Use `build:iis` for IIS deployments to show correct filesystem paths to administrators.

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

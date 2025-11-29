# Setup Guide

This guide walks you through getting TermNorm up and running quickly after installation.

---

## Prerequisites

Before starting, ensure you have completed the **[Installation Guide](INSTALLATION.md)**:
- Downloaded and extracted the release package
- Installed Microsoft Excel and Python 3.9+
- Added the TermNorm add-in to Excel (via sideload, IIS, or Microsoft 365)

---

## Quick Start: 4 Steps to Get Running

### Step 1: Go thourgh the installation process


### Step 2: Start the Python Server

The Python server handles the intelligent term normalization and matching.

**Easiest method:**
Simply double-click the `start-server-py-LLMs.bat` file in the TermNorm-excel directory.

<details>
<summary>What does the script do?</summary>

The script automatically:
- ✅ Sets up virtual environment
- ✅ Installs all dependencies
- ✅ Chooses deployment type (Local or Network)
- ✅ Runs diagnostics and starts server
</details>

<details>
<summary>Manual setup (for advanced users or troubleshooting)</summary>

Navigate to the backend directory:
```bash
cd C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\backend-api
```

Create and activate virtual environment:
```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

Start server:
- Local: `python -m uvicorn main:app --reload`
- Network: `python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload`
</details>

**Verify server is running:**
- Check the terminal for "Application startup complete"
- The TermNorm task pane should show a green status indicator



---

### Step 4: Activate Tracking

1. Navigate to the **Load Configuration** tab in the task pane
2. Click the **Activate Tracking** button

**✅ You're ready to go!**

---

---

### Step 4: Customize your configuration

To unlock TermNorm's full capabilities, configure:

- **Multiple Projects** - Configure multiple workbooks
- **Authentication** - Multi-user access with IP-based auth
- **LLM API Keys** - Required for intelligent matching (Groq API)
- **Web Search** - Optional Brave Search API for enhanced research

See the **[Configuration Guide](CONFIGURATION.md)** for detailed setup instructions.

---

## Try It Out: First Term Normalization

1. **Select a cell** in your defined input column (e.g., "Input")
2. **Type a term** you want to standardize (e.g., "stainless steel")
3. **Press Enter**

**What happens:**
- The system processes your term using:
  - Quick lookup in loaded mapping files
  - Fuzzy matching for similar terms
  - LLM-based intelligent matching (if server is connected)
- Results appear in the **Tracking Results** panel
- The target column is automatically updated with the best match

**View results:**
- Check the **Candidate Ranked** table in the task pane
- Review suggested matches ranked by confidence
- Click **Apply First** to accept the top suggestion
- Switch to **History** view to see all past normalizations

**Monitor activity:**
- Real-time processing shown in the Activity Feed
- Server status indicator (green = online, red = offline)
- Processing logs for debugging

---

## Quick Verification Checklist

Before diving deeper, verify everything is working:

- [ ] Python server is running (green LED in task pane)
- [ ] Configuration loaded successfully
- [ ] Entered a term and saw it processed
- [ ] Target column populated with results
- [ ] Activity Feed shows processing logs

If any step fails, see the **[Troubleshooting Guide](TROUBLESHOOTING.md)**.

---

## What's Next?

### For Basic Usage

You're ready to start normalizing terms! See **[Usage Guide](#using-termnorm)** below for detailed instructions.


---

## Getting Help

### Check Server Status
- Look for the LED indicator in the task pane
- Hover over it to see connection details
- Click to refresh connection

### Read System Messages
- Check the Activity Feed for processing logs
- Look for error messages in sys-status
- Review terminal output for server errors

### Troubleshooting
For common issues and solutions, see the **[Troubleshooting Guide](TROUBLESHOOTING.md)**:
- Backend server issues
- Frontend add-in problems
- Network connectivity
- IIS deployment


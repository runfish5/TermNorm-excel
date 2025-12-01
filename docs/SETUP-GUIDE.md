# Setup Guide

This guide walks you through getting TermNorm up and running quickly after installation.

---

## Prerequisites

- Microsoft Excel or 365
- Python 3.9+

---

## Quick Start: 4 Steps to Get Running

### Step 1: Go through the installation process

Jump to the **[Installation Guide](INSTALLATION.md)** and come back after.

### Step 2:  Add the add-in to Excel

### Step 3: Start the Python Server

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

### Step 4: Using the add-in

1. Open TermNorm task pane, it will show you 4 stages for setup
2. Drag your `app.config.json` into the field, see here on how to prepare one: **[Configuration Guide](CONFIGURATION.md)**
3. Load each of the reference files
  - For each Excel reference file, click **Browse**
  - Select the corresponding Excel file
  - Click **Load Mapping Table**
  - Repeat for all reference files
4. Click the **Activate tracking** button

**✅ You're ready to go!**

5. **Select a cell** in your defined input column (e.g., "Input")
6. **Type a term** you want to standardize (e.g., "stainless steel")
7. **Press Enter**

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

## Quick Verification Checklist

Before diving deeper, verify everything is working:

- [ ] Python server is running (green LED in task pane)
- [ ] Configuration loaded successfully
- [ ] Entered a term and saw it processed
- [ ] Target column populated with results
- [ ] Activity Feed shows processing logs

If any step fails, see the **[Troubleshooting Guide](TROUBLESHOOTING.md)**.

---

## Getting Help

### Troubleshooting
For common issues and solutions, see the **[Troubleshooting Guide](TROUBLESHOOTING.md)**

### Check Server Status
- Look for the LED indicator in the task pane
- Hover over it to see connection details
- Click to refresh connection

### Read System Messages
- Check the Activity Feed for processing logs
- Look for error messages in sys-status
- Review terminal output for server errors



---

## Customize your configuration

To unlock TermNorm's full capabilities, configure:

- **Multiple Projects** - Configure multiple workbooks
- **Authentication** - Multi-user access with IP-based auth
- **LLM API Keys** - Required for intelligent matching (Groq API)
- **Web Search** - Optional Brave Search API for enhanced research

See the **[Configuration Guide](CONFIGURATION.md)** for detailed setup instructions.

# Setup Guide

This guide walks you through getting TermNorm up and running quickly after installation.

---

## Prerequisites

- Microsoft Excel or 365
- Python 3.9+

---

## Quick Start: 3 Steps to Get Running

### Step 1: Go through the installation process

Jump to the **[Installation Guide](INSTALLATION.md)** and come back after.

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

### Step 3: Using the add-in

1. Open TermNorm task pane - the thermometer shows 4 setup stages (Server→Config→Mappings→Activate)
2. Drag your `app.config.json` into the field, see here on how to prepare one: **[Configuration Guide](CONFIGURATION.md)**

**✅ That's it!** Mappings auto-load and tracking auto-activates.

**Manual control:** Use the ON/OFF toggle switch in the dashboard to enable/disable tracking.

3. **Select a cell** in your defined input column (e.g., "Input")
4. **Type a term** you want to standardize (e.g., "stainless steel")
5. **Press Enter**

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
- Real-time processing shown in the Matching Journal
- Py-Server indicator in navbar (green = online, red = offline)
- Match history for debugging

**Direct Prompt (advanced):**

For custom LLM queries without the full research pipeline:

1. Switch to the **Results** tab
2. Click the **Direct Prompt** button to expand the panel
3. Type your query (e.g., "What is the standard name for 316L?")
4. Optional: Check **Include output** to add current output column values as context
5. Click **Submit**

The LLM response is validated against your reference terms:
- **High confidence match (≥75%)**: Response is auto-corrected to the closest known term
- **Low confidence match (<75%)**: A candidate picker appears with the top 10 similar terms for you to choose from

To add domain context to all Direct Prompt queries, configure `direct_prompt_context` in your config file (see [Configuration Guide](CONFIGURATION.md)).

## Quick Verification Checklist

Before diving deeper, verify everything is working:

- [ ] Py-Server indicator is green (in navbar)
- [ ] Configuration loaded successfully
- [ ] Entered a term and saw it processed
- [ ] Target column populated with results
- [ ] Matching Journal shows match history

If any step fails, see the **[Troubleshooting Guide](TROUBLESHOOTING.md)**.

---

## Getting Help

### Troubleshooting
For common issues and solutions, see the **[Troubleshooting Guide](TROUBLESHOOTING.md)**

### Check Server Status
- Look for the Py-Server indicator in the navbar
- Hover over it to see connection details
- Click to refresh connection

### Read System Messages
- Check the Matching Journal for match history
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

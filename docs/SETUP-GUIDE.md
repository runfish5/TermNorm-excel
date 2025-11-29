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

### Step 1: Start the Python Server

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

### Step 2: Load Your Configuration

**Open your Excel workbook** where you want to use TermNorm.

**For quick testing (minimal configuration):**

Create a simple `app.config.json` file:

```json
{
  "excel-projects": {
    "Book1.xlsx": {
      "column_map": {
        "Input": "Output"
      },
      "default_std_suffix": "standardized",
      "standard_mappings": []
    }
  }
}
```

Replace `"Book1.xlsx"` with your actual workbook name.

**Load the configuration:**

- **For 365 Cloud Excel:**
  - In the TermNorm task pane, drag and drop your `app.config.json` file

- **For Desktop Excel:**
  - Save `app.config.json` to: `C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\config\app.config.json`
  - Click **Load Config** button in the task pane

---

### Step 3: Load Mapping Files (Optional)

If you have reference Excel files with standard terminology:

1. Click **Browse** for each reference file
2. Select the corresponding Excel file
3. Click **Load Mapping Table**
4. Repeat for all reference files

**Note:** You can skip this step for initial testing and use just the LLM-based matching.

---

### Step 4: Activate Tracking

1. Navigate to the **Load Configuration** tab in the task pane
2. Click the **Activate Tracking** button

**✅ You're ready to go!**

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

### For Advanced Configuration

To unlock TermNorm's full capabilities, configure:

- **Authentication** - Multi-user access with IP-based auth
- **LLM API Keys** - Required for intelligent matching (Groq API)
- **Web Search** - Optional Brave Search API for enhanced research
- **Multiple Projects** - Configure multiple workbooks
- **Complex Mappings** - Advanced column mapping rules

See the **[Configuration Guide](CONFIGURATION.md)** for detailed setup instructions.

---

## Using TermNorm

### Basic Workflow

1. **Select a cell** in your predefined input column
2. **Type a term** that you want to standardize
3. **Press Enter** to trigger normalization
4. The system automatically performs:
   - Quick lookup for existing mappings
   - Fuzzy matching for similar terms
   - Advanced LLM-based matching (requires internet)
5. Target column is updated automatically

### Reviewing Results

**Candidate Ranked View:**
- Shows best candidates ranked by confidence
- Select a better match if needed
- Click **Apply First** to update the target column

**History View:**
- See all past normalizations
- Review what terms were mapped
- Check processing timestamps

### Activity Logging

All term normalizations are logged to:
```
C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\backend-api\logs\activity.jsonl
```

Each log entry captures:
- Input term
- Matched output
- Confidence score
- Timestamp
- User who triggered the normalization

---

## Common Scenarios

### Scenario 1: Working Offline

If the Python server is unavailable:
1. Open TermNorm → **Settings** tab
2. Uncheck "Require server connection"
3. TermNorm will use exact and fuzzy matching only (no LLM)

### Scenario 2: Multiple Users

For team environments:
1. Deploy backend server on a shared machine
2. Configure allowed IPs in `backend-api/config/users.json`
3. Users update their "Server URL" in Settings tab
4. See **[Configuration Guide](CONFIGURATION.md)** → Multi-User Setup

### Scenario 3: Custom Terminology Domains

For specialized vocabularies:
1. Create Excel reference files with your standard terms
2. Configure them in `app.config.json` → `standard_mappings`
3. Load mapping files via the task pane
4. See **[Configuration Guide](CONFIGURATION.md)** → Multiple Reference Files

---

## Tips for Best Results

### Column Setup
- Keep input and output columns in the same worksheet
- Use clear, descriptive column names
- Avoid special characters in column headers

### Reference Files
- Organize by terminology domain (materials, processes, etc.)
- Keep reference files up to date
- Use absolute paths in configuration

### Performance
- Load frequently-used mappings first
- Use local server for fastest response
- Configure web search API for better online research

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

### Documentation
- **[Installation Guide](INSTALLATION.md)** - Setup instructions
- **[Configuration Guide](CONFIGURATION.md)** - Advanced settings
- **[Developer Guide](DEVELOPER.md)** - For modifying the code
- **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues

---

## Summary

You've completed the setup and should now have:
✅ Python server running
✅ Configuration loaded
✅ TermNorm tracking active
✅ Successfully normalized your first term

Next steps:
- Configure advanced options in **[CONFIGURATION.md](CONFIGURATION.md)**
- Add more reference files for your terminology domains
- Set up multi-user access if working in a team
- Explore the full feature set

Happy normalizing! 🎉

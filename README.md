# Get Started with TermNorm in Excel

[[IMAGE OF OPENED Add-In taskpane on the side, and some standardized cells]]

This is a basic Excel add-in that automatically standardizes terminology in Excel cells as you work, using configurable mappings and AI-powered matching. Monitor cells in real-time, apply standardization rules, and track processing activity with an intuitive interface.

The TermNorm Add-in is used for assigning one term to the best match of a user-defined set of reference names, and can also be used for classification.

The TermNorm Add-in integrates with a Python backend server for internet search to pass that info to a chat model requests to provide real-time term standardization.

## Key Features

- **Real-time Cell Monitoring** - Automatically detects and processes cell changes
- **AI-Powered Research & Matching** - Core `/research-and-match` endpoint performs web research + LLM ranking + token matching
- **Intelligent Candidate Ranking** - Uses LLM integration to rank and evaluate terminology matches
- **Clear Configuration** - Single file config management with drag & drop support
- **Activity Tracking** - In-Excel view of processing history and ranked candidate results
- **Persistent Logging** - Comprehensive logging of all mapping actions and decisions
- **Flexible Mapping System** - Support for multiple mapping sources and reference files
- **Color-Coded Results** - Visual feedback for normalization status and confidence levels
- **Ultra-lean Backend** - Focused architecture with only essential endpoints for maximum performance

## Quick Start

### Prerequisites

- Microsoft Excel (desktop or Microsoft 365)
- Python (latest version)

### Installation

1. **Install the Excel add-in** - Upload `manifest-cloud.xml` to Excel (365 Cloud) or sideload for desktop
2. **Set up Python backend** - Activate venv and run `python -m uvicorn main:app --reload` in `backend-api/`
3. **Configure your project** - Create and load `app.config.json` with your column mappings and reference files
4. **Start tracking** - Click "Activate Tracking" to begin monitoring cells

📖 **[Full Installation Guide](docs/INSTALLATION.md)** for detailed setup instructions

## Documentation

- **[Installation Guide](docs/INSTALLATION.md)** - Complete setup instructions for Excel add-in and Python backend
- **[Usage Guide](docs/USAGE.md)** - How to use the add-in for term normalization
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues, multi-user setup, and production deployment
- **[Code Exploration](docs/CODE_EXPLORATION.md)** - Sample files, customization options, and community engagement

## How It Works

1. **Select a cell** in your configured input column
2. **Type a term** and press Enter
3. **Automatic normalization** - The system performs:
   - Quick lookup for existing mappings
   - Fuzzy matching for similar terms
   - LLM-powered research and ranking (requires internet)
4. **Review results** in the Tracking Results panel
5. **Apply suggestions** to update the target column

## Copyright

Copyright (c) 2025 Runfish-data. All rights reserved. For more information, contact uniquedave@gmail.com with any additional questions or comments.


# Get Started with TermNorm in Excel

[[IMAGE OF OPENED Add-In taskpane on the side, and some standardized cells]]


This is a basic Excel add-in that automatically standardizes terminology in Excel cells as you work, using configurable mappings and AI-powered matching. Monitor cells in real-time, apply standardization rules, and track processing activity with an intuitive interface.
The TermNorm Add-in is used for assigning one term to the best match of a user-defined set of reference names, and can also be used for classification.
The TermNorm Add-in integrates with a Python backend server for internet search to pass that info to a chat model requests to provide real-time term standardization.

## Key Features

- **Real-time Cell Monitoring** - Automatically detects and processes cell changes
- **AI-Powered Research & Matching** - Core `/research-and-match` endpoint performs web research + LLM ranking + token matching
- **Intelligent Candidate Ranking** - Uses LLM integration to rank and evaluate terminology matches
- **Clear Configuration** - Single file config management with drag & drop support
- **Activity Tracking** - In-Excel view of processing history and ranked candidate results
- **Persistent Logging** - Comprehensive logging of all mapping actions and decisions
- **Flexible Mapping System** - Support for multiple mapping sources and reference files
- **Color-Coded Results** - Visual feedback for normalization status and confidence levels
- **Ultra-lean Backend** - Focused architecture with only essential endpoints for maximum performance

## How to run the TermNorm Add-In

### Prerequisites

- Microsoft Excel installed on your system or licence for the cloud version (Microsoft 365 subscription).
- Python (latest version). Visit the Python.org site to download and install the right version for your operating system. To verify if you've already installed Python, run the command `python -v` in your terminal.

### Add the add-in to Excel

#### 365 Cloud setup
1. Download the 'manifest-cloud.xml' from https://github.com/runfish5/TermNorm-excel/blob/master/manifest-cloud.xml

2. In the Excel 'Home' tab, click on 'Add-ins', then 'My Add-ins', then 'Upload my Add-in' 

3. In the popup, click on browse to pick the 'manifest-cloud.xml'

4. Now the taskpane that is displayed in the image at the top should be visible. If not, you did something wrong, try solve it otherwise contact me.


### Run the add-in

#### Define your project configurations

1. **Open your Excel workbook** where you want to use TermNorm.

2. **Create your configuration file.**
  - Create an `app.config.json` file as shown below
      - To customize for your project, define your `"coumn_map"` and `"standard_mappings"`. You can add more than one.
      - Every project configuraiton is stored inside the brackets here: `{"excel-projects": {<HERE>}}` and has the following structure:
  - Include file paths, worksheet names, source and target columns for each mapping reference
  - Example:
  ```json

  {
    "excel-projects": {
      "Book 32.xlsx": {
        "column_map": {
          "name_of_your_input_column": "name_of_mapped_output_column",
          "b": "b_std"
        },
        "default_std_suffix": "standardized",
        "standard_mappings": [
          {
            "mapping_reference": "C:\\Users\\jon\\ReferenceTerms.xlsx",
            "worksheet": "Materials",
            "source_column": "",
            "target_column": "ISO"
          },
          {
            "mapping_reference": "C:\\Users\\jon\\MoreTerms.xlsx",
            "worksheet": "Processing",
            "source_column": "",
            "target_column": "BFO"
          }
        ]
      }
    }
  }
  ```

3. **Load your configuration.**
   For 365 Cloud environment:
   - In the TermNorm interface, locate the drag-and-drop field
   - Drop your `app.config.json` file into the field
   - The configuration will appear in the user interface

   For local Excel
   - Save your `app.config.json` at `C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\config\app.config.json`
   - Use the **Load Config** button to reload existing configuration


4. **Set up the Python server.**
   - Open the terminal using `windows-key` and type 'cmd' in the search, click on 'command prompt'.
   - Navigate to the `\OfficeAddinApps\TermNorm-excel\backend-api` directory
      ```bash
      cd C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\backend-api
      ```
   - Create and activate a virtual environment:
     ```bash
     .\venv\Scripts\activate
     ```

   - **Configure users** (for multi-user access):
     Edit `backend-api/config/users.json` to add allowed IPs:
     ```json
     {
       "users": {
         "admin": {
           "email": "admin@company.com",
           "allowed_ips": ["127.0.0.1"]
         }
       }
     }
     ```

   - **Configure LLM provider**:
     Set Groq or OpenAI API keys in your environment for research-and-match functionality

   - **Start the Python server**
      - Local Development (default: `http://127.0.0.1:8000`)
      ```bash
      python -m uvicorn main:app --reload
      ```

      - Network based (team/production):
      ```bash
      python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
      ```

   - **Configure Server URL in Excel** (if needed):
      - Open TermNorm → **Settings** tab
      - Update "Server URL" field to match your backend location:
        - Local: `http://127.0.0.1:8000` (default)
        - Network: `http://192.168.1.100:8000` (example)
        - Production: `https://api.yourcompany.com`
      - No save button needed - updates instantly

6. **Load mapping files.**
   - For each Excel reference file, click **Browse**
   - Select the corresponding Excel file
   - Click **Load Mapping Table**
   - Repeat for all reference files

---
Note: Setup complete

#### Start tracking

7. **Activate tracking.**
   - Navigate to **Load Configuration**
   - Click the **Activate Tracking** button

8. **Trouble shoting.**
- Monitor real-time processing through the Activity Feed UI component
- Check server status using the status indicator in the task pane
- Wait for user instruction before running any validation or testing commands



## Use the TermNorm add-in

1. **Select a cell** in your predefined columns within the current worksheet.
2. **Type a term** that you want to standardize.
3. **Press Enter** to trigger the normalization process.
4. The system will automatically perform:
   - Quick lookup for existing mappings
   - Fuzzy matching for similar terms
   - Advanced search with indexing and API requests (requires internet)
5. it will update the target_column automatically. 
6. View results in the **Tracking Results** panel. The taskpane should now show under 'Tracking Results>Candidate Ranked' a table with the best candidates. You can select any better one and then click "apply-first" to update the target_column.

When a term is standardized, it will also create an entry in the *log*-file (`C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\backend-api\logs\activity.jsonl`). And when you click "apply-first", it will also log it.

7. Switch between **History** and **Candidate Ranked** views

## Explore sample files

These are the important files in the sample project.
<THIS IS A DUMMY>
```
| manifest.xml                  Manifest file
| src/                          Add-in source code
|   | taskpane/
|   |   | taskpane.css          Task pane style
|   |   | taskpane.html         Task pane entry HTML
|   |   | taskpane.js           Office JS API calls and add-in logic
| webpack.config.js             Webpack config
```

## Troubleshooting

If you have problems running the sample, take the following steps:

- Read the sys-status message.
- Check server status by clicking on the server-status-led and subsequently hover over it. if the server is online, it should turn green.
- **Close any open instances of Excel.**
- **Stop the Python server** by pressing `Ctrl+C` in the terminal where it's running.
- **Check your configuration file** - verify JSON syntax in `app.config.json`.
- **Verify file paths** - ensure all mapping reference files exist at the specified locations.
- **Try running again.**

### Multi-User Setup

The backend supports multiple concurrent users with IP-based authentication. Stateless backend - each request is independent. No session management.

**Add users** - Edit `backend-api/config/users.json`:
```json
{
  "users": {
    "admin": {
      "email": "admin@company.com",
      "allowed_ips": ["127.0.0.1", "192.168.1.134"]
    },
    "john": {
      "email": "john@company.com",
      "allowed_ips": ["192.168.1.100"]
    }
  }
}
```

**Stateless Architecture:**
- Users authenticated by IP address (hot-reloaded from users.json)
- No backend sessions - each request is independent
- Frontend sends terms array with each LLM request
- Multiple users can make concurrent requests without interference

### Cloud/Production Server Setup

For production deployment:

1. **Add users with their actual IPs** in `backend-api/config/users.json`

2. **Start network server:**
   ```bash
   python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

If you still have problems, see {{TROUBLESHOOT_DOCS_PLACEHOLDER}} or create a GitHub issue and we'll help you.

## Make code changes

Once you understand the sample, make it your own! All the information about {{TERMNORM_DOCUMENTATION_PLACEHOLDER}} is found in our official documentation. You can also explore more samples in {{SAMPLES_LOCATION_PLACEHOLDER}}.

Key areas for customization:
- **Configuration mappings** - Add or modify column mappings in `app.config.json`
- **Reference files** - Update Excel files with your standardization data
- **API integrations** - Configure external services for advanced search
- **Fuzzy matching parameters** - Adjust similarity thresholds

If you edit the configuration as part of your changes, validate your JSON syntax using {{JSON_VALIDATOR_PLACEHOLDER}}.

## Engage with the team

Did you experience any problems with the sample? Create an issue and we'll help you out.

Want to learn more about new features and best practices for {{PLATFORM_NAME_PLACEHOLDER}}? Join the {{COMMUNITY_CALL_PLACEHOLDER}}.

## Copyright

Copyright (c) 2025 Runfish-data. All rights reserved. For more information, contact uniquedave@gmail.com with any additional questions or comments.
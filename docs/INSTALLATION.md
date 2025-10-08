# Installation Guide

## Prerequisites

- Microsoft Excel installed on your system or licence for the cloud version (Microsoft 365 subscription).
- Python (latest version). Visit the Python.org site to download and install the right version for your operating system. To verify if you've already installed Python, run the command `python -v` in your terminal.

## Add the add-in to Excel

### 365 Cloud setup
1. Download the 'manifest-cloud.xml' from https://github.com/runfish5/TermNorm-excel/blob/master/manifest-cloud.xml

2. In the Excel 'Home' tab, click on 'Add-ins', then 'My Add-ins', then 'Upload my Add-in'

3. In the popup, click on browse to pick the 'manifest-cloud.xml'

4. Now the taskpane that is displayed in the image at the top should be visible. If not, you did something wrong, try solve it otherwise contact me.


## Run the add-in

### Define your project configurations

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

### Start tracking

7. **Activate tracking.**
   - Navigate to **Load Configuration**
   - Click the **Activate Tracking** button

8. **Trouble shoting.**
- Monitor real-time processing through the Activity Feed UI component
- Check server status using the status indicator in the task pane
- Wait for user instruction before running any validation or testing commands

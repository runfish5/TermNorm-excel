# Get Started with TermNorm in Excel

[[IMAGE OF OPENED Add-In taskpane on the side, and some standardized cells]]


This is a basic Excel add-in that automatically standardizes terminology in Excel cells as you work, using configurable mappings and AI-powered matching. Monitor cells in real-time, apply standardization rules, and track processing activity with an intuitive interface.
The TermNorm Add-in is used for assigning one term to the best match of a user-defined set of reference names, and can also be used for classification.
The TermNorm Add-in integrates with a Python backend server for internet search to pass that info to a chat model requests to provide real-time term standardization.

## Key Features

- **Real-time Cell Monitoring** - Automatically detects and processes cell changes
- **AI-Powered Normalization** - Uses LLM integration for intelligent term matching and generation
- **Multiple Processing Strategies** - Cached lookups, API calls, and fuzzy matching
- **Clear Configuration** - One file config management
- **Activity Tracking** - In-Excel view processing history and candidate rankings
- **Persistant logs** - saves all mapping actions of users.
- **Flexible Mapping System** - Support for multiple mapping sources and standard mappings
- **Color-Coded Results** - Visual feedback for normalization status
- **Easily expandable** - DIY or contact me to get offer for additional features

## How to run the TermNorm Add-In

### Prerequisites

- Microsoft Excel installed on your system or licence for the cloud version (Microsoft 365 subscription).
- Python (latest version). Visit the Python.org site to download and install the right version for your operating system. To verify if you've already installed Python, run the command `python -v` in your terminal.
- API key of groq.com  (free) or OpenAI.

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

   - **Start the Python server**
      - Local Development
      ```bash
      python -m uv corn main:app --reload
      ```
      The server will start and be ready to handle term normalization requests.

      - Network based:
      You first must set your password, but the start command is almost the same.
      ```bash
      set TERMNORM_API_KEY=mycatlikesfish 
      python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
      ```
   
6. **Load mapping files.**
   - For each Excel reference file, click **Browse**
   - Select the corresponding Excel file
   - Click **Load Mapping Table**
   - Repeat for all reference files

7. **Activate tracking.**
   - Navigate to **Load Configuration**
   - Click the **Activate Tracking** button

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

### Cloud/Production Server Setup

For production deployment:

1. **Set your API key:**
   ```bash
   set TERMINAL_API_KEY=your_password_here
   ```

2. **Start the production server:**
   ```bash
   python -m uv corn main:app --host 0.0.0.0 --port 8000 --reload
   ```

3. **Configure API key in settings:**
   - Go to **Settings** in the TermNorm interface
   - Enter your API key

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
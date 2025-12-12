# Troubleshooting

## General Troubleshooting

If you have problems running the sample, take the following steps:

- Read the sys-status message.
- Check server status by clicking on the Py-Server indicator in the navbar - if online, it shows green.
- **Close any open instances of Excel.**
- **Stop the Python server** by pressing `Ctrl+C` in the terminal where it's running.
- **Check your configuration file** - verify JSON syntax in `app.config.json`.
- **Verify file paths** - ensure all mapping reference files exist at the specified locations.
- **Try running again.**

## Backend Server Issues

### Server Appears to Hang / No Response from Endpoints

**Symptoms:**
- Backend terminal shows no new logs
- Endpoints don't respond (e.g., `/test-connection`, `/docs` hang forever)
- Py-Server indicator stays red (offline)
- Browser requests never complete

**Critical Diagnostic - Press Ctrl+C:**

Press `Ctrl+C` in the backend terminal to flush buffered logs and reveal what's happening:

- **If logs appear** (especially `OPTIONS /test-connection HTTP/1.1` requests): Server was stuck processing CORS preflight requests
- **If no logs appear**: Server is completely hung during startup

**Fix:**
1. Kill the hung process completely (press Ctrl+C multiple times if needed)
2. Check for stale connections: `netstat -ano | findstr ":8000"`
3. If port is still in use, kill the process: `taskkill /F /PID <pid>`
4. Restart fresh with `start-server-py-LLMs.bat`

### Port 8000 Already in Use

**Check what's using the port:**
```bash
netstat -ano | findstr ":8000"
```

**Kill stale Python process:**
```bash
# Find PID from netstat output, then:
taskkill /F /PID <pid>
```

### CORS Preflight Requests Hanging

**Symptom:** After pressing Ctrl+C, you see many stuck OPTIONS requests:
```
INFO:     127.0.0.1:65086 - "OPTIONS /test-connection HTTP/1.1" 200 OK
INFO:     127.0.0.1:59464 - "OPTIONS /test-connection HTTP/1.1" 200 OK
```

**Cause:** Server has accumulated stale socket connections (CLOSE_WAIT state) that block new requests.

**Fix:** Restart server with clean state (see steps above).

## Frontend Add-in Issues

### "Load Mapping Table" Button Does Nothing

**Troubleshooting steps:**
1. Check Py-Server indicator - if red, backend is offline (see Backend Server Issues above)
2. Open browser console (`F12` in Excel task pane) - look for JavaScript errors or network failures
3. Check Settings tab - verify "Require server connection" setting
4. If offline mode is acceptable, uncheck "Require server connection" to work with exact/fuzzy matching only

### Add-in Not Working After Sideload

**Symptoms:**
- Add-in loads but buttons don't respond
- Missing UI elements compared to source code
- Strange behavior after switching between sideload and dev mode

**Fix:**
1. **Rebuild dist folder:** `npm run build`
2. **Clear Excel cache:**
   - Close ALL Excel instances completely
   - Clear Office add-in cache (varies by OS)
3. **Restart Excel** and reload add-in
4. **For development:** Use `npm start` (dev mode) instead of sideload - it serves fresh files with hot reload

### UI Shows Outdated Content

If the add-in UI doesn't match the latest code changes:
1. Rebuild: `npm run build`
2. Hard refresh in Excel task pane (if available)
3. Or restart Excel completely

## Multi-User Setup

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
      "allowed_ips": ["10.0.0.100"]
    }
  }
}
```

**Stateless Architecture:**
- Users authenticated by IP address (hot-reloaded from users.json)
- No backend sessions - each request is independent
- Frontend sends terms array with each LLM request
- Multiple users can make concurrent requests without interference

## Cloud/Production Server Setup

For production deployment:

1. **Add users with their actual IPs** in `backend-api/config/users.json`

2. **Start network server:**
   ```bash
   python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

## Windows Server / IIS Deployment Issues

### 401.3 Unauthorized Error

If browser shows "401.3 Unauthorized" when testing `http://localhost:8080/taskpane.html`:

- The files are in a user folder that IIS cannot access
- Solution: Deploy files to `C:\inetpub\wwwroot\termnorm\` where IIS has full access (see INSTALLATION.md for PowerShell deployment commands)

### Add-in doesn't appear in SHARED FOLDER

- Verify manifest copied to `\\SERVERNAME\OfficeAddIns\`
- Check users configured Trusted Catalog correctly
- Ensure network path is accessible to users
- Restart Excel after adding catalog

### Network connectivity error when loading add-in

- Test the URL in browser: `http://SERVERNAME:8080/taskpane.html`
- Check IIS website is running (IIS Manager → Sites → TermNorm → State: Started)
- Verify firewall allows port 8080
- Ensure manifest URLs match server configuration

### Excel loads old version after deployment update

If Excel shows an old build (check build date in "About & Version Info") even after redeploying:

1. **Close all Excel windows/processes** (verify in Task Manager - no EXCEL.EXE running)

2. **Clear Office add-in cache**:
   ```cmd
   rd /s /q "%LOCALAPPDATA%\Microsoft\Office\16.0\Wef"
   rd /s /q "%LOCALAPPDATA%\Microsoft\Office\16.0\WEF"
   ```

3. **Clear browser cache** (Office uses Edge WebView):
   ```cmd
   rd /s /q "%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Cache"
   ```

4. **Remove and re-add the add-in**:
   - Open Excel
   - Insert → My Add-ins → Three dots menu → Remove TermNorm
   - Close Excel completely
   - Reopen Excel
   - Insert → My Add-ins → SHARED FOLDER → Add TermNorm

5. **Verify correct version loaded**:
   - Open TermNorm task pane
   - Check "About & Version Info" → Build date should match deployment date
   - Verify expected configuration changes appear

### HTTPS Configuration (recommended for production)

To use HTTPS instead of HTTP:

1. Obtain SSL certificate for your server
2. Bind certificate to IIS website (Port 443)
3. Rebuild with HTTPS URL:
   ```bash
   set DEPLOYMENT_URL=https://SERVERNAME/termnorm/
   npm run build
   ```
4. Redeploy to IIS

---

If you still have problems, create a GitHub issue and we'll help you.

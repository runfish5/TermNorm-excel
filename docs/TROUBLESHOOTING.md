# Troubleshooting

## General Troubleshooting

If you have problems running the sample, take the following steps:

- Read the sys-status message.
- Check server status by clicking on the server-status-led and subsequently hover over it. if the server is online, it should turn green.
- **Close any open instances of Excel.**
- **Stop the Python server** by pressing `Ctrl+C` in the terminal where it's running.
- **Check your configuration file** - verify JSON syntax in `app.config.json`.
- **Verify file paths** - ensure all mapping reference files exist at the specified locations.
- **Try running again.**

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

## Cloud/Production Server Setup

For production deployment:

1. **Add users with their actual IPs** in `backend-api/config/users.json`

2. **Start network server:**
   ```bash
   python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

If you still have problems, see {{TROUBLESHOOT_DOCS_PLACEHOLDER}} or create a GitHub issue and we'll help you.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2025-11-16

### Key Improvements for Users

**Enterprise Deployment**
- Windows Server deployment with IIS (industry-standard approach for internal networks)
- Simplified deployment with automated scripts
- Comprehensive troubleshooting guides for IT administrators

**Performance & Reliability**
- Faster matching with per-user caching
- More reliable session-based architecture
- Better error handling and recovery

**User Experience**
- Professional loading animations (sandclock indicator)
- Smoother cell updates during normalization
- Better visual feedback throughout the application

**Enhanced Search Capabilities**
- Brave API integration for improved web research
- More reliable web scraping with fallback providers
- Better handling of search failures

**Improved Setup**
- Better virtual environment location (project directory instead of backend-api/)
- Auto-detect Python command (python or py)
- Automated server startup with diagnostics

**Documentation & Support**
- Inline troubleshooting in installation guide
- Step-by-step manual deployment instructions
- Clear Excel cache clearing procedures
- Architecture documentation for developers

### Technical Changes

**Architecture**
- Session-based architecture (replaced caching system)
- 8-phase maintainability refactor for session management
- Centralized warning badge system

**Development & Deployment**
- Script organization into subdirectories (build/, deployment/)
- Webpack config updates (config folder in build output)
- PowerShell quote escaping fixes in deployment scripts
- Ultra-optimized server startup script

**Code Quality**
- Replace template placeholders with TermNorm branding
- Remove obsolete development documentation
- Remove outdated API key authentication system

**Bug Fixes**
- Excel cache clearing for deployment updates
- Target cells immediate update during sequential normalization
- Documentation alignment with venv path changes
- Web scraping fallbacks and error handling

## [1.0.0] - 2025-11-12

Initial release with core functionality:
- Excel add-in for term normalization
- Backend API with LLM integration
- Fuzzy matching and caching
- Real-time cell tracking
- Configuration management

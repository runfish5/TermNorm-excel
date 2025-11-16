# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2025-11-16

### Added
- Windows Server deployment with IIS (standard Microsoft approach)
- Per-user matcher caching for improved performance
- Automated server startup script improvements
- Template example project in app.config.json
- Animated loading indicators with emoji rotation
- Comprehensive troubleshooting guide (backend and frontend)
- Inline troubleshooting in INSTALLATION.md (manual deployment, Excel cache clearing)
- CLAUDE.md architecture overview
- Auto-detect python command (python or py)
- Brave API integration for web search

### Fixed
- Deployment script issues (webpack config folder inclusion)
- PowerShell quote escaping in deployment scripts
- Target cells immediate update during sequential normalization
- Documentation alignment with venv path changes
- Web scraping fallbacks and error handling

### Changed
- Session-based architecture (replaced caching system)
- 8-phase maintainability refactor for session management
- Script organization into subdirectories (build/, deployment/)
- Replace template placeholders with TermNorm branding
- Centralized warning badge system
- Ultra-optimized server startup script
- README reorganization with workflow diagram at top

### Removed
- Obsolete development documentation
- Outdated API key authentication system

## [1.0.0] - 2025-11-12

Initial release with core functionality:
- Excel add-in for term normalization
- Backend API with LLM integration
- Fuzzy matching and caching
- Real-time cell tracking
- Configuration management

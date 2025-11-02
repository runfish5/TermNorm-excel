# Changelog

All notable changes to TermNorm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2025-01-02

### Added
- Real-time cell monitoring for automatic terminology normalization
- AI-powered term matching with Groq/OpenAI integration
- 4-tier web search fallback: Brave API → SearXNG → DuckDuckGo → Bing
- Fuzzy matching algorithms for approximate matches
- Multi-user support with IP-based authentication
- Configurable mapping system via JSON configuration
- Drag & drop configuration loading (Microsoft 365)
- Activity logging and audit trail
- Server status indicators (LED and connection monitoring)
- Offline mode with cached mappings
- Sideloading instructions for Excel Desktop
- Comprehensive disclaimers and security documentation
- Version control strategy for client releases

### Features
- Exact match lookup (cached)
- Fuzzy matching with configurable thresholds
- LLM-powered research and ranking
- Multi-source candidate ranking
- Color-coded confidence indicators
- In-Excel activity tracking view
- Hot-reload for user configuration

### Documentation
- Comprehensive German installation guide (CLIENT_INSTALLATION_de.md)
- English installation guide (INSTALLATION.md)
- Backend setup guide
- Troubleshooting guide
- Usage guide
- Version control and security guidelines

### Known Limitations
- Performance optimization ongoing for large datasets (>1000 terms)
- LLM requests may take 5-10 seconds on first use
- Single Excel instance per workbook
- Requires manual validation of AI suggestions

### Requirements
- Python 3.9+
- Microsoft Excel (Desktop or Microsoft 365)
- Groq or OpenAI API key
- Windows or macOS

[Unreleased]: https://github.com/runfish5/TermNorm-excel/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/runfish5/TermNorm-excel/releases/tag/v1.0.0
